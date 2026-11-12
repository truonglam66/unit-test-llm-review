import { applyVoucher, Voucher } from '../../src/voucher';

const EXPIRES_AT_ISO = '2026-12-31T00:00:00.000Z';
const BEFORE_EXPIRY_ISO = '2026-06-01T00:00:00.000Z';

// Cấu hình ví dụ: percent = 10, maxDiscount = 50000, minOrder = 200000
function makeVoucher(overrides: Partial<Voucher> = {}): Voucher {
  return {
    code: 'SAVE10',
    percent: 10,
    maxDiscount: 50000,
    minOrder: 200000,
    expiresAt: new Date(EXPIRES_AT_ISO),
    ...overrides,
  };
}

// Thời điểm cách expiresAt một khoảng ms (âm = trước hạn, dương = sau hạn)
function atExpiryOffset(ms: number): Date {
  return new Date(new Date(EXPIRES_AT_ISO).getTime() + ms);
}

function beforeExpiry(): Date {
  return new Date(BEFORE_EXPIRY_ISO);
}

describe('K1 - total âm: throw INVALID_TOTAL', () => {
  it('total = -0.01 còn hạn thì throw INVALID_TOTAL', () => {
    expect(() => applyVoucher(-0.01, makeVoucher(), beforeExpiry())).toThrow('INVALID_TOTAL');
  });

  it('total = -0.01 đã hết hạn vẫn throw INVALID_TOTAL (kiểm tra total trước kiểm tra hạn)', () => {
    expect(() => applyVoucher(-0.01, makeVoucher(), atExpiryOffset(1))).toThrow('INVALID_TOTAL');
  });

  it('total = 0 không throw và trả về 0 khi chưa đủ minOrder', () => {
    expect(applyVoucher(0, makeVoucher(), beforeExpiry())).toBe(0);
  });
});

describe('K2 - voucher hết hạn: trả nguyên total', () => {
  it('total = 0 đã hết hạn 1ms thì trả về 0', () => {
    expect(applyVoucher(0, makeVoucher(), atExpiryOffset(1))).toBe(0);
  });

  it('now đúng bằng expiresAt (so sánh bằng tính là hết hạn) thì trả nguyên total 100000', () => {
    expect(applyVoucher(100000, makeVoucher(), atExpiryOffset(0))).toBe(100000);
  });

  it('now sau expiresAt 1ms thì trả nguyên total 100000', () => {
    expect(applyVoucher(100000, makeVoucher(), atExpiryOffset(1))).toBe(100000);
  });

  it('đơn đủ minOrder nhưng đã hết hạn thì không giảm giá (trả 300000)', () => {
    expect(applyVoucher(300000, makeVoucher(), atExpiryOffset(1))).toBe(300000);
  });
});

describe('K3 - còn hạn nhưng total < minOrder: trả nguyên total', () => {
  it('total = 0 với minOrder = 200000 thì trả về 0', () => {
    expect(applyVoucher(0, makeVoucher(), beforeExpiry())).toBe(0);
  });

  it('total = 199999.99 (minOrder - 0.01) thì trả về 199999.99', () => {
    expect(applyVoucher(199999.99, makeVoucher(), beforeExpiry())).toBe(199999.99);
  });

  it('now = expiresAt - 1ms, total = 100000 (chưa đủ minOrder) thì trả về 100000', () => {
    expect(applyVoucher(100000, makeVoucher(), atExpiryOffset(-1))).toBe(100000);
  });
});

