import { calculateShippingFee } from '../../src/shipping-fee';

describe('calculateShippingFee', () => {
  describe('validation đầu vào', () => {
    it('ném INVALID_INPUT khi weightKg = 0 (biên dưới)', () => {
      expect(() => calculateShippingFee(0, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi weightKg âm', () => {
      expect(() => calculateShippingFee(-1, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi weightKg = -Infinity', () => {
      expect(() => calculateShippingFee(-Infinity, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('không ném lỗi khi weightKg = 0.001 (ngay trên biên 0) và trả 15', () => {
      expect(calculateShippingFee(0.001, 0, 0, false)).toBe(15);
    });

    it('ném INVALID_INPUT khi distanceKm = -0.01 (ngay dưới biên 0)', () => {
      expect(() => calculateShippingFee(1, -0.01, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi distanceKm = -1', () => {
      expect(() => calculateShippingFee(1, -1, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi distanceKm = -Infinity', () => {
      expect(() => calculateShippingFee(1, -Infinity, 100, false)).toThrow('INVALID_INPUT');
    });

    it('distanceKm = 0 hợp lệ, không ném lỗi và trả 15', () => {
      expect(calculateShippingFee(1, 0, 0, false)).toBe(15);
    });

    it('validation chạy trước miễn phí: weightKg = 0 với orderTotal = 500 vẫn ném INVALID_INPUT', () => {
      expect(() => calculateShippingFee(0, 5, 500, false)).toThrow('INVALID_INPUT');
    });

    it('validation chạy trước miễn phí: distanceKm < 0 với orderTotal = 1000 vẫn ném INVALID_INPUT', () => {
      expect(() => calculateShippingFee(1, -1, 1000, true)).toThrow('INVALID_INPUT');
    });
  });

  describe('miễn phí ship khi đơn từ 500 trở lên', () => {
    it('orderTotal = 500 (biên) trả về 0', () => {
      expect(calculateShippingFee(1, 1, 500, false)).toBe(0);
    });

    it('orderTotal = 1000 trả về 0', () => {
      expect(calculateShippingFee(1, 1, 1000, false)).toBe(0);
    });

    it('orderTotal = 499.99 (dưới biên) vẫn tính phí và trả 15', () => {
      expect(calculateShippingFee(1, 0, 499.99, false)).toBe(15);
    });

    it('orderTotal = 0 vẫn tính phí và trả 15', () => {
      expect(calculateShippingFee(1, 0, 0, false)).toBe(15);
    });

    it('thành viên đơn 500 vẫn miễn phí: trả 0, không áp dụng giảm 20% (không phải 19.2)', () => {
      expect(calculateShippingFee(3, 12, 500, true)).toBe(0);
    });

    it('khối lượng và quãng đường lớn vẫn miễn phí khi orderTotal = 500', () => {
      expect(calculateShippingFee(10, 50, 500, false)).toBe(0);
    });

    it('orderTotal = Infinity trả về 0', () => {
      expect(calculateShippingFee(1, 1, Infinity, false)).toBe(0);
    });

    it('orderTotal = NaN không được coi là miễn phí và tính phí bình thường (trả 15)', () => {
      expect(calculateShippingFee(1, 0, NaN, false)).toBe(15);
    });
  });

  describe('phụ phí khối lượng (orderTotal = 0, không thành viên, distanceKm = 0)', () => {
    it('weightKg = 0.5 không có phụ phí và trả 15', () => {
      expect(calculateShippingFee(0.5, 0, 0, false)).toBe(15);
    });

    it('weightKg = 2 (biên trên nhóm nhẹ) không có phụ phí và trả 15', () => {
      expect(calculateShippingFee(2, 0, 0, false)).toBe(15);
    });

    it('weightKg = 2.000001 (vừa vượt 2kg) cộng bậc 1 và trả 20', () => {
      expect(calculateShippingFee(2.000001, 0, 0, false)).toBe(20);
    });

    it('weightKg = 2.5 cộng bậc 1 (+5) và trả 20', () => {
      expect(calculateShippingFee(2.5, 0, 0, false)).toBe(20);
    });

    it('weightKg = 3 (biên trên bậc 1) vẫn cộng +5 và trả 20', () => {
      expect(calculateShippingFee(3, 0, 0, false)).toBe(20);
    });

    it('weightKg = 3.5 cộng bậc 2 (+10) và trả 25', () => {
      expect(calculateShippingFee(3.5, 0, 0, false)).toBe(25);
    });

    it('weightKg = 4 (biên trên bậc 2) cộng +10 và trả 25', () => {
      expect(calculateShippingFee(4, 0, 0, false)).toBe(25);
    });

    it('weightKg = 4.5 cộng bậc 3 (+15) và trả 30', () => {
      expect(calculateShippingFee(4.5, 0, 0, false)).toBe(30);
    });

    it('weightKg = 5 (biên trên bậc 3) cộng +15 và trả 30', () => {
      expect(calculateShippingFee(5, 0, 0, false)).toBe(30);
    });

    it('weightKg = 5.01 sang bậc 4 (+20) và trả 35', () => {
      expect(calculateShippingFee(5.01, 0, 0, false)).toBe(35);
    });
  });

  describe('phụ phí quãng đường (weightKg = 1, orderTotal = 0, không thành viên)', () => {
    it('distanceKm = 0 không có phụ phí và trả 15', () => {
      expect(calculateShippingFee(1, 0, 0, false)).toBe(15);
    });

    it('distanceKm = 9.99 không có phụ phí và trả 15', () => {
      expect(calculateShippingFee(1, 9.99, 0, false)).toBe(15);
    });

    it('distanceKm = 10 (biên) không có phụ phí và trả 15', () => {
      expect(calculateShippingFee(1, 10, 0, false)).toBe(15);
    });

    it('distanceKm = 10.01 cộng 0.02 và trả 15.02', () => {
      expect(calculateShippingFee(1, 10.01, 0, false)).toBe(15.02);
    });

    it('distanceKm = 10.5 cộng 1 và trả 16', () => {
      expect(calculateShippingFee(1, 10.5, 0, false)).toBe(16);
    });

    it('distanceKm = 12 cộng 4 và trả 19', () => {
      expect(calculateShippingFee(1, 12, 0, false)).toBe(19);
    });

    it('distanceKm = 20 cộng 20 và trả 35', () => {
      expect(calculateShippingFee(1, 20, 0, false)).toBe(35);
    });
  });

  describe('giảm giá thành viên', () => {
    it('thành viên được giảm 20% trên phí sau phụ phí: (15+5+4)*0.8 = 19.2', () => {
      expect(calculateShippingFee(3, 12, 0, true)).toBe(19.2);
    });

    it('khách không phải thành viên với cùng input không giảm: trả 24', () => {
      expect(calculateShippingFee(3, 12, 0, false)).toBe(24);
    });

    it('thành viên với phí cơ bản 15 trả 12', () => {
      expect(calculateShippingFee(1, 0, 0, true)).toBe(12);
    });

    it('thành viên với phí 20 (weightKg = 2.5) trả 16', () => {
      expect(calculateShippingFee(2.5, 0, 0, true)).toBe(16);
    });

    it('thành viên với weightKg = 2.5, distanceKm = 15 (phí 30) trả 24', () => {
      expect(calculateShippingFee(2.5, 15, 0, true)).toBe(24);
    });

    it('khách không phải thành viên với weightKg = 2.5, distanceKm = 15 trả 30', () => {
      expect(calculateShippingFee(2.5, 15, 0, false)).toBe(30);
    });
  });

  describe('làm tròn 2 chữ số thập phân', () => {
    it('distanceKm = 10.0024 (phí 15.0048) làm tròn xuống 15', () => {
      expect(calculateShippingFee(1, 10.0024, 0, false)).toBe(15);
    });

    it('distanceKm = 10.0026 (phí 15.0052) làm tròn lên 15.01', () => {
      expect(calculateShippingFee(1, 10.0026, 0, false)).toBe(15.01);
    });

    it('thành viên distanceKm = 10.0012 (phí 15.0024 * 0.8 = 12.00192) làm tròn xuống 12', () => {
      expect(calculateShippingFee(1, 10.0012, 0, true)).toBe(12);
    });

    it('thành viên distanceKm = 10.0038 (phí 15.0076 * 0.8 = 12.00608) làm tròn lên 12.01', () => {
      expect(calculateShippingFee(1, 10.0038, 0, true)).toBe(12.01);
    });

    it('thành viên distanceKm = 10.0625 (phí 15.125 * 0.8 = 12.1) trả 12.1', () => {
      expect(calculateShippingFee(1, 10.0625, 0, true)).toBe(12.1);
    });
  });

  describe('giá trị đặc biệt (NaN / Infinity)', () => {
    it('weightKg = NaN không bị bắt bởi validation, không cộng phụ phí và trả 15', () => {
      expect(calculateShippingFee(NaN, 0, 0, false)).toBe(15);
    });

    it('distanceKm = NaN không bị bắt bởi validation, không cộng phụ phí và trả 15', () => {
      expect(calculateShippingFee(1, NaN, 0, false)).toBe(15);
    });

    it('weightKg = Infinity trả Infinity', () => {
      expect(calculateShippingFee(Infinity, 0, 0, false)).toBe(Infinity);
    });

    it('distanceKm = Infinity trả Infinity', () => {
      expect(calculateShippingFee(1, Infinity, 0, false)).toBe(Infinity);
    });
  });
});
