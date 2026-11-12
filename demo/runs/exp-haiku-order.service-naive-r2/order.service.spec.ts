import { OrderService, Inventory, Payment, OrderRepo, Item } from '../../src/order.service';

describe('OrderService', () => {
  let inventory: jest.Mocked<Inventory>;
  let payment: jest.Mocked<Payment>;
  let repo: jest.Mocked<OrderRepo>;
  let service: OrderService;

  beforeEach(() => {
    inventory = {
      reserve: jest.fn().mockResolvedValue(true),
      release: jest.fn().mockResolvedValue(undefined),
    };
    payment = {
      charge: jest.fn().mockResolvedValue({ ok: true, txId: 'tx-1' }),
    };
    repo = {
      save: jest.fn().mockResolvedValue({ id: 'order-1' }),
    };
    service = new OrderService(inventory, payment, repo);
  });

  describe('computeTotal', () => {
    it('trả về 0 khi không có sản phẩm', () => {
      expect(service.computeTotal([])).toBe(0);
    });

    it('tính subtotal = Σ(qty * price) và không giảm khi dưới 1.000.000', () => {
      const items: Item[] = [
        { sku: 'A', qty: 2, price: 100_000 },
        { sku: 'B', qty: 3, price: 50_000 },
      ];
      // 200.000 + 150.000 = 350.000
      expect(service.computeTotal(items)).toBe(350_000);
    });

    it('không giảm giá khi subtotal = 999.999 (ngay dưới ngưỡng)', () => {
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 999_999 }])).toBe(999_999);
    });

    it('giảm đúng 10% khi subtotal = 1.000.000 (biên dưới của ngưỡng)', () => {
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 1_000_000 }])).toBe(900_000);
    });

    it('giảm 10% khi subtotal = 1.500.000 (chưa chạm trần)', () => {
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 1_500_000 }])).toBe(1_350_000);
    });

    it('giảm đúng 200.000 khi subtotal = 2.000.000 (10% vừa bằng trần)', () => {
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 2_000_000 }])).toBe(1_800_000);
    });

    it('giới hạn mức giảm tối đa 200.000 khi 10% vượt trần', () => {
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 3_000_000 }])).toBe(2_800_000);
    });

    it('cộng subtotal trên nhiều dòng trước khi áp giảm giá', () => {
      const items: Item[] = [
        { sku: 'A', qty: 2, price: 300_000 }, // 600.000
        { sku: 'B', qty: 1, price: 500_000 }, // 500.000
      ];
      // subtotal 1.100.000 → giảm 110.000 → 990.000
      expect(service.computeTotal(items)).toBe(990_000);
    });

    it('giữ nguyên phần thập phân khi giảm giá ra số lẻ', () => {
      // subtotal 1.000.005 → giảm 100.000,5 → 900.004,5
      expect(service.computeTotal([{ sku: 'A', qty: 1, price: 1_000_005 }])).toBeCloseTo(900_004.5, 6);
    });
  });

  describe('placeOrder', () => {
    const itemA: Item = { sku: 'A', qty: 2, price: 300_000 };
    const itemB: Item = { sku: 'B', qty: 1, price: 500_000 };

    describe('validation đầu vào', () => {
      it('ném EMPTY_ORDER khi danh sách rỗng và không gọi kho, thanh toán, repo', async () => {
        await expect(service.placeOrder('cust-1', [])).rejects.toThrow('EMPTY_ORDER');
        expect(inventory.reserve).not.toHaveBeenCalled();
        expect(payment.charge).not.toHaveBeenCalled();
        expect(repo.save).not.toHaveBeenCalled();
      });

      it.each([0, -1])('ném INVALID_QTY khi qty = %p và không giữ hàng', async (qty) => {
        await expect(
          service.placeOrder('cust-1', [{ sku: 'A', qty, price: 100_000 }]),
        ).rejects.toThrow('INVALID_QTY');
        expect(inventory.reserve).not.toHaveBeenCalled();
      });

      it('ném INVALID_QTY nếu một dòng hợp lệ nhưng dòng khác có qty <= 0', async () => {
        await expect(
          service.placeOrder('cust-1', [itemA, { sku: 'B', qty: 0, price: 500_000 }]),
        ).rejects.toThrow('INVALID_QTY');
        expect(inventory.reserve).not.toHaveBeenCalled();
        expect(payment.charge).not.toHaveBeenCalled();
      });
    });

    describe('khi thành công', () => {
      it('giữ hàng từng sản phẩm theo đúng thứ tự', async () => {
        await service.placeOrder('cust-1', [itemA, itemB]);

        expect(inventory.reserve).toHaveBeenCalledTimes(2);
        expect(inventory.reserve).toHaveBeenNthCalledWith(1, 'A', 2);
        expect(inventory.reserve).toHaveBeenNthCalledWith(2, 'B', 1);
      });

      it('thu tiền đúng khách hàng với số tiền sau giảm giá', async () => {
        await service.placeOrder('cust-1', [itemA, itemB]);

        expect(payment.charge).toHaveBeenCalledTimes(1);
        expect(payment.charge).toHaveBeenCalledWith('cust-1', 990_000);
      });

      it('lưu đơn với customerId, items, total và txId từ payment', async () => {
        await service.placeOrder('cust-1', [itemA, itemB]);

        expect(repo.save).toHaveBeenCalledTimes(1);
        expect(repo.save).toHaveBeenCalledWith({
          customerId: 'cust-1',
          items: [itemA, itemB],
          total: 990_000,
          txId: 'tx-1',
        });
      });

      it('trả về id của đơn đã lưu và total', async () => {
        const result = await service.placeOrder('cust-1', [itemA, itemB]);

        expect(result).toEqual({ id: 'order-1', total: 990_000 });
      });

      it('không nhả lại hàng khi đơn thành công', async () => {
        await service.placeOrder('cust-1', [itemA, itemB]);

        expect(inventory.release).not.toHaveBeenCalled();
      });
    });

    describe('khi hết hàng (OUT_OF_STOCK)', () => {
      it('ném OUT_OF_STOCK ngay ở sản phẩm đầu tiên và không nhả hàng vì chưa giữ gì', async () => {
        inventory.reserve.mockResolvedValueOnce(false);

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('OUT_OF_STOCK:A');
        expect(inventory.release).not.toHaveBeenCalled();
        expect(payment.charge).not.toHaveBeenCalled();
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('nhả đúng hàng đã giữ khi sản phẩm thứ hai hết hàng', async () => {
        inventory.reserve
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('OUT_OF_STOCK:B');
        expect(inventory.release).toHaveBeenCalledTimes(1);
        expect(inventory.release).toHaveBeenCalledWith('A', 2);
        expect(payment.charge).not.toHaveBeenCalled();
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('nhả toàn bộ hàng đã giữ trước sản phẩm bị hết (3 dòng, dòng thứ 3 hết)', async () => {
        const itemC: Item = { sku: 'C', qty: 4, price: 10_000 };
        inventory.reserve
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false);

        await expect(service.placeOrder('cust-1', [itemA, itemB, itemC])).rejects.toThrow(
          'OUT_OF_STOCK:C',
        );
        expect(inventory.release).toHaveBeenCalledTimes(2);
        expect(inventory.release).toHaveBeenNthCalledWith(1, 'A', 2);
        expect(inventory.release).toHaveBeenNthCalledWith(2, 'B', 1);
      });
    });

    describe('khi inventory.reserve ném lỗi', () => {
      it('nhả các hàng đã giữ trước đó, không nhả dòng gây lỗi, và ném lại lỗi gốc', async () => {
        inventory.reserve
          .mockResolvedValueOnce(true)
          .mockRejectedValueOnce(new Error('NETWORK'));

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('NETWORK');
        expect(inventory.release).toHaveBeenCalledTimes(1);
        expect(inventory.release).toHaveBeenCalledWith('A', 2);
        expect(payment.charge).not.toHaveBeenCalled();
      });
    });

    describe('khi thanh toán thất bại', () => {
      it('ném PAYMENT_FAILED khi charge.ok = false và nhả toàn bộ hàng', async () => {
        payment.charge.mockResolvedValueOnce({ ok: false });

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('PAYMENT_FAILED');
        expect(inventory.release).toHaveBeenCalledTimes(2);
        expect(inventory.release).toHaveBeenNthCalledWith(1, 'A', 2);
        expect(inventory.release).toHaveBeenNthCalledWith(2, 'B', 1);
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('ném PAYMENT_FAILED khi ok = true nhưng thiếu txId và nhả toàn bộ hàng', async () => {
        payment.charge.mockResolvedValueOnce({ ok: true });

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('PAYMENT_FAILED');
        expect(inventory.release).toHaveBeenCalledTimes(2);
        expect(repo.save).not.toHaveBeenCalled();
      });

      it('nhả hàng và ném lại lỗi khi charge bị reject', async () => {
        payment.charge.mockRejectedValueOnce(new Error('GATEWAY_DOWN'));

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('GATEWAY_DOWN');
        expect(inventory.release).toHaveBeenCalledTimes(2);
        expect(inventory.release).toHaveBeenCalledWith('A', 2);
        expect(inventory.release).toHaveBeenCalledWith('B', 1);
        expect(repo.save).not.toHaveBeenCalled();
      });
    });

    describe('khi lưu đơn thất bại', () => {
      it('nhả toàn bộ hàng và ném lại lỗi của repo.save', async () => {
        repo.save.mockRejectedValueOnce(new Error('DB_DOWN'));

        await expect(service.placeOrder('cust-1', [itemA, itemB])).rejects.toThrow('DB_DOWN');
        expect(inventory.release).toHaveBeenCalledTimes(2);
        expect(inventory.release).toHaveBeenNthCalledWith(1, 'A', 2);
        expect(inventory.release).toHaveBeenNthCalledWith(2, 'B', 1);
      });
    });
  });
});
