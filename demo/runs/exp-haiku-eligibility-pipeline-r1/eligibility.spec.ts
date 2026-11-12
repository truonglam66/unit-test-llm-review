import { checkEligibility } from '../../src/eligibility';

describe('checkEligibility', () => {
  describe('tuổi không phải số nguyên hữu hạn -> throw INVALID_AGE', () => {
    it('throw INVALID_AGE khi age = NaN', () => {
      expect(() => checkEligibility(NaN, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = 17.5 (số thập phân ngay dưới 18)', () => {
      expect(() => checkEligibility(17.5, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = 65.5 (số thập phân ngay trên 65)', () => {
      expect(() => checkEligibility(65.5, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = Infinity', () => {
      expect(() => checkEligibility(Infinity, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = -Infinity', () => {
      expect(() => checkEligibility(-Infinity, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age là chuỗi "20" (sai kiểu lúc runtime)', () => {
      expect(() => checkEligibility('20' as unknown as number, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = null (sai kiểu lúc runtime)', () => {
      expect(() => checkEligibility(null as unknown as number, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE trước khi xét thu nhập: age = NaN, income = 1', () => {
      expect(() => checkEligibility(NaN, 1)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE trước khi xét thu nhập: age = 17.5, income = 1000', () => {
      expect(() => checkEligibility(17.5, 1000)).toThrow('INVALID_AGE');
    });
  });

  describe('tuổi là số nguyên âm -> throw INVALID_AGE', () => {
    it('throw INVALID_AGE khi age = -1 (biên ngay dưới 0), income = 20', () => {
      expect(() => checkEligibility(-1, 20)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = -1, income = 0 (không rơi vào nhánh REJECTED theo thu nhập)', () => {
      expect(() => checkEligibility(-1, 0)).toThrow('INVALID_AGE');
    });

    it('throw INVALID_AGE khi age = -100 (số nguyên âm xa)', () => {
      expect(() => checkEligibility(-100, 20)).toThrow('INVALID_AGE');
    });
  });

  describe('tuổi nguyên 0..17 (vị thành niên) -> REJECTED', () => {
    it('REJECTED khi age = 0 (biên dưới của nhóm), income = 20', () => {
      expect(checkEligibility(0, 20)).toBe('REJECTED');
    });

    it('REJECTED khi age = -0 được coi như 0, income = 20', () => {
      expect(checkEligibility(-0, 20)).toBe('REJECTED');
    });

    it('REJECTED khi age = 10 (giữa nhóm), income = 1000', () => {
      expect(checkEligibility(10, 1000)).toBe('REJECTED');
    });

    it('REJECTED khi age = 17 (biên trên của nhóm), income = 20', () => {
      expect(checkEligibility(17, 20)).toBe('REJECTED');
    });

    it('REJECTED khi age = 17 dù thu nhập rất cao, income = 1000', () => {
      expect(checkEligibility(17, 1000)).toBe('REJECTED');
    });
  });

  describe('tuổi nguyên >= 66 (quá tuổi) -> REJECTED', () => {
    it('REJECTED khi age = 66 (biên trên ngay sau 65), income = 20', () => {
      expect(checkEligibility(66, 20)).toBe('REJECTED');
    });

    it('REJECTED khi age = 66 dù thu nhập rất cao, income = 1000', () => {
      expect(checkEligibility(66, 1000)).toBe('REJECTED');
    });

    it('REJECTED khi age = 120 (không có giới hạn trên), income = 20', () => {
      expect(checkEligibility(120, 20)).toBe('REJECTED');
    });
  });

  describe('tuổi 18..65 và thu nhập < 8 -> REJECTED', () => {
    it('REJECTED khi age = 18 (biên trái), income = 5', () => {
      expect(checkEligibility(18, 5)).toBe('REJECTED');
    });

    it('REJECTED khi age = 65 (biên phải), income = 5', () => {
      expect(checkEligibility(65, 5)).toBe('REJECTED');
    });

    it('REJECTED khi age = 40, income = 7.99 (sát ngưỡng dưới 8)', () => {
      expect(checkEligibility(40, 7.99)).toBe('REJECTED');
    });

    it('REJECTED khi age = 18 (biên trái), income = 7.99', () => {
      expect(checkEligibility(18, 7.99)).toBe('REJECTED');
    });

    it('REJECTED khi age = 40, income = 0', () => {
      expect(checkEligibility(40, 0)).toBe('REJECTED');
    });

    it('REJECTED khi age = 40, income = -1 (thu nhập âm)', () => {
      expect(checkEligibility(40, -1)).toBe('REJECTED');
    });
  });

  describe('tuổi 18..65 và thu nhập >= 8 -> APPROVED', () => {
    it('APPROVED khi age = 18 (biên trái), income = 20', () => {
      expect(checkEligibility(18, 20)).toBe('APPROVED');
    });

    it('APPROVED khi age = 65 (biên phải), income = 20', () => {
      expect(checkEligibility(65, 20)).toBe('APPROVED');
    });

    it('APPROVED khi age = 40, income = 8 (đúng ngưỡng)', () => {
      expect(checkEligibility(40, 8)).toBe('APPROVED');
    });

    it('APPROVED khi age = 18, income = 8 (đúng ngưỡng, biên trái tuổi)', () => {
      expect(checkEligibility(18, 8)).toBe('APPROVED');
    });

    it('APPROVED khi age = 65, income = 8 (đúng ngưỡng, biên phải tuổi)', () => {
      expect(checkEligibility(65, 8)).toBe('APPROVED');
    });

    it('APPROVED khi age = 40, income = Infinity', () => {
      expect(checkEligibility(40, Infinity)).toBe('APPROVED');
    });
  });

  // Chưa chốt expected: code hiện tại trả APPROVED vì NaN < 8 là false.
  // Cần làm rõ spec (throw hoặc REJECTED) rồi mới viết assertion.
  test.todo('monthlyIncome = NaN với tuổi hợp lệ: làm rõ spec trước khi chốt expected');
});
