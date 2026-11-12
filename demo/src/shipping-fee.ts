/**
 * Phí giao hàng (nghìn đồng):
 * - Cơ bản 15; mỗi kg vượt 2kg đầu tiên +5; quãng đường > 10km thêm 2/km phần vượt.
 * - Thành viên được giảm 20%, đơn từ 500 trở lên được miễn phí.
 */
export function calculateShippingFee(weightKg: number, distanceKm: number, orderTotal: number, isMember: boolean): number {
  if (weightKg <= 0 || distanceKm < 0) throw new Error('INVALID_INPUT');
  if (orderTotal >= 500) return 0;
  let fee = 15;
  if (weightKg > 2) fee += Math.ceil(weightKg - 2) * 5;
  if (distanceKm > 10) fee += (distanceKm - 10) * 2;
  if (isMember) fee = fee * 0.8;
  return Math.round(fee * 100) / 100;
}
