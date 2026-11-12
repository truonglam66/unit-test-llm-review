import { OrderService, Item } from '../../src/order.service';

const itemA: Item = { sku: 'SKU-A', qty: 2, price: 500_000 };
const itemB: Item = { sku: 'SKU-B', qty: 1, price: 100_000 };

function setup() {
  const reserve = jest.fn().mockResolvedValue(true);
  const release = jest.fn().mockResolvedValue(undefined);
  const charge = jest.fn().mockResolvedValue({ ok: true, txId: 'TX-1' });
  const save = jest.fn().mockResolvedValue({ id: 'ORDER-1' });
  const service = new OrderService({ reserve, release }, { charge }, { save });
  return { service, reserve, release, charge, save };
}

describe('OrderService', () => {
  describe('computeTotal', () => {
    const single = (price: number): Item => ({ sku: 'X', qty: 1, price });

    it('trả về 0 khi không có sản phẩm', () => {
      const { service } = setup();
      expect(service.computeTotal([])).toBe(0);
    });

    it('không giảm giá khi tổng dưới 1.000.000', () => {
      const { service } = setup();
      expect(service.computeTotal([single(999_999)])).toBe(999_999);
    });

    it('giảm 10% khi tổng đúng bằng 1.000.000 (ngưỡng biên)', () => {
      const { service } = setup();
      expect(service.computeTotal([single(1_000_000)])).toBe(900_000);
    });

    it('giảm 10% khi tổng nằm giữa ngưỡng và mức trần', () => {
      const { service } = setup();
      expect(service.computeTotal([single(1_500_000)])).toBe(1_350_000);
    });

    it('mức giảm bằng đúng 200.000 khi tổng 2.000.000', () => {
      const { service } = setup();
      expect(service.computeTotal([single(2_000_000)])).toBe(1_800_000);
    });

    it('giới hạn giảm tối đa 200.000 khi 10% vượt trần', () => {
      const { service } = setup();
      expect(service.computeTotal([single(2_000_001)])).toBe(1_800_001);
      expect(service.computeTotal([single(3_000_000)])).toBe(2_800_000);
    });

    it('cộng đúng subtotal từ nhiều sản phẩm (qty * price) rồi mới áp giảm giá', () => {
      const { service } = setup();
      const items: Item[] = [
        { sku: 'A', qty: 3, price: 300_000 }, // 900.000
        { sku: 'B', qty: 2, price: 100_000 }, // 200.000
      ];
      // subtotal = 1.100.000 -> giảm 110.000 -> 990.000
      expect(service.computeTotal(items)).toBe(990_000);
    });

    it('xử lý đúng số thập phân khi tính 10%', () => {
      const { service } = setup();
      expect(service.computeTotal([single(1_234_567)])).toBeCloseTo(1_111_110.3, 6);
    });
  });

  describe('placeOrder - validation', () => {
    it('ném EMPTY_ORDER khi danh sách sản phẩm rỗng và không gọi kho', async () => {
      const { service, reserve, charge, save } = setup();
      await expect(service.placeOrder('C1', [])).rejects.toThrow('EMPTY_ORDER');
      expect(reserve).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it.each([0, -1])('ném INVALID_QTY khi qty = %p và không giữ hàng', async (qty) => {
      const { service, reserve, release } = setup();
      const items: Item[] = [itemA, { ...itemB, qty }];
      await expect(service.placeOrder('C1', items)).rejects.toThrow('INVALID_QTY');
      expect(reserve).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
    });
  });

  describe('placeOrder - happy path', () => {
    it('giữ hàng từng sản phẩm, thu tiền đã giảm giá, lưu đơn và trả về id + total', async () => {
      const { service, reserve, release, charge, save } = setup();

      const result = await service.placeOrder('C1', [itemA, itemB]);

      expect(reserve).toHaveBeenNthCalledWith(1, 'SKU-A', 2);
      expect(reserve).toHaveBeenNthCalledWith(2, 'SKU-B', 1);
      expect(reserve).toHaveBeenCalledTimes(2);

      // subtotal 1.100.000 -> giảm 110.000 -> 990.000
      expect(charge).toHaveBeenCalledWith('C1', 990_000);
      expect(save).toHaveBeenCalledWith({
        customerId: 'C1',
        items: [itemA, itemB],
        total: 990_000,
        txId: 'TX-1',
      });
      expect(result).toEqual({ id: 'ORDER-1', total: 990_000 });
      expect(release).not.toHaveBeenCalled();
    });

    it('không áp giảm giá cho đơn nhỏ hơn 1.000.000', async () => {
      const { service, charge } = setup();
      const result = await service.placeOrder('C2', [{ sku: 'S', qty: 1, price: 100 }]);
      expect(charge).toHaveBeenCalledWith('C2', 100);
      expect(result.total).toBe(100);
    });
  });

  describe('placeOrder - lỗi khi giữ hàng', () => {
    it('ném OUT_OF_STOCK ở sản phẩm đầu tiên, không nhả hàng vì chưa giữ gì', async () => {
      const { service, reserve, release, charge, save } = setup();
      reserve.mockResolvedValueOnce(false);

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('OUT_OF_STOCK:SKU-A');
      expect(release).not.toHaveBeenCalled();
      expect(charge).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('nhả lại hàng đã giữ khi sản phẩm sau hết hàng', async () => {
      const { service, reserve, release, charge, save } = setup();
      reserve.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('OUT_OF_STOCK:SKU-B');
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith('SKU-A', 2);
      expect(charge).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('nhả lại hàng đã giữ và ném lại lỗi khi reserve ném exception', async () => {
      const { service, reserve, release, charge } = setup();
      reserve.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('NETWORK'));

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('NETWORK');
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith('SKU-A', 2);
      expect(charge).not.toHaveBeenCalled();
    });
  });

  describe('placeOrder - lỗi khi thanh toán', () => {
    it('ném PAYMENT_FAILED khi ok = false và nhả toàn bộ hàng đã giữ', async () => {
      const { service, release, charge, save } = setup();
      charge.mockResolvedValueOnce({ ok: false });

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('PAYMENT_FAILED');
      expect(release).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenNthCalledWith(1, 'SKU-A', 2);
      expect(release).toHaveBeenNthCalledWith(2, 'SKU-B', 1);
      expect(save).not.toHaveBeenCalled();
    });

    it('ném PAYMENT_FAILED khi thiếu txId và nhả toàn bộ hàng đã giữ', async () => {
      const { service, release, charge, save } = setup();
      charge.mockResolvedValueOnce({ ok: true });

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('PAYMENT_FAILED');
      expect(release).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenNthCalledWith(1, 'SKU-A', 2);
      expect(release).toHaveBeenNthCalledWith(2, 'SKU-B', 1);
      expect(save).not.toHaveBeenCalled();
    });

    it('ném PAYMENT_FAILED khi txId là chuỗi rỗng', async () => {
      const { service, release, charge, save } = setup();
      charge.mockResolvedValueOnce({ ok: true, txId: '' });

      await expect(service.placeOrder('C1', [itemA])).rejects.toThrow('PAYMENT_FAILED');
      expect(release).toHaveBeenCalledWith('SKU-A', 2);
      expect(save).not.toHaveBeenCalled();
    });

    it('nhả toàn bộ hàng và ném lại lỗi khi cổng thanh toán ném exception', async () => {
      const { service, release, charge, save } = setup();
      charge.mockRejectedValueOnce(new Error('GATEWAY_TIMEOUT'));

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('GATEWAY_TIMEOUT');
      expect(release).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenNthCalledWith(1, 'SKU-A', 2);
      expect(release).toHaveBeenNthCalledWith(2, 'SKU-B', 1);
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('placeOrder - lỗi khi lưu đơn', () => {
    it('nhả toàn bộ hàng và ném lại lỗi khi repo.save thất bại', async () => {
      const { service, release, save } = setup();
      save.mockRejectedValueOnce(new Error('DB_DOWN'));

      await expect(service.placeOrder('C1', [itemA, itemB])).rejects.toThrow('DB_DOWN');
      expect(release).toHaveBeenCalledTimes(2);
      expect(release).toHaveBeenCalledWith('SKU-A', 2);
      expect(release).toHaveBeenCalledWith('SKU-B', 1);
    });
  });
});
