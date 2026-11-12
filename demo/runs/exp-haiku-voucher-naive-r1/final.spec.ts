import { applyVoucher, Voucher } from '../../src/voucher';

const NOW = new Date('2026-10-19T00:00:00Z');
const FAR_FUTURE = new Date('2030-01-01T00:00:00Z');

const makeVoucher = (overrides: Partial<Voucher> = {}): Voucher => ({
  code: 'SALE',
  percent: 10,
  maxDiscount: 50_000,
  minOrder: 100_000,
  expiresAt: FAR_FUTURE,
  ...overrides,
});

describe('applyVoucher', () => {
  describe('tính giảm giá', () => {
    it('giảm theo phần trăm khi số tiền giảm chưa chạm maxDiscount', () => {
      const v = makeVoucher({ percent: 10, maxDiscount: 50_000 });

      expect(applyVoucher(200_000, v, NOW)).toBe(180_000);
    });

    it('giới hạn số tiền giảm ở maxDiscount khi phần trăm cho ra số lớn hơn', () => {
      const v = makeVoucher({ percent: 50, maxDiscount: 100_000 });

      // 50% của 1_000_000 = 500_000 > 100_000 → chỉ giảm 100_000
      expect(applyVoucher(1_000_000, v, NOW)).toBe(900_000);
    });

    it('giảm đúng maxDiscount khi phần trăm bằng đúng ngưỡng', () => {
      const v = makeVoucher({ percent: 50, maxDiscount: 100_000 });

      // 50% của 200_000 = 100_000 = maxDiscount
      expect(applyVoucher(200_000, v, NOW)).toBe(100_000);
    });

    it('trả về số tiền có phần thập phân khi tiền giảm không nguyên', () => {
      const v = makeVoucher({ percent: 10, maxDiscount: 1_000, minOrder: 0 });

      // 333 - 33.3 = 299.7
      expect(applyVoucher(333, v, NOW)).toBeCloseTo(299.7, 5);
    });

    it('percent = 100 và maxDiscount đủ lớn thì đơn được miễn phí hoàn toàn', () => {
      const v = makeVoucher({ percent: 100, maxDiscount: 1_000_000_000, minOrder: 0 });

      expect(applyVoucher(80_000, v, NOW)).toBe(0);
    });

    it('total = 0 và minOrder = 0 thì trả về 0', () => {
      const v = makeVoucher({ minOrder: 0 });

      expect(applyVoucher(0, v, NOW)).toBe(0);
    });
  });

  describe('điều kiện minOrder', () => {
    it('áp dụng voucher khi total đúng bằng minOrder (ranh giới)', () => {
      const v = makeVoucher({ percent: 10, maxDiscount: 50_000, minOrder: 100_000 });

      expect(applyVoucher(100_000, v, NOW)).toBe(90_000);
    });

    it('giữ nguyên total khi total thấp hơn minOrder 1 đơn vị', () => {
      const v = makeVoucher({ minOrder: 100_000 });

      expect(applyVoucher(99_999, v, NOW)).toBe(99_999);
    });
  });

  describe('hạn sử dụng', () => {
    it('giữ nguyên total khi thời điểm hiện tại vượt expiresAt', () => {
      const v = makeVoucher({ expiresAt: new Date('2026-10-18T00:00:00Z') });

      expect(applyVoucher(200_000, v, NOW)).toBe(200_000);
    });

    it('giữ nguyên total khi thời điểm hiện tại đúng bằng expiresAt (ranh giới hết hạn)', () => {
      const expiresAt = new Date('2026-10-19T00:00:00Z');
      const v = makeVoucher({ expiresAt });

      expect(applyVoucher(200_000, v, expiresAt)).toBe(200_000);
    });

    it('vẫn áp dụng khi còn cách expiresAt 1 ms', () => {
      const expiresAt = new Date('2026-10-19T00:00:00Z');
      const v = makeVoucher({ percent: 10, maxDiscount: 50_000, minOrder: 0, expiresAt });
      const justBefore = new Date(expiresAt.getTime() - 1);

      expect(applyVoucher(200_000, v, justBefore)).toBe(180_000);
    });
  });

  describe('validate đầu vào', () => {
    it('ném lỗi INVALID_TOTAL khi total âm', () => {
      const v = makeVoucher();

      expect(() => applyVoucher(-1, v, NOW)).toThrow('INVALID_TOTAL');
    });

    it('vẫn ném lỗi INVALID_TOTAL khi total âm dù voucher đã hết hạn', () => {
      const v = makeVoucher({ expiresAt: new Date('2026-01-01T00:00:00Z') });

      expect(() => applyVoucher(-100, v, NOW)).toThrow('INVALID_TOTAL');
    });
  });

  describe('tham số now mặc định', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('dùng thời gian hệ thống khi không truyền now (voucher còn hạn)', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-19T00:00:00Z'));
      const v = makeVoucher({ percent: 10, maxDiscount: 50_000, minOrder: 0, expiresAt: new Date('2026-10-20T00:00:00Z') });

      expect(applyVoucher(200_000, v)).toBe(180_000);
    });

    it('dùng thời gian hệ thống khi không truyền now (voucher đã hết hạn)', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-19T00:00:00Z'));
      const v = makeVoucher({ minOrder: 0, expiresAt: new Date('2026-10-18T00:00:00Z') });

      expect(applyVoucher(200_000, v)).toBe(200_000);
    });
  });
});
