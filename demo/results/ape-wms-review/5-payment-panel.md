# Review: `views/main/billing/period/components/payment-panel.test.tsx` — **NEEDS_WORK**

Bộ test chỉ có 3 case, kiểm chứng tốt double-click của 'Ghi nhận', luồng undo sau khi ghi và việc truyền warehouseId. Nhưng PaymentPanel còn rất nhiều hành vi chưa được test: phân bổ FIFO và xác nhận phân bổ, hủy khoản thu/phân bổ với ngưỡng lý do, ngưỡng amount của form ghi, chọn khoản thu bằng Radio, các trạng thái loading/error/rỗng, quyền, xử lý lỗi và ghi chú hủy. Nhiều mutation quan trọng vẫn khiến mọi test pass, nên mức độ tin cậy thấp. Cần thêm test theo nhánh và biên, siết assertion payload, và dùng assert DOM thay vì đếm lời gọi mock.

## Behavior LLM tự suy ra từ source

| Behavior | Biên | Test hiện có |
|---|---|---|
| Ghi khoản thu: chặn bấm đúp (runOnce) – chỉ gọi logPayment 1 lần | 1 click, 3 click cùng tick | yes |
| Ghi khoản thu: nút bị disable khi amount rỗng/0; hợp lệ khi > 0 | null, 0, 0.01, âm (min=0 chặn) | no |
| Ghi khoản thu: payload đúng (paymentDate YYYY-MM-DD, paymentMethod, referenceCode trim hoặc undefined) | reference rỗng, reference toàn khoảng trắng, reference có khoảng trắng hai đầu, đổi ngày/method | partial |
| Sau ghi thành công: reset amount/reference và đóng form; thất bại: message.error và giữ form | thành công, reject có message, reject không message | no |
| Hoàn tác khoản thu: gọi cancel với paymentId vừa tạo + lý do i18n; thiếu paymentId thì báo lỗi | id có, id undefined | partial |
| Tải hóa đơn/khoản thu theo customerId + warehouseId | có warehouseId, không có warehouseId | partial |
| Gợi ý phân bổ FIFO theo khoản thu chưa phân bổ; sửa số tiền cập nhật tổng/còn dư/vượt (leftover/overBy), paid in full/remaining | amount = 0, amount = amountDue, amount > payment, amount = payment, amountDue - amount = 0 | no |
| Xác nhận & phân bổ: mở ConfirmInline, gọi allocatePayment đúng payload, toast success, đóng confirm; lỗi thì toast error; double click chỉ 1 lần | không có khoản thu chưa phân bổ, action disabled/không quyền, API lỗi | no |
| Radio chọn khoản thu chưa phân bổ (chỉ hiện khi >1); đổi chọn reset confirm và gợi ý | 0 payment, 1 payment, 2 payment | no |
| Hủy khoản thu/phân bổ: lý do sau trim >= MIN_CANCEL_REASON_LENGTH mới bật xác nhận; gọi đúng API theo loại; double click chặn | MIN-1 ký tự, MIN ký tự, MIN ký tự toàn khoảng trắng, 500 ký tự | no |
| Trạng thái loading/error/rỗng của hóa đơn mở & lịch sử khoản thu (Skeleton, retry, noPayments, noOpenInvoices) | isLoading, isError + retry, data rỗng | no |
| Lịch sử: hiển thị tag huỷ, ghi chú huỷ có/không actor, phân bổ active trước cancelled | cancelledBy = currentMember, cancelledBy không biết tên, reason rỗng → '—' | no |
| Quyền: permissions.paymentCreate=false ẩn form ghi; nút Hủy theo quyền | paymentCreate=false, paymentUpdate=false | no |
| startWithLogForm=false: form đóng, link 'ghi thêm' mở form; nút 'Quay lại' gọi onBackToCustomer | true, false | no |

## Rubric

### ⚠️ test_vs_implementation (medium confidence)
- **Bằng chứng:** Phần lớn assert ở biên công khai: API mock (paymentApi.logPayment/cancel được gọi với payload), DOM ('Còn nợ của khách: 2.000.000'). Nhưng test 'loads invoices and payments...' chỉ assert đối số của invoiceApi.list/paymentApi.list bằng expect.objectContaining – đó là chi tiết cách gọi API bên trong hook, không phải hành vi người dùng thấy. Test ac2 còn dùng notification.open.mock.calls[0][0].description (cấu trúc nội bộ của useUndoableAction) rồi render lại bằng render() thứ hai; và đếm invoiceApi.list.mock.calls.length để suy ra 'reload' – phụ thuộc cài đặt react-query/refetch.
- **Gợi ý:** Với test warehouse, mock API trả dữ liệu khác nhau theo warehouseId và assert DOM (số nợ hiển thị khác nhau) thay vì assert đối số. Với reload sau undo, assert nợ hiển thị đổi theo dữ liệu mock mới thay vì đếm số lần gọi.

### ❌ equivalence_boundary (medium confidence)
- **Bằng chứng:** Chỉ 3 test, đều chỉ dùng 1 giá trị 'happy' (amount '1.500.000', 1 hóa đơn, 1 khoản thu). Không có test cho: amount rỗng/0 (disabled: `!logAmount || logAmount <= 0`), lý do hủy MIN_CANCEL_REASON_LENGTH-1/MIN, referenceCode trim, amount = amountDue / > payment (leftover vs overBy), >1 khoản thu (Radio), loading/error/rỗng, hủy khoản thu/phân bổ, quyền paymentCreate=false, startWithLogForm=false.
- **Gợi ý:** Thêm test theo từng nhánh: (1) amount '' / '0' → nút ghi disabled, '1' → enabled; (2) lý do hủy 4 ký tự → nút xác nhận disabled, 5 ký tự → ConfirmInline xuất hiện, 5 ký tự toàn khoảng trắng → vẫn disabled; (3) sửa số tiền phân bổ = amountDue → 'paidInFull', > payment → 'overBy'; (4) 2 khoản thu → Radio hiển thị; (5) paymentCreate=false → không có form; (6) API lỗi → message.error.

