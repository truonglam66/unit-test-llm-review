import { applyVoucher, Voucher } from '../../src/voucher';

const NOW = new Date('2026-06-01T00:00:00Z');

const makeVoucher = (overrides: Partial<Voucher> = {}): Voucher => ({
  code: 'SALE10',
  percent: 10,
  maxDiscount: 100_000,
  minOrder: 200_000,
  expiresAt: new Date('2030-01-01T00:00:00Z'),
  ...overrides,
});

describe('applyVoucher', () => {
  describe('validation', () => {
    it('ném lỗi INVALID_TOTAL khi total âm', () => {
      expect(() => applyVoucher(-1, makeVoucher(), NOW)).toThrow('INVALID_TOTAL');
    });
  });

  describe('hạn sử dụng', () => {
    it('giữ nguyên total khi now sau expiresAt', () => {
      const voucher = makeVoucher({ expiresAt: new Date('2026-01-01T00:00:00Z') });
      expect(applyVoucher(500_000, voucher, NOW)).toBe(500_000);
    });

    it('giữ nguyên total đúng tại thời điểm expiresAt (biên bằng nhau)', () => {
      const voucher = makeVoucher();
      expect(applyVoucher(500_000, voucher, new Date(voucher.expiresAt))).toBe(500_000);
    });

    it('vẫn áp dụng voucher khi còn trước expiresAt 1ms', () => {
      const voucher = makeVoucher();
      const justBefore = new Date(voucher.expiresAt.getTime() - 1);
      expect(applyVoucher(500_000, voucher, justBefore)).toBe(450_000);
    });
  });

  describe('điều kiện minOrder', () => {
    it('giữ nguyên total khi total nhỏ hơn minOrder', () => {
      expect(applyVoucher(199_999, makeVoucher(), NOW)).toBe(199_999);
    });

    it('áp dụng voucher khi total bằng đúng minOrder', () => {
      expect(applyVoucher(200_000, makeVoucher(), NOW)).toBe(180_000);
    });
  });

  describe('tính giảm giá', () => {
    it('giảm theo percent khi chưa chạm maxDiscount', () => {
      expect(applyVoucher(300_000, makeVoucher(), NOW)).toBe(270_000);
    });

    it('giới hạn mức giảm ở maxDiscount khi percent vượt quá', () => {
      // 10% of 2_000_000 = 200_000 > maxDiscount 100_000
      expect(applyVoucher(2_000_000, makeVoucher(), NOW)).toBe(1_900_000);
    });

    it('mức giảm bằng đúng maxDiscount', () => {
      // 10% of 1_000_000 = 100_000 == maxDiscount
      expect(applyVoucher(1_000_000, makeVoucher(), NOW)).toBe(900_000);
    });

    it('percent = 0 thì không giảm', () => {
      expect(applyVoucher(300_000, makeVoucher({ percent: 0 }), NOW)).toBe(300_000);
    });

    it('percent = 100 và chưa chạm maxDiscount thì trả về 0', () => {
      const voucher = makeVoucher({ percent: 100, maxDiscount: 1_000_000, minOrder: 0 });
      expect(applyVoucher(500_000, voucher, NOW)).toBe(0);
    });

    it('percent = 100 nhưng bị giới hạn bởi maxDiscount', () => {
      const voucher = makeVoucher({ percent: 100, maxDiscount: 50_000, minOrder: 0 });
      expect(applyVoucher(500_000, voucher, NOW)).toBe(450_000);
    });

    it('total = 0 với minOrder = 0 trả về 0', () => {
      const voucher = makeVoucher({ minOrder: 0 });
      expect(applyVoucher(0, voucher, NOW)).toBe(0);
    });

    it('xử lý kết quả thập phân chính xác', () => {
      // 10% of 1001 = 100.1 -> 900.9
      const voucher = makeVoucher({ minOrder: 0, maxDiscount: 1_000_000 });
      expect(applyVoucher(1001, voucher, NOW)).toBeCloseTo(900.9, 5);
    });
  });

  describe('tham số now mặc định', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('dùng thời gian hiện tại khi không truyền now: voucher đã hết hạn', () => {
      jest.setSystemTime(new Date('2026-06-01T00:00:00Z'));
      const voucher = makeVoucher({ expiresAt: new Date('2026-01-01T00:00:00Z') });
      expect(applyVoucher(500_000, voucher)).toBe(500_000);
    });

    it('dùng thời gian hiện tại khi không truyền now: voucher còn hạn', () => {
      jest.setSystemTime(new Date('2026-06-01T00:00:00Z'));
      const voucher = makeVoucher({ expiresAt: new Date('2027-01-01T00:00:00Z') });
      expect(applyVoucher(500_000, voucher)).toBe(450_000);
    });
  });
});
