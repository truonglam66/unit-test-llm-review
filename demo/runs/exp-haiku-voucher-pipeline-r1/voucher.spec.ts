import { applyVoucher, Voucher } from '../../src/voucher';

const EXPIRES_AT = new Date('2026-12-31T00:00:00.000Z');
const BEFORE_EXPIRY = new Date(EXPIRES_AT.getTime() - 1);
const AT_EXPIRY = new Date(EXPIRES_AT.getTime());
const AFTER_EXPIRY = new Date(EXPIRES_AT.getTime() + 1);
const NOW = new Date('2026-06-01T00:00:00.000Z');

function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    code: 'SAVE10',
    percent: 10,
    maxDiscount: 50,
    minOrder: 100,
    expiresAt: new Date(EXPIRES_AT.getTime()),
    ...overrides,
  };
}

describe('C1 – Ném lỗi khi total âm', () => {
  test('total = -0.01 ném INVALID_TOTAL khi voucher còn hạn', () => {
    expect(() => applyVoucher(-0.01, makeVoucher(), NOW)).toThrow('INVALID_TOTAL');
  });

  test('total = -100 ném INVALID_TOTAL ngay cả khi voucher đã hết hạn', () => {
    expect(() => applyVoucher(-100, makeVoucher(), AFTER_EXPIRY)).toThrow('INVALID_TOTAL');
  });

  test('total = -0.01 ném INVALID_TOTAL khi minOrder = 0', () => {
    expect(() => applyVoucher(-0.01, makeVoucher({ minOrder: 0 }), NOW)).toThrow('INVALID_TOTAL');
  });

  test('total = 0 không ném lỗi và trả về 0', () => {
    expect(applyVoucher(0, makeVoucher(), NOW)).toBe(0);
  });
});

describe('C2 – Voucher hết hạn: giữ nguyên total', () => {
  test('now sau expiresAt 1ms với total 1000 trả về 1000, không giảm 950', () => {
    expect(applyVoucher(1000, makeVoucher(), AFTER_EXPIRY)).toBe(1000);
  });

  test('now = expiresAt (mốc inclusive) vẫn coi là hết hạn, total 1000 trả về 1000', () => {
    expect(applyVoucher(1000, makeVoucher(), AT_EXPIRY)).toBe(1000);
  });

  test('total = 0 đã hết hạn trả về 0', () => {
    expect(applyVoucher(0, makeVoucher(), AFTER_EXPIRY)).toBe(0);
  });

  test('voucher hết hạn bỏ qua percent: percent = 100 vẫn trả về nguyên total 300', () => {
    const voucher = makeVoucher({ percent: 100, maxDiscount: 1000, minOrder: 0 });
    expect(applyVoucher(300, voucher, AFTER_EXPIRY)).toBe(300);
  });
});

describe('C3 – Đơn chưa đạt minOrder: giữ nguyên total', () => {
  test('total = 99.99 với minOrder = 100 trả về 99.99, không giảm', () => {
    expect(applyVoucher(99.99, makeVoucher(), NOW)).toBe(99.99);
  });

  test('total = 0 với minOrder = 100 trả về 0', () => {
    expect(applyVoucher(0, makeVoucher(), NOW)).toBe(0);
  });

  test('total = 99.99 với now = expiresAt - 1ms vẫn trả về 99.99 vì chưa đủ minOrder', () => {
    expect(applyVoucher(99.99, makeVoucher(), BEFORE_EXPIRY)).toBe(99.99);
  });

  test('minOrder = 0 thì không có nhánh C3: total 0.5 vẫn được giảm 10% thành 0.45', () => {
    expect(applyVoucher(0.5, makeVoucher({ minOrder: 0 }), NOW)).toBeCloseTo(0.45, 10);
  });
});

describe('C4a – Giảm theo phần trăm, chưa chạm trần maxDiscount', () => {
  test('total = minOrder = 100 (cạnh dưới) giảm 10% thành 90', () => {
    expect(applyVoucher(100, makeVoucher(), NOW)).toBe(90);
  });

  test('total = 200 giảm 10% thành 180', () => {
    expect(applyVoucher(200, makeVoucher(), NOW)).toBe(180);
  });

  test('total = 500 (cạnh trần T) giảm đúng 50 thành 450', () => {
    expect(applyVoucher(500, makeVoucher(), NOW)).toBe(450);
  });

  test('total = 499.99 chưa chạm trần giảm 49.999 thành 449.991', () => {
    expect(applyVoucher(499.99, makeVoucher(), NOW)).toBeCloseTo(449.991, 6);
  });

  test('now = expiresAt - 1ms vẫn còn hạn nên total 100 thành 90', () => {
    expect(applyVoucher(100, makeVoucher(), BEFORE_EXPIRY)).toBe(90);
  });
});