### ⚠️ assertion_strength (medium confidence)
- **Bằng chứng:** Có assertion mạnh: toHaveBeenCalledTimes(1), toHaveBeenCalledWith('pay-new', {reason: ...}), objectContaining({amount: 1_500_000}). Điểm yếu: objectContaining ở các test khác chỉ kiểm tra một phần payload (không kiểm tra paymentDate, paymentMethod, referenceCode, customerId); `waitFor(() => expect(...calls.length).toBeGreaterThan(before))` yếu (không biết gọi lại vì lý do gì); `getByText(/Còn nợ của khách: 2\.000\.000/)` regex không neo, và test 'ac2' vốn đã có số này trước khi undo nên assert cuối có thể pass dù reload không làm gì; i18next.t(...) dùng làm expected value có thể là circular nếu i18n chưa init (trả về key, so khớp key với key).
- **Gợi ý:** Assert đầy đủ payload logPayment bằng toHaveBeenCalledWith({customerId:'c-1', paymentDate: <ngày cố định>, amount:1_500_000, paymentMethod:'BANK_TRANSFER', referenceCode: undefined}). Trong ac2, cho invoiceApi.list lần sau trả giá trị khác (hoặc cùng giá trị nhưng assert thêm UI) để chứng minh reload. Dùng chuỗi cứng tiếng Việt hoặc xác nhận i18n đã init trong setup.

### ✅ isolation (medium confidence)
- **Bằng chứng:** beforeEach thiết lập mock API và window.$notification/$message; afterEach gọi vi.clearAllMocks() và xoá các global. Mỗi test tạo QueryClient mới trong renderPanel (retry: false). resolveLog là biến cục bộ trong test.
- **Gợi ý:** Lưu ý vi.clearAllMocks() không reset implementation (mockImplementation/mockResolvedValue đặt trong test cũ vẫn có thể rò rỉ, vd paymentApi.logPayment); dùng vi.resetAllMocks() hoặc đặt lại mặc định trong beforeEach. Nên gọi cleanup/unmount cho `toast = render(...)` thứ hai trong ac2.

### ⚠️ determinism (medium confidence)
- **Bằng chứng:** Source dùng `dayjs()` làm logDate mặc định nhưng test không mock thời gian và không assert paymentDate, nên hiện chưa flaky nhưng nếu thêm assert sẽ phụ thuộc ngày chạy. Test dùng dueDate '2099-10-31' để tránh quá hạn (time-bomb tạm né, nhưng sẽ vỡ năm 2099 và issueDate '2026-10-01' cố định so với hôm nay 2026-10-19 không ảnh hưởng). Async dùng waitFor/findByText đúng; `resolveLog` gán trong promise executor an toàn nhưng phụ thuộc thứ tự microtask ('react-query starts mutationFn a microtask later').
- **Gợi ý:** Dùng vi.useFakeTimers({toFake:['Date']}) + vi.setSystemTime('2026-10-19') khi test payload ngày; dùng ngày tương đối hoặc mock thời gian cho logic quá hạn.

### ⚠️ naming_clarity (high confidence)
- **Bằng chứng:** 'a double click on "Ghi nhận" logs the payment only once' và 'loads invoices and payments with the same warehouse filter...' mô tả rõ hành vi. 'ac2: log → Hoàn tác cancels...' dùng mã 'ac2' khó hiểu ngoài ngữ cảnh và gộp nhiều hành vi (log, toast, undo, không allocate, reload nợ). describe 'PaymentPanel — log payment' nhưng chứa cả test tải dữ liệu theo warehouse (không phải log payment).
- **Gợi ý:** Đổi thành 'undo after logging cancels the new payment with the undo reason and leaves debt unchanged' và tách thành các test nhỏ; chuyển test warehouse sang describe 'data loading'.

### ❌ fake_pass_risk (high confidence)
- **Bằng chứng:** Các mutation sau vẫn khiến cả 3 test pass: (1) đổi `logAmount <= 0` thành `< 0` hoặc bỏ điều kiện; (2) đổi MIN_CANCEL_REASON_LENGTH/`>=` thành `>`; (3) bỏ `.trim()` ở referenceCode; (4) sai định dạng ngày API_DATE_FORMAT; (5) đổi `summary.remainder >= 0` thành `> 0`; (6) bỏ `setIsLogFormOpen(false)` hoặc reset amount sau khi ghi; (7) bỏ message.error trong catch; (8) hỏng toàn bộ handleAllocate/handleCancel (không test nào click phân bổ hay hủy); (9) sai paymentMethod mặc định; (10) bỏ điều kiện `unallocatedPayments.length > 1`; (11) hỏng renderCancelledNote/getActorName. Chỉ phần runOnce của log, payload undo và truyền warehouseId được bảo vệ.
- **Gợi ý:** Bổ sung test cho allocate (mở confirm → xác nhận → allocatePayment đúng payload), cancel payment/allocation (ngưỡng lý do), log (disabled boundary, payload đầy đủ, reset form, lỗi API), cộng thêm test nhánh Radio, loading/error/empty và quyền.
