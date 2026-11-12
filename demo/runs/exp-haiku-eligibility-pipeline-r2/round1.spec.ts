import { checkEligibility } from '../../src/eligibility';

describe('checkEligibility', () => {
  describe('A1 - tuổi không phải số nguyên → throw INVALID_AGE', () => {
    test('age = 17.5 throw INVALID_AGE, không trả REJECTED dù 17.5 < 18', () => {
      expect(() => checkEligibility(17.5, 10)).toThrow('INVALID_AGE');
    });

    test('age = NaN throw INVALID_AGE', () => {
      expect(() => checkEligibility(NaN, 10)).toThrow('INVALID_AGE');
    });

    test('age = +Infinity throw INVALID_AGE', () => {
      expect(() => checkEligibility(Infinity, 10)).toThrow('INVALID_AGE');
    });

    test('age = -Infinity throw INVALID_AGE', () => {
      expect(() => checkEligibility(-Infinity, 10)).toThrow('INVALID_AGE');
    });

    test('age là chuỗi "30" (không phải number) throw INVALID_AGE', () => {
      expect(() => checkEligibility('30' as unknown as number, 10)).toThrow('INVALID_AGE');
    });
  });

  describe('A2 - tuổi là số nguyên âm → throw INVALID_AGE', () => {
    test('age = -1 (sát biên 0) throw INVALID_AGE', () => {
      expect(() => checkEligibility(-1, 10)).toThrow('INVALID_AGE');
    });

    test('age = -100 throw INVALID_AGE', () => {
      expect(() => checkEligibility(-100, 10)).toThrow('INVALID_AGE');
    });

    test('age = -1 vẫn throw INVALID_AGE khi thu nhập hợp lệ 100', () => {
      expect(() => checkEligibility(-1, 100)).toThrow('INVALID_AGE');
    });
  });

  describe('B1 - tuổi 0..17 → REJECTED', () => {
    test('age = 0 (biên dưới của lớp) → REJECTED', () => {
      expect(checkEligibility(0, 100)).toBe('REJECTED');
    });

    test('age = -0 → REJECTED (Number.isInteger(-0) true, -0 < 0 false)', () => {
      expect(checkEligibility(-0, 100)).toBe('REJECTED');
    });

    test('age = 10 (giữa lớp) → REJECTED', () => {
      expect(checkEligibility(10, 100)).toBe('REJECTED');
    });

    test('age = 17 (biên trên của lớp, sát 18) → REJECTED', () => {
      expect(checkEligibility(17, 100)).toBe('REJECTED');
    });

    test('age = 17 với thu nhập đủ 8 vẫn REJECTED, không phụ thuộc thu nhập', () => {
      expect(checkEligibility(17, 8)).toBe('REJECTED');
    });
  });

  describe('C1 - tuổi 18..65 → quyết định theo thu nhập', () => {
    test('age = 18 (biên dưới) với thu nhập 8 → APPROVED', () => {
      expect(checkEligibility(18, 8)).toBe('APPROVED');
    });

    test('age = 65 (biên trên) với thu nhập 8 → APPROVED', () => {
      expect(checkEligibility(65, 8)).toBe('APPROVED');
    });

    test('age = 18 với thu nhập 7.999 → REJECTED', () => {
      expect(checkEligibility(18, 7.999)).toBe('REJECTED');
    });

    test('age = 65 với thu nhập 7.999 → REJECTED', () => {
      expect(checkEligibility(65, 7.999)).toBe('REJECTED');
    });

    test('age = 30 với thu nhập 100 → APPROVED', () => {
      expect(checkEligibility(30, 100)).toBe('APPROVED');
    });
  });

  describe('B2 - tuổi trên 65 (>= 66) → REJECTED', () => {
    test('age = 66 (sát biên 65|66) với thu nhập 100 → REJECTED', () => {
      expect(checkEligibility(66, 100)).toBe('REJECTED');
    });

    test('age = 66 với thu nhập đủ 8 vẫn REJECTED (kiểm tra tuổi trước thu nhập)', () => {
      expect(checkEligibility(66, 8)).toBe('REJECTED');
    });

    test('age = 150 với thu nhập 100 → REJECTED', () => {
      expect(checkEligibility(150, 100)).toBe('REJECTED');
    });
  });

  describe('D1 - thu nhập < 8 → REJECTED (age = 30)', () => {
    test('thu nhập = 7.999 (sát biên 8) → REJECTED', () => {
      expect(checkEligibility(30, 7.999)).toBe('REJECTED');
    });

    test('thu nhập = 0 → REJECTED', () => {
      expect(checkEligibility(30, 0)).toBe('REJECTED');
    });

    test('thu nhập = -5 (số âm, code không validate) → REJECTED', () => {
      expect(checkEligibility(30, -5)).toBe('REJECTED');
    });

    test('thu nhập = -Infinity → REJECTED', () => {
      expect(checkEligibility(30, -Infinity)).toBe('REJECTED');
    });
  });

  describe('D2 - thu nhập >= 8 → APPROVED (age = 30)', () => {
    test('thu nhập = 8 (đúng biên) → APPROVED', () => {
      expect(checkEligibility(30, 8)).toBe('APPROVED');
    });

    test('thu nhập = 100 → APPROVED', () => {
      expect(checkEligibility(30, 100)).toBe('APPROVED');
    });

    test('thu nhập = +Infinity → APPROVED', () => {
      expect(checkEligibility(30, Infinity)).toBe('APPROVED');
    });
  });

  describe('D3 - thu nhập NaN rơi qua nhánh → APPROVED (hành vi hiện tại)', () => {
    test.each([
      [18, NaN],
      [30, NaN],
      [65, NaN],
    ])('age = %p, thu nhập NaN (%p) → APPROVED', (age, income) => {
      expect(checkEligibility(age, income)).toBe('APPROVED');
    });
  });

  describe('E1 - tuổi ngoài 18..65 bỏ qua thu nhập → REJECTED', () => {
    test.each([
      [0, NaN],
      [0, 100],
      [17, NaN],
      [17, 100],
      [66, NaN],
      [66, 100],
      [150, NaN],
      [150, 100],
    ])('age = %p, thu nhập = %p → REJECTED', (age, income) => {
      expect(checkEligibility(age, income)).toBe('REJECTED');
    });
  });
});