describe('K4 - đủ điều kiện, chưa chạm trần: giảm theo percent', () => {
  it('total = 200000 (đúng minOrder) thì giảm 20000 và trả về 180000', () => {
    expect(applyVoucher(200000, makeVoucher(), beforeExpiry())).toBe(180000);
  });

  it('total = 300000 thì giảm 30000 và trả về 270000', () => {
    expect(applyVoucher(300000, makeVoucher(), beforeExpiry())).toBe(270000);
  });

  it('now = expiresAt - 1ms, total = 300000 thì vẫn giảm và trả về 270000', () => {
    expect(applyVoucher(300000, makeVoucher(), atExpiryOffset(-1))).toBe(270000);
  });

  it('total = 499999.99 (discount 49999.999 < maxDiscount) thì trả về 449999.991', () => {
    expect(applyVoucher(499999.99, makeVoucher(), beforeExpiry())).toBeCloseTo(449999.991, 6);
  });
});

describe('K5 - đủ điều kiện, chạm trần: giảm đúng maxDiscount', () => {
  it('total = 500000 (discount đúng bằng maxDiscount 50000) thì trả về 450000', () => {
    expect(applyVoucher(500000, makeVoucher(), beforeExpiry())).toBe(450000);
  });

  it('now = expiresAt - 1ms, total = 1000000 thì giảm đúng 50000 và trả về 950000', () => {
    expect(applyVoucher(1000000, makeVoucher(), atExpiryOffset(-1))).toBe(950000);
  });

  it('total = 600000 (vượt trần) thì vẫn chỉ giảm 50000 và trả về 550000', () => {
    expect(applyVoucher(600000, makeVoucher(), beforeExpiry())).toBe(550000);
  });
});

describe('T - phụ thuộc thời gian: không truyền now', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('không truyền now và đồng hồ trước expiresAt thì giảm theo percent (300000 -> 270000)', () => {
    jest.setSystemTime(beforeExpiry());
    expect(applyVoucher(300000, makeVoucher())).toBe(270000);
  });

  it('không truyền now và đồng hồ đúng bằng expiresAt thì trả nguyên total 300000', () => {
    jest.setSystemTime(new Date(EXPIRES_AT_ISO));
    expect(applyVoucher(300000, makeVoucher())).toBe(300000);
  });

  it('now truyền vào được ưu tiên hơn đồng hồ hệ thống (hệ thống đã hết hạn, now còn hạn thì giảm 270000)', () => {
    jest.setSystemTime(atExpiryOffset(1));
    expect(applyVoucher(300000, makeVoucher(), beforeExpiry())).toBe(270000);
  });
});

describe('P1 - percent > 100 (ngoài miền 1..100, không có guard)', () => {
  it('percent = 101 với total = 100 thì discount = 101 và kết quả là -1 (không throw)', () => {
    expect(applyVoucher(100, makeVoucher({ percent: 101, maxDiscount: 1000, minOrder: 0 }), beforeExpiry())).toBe(-1);
  });

  it('percent = 200 với total = 100 thì discount = 200 và kết quả là -100 (không throw)', () => {
    expect(applyVoucher(100, makeVoucher({ percent: 200, maxDiscount: 1000, minOrder: 0 }), beforeExpiry())).toBe(-100);
  });
});

describe('P0 - percent < 1 (ngoài miền, không có guard)', () => {
  it('percent = 0 thì discount = 0 và trả về total 300000', () => {
    expect(applyVoucher(300000, makeVoucher({ percent: 0 }), beforeExpiry())).toBe(300000);
  });

  it('percent = -10 thì discount = -30000 và tổng tiền tăng lên 330000', () => {
    expect(applyVoucher(300000, makeVoucher({ percent: -10 }), beforeExpiry())).toBe(330000);
  });
});

describe('M - maxDiscount ngoài miền (không có guard)', () => {
  it('maxDiscount = 0 thì discount = 0 và trả về total 300000', () => {
    expect(applyVoucher(300000, makeVoucher({ maxDiscount: 0 }), beforeExpiry())).toBe(300000);
  });

  it('maxDiscount = -1 thì discount = -1 và kết quả là 300001 (lớn hơn total)', () => {
    expect(applyVoucher(300000, makeVoucher({ maxDiscount: -1 }), beforeExpiry())).toBe(300001);
  });
});
