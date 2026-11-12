import { calculateShippingFee } from '../../src/shipping-fee';

describe('calculateShippingFee', () => {
  describe('validation đầu vào', () => {
    it('ném INVALID_INPUT khi weightKg = 0', () => {
      expect(() => calculateShippingFee(0, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi weightKg âm', () => {
      expect(() => calculateShippingFee(-1, 5, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi weightKg = 0 kể cả orderTotal >= 500 (kiểm tra chạy trước nhánh miễn phí)', () => {
      expect(() => calculateShippingFee(0, 5, 500, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi distanceKm = -0.01 với weightKg = 0.01', () => {
      expect(() => calculateShippingFee(0.01, -0.01, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi distanceKm = -0.001 (ngay dưới biên 0)', () => {
      expect(() => calculateShippingFee(1, -0.001, 100, false)).toThrow('INVALID_INPUT');
    });

    it('ném INVALID_INPUT khi distanceKm âm dù orderTotal >= 500', () => {
      expect(() => calculateShippingFee(1, -1, 500, false)).toThrow('INVALID_INPUT');
    });

    it('không ném lỗi khi weightKg = 0.01 (biên ngay trên 0)', () => {
      expect(calculateShippingFee(0.01, 0, 499.99, false)).toBe(15);
    });

    it('không ném lỗi khi distanceKm = 0 (biên bằng 0)', () => {
      expect(calculateShippingFee(1, 0, 499.99, false)).toBe(15);
    });

    it('không ném lỗi khi distanceKm = -0 (IEEE -0 không nhỏ hơn 0)', () => {
      expect(calculateShippingFee(1, -0, 499.99, false)).toBe(15);
    });
  });

  describe('miễn phí khi orderTotal >= 500', () => {
    it('trả 0 khi orderTotal = 500 (biên dưới của miễn phí)', () => {
      expect(calculateShippingFee(1, 5, 500, false)).toBe(0);
    });

    it('trả 0 khi orderTotal = 501', () => {
      expect(calculateShippingFee(1, 5, 501, false)).toBe(0);
    });

    it('trả 0 với weightKg = 0.01, distanceKm = 0 và orderTotal = 500', () => {
      expect(calculateShippingFee(0.01, 0, 500, false)).toBe(0);
    });

    it('trả 0 với weightKg = 100, distanceKm = 50, thành viên và orderTotal = 500', () => {
      expect(calculateShippingFee(100, 50, 500, true)).toBe(0);
    });

    it('trả 0 cho thành viên khi orderTotal = 500 (không áp dụng giảm 20%)', () => {
      expect(calculateShippingFee(1, 5, 500, true)).toBe(0);
    });

    it('không miễn phí khi orderTotal = 499.99 (biên dưới ngưỡng)', () => {
      expect(calculateShippingFee(1, 5, 499.99, false)).toBe(15);
    });
  });

  describe('C1: weight trong (0,2], distance trong [0,10], không thành viên', () => {
    it('trả 15 với weightKg = 1, distanceKm = 5', () => {
      expect(calculateShippingFee(1, 5, 100, false)).toBe(15);
    });

    it('trả 15 với weightKg = 0.01 (biên dưới)', () => {
      expect(calculateShippingFee(0.01, 5, 499.99, false)).toBe(15);
    });

    // Lưu ý: weightKg = 2 cho kết quả 15 kể cả khi điều kiện là ">= 2" (ceil(0) = 0),
    // nên mutant EqualityOperator "weightKg >= 2" tương đương với code gốc.
    it('trả 15 với weightKg = 2 (biên trên của lớp)', () => {
      expect(calculateShippingFee(2, 5, 499.99, false)).toBe(15);
    });

    it('trả 15 với distanceKm = 0 (biên dưới)', () => {
      expect(calculateShippingFee(1, 0, 499.99, false)).toBe(15);
    });

    // Lưu ý: distanceKm = 10 cho kết quad 15 kể cả khi điều kiện là ">= 10" ((10-10)*2 = 0),
    // nên mutant EqualityOperator "distanceKm >= 10" tương đương với code gốc.
    it('trả 15 với distanceKm = 10 (biên trên, không vượt ngưỡng)', () => {
      expect(calculateShippingFee(1, 10, 499.99, false)).toBe(15);
    });

    it('trả 15 với weightKg = 2 và distanceKm = 10 đồng thời', () => {
      expect(calculateShippingFee(2, 10, 499.99, false)).toBe(15);
    });
  });

  describe('C2: weight trong (0,2], distance trong [0,10], thành viên', () => {
    it('trả 12 (15 * 0.8) với weightKg = 1, distanceKm = 5', () => {
      expect(calculateShippingFee(1, 5, 100, true)).toBe(12);
    });

    it('trả 12 với weightKg = 0.01 (biên dưới)', () => {
      expect(calculateShippingFee(0.01, 5, 499.99, true)).toBe(12);
    });

    it('trả 12 với weightKg = 2 và distanceKm = 10 (biên trên)', () => {
      expect(calculateShippingFee(2, 10, 499.99, true)).toBe(12);
    });

    it('trả 12 với distanceKm = 0 (biên dưới)', () => {
      expect(calculateShippingFee(1, 0, 499.99, true)).toBe(12);
    });
  });

  describe('C3: weight trong (0,2], distance > 10, không thành viên', () => {
    it('trả 19 với weightKg = 1, distanceKm = 12 (15 + (12-10)*2)', () => {
      expect(calculateShippingFee(1, 12, 100, false)).toBe(19);
    });

    it('trả 15.02 với distanceKm = 10.01 (biên trên ngưỡng)', () => {
      expect(calculateShippingFee(1, 10.01, 499.99, false)).toBe(15.02);
    });

    it('trả 19 với weightKg = 2 và distanceKm = 12 (weight biên trên của lớp)', () => {
      expect(calculateShippingFee(2, 12, 499.99, false)).toBe(19);
    });

    it('trả 19 với weightKg = 0.01 và distanceKm = 12 (weight biên dưới của lớp)', () => {
      expect(calculateShippingFee(0.01, 12, 499.99, false)).toBe(19);
    });
  });

  describe('C4: weight trong (0,2], distance > 10, thành viên', () => {
    it('trả 15.2 ((15 + 4) * 0.8) với weightKg = 1, distanceKm = 12', () => {
      expect(calculateShippingFee(1, 12, 100, true)).toBe(15.2);
    });

    it('trả 12.02 với distanceKm = 10.01 (giảm 20% áp dụng cho phụ phí quãng đường)', () => {
      expect(calculateShippingFee(2, 10.01, 499.99, true)).toBe(12.02);
    });

    it('trả 15.2 với weightKg = 0.01 và distanceKm = 12', () => {
      expect(calculateShippingFee(0.01, 12, 499.99, true)).toBe(15.2);
    });
  });

  describe('C5: weight > 2, distance trong [0,10], không thành viên', () => {
    it('trả 20 với weightKg = 2.01 (ceil(0.01) = 1 bước)', () => {
      expect(calculateShippingFee(2.01, 0, 499.99, false)).toBe(20);
    });

    it('trả 20 với weightKg = 2.5', () => {
      expect(calculateShippingFee(2.5, 5, 499.99, false)).toBe(20);
    });

    it('trả 20 với weightKg = 3 (biên của bước đầu tiên)', () => {
      expect(calculateShippingFee(3, 5, 499.99, false)).toBe(20);
    });

    it('trả 25 với weightKg = 3.01 (vượt biên, sang bước thứ 2)', () => {
      expect(calculateShippingFee(3.01, 5, 499.99, false)).toBe(25);
    });

    it('trả 25 với weightKg = 4 (ceil(2) = 2 bước)', () => {
      expect(calculateShippingFee(4, 5, 499.99, false)).toBe(25);
    });

    it('trả 30 với weightKg = 4.5 (ceil(2.5) = 3 bước)', () => {
      expect(calculateShippingFee(4.5, 5, 499.99, false)).toBe(30);
    });

    it('trả 20 với distanceKm = 0 (biên dưới)', () => {
      expect(calculateShippingFee(3, 0, 499.99, false)).toBe(20);
    });

    it('trả 20 với distanceKm = 10 (biên trên, không phụ phí quãng đường)', () => {
      expect(calculateShippingFee(3, 10, 499.99, false)).toBe(20);
    });
  });

  describe('C6: weight > 2, distance trong [0,10], thành viên', () => {
    it('trả 16 ((15 + 5) * 0.8) với weightKg = 2.5, distanceKm = 5', () => {
      expect(calculateShippingFee(2.5, 5, 499.99, true)).toBe(16);
    });

    it('trả 16 với weightKg = 2.01 (biên dưới của lớp) và distanceKm = 10', () => {
      expect(calculateShippingFee(2.01, 10, 499.99, true)).toBe(16);
    });

    it('trả 20 ((15 + 10) * 0.8) với weightKg = 3.01 và distanceKm = 0', () => {
      expect(calculateShippingFee(3.01, 0, 499.99, true)).toBe(20);
    });
  });

  describe('C7: weight > 2, distance > 10, không thành viên', () => {
    it('trả 24 với weightKg = 2.5, distanceKm = 12 (15 + 5 + 4)', () => {
      expect(calculateShippingFee(2.5, 12, 499.99, false)).toBe(24);
    });

    it('trả 20.02 với weightKg = 2.01 và distanceKm = 10.01 (biên dưới cả hai)', () => {
      expect(calculateShippingFee(2.01, 10.01, 499.99, false)).toBe(20.02);
    });
  });

  describe('C8: weight > 2, distance > 10, thành viên', () => {
    it('trả 19.2 ((15 + 5 + 4) * 0.8) với weightKg = 2.5, distanceKm = 12', () => {
      expect(calculateShippingFee(2.5, 12, 499.99, true)).toBe(19.2);
    });

    it('trả 16.02 với weightKg = 2.01 và distanceKm = 10.01', () => {
      expect(calculateShippingFee(2.01, 10.01, 499.99, true)).toBe(16.02);
    });
  });

  describe('weight lớn hữu hạn ngoài nhánh miễn phí', () => {
    it('trả 505 với weightKg = 100, distanceKm = 0, không thành viên (15 + ceil(98) * 5)', () => {
      expect(calculateShippingFee(100, 0, 499.99, false)).toBe(505);
    });

    it('trả 404 ((15 + 490) * 0.8) với weightKg = 100, distanceKm = 0, thành viên', () => {
      expect(calculateShippingFee(100, 0, 499.99, true)).toBe(404);
    });
  });

  describe('đầu vào NaN (hành vi hiện tại, chưa có nhánh xử lý)', () => {
    it('không ném và trả 15 khi weightKg = NaN (so sánh với NaN đều false)', () => {
      expect(calculateShippingFee(NaN, 5, 100, false)).toBe(15);
    });

    it('trả 12 khi weightKg = NaN và thành viên', () => {
      expect(calculateShippingFee(NaN, 5, 100, true)).toBe(12);
    });

    it('không ném và trả 15 khi distanceKm = NaN', () => {
      expect(calculateShippingFee(1, NaN, 100, false)).toBe(15);
    });

    it('không kích hoạt miễn phí khi orderTotal = NaN', () => {
      expect(calculateShippingFee(1, 5, NaN, false)).toBe(15);
    });
  });

  describe('đầu vào Infinity', () => {
    it('trả Infinity khi weightKg = Infinity', () => {
      expect(calculateShippingFee(Infinity, 5, 100, false)).toBe(Infinity);
    });

    it('trả Infinity khi distanceKm = Infinity', () => {
      expect(calculateShippingFee(1, Infinity, 100, false)).toBe(Infinity);
    });

    it('trả Infinity cho thành viên khi distanceKm = Infinity', () => {
      expect(calculateShippingFee(1, Infinity, 100, true)).toBe(Infinity);
    });
  });

  describe('làm tròn 2 chữ số', () => {
    it('làm tròn xuống thành 15 khi phí = 15.004 (phần thập phân < 0.005)', () => {
      expect(calculateShippingFee(1, 10.002, 100, false)).toBe(15);
    });

    it('làm tròn lên thành 15.01 khi phí = 15.005 (phần thập phân >= 0.005)', () => {
      expect(calculateShippingFee(1, 10.0025, 100, false)).toBe(15.01);
    });

    it('làm tròn lên thành 15.13 khi phí = 15.125 (nửa, biểu diễn nhị phân chính xác)', () => {
      expect(calculateShippingFee(1, 10.0625, 100, false)).toBe(15.13);
    });

    it('làm tròn xuống thành 15.06 khi phí = 15.0625 (1506.25 -> 1506, biểu diễn nhị phân chính xác)', () => {
      expect(calculateShippingFee(1, 10.03125, 100, false)).toBe(15.06);
    });
  });
});
