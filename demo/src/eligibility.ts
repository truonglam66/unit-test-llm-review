export type Decision = 'APPROVED' | 'REJECTED';

/** Duyệt hồ sơ vay theo tuổi và thu nhập tháng (triệu đồng). */
export function checkEligibility(age: number, monthlyIncome: number): Decision {
  if (!Number.isInteger(age) || age < 0) throw new Error('INVALID_AGE');
  if (age < 18) return 'REJECTED';
  if (age > 65) return 'REJECTED';
  if (monthlyIncome < 8) return 'REJECTED';
  return 'APPROVED';
}