describe('C4b – Giảm bị chặn bởi maxDiscount', () => {
  test('total = 500.01 (T + 0.01) bị chặn ở 50 thành 450.01', () => {
    expect(applyVoucher(500.01, makeVoucher(), NOW)).toBeCloseTo(450.01, 6);
  });

  test('total = 1000 bị chặn ở maxDiscount 50 thành 950', () => {
    expect(applyVoucher(1000, makeVoucher(), NOW)).toBe(950);
  });

  test('total = 1000 với percent = 50 vẫn bị chặn ở 50 thành 950, không phải 500', () => {
    expect(applyVoucher(1000, makeVoucher({ percent: 50 }), NOW)).toBe(950);
  });

  test('now = expiresAt - 1ms vẫn áp trần: total 1000 thành 950', () => {
    expect(applyVoucher(1000, makeVoucher(), BEFORE_EXPIRY)).toBe(950);
  });
});

describe('C5 – now không truyền: dùng đồng hồ hệ thống', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('đồng hồ hệ thống = expiresAt - 1ms: không truyền now vẫn áp giảm, total 100 thành 90', () => {
    jest.setSystemTime(BEFORE_EXPIRY);
    expect(applyVoucher(100, makeVoucher())).toBe(90);
  });

  test('đồng hồ hệ thống = expiresAt: không truyền now thì voucher hết hạn, total 100 giữ nguyên', () => {
    jest.setSystemTime(AT_EXPIRY);
    expect(applyVoucher(100, makeVoucher())).toBe(100);
  });
});

describe('C6 – total là NaN (ngoài miền số)', () => {
  test('total = NaN với voucher còn hạn không ném lỗi và trả về NaN', () => {
    expect(applyVoucher(NaN, makeVoucher(), NOW)).toBe(NaN);
  });

  test('total = NaN với voucher hết hạn cũng trả về NaN, không ném lỗi', () => {
    expect(applyVoucher(NaN, makeVoucher(), AFTER_EXPIRY)).toBe(NaN);
  });
});

describe('C7 – expiresAt là Invalid Date', () => {
  test('expiresAt invalid được coi là còn hạn: total 100 thành 90', () => {
    const voucher = makeVoucher({ expiresAt: new Date('not-a-date') });
    expect(applyVoucher(100, voucher, NOW)).toBe(90);
  });

  test('expiresAt invalid vẫn áp trần maxDiscount: total 1000 thành 950', () => {
    const voucher = makeVoucher({ expiresAt: new Date('not-a-date') });
    expect(applyVoucher(1000, voucher, NOW)).toBe(950);
  });

  test('expiresAt invalid với now sau mốc hợp lệ vẫn áp giảm: total 100 thành 90', () => {
    const voucher = makeVoucher({ expiresAt: new Date('not-a-date') });
    expect(applyVoucher(100, voucher, AFTER_EXPIRY)).toBe(90);
  });
});

describe('C8a – percent trong miền hợp lệ [1, 100]', () => {
  test('percent = 1 (cạnh dưới) giảm 1 thành 99', () => {
    const voucher = makeVoucher({ percent: 1, maxDiscount: 50 });
    expect(applyVoucher(100, voucher, NOW)).toBe(99);
  });

  test('percent = 100 (cạnh trên) giảm toàn bộ thành 0', () => {
    const voucher = makeVoucher({ percent: 100, maxDiscount: 1000, minOrder: 0 });
    expect(applyVoucher(200, voucher, NOW)).toBe(0);
  });
});

describe('C8b – percent ngoài miền [1, 100], chưa được validate', () => {
  test('percent = 0 (ngoài miền, sát cạnh 1) không giảm, total 100 trả về 100', () => {
    const voucher = makeVoucher({ percent: 0 });
    expect(applyVoucher(100, voucher, NOW)).toBe(100);
  });

  test('percent = 101 (ngoài miền, sát cạnh 100) làm kết quả âm: total 500 thành -5', () => {
    const voucher = makeVoucher({ percent: 101, maxDiscount: 1000 });
    expect(applyVoucher(500, voucher, NOW)).toBe(-5);
  });

  test('percent = 150 làm kết quả âm: total 500 thành -250', () => {
    const voucher = makeVoucher({ percent: 150, maxDiscount: 1000 });
    expect(applyVoucher(500, voucher, NOW)).toBe(-250);
  });
});
