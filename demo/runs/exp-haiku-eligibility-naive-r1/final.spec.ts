import { checkEligibility } from '../../src/eligibility';

describe('checkEligibility', () => {
  describe('kiểm tra đầu vào tuổi', () => {
    it.each([-1, -100])('ném lỗi INVALID_AGE khi tuổi âm (%p)', (age) => {
      expect(() => checkEligibility(age, 10)).toThrow('INVALID_AGE');
    });

    it.each([18.5, 0.1, NaN, Infinity, -Infinity])(
      'ném lỗi INVALID_AGE khi tuổi không phải số nguyên hữu hạn (%p)',
      (age) => {
        expect(() => checkEligibility(age, 10)).toThrow('INVALID_AGE');
      },
    );

    it('ném lỗi INVALID_AGE trước khi xét thu nhập', () => {
      expect(() => checkEligibility(-1, 0)).toThrow('INVALID_AGE');
    });
  });

  describe('giới hạn tuổi', () => {
    it.each([0, 1, 17])('từ chối khi tuổi dưới 18 (%p)', (age) => {
      expect(checkEligibility(age, 100)).toBe('REJECTED');
    });

    it('từ chối khi tuổi = 17 (biên dưới ngoài khoảng)', () => {
      expect(checkEligibility(17, 100)).toBe('REJECTED');
    });

    it('chấp nhận khi tuổi = 18 (biên dưới hợp lệ)', () => {
      expect(checkEligibility(18, 8)).toBe('APPROVED');
    });

    it('chấp nhận khi tuổi = 65 (biên trên hợp lệ)', () => {
      expect(checkEligibility(65, 8)).toBe('APPROVED');
    });

    it('từ chối khi tuổi = 66 (biên trên ngoài khoảng)', () => {
      expect(checkEligibility(66, 100)).toBe('REJECTED');
    });

    it.each([80, 120])('từ chối khi tuổi quá cao (%p)', (age) => {
      expect(checkEligibility(age, 100)).toBe('REJECTED');
    });
  });

  describe('giới hạn thu nhập (triệu đồng/tháng)', () => {
    it.each([0, 1, 7, 7.99])('từ chối khi thu nhập dưới 8 (%p)', (income) => {
      expect(checkEligibility(30, income)).toBe('REJECTED');
    });

    it('từ chối khi thu nhập âm', () => {
      expect(checkEligibility(30, -5)).toBe('REJECTED');
    });

    it('chấp nhận khi thu nhập = 8 (biên hợp lệ)', () => {
      expect(checkEligibility(30, 8)).toBe('APPROVED');
    });

    it.each([8.01, 20, 1000])('chấp nhận khi thu nhập trên 8 (%p)', (income) => {
      expect(checkEligibility(30, income)).toBe('APPROVED');
    });
  });

  describe('kết hợp tuổi và thu nhập', () => {
    it('chấp nhận khi cả tuổi và thu nhập đều hợp lệ', () => {
      expect(checkEligibility(35, 20)).toBe('APPROVED');
    });

    it('từ chối khi tuổi hợp lệ nhưng thu nhập thấp', () => {
      expect(checkEligibility(35, 5)).toBe('REJECTED');
    });

    it('từ chối khi thu nhập đủ nhưng tuổi dưới 18', () => {
      expect(checkEligibility(17, 50)).toBe('REJECTED');
    });

    it('từ chối khi thu nhập đủ nhưng tuổi trên 65', () => {
      expect(checkEligibility(70, 50)).toBe('REJECTED');
    });

    it('từ chối khi cả tuổi và thu nhập đều không hợp lệ', () => {
      expect(checkEligibility(10, 1)).toBe('REJECTED');
    });
  });
});
