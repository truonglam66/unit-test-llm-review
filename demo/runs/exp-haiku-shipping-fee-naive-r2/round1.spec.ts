import { calculateShippingFee } from '../../src/shipping-fee';

describe('calculateShippingFee', () => {
  describe('validate đầu vào', () => {
    it.each([
      ['weight = 0', 0, 5, 100, false],
      ['weight âm', -1, 5, 100, false],
      ['distance âm', 1, -0.1, 100, false],
    ])('ném INVALID_INPUT khi %s', (_name, weight, distance, total, member) => {
      expect(() => calculateShippingFee(weight, distance, total, member)).toThrow('INVALID_INPUT');
    });

    it('vẫn ném INVALID_INPUT khi đơn >= 500 nhưng đầu vào sai', () => {
      expect(() => calculateShippingFee(0, 5, 1000, false)).toThrow('INVALID_INPUT');
    });

    it('distance = 0 là hợp lệ', () => {
      expect(calculateShippingFee(1, 0, 100, false)).toBe(15);
    });
  });

  describe('miễn phí khi đơn >= 500', () => {
    it('đúng ngưỡng 500 thì miễn phí', () => {
      expect(calculateShippingFee(1, 5, 500, false)).toBe(0);
    });

    it('dưới 500 (499.99) vẫn tính phí', () => {
      expect(calculateShippingFee(1, 5, 499.99, false)).toBe(15);
    });

    it('đơn lớn, nặng, xa vẫn miễn phí', () => {
      expect(calculateShippingFee(10, 50, 1000, false)).toBe(0);
    });

    it('thành viên với đơn >= 500 cũng miễn phí (không ra 0.8 * phí)', () => {
      expect(calculateShippingFee(10, 50, 500, true)).toBe(0);
    });
  });

  describe('phí cơ bản', () => {
    it('weight 1, distance 5 → 15', () => {
      expect(calculateShippingFee(1, 5, 100, false)).toBe(15);
    });

    it('weight = 2 (biên, chưa vượt) → không phụ phí cân nặng', () => {
      expect(calculateShippingFee(2, 5, 100, false)).toBe(15);
    });

    it('distance = 10 (biên, chưa vượt) → không phụ phí quãng đường', () => {
      expect(calculateShippingFee(1, 10, 100, false)).toBe(15);
    });
  });

  describe('phụ phí cân nặng (mỗi kg vượt 2kg, làm tròn lên, +5)', () => {
    it.each([
      [2.01, 20],
      [2.5, 20],
      [3, 20],
      [3.01, 25],
      [5, 30],
    ])('weight = %p → phí = %p', (weight, expected) => {
      expect(calculateShippingFee(weight, 5, 100, false)).toBe(expected);
    });
  });

  describe('phụ phí quãng đường (vượt 10km, +2/km)', () => {
    it.each([
      [10.5, 16],
      [12.25, 19.5],
      [15, 25],
    ])('distance = %p → phí = %p', (distance, expected) => {
      expect(calculateShippingFee(1, distance, 100, false)).toBe(expected);
    });
  });

  describe('kết hợp cân nặng và quãng đường', () => {
    it('weight 5, distance 15 → 15 + 15 + 10 = 40', () => {
      expect(calculateShippingFee(5, 15, 100, false)).toBe(40);
    });
  });

  describe('giảm 20% cho thành viên', () => {
    it('weight 1, distance 5, thành viên → 12', () => {
      expect(calculateShippingFee(1, 5, 100, true)).toBe(12);
    });

    it('weight 2.5, distance 5, thành viên → 16', () => {
      expect(calculateShippingFee(2.5, 5, 100, true)).toBe(16);
    });

    it('weight 5, distance 15, thành viên → 32', () => {
      expect(calculateShippingFee(5, 15, 100, true)).toBe(32);
    });
  });

  describe('làm tròn 2 chữ số thập phân', () => {
    it('phí 15.246 không thành viên → 15.25', () => {
      expect(calculateShippingFee(1, 10.123, 100, false)).toBe(15.25);
    });

    it('phí 15.246 thành viên (× 0.8 = 12.1968) → 12.2', () => {
      expect(calculateShippingFee(1, 10.123, 100, true)).toBe(12.2);
    });
  });
});
