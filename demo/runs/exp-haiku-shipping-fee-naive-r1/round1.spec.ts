import { calculateShippingFee } from '../../src/shipping-fee';

describe('calculateShippingFee', () => {
  describe('validate đầu vào', () => {
    it('ném lỗi INVALID_INPUT khi trọng lượng = 0', () => {
      expect(() => calculateShippingFee(0, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném lỗi INVALID_INPUT khi trọng lượng âm', () => {
      expect(() => calculateShippingFee(-1, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném lỗi INVALID_INPUT khi khoảng cách âm', () => {
      expect(() => calculateShippingFee(1, -0.5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('không ném lỗi khi khoảng cách = 0', () => {
      expect(() => calculateShippingFee(1, 0, 100, false)).not.toThrow();
    });

    it('không ném lỗi khi trọng lượng dương rất nhỏ', () => {
      expect(calculateShippingFee(0.01, 5, 100, false)).toBe(15);
    });
  });

  describe('miễn phí khi đơn hàng >= 500', () => {
    it('đơn đúng 500 được miễn phí', () => {
      expect(calculateShippingFee(3, 12, 500, false)).toBe(0);
    });

    it('đơn trên 500 được miễn phí, kể cả khi là thành viên', () => {
      expect(calculateShippingFee(3, 12, 800, true)).toBe(0);
    });

    it('đơn 499 không được miễn phí', () => {
      expect(calculateShippingFee(3, 12, 499, false)).toBe(24);
    });
  });

  describe('phí theo trọng lượng', () => {
    it('trọng lượng <= 2kg không phát sinh phụ phí (chỉ phí cơ bản 15)', () => {
      expect(calculateShippingFee(0.5, 5, 100, false)).toBe(15);
      expect(calculateShippingFee(2, 5, 100, false)).toBe(15);
    });

    it('vượt 2kg một chút (2.01kg) tính làm tròn lên: +5', () => {
      expect(calculateShippingFee(2.01, 5, 100, false)).toBe(20);
    });

    it('3kg: vượt 1kg => +5', () => {
      expect(calculateShippingFee(3, 5, 100, false)).toBe(20);
    });

    it('2.5kg: vượt 0.5kg làm tròn lên thành 1kg => +5', () => {
      expect(calculateShippingFee(2.5, 5, 100, false)).toBe(20);
    });

    it('3.5kg: vượt 1.5kg làm tròn lên thành 2kg => +10', () => {
      expect(calculateShippingFee(3.5, 5, 100, false)).toBe(25);
    });

    it('4kg: vượt 2kg => +10', () => {
      expect(calculateShippingFee(4, 5, 100, false)).toBe(25);
    });
  });

  describe('phí theo khoảng cách', () => {
    it('khoảng cách = 10km không phát sinh phụ phí', () => {
      expect(calculateShippingFee(1, 10, 100, false)).toBe(15);
    });

    it('khoảng cách 10.5km: vượt 0.5km => +1', () => {
      expect(calculateShippingFee(1, 10.5, 100, false)).toBe(16);
    });

    it('khoảng cách 12km: vượt 2km => +4', () => {
      expect(calculateShippingFee(1, 12, 100, false)).toBe(19);
    });

    it('khoảng cách 25km: vượt 15km => +30', () => {
      expect(calculateShippingFee(1, 25, 100, false)).toBe(45);
    });
  });

  describe('phí thành viên (giảm 20%)', () => {
    it('thành viên với phí cơ bản: 15 * 0.8 = 12', () => {
      expect(calculateShippingFee(1, 5, 100, true)).toBe(12);
    });

    it('thành viên với trọng lượng và khoảng cách: (15 + 5 + 4) * 0.8 = 19.2', () => {
      expect(calculateShippingFee(3, 12, 100, true)).toBe(19.2);
    });

    it('thành viên có phí gốc 16 => 12.8', () => {
      expect(calculateShippingFee(1, 10.5, 100, true)).toBe(12.8);
    });
  });

  describe('kết hợp nhiều yếu tố', () => {
    it('10kg, 25km, không phải thành viên: 15 + 40 + 30 = 85', () => {
      expect(calculateShippingFee(10, 25, 100, false)).toBe(85);
    });

    it('10kg, 25km, thành viên: 85 * 0.8 = 68', () => {
      expect(calculateShippingFee(10, 25, 100, true)).toBe(68);
    });
  });

  describe('làm tròn 2 chữ số thập phân', () => {
    it('làm tròn 15.666 thành 15.67', () => {
      expect(calculateShippingFee(1, 10.333, 100, false)).toBe(15.67);
    });

    it('thành viên 15.2 * 0.8 = 12.16 (giữ nguyên 2 chữ số)', () => {
      expect(calculateShippingFee(1, 10.1, 100, true)).toBe(12.16);
    });
  });
});
