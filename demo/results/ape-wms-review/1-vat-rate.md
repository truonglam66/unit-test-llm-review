# Review: `views/main/setting/billing-category/utils/vat-rate.spec.ts` — **NEEDS_WORK**

Test sạch về cách tiếp cận (hàm thuần, assert vào output, không flaky), nhưng độ phủ biên yếu: thiếu 100, số âm, whitespace, NaN, và gần như không test nhánh invalid của parseCategoryVatRate. Nhiều mutation (đổi <= thành <, bỏ trim, bỏ validate ở parseCategoryVatRate, đổi ?? thành ||, đổi hằng fallback) vẫn pass. Nên chuyển sang it.each theo từng nhánh, thêm biên và assert cứng giá trị 8.

## Behavior LLM tự suy ra từ source

| Behavior | Biên | Test hiện có |
|---|---|---|
| parseDefaultVatRate: null/undefined/chuỗi rỗng/chỉ khoảng trắng → fallback 8 | null, undefined, '', '   ' | partial |
| parseDefaultVatRate: giá trị hợp lệ trong [0,100] → trả về số | 0 (min), 100 (max), -1 (dưới min), 101 (trên max), '8.5' | partial |
| parseDefaultVatRate: không phải số / không hữu hạn → fallback | 'abc', NaN, Infinity, 'Infinity' | partial |
| parseCategoryVatRate: null/undefined/rỗng → null | null, undefined, '', '  ' | partial |
| parseCategoryVatRate: chuỗi số hợp lệ → số (kể cả dạng PG '5.00') | '0.00', '5.00', '100' | partial |
| parseCategoryVatRate: ngoài khoảng/không hợp lệ → null (không fallback 8) | '-0.01', '100.01', 'abc', NaN | no |
| toVatRateFormValue: null/invalid → 'DEFAULT', hợp lệ → số (0 không bị coi là falsy nhờ ??) | null, 'abc', '0', '10.00' | partial |
| fromVatRateFormValue: undefined/'DEFAULT' → null, số → giữ nguyên | undefined, 'DEFAULT', 0, 10 | yes |

## Rubric

### ✅ test_vs_implementation (high confidence)
- **Bằng chứng:** Chỉ gọi các hàm export thuần và assert vào giá trị trả về; không spy, không mock, không phụ thuộc cấu trúc nội bộ (isValidVatRate không được test trực tiếp).
- **Gợi ý:** Giữ nguyên cách tiếp cận này.

### ❌ equivalence_boundary (medium confidence)
- **Bằng chứng:** Điều kiện `rate >= 0 && rate <= 100` có 2 cạnh nhưng test chỉ có '101' (cho parseDefaultVatRate); không có 100, -1, hay 0 cho cạnh dưới ở nhánh invalid. parseCategoryVatRate hoàn toàn không có case ngoài khoảng/không phải số/chuỗi rỗng (nhánh `return null` của isValidVatRate sai). Không có case chuỗi chỉ khoảng trắng dù source có `.trim()`, không có NaN/Infinity dù có Number.isFinite.
- **Gợi ý:** Dùng it.each cho cả 2 parser: 0, 100 (hợp lệ), -1, -0.01, 100.01, 101 (invalid); '   ' (whitespace), 'Infinity', NaN, null; thêm parseCategoryVatRate('abc'|'101'|'-1'|'') → null và toVatRateFormValue('abc') → 'DEFAULT'.

### ⚠️ assertion_strength (high confidence)
- **Bằng chứng:** Dùng toBe/toBeNull với giá trị cụ thể nên khá chắc. Nhưng test fallback dùng hằng FALLBACK_DEFAULT_VAT_RATE (circular): nếu hằng bị đổi từ 8 thành 9 thì test vẫn pass dù tên test nói 'falls back to 8'. Nhiều expect gộp trong một it nên khi fail khó biết nhánh nào hỏng.
- **Gợi ý:** Assert thẳng `.toBe(8)` ít nhất một lần (hoặc thêm test khẳng định FALLBACK_DEFAULT_VAT_RATE === 8 vì đây là hợp đồng với API); tách mỗi nhánh thành it/it.each riêng.

### ✅ isolation (high confidence)
- **Bằng chứng:** Hàm thuần, không state dùng chung, không mock, không beforeEach cần dọn.
- **Gợi ý:** Không cần thay đổi.

### ✅ determinism (high confidence)
- **Bằng chứng:** Không dùng Date/Math.random/async; đầu ra chỉ phụ thuộc đầu vào.
- **Gợi ý:** Không cần thay đổi.

### ⚠️ naming_clarity (high confidence)
- **Bằng chứng:** 'falls back to 8 for missing or out-of-range values' gộp nhiều nhánh (thiếu, rỗng, NaN, vượt khoảng) trong một test; 'round-trips through the form value' thực tế không test round-trip mà test từng hàm riêng lẻ; 'treats null as tenant default and numeric strings as rates' gộp 2 hành vi.
- **Gợi ý:** Tách thành các test theo hành vi: 'returns 8 when raw is empty/null/undefined', 'returns 8 when raw is above 100', 'returns null for out-of-range category rate'... Đổi tên 'round-trips' hoặc thật sự viết round-trip: fromVatRateFormValue(toVatRateFormValue('10.00')) === 10.

### ❌ fake_pass_risk (high confidence)
- **Bằng chứng:** Mutation còn sống: (1) đổi `rate <= MAX_VAT_RATE` thành `< MAX` → vẫn pass (không test 100); (2) đổi `>= MIN` thành `> MIN` → test parseDefaultVatRate(0) và '0.00' sẽ fail nên bắt được, nhưng đổi `>= MIN` thành `>= -5` hoặc xoá cạnh dưới → vẫn pass (không có số âm); (3) bỏ `Number.isFinite` → vẫn pass (không test Infinity; 'Infinity' > 100 nên vẫn bị chặn bởi cạnh trên, tức check này dư với giá trị dương, nhưng NaN cần test); (4) bỏ `.trim()` → vẫn pass (không test '  '; Number('  ') = 0 nên sẽ trả 0 thay vì fallback); (5) parseCategoryVatRate luôn trả giá trị không validate (bỏ isValidVatRate) → vẫn pass vì không có case invalid; (6) đổi FALLBACK từ 8 sang giá trị khác → vẫn pass do circular; (7) toVatRateFormValue đổi `??` thành `||` → fail với '0'? không, test không có toVatRateFormValue('0') nên vẫn pass và làm mất giá trị 0%.
- **Gợi ý:** Thêm các case biên/invalid ở trên, đặc biệt: 100, '  ', -1, parseCategoryVatRate('101'), toVatRateFormValue('0.00') → 0, và assert fallback = 8 cứng.
