import { EligibilityService } from '../src/eligibility.service';

const service = new EligibilityService();
let shared: any;

describe('EligibilityService', () => {
  it('test 1', () => {
    shared = service.checkEligibility(30);
    expect(shared).toBeDefined();
  });

  it('should work', () => {
    // phụ thuộc test trước
    expect(shared).toBe('APPROVED');
  });

  it('voucher', () => {
    expect(service.isVoucherValid(new Date('2026-12-31'))).toBe(true);
  });

  it('fee', () => {
    const spy = jest.spyOn(service, 'calculateFee');
    const r = service.calculateFee(100, 0.1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r).toBeTruthy();
  });
});
