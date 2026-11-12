# Review 5 spec đại diện – ape_wms_admin

Model: Sonnet qua Claude CLI. Mỗi file được review 1 lần; kết quả LLM có thể dao động giữa các lần chạy.

| # | Loại | Spec | Verdict | T/I | EC/BV | Assert | Isol | Determ | Naming | FakePass |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Hàm thuần | [vat-rate](1-vat-rate.md) | needs_work | ✅ | ❌ | ⚠️ | ✅ | ✅ | ⚠️ | ❌ |
| 2 | Helper phân quyền | [permission.helper](2-permission.helper.md) | needs_work | ✅ | ❌ | ✅ | ⚠️ | ✅ | ⚠️ | ❌ |
| 3 | Store | [auth.store](3-auth.store.md) | needs_work | ⚠️ | ❌ | ❌ | ⚠️ | ✅ | ⚠️ | ❌ |
| 4 | Hook async | [use-period-actions](4-use-period-actions.md) | needs_work | ⚠️ | ❌ | ⚠️ | ⚠️ | ✅ | ⚠️ | ❌ |
| 5 | React component | [payment-panel](5-payment-panel.md) | needs_work | ⚠️ | ❌ | ⚠️ | ✅ | ⚠️ | ⚠️ | ❌ |

## Tóm tắt từng file

### 1-vat-rate

Test sạch về cách tiếp cận (hàm thuần, assert vào output, không flaky), nhưng độ phủ biên yếu: thiếu 100, số âm, whitespace, NaN, và gần như không test nhánh invalid của parseCategoryVatRate. Nhiều mutation (đổi <= thành <, bỏ trim, bỏ validate ở parseCategoryVatRate, đổi ?? thành ||, đổi hằng fallback) vẫn pass. Nên chuyển sang it.each theo từng nhánh, thêm biên và assert cứng giá trị 8.

### 2-permission.helper

Test của checkPermission khá tốt (assert ở public boundary, giá trị cụ thể, xác định, có dọn state). Nhưng file source export 4 hàm và 3 hàm (hasPermissionCode, hasRouteAccess, hasRouteViewPermission) không có test nào, dù chứa phần lớn nhánh logic. Thiếu thêm case chéo chọn nguồn quyền theo type. Rủi ro pass giả cao với các hàm chưa test, nên cần bổ sung trước khi tin vào bộ test này.

### 3-auth.store

Test login và logout kiểm chứng được một phần (token, account.id), nhưng khá lỏng. Ba spy (account/access/tabs) được tạo mà không được assert, nên cascade reset của access và tabs hoàn toàn không được bảo vệ: xoá hai dòng đó test vẫn pass. Test forgotPassword/resetPassword chỉ kiểm lời gọi API, không kiểm state dù tên test nói có. Thiếu hẳn nhánh lỗi (API reject), response rỗng và persist. Cần bổ sung assertion trạng thái thật, dọn mock/storage và sửa tên test cho khớp.

### 4-use-period-actions

Test bao phủ tốt các "happy path" chính của các hàm thuần (lock/send/void/bulk send/runSequentially) và hầu hết ổn về tính xác định. Nhưng nhiều nhánh và biên bị bỏ trống, đặc biệt là 8/10 mutation, getPeriodRange, useStatementDetail/useActiveContracts, nhánh fallback của getPeriodNextAction và phần lớn ACTION_PERMISSION. Nhiều assertion chỉ kiểm tra một field (`visible`/`disabled`), và test invalidate dùng chính `PERIOD_QUERY_KEYS` của source (circular) kèm spy vào chi tiết nội bộ. Hệ quả: nhiều mutation đơn giản (đổi quyền, bỏ nhánh PAID/VOID, đổi onSettled thành onSuccess, sai getPeriodRange, đổi ngưỡng count) vẫn pass. Nên chuyển sang bảng it.each theo nhánh/biên, thêm test cho từng mutation (cả khi lỗi), và dọn mock giữa các test.

### 5-payment-panel

Bộ test chỉ có 3 case, kiểm chứng tốt double-click của 'Ghi nhận', luồng undo sau khi ghi và việc truyền warehouseId. Nhưng PaymentPanel còn rất nhiều hành vi chưa được test: phân bổ FIFO và xác nhận phân bổ, hủy khoản thu/phân bổ với ngưỡng lý do, ngưỡng amount của form ghi, chọn khoản thu bằng Radio, các trạng thái loading/error/rỗng, quyền, xử lý lỗi và ghi chú hủy. Nhiều mutation quan trọng vẫn khiến mọi test pass, nên mức độ tin cậy thấp. Cần thêm test theo nhánh và biên, siết assertion payload, và dùng assert DOM thay vì đếm lời gọi mock.

## Kiểm chứng thủ công (file 1, vat-rate)

- Thiếu biên 100 và số âm, mutant `<=` → `<` sống sót: đúng.
- `parseCategoryVatRate` không có case không hợp lệ: đúng.
- Bỏ `.trim()` làm chuỗi khoảng trắng trả 0% thay vì fallback, không test nào bắt: đúng.
- Đổi `??` thành `||` trong `toVatRateFormValue` làm mất mức VAT 0%, không test nào bắt: đúng, rủi ro thật.
- Đề xuất test NaN: thừa, case `'abc'` đã đi qua nhánh NaN.
- Nhận định chung: phát hiện đáng tin, nhưng mức `fail` hơi gắt cho một bộ test khá tốt.
