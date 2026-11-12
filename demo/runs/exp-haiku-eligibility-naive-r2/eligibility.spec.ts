import { checkEligibility } from '../../src/eligibility';

describe('checkEligibility', () => {
  describe('kiểm tra đầu vào tuổi', () => {
    test.each([-1, -100, 1.5, 18.5, NaN, Infinity, -Infinity])(
      'ném INVALID_AGE khi age = %p',
      (age) => {
        expect(() => checkEligibility(age, 10)).toThrow('INVALID_AGE');
      },
    );

    test('age = 0 là số nguyên hợp lệ nên không ném lỗi, bị REJECTED do dưới 18', () => {
      expect(checkEligibility(0, 10)).toBe('REJECTED');
    });
  });

  describe('tuổi ngoài khoảng 18–65', () => {
    test.each([0, 1, 12, 17])('REJECTED khi age = %p (dưới 18)', (age) => {
      expect(checkEligibility(age, 100)).toBe('REJECTED');
    });

    test.each([66, 70, 100])('REJECTED khi age = %p (trên 65)', (age) => {
      expect(checkEligibility(age, 100)).toBe('REJECTED');
    });

    test('age = 17 bị REJECTED dù thu nhập rất cao', () => {
      expect(checkEligibility(17, 1000)).toBe('REJECTED');
    });

    test('age = 66 bị REJECTED dù thu nhập rất cao', () => {
      expect(checkEligibility(66, 1000)).toBe('REJECTED');
    });
  });

  describe('biên tuổi hợp lệ', () => {
    test.each([18, 19, 40, 64, 65])('APPROVED khi age = %p và thu nhập đủ', (age) => {
      expect(checkEligibility(age, 8)).toBe('APPROVED');
    });
  });

  describe('kiểm tra thu nhập (triệu đồng/tháng)', () => {
    test.each([-5, 0, 7, 7.99])('REJECTED khi thu nhập = %p (dưới 8)', (income) => {
      expect(checkEligibility(30, income)).toBe('REJECTED');
    });

    test.each([8, 8.01, 50])('APPROVED khi thu nhập = %p (từ 8 trở lên)', (income) => {
      expect(checkEligibility(30, income)).toBe('APPROVED');
    });
  });

  describe('trường hợp tổng hợp', () => {
    test('APPROVED khi tuổi hợp lệ và thu nhập đủ', () => {
      expect(checkEligibility(30, 15)).toBe('APPROVED');
    });

    test('REJECTED khi tuổi hợp lệ nhưng thu nhập thiếu', () => {
      expect(checkEligibility(30, 5)).toBe('REJECTED');
    });

    test('REJECTED khi tuổi ngoài khoảng và thu nhập thiếu', () => {
      expect(checkEligibility(70, 1)).toBe('REJECTED');
    });

    test('lỗi INVALID_AGE được ưu tiên trước kiểm tra thu nhập', () => {
      expect(() => checkEligibility(-1, 1)).toThrow('INVALID_AGE');
    });
  });
});
