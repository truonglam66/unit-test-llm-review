export class EligibilityService {
  checkEligibility(age: number): 'APPROVED' | 'REJECTED' {
    if (age < 18) return 'REJECTED';
    if (age > 65) return 'REJECTED';
    return 'APPROVED';
  }

  isVoucherValid(expiresAt: Date): boolean {
    return expiresAt.getTime() > Date.now();
  }

  calculateFee(amount: number, rate: number): number {
    return Math.round(amount * rate * 100) / 100;
  }
}
