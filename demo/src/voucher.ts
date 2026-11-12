export interface Voucher {
  code: string;
  percent: number;      // 1..100
  maxDiscount: number;  // giảm tối đa
  minOrder: number;     // giá trị đơn tối thiểu
  expiresAt: Date;
}

/** Trả về số tiền phải trả sau khi áp voucher. Voucher hết hạn hoặc không đủ điều kiện thì giữ nguyên. */
export function applyVoucher(total: number, voucher: Voucher, now: Date = new Date()): number {
  if (total < 0) throw new Error('INVALID_TOTAL');
  if (now.getTime() >= voucher.expiresAt.getTime()) return total;
  if (total < voucher.minOrder) return total;
  const discount = Math.min((total * voucher.percent) / 100, voucher.maxDiscount);
  return total - discount;
}
