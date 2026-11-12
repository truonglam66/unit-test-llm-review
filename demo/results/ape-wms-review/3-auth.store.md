# Review: `store/__tests__/auth.store.spec.ts` — **NEEDS_WORK**

Test login và logout kiểm chứng được một phần (token, account.id), nhưng khá lỏng. Ba spy (account/access/tabs) được tạo mà không được assert, nên cascade reset của access và tabs hoàn toàn không được bảo vệ: xoá hai dòng đó test vẫn pass. Test forgotPassword/resetPassword chỉ kiểm lời gọi API, không kiểm state dù tên test nói có. Thiếu hẳn nhánh lỗi (API reject), response rỗng và persist. Cần bổ sung assertion trạng thái thật, dọn mock/storage và sửa tên test cho khớp.

## Behavior LLM tự suy ra từ source

| Behavior | Biên | Test hiện có |
|---|---|---|
| Khởi tạo state: accessToken và refreshToken rỗng | '' / '' | partial |
| login: gọi authApi.login với payload và merge toàn bộ response vào state (token được lưu) | response có token, response có field thừa (expiresIn), API reject (lỗi) -> state không đổi, lỗi được ném ra | partial |
| forgotPassword: gọi authApi.forgotPassword và merge response vào state | response có token, response rỗng/không có field, API reject | partial |
| resetPassword: gọi authApi.resetPassword và merge response vào state | response có token mới, response rỗng, API reject | partial |
| logout: gọi reset() -> xoá token | đang có token, chưa có token (idempotent) | yes |
| reset: xoá token và cascade reset useAccountStore, useAccessStore, useTabsStore.resetTabs | account có dữ liệu, access có dữ liệu, tabs có dữ liệu | partial |
| persist middleware lưu state vào storage với key 'access-token' | tên key, dữ liệu persist sau login/reset | no |

## Rubric

### ⚠️ test_vs_implementation (medium confidence)
- **Bằng chứng:** Phần lớn assert vào state công khai của store (accessToken, refreshToken), tốt. Nhưng test login/forgot/reset dùng `expect(authApi.xxx).toHaveBeenCalledWith(...)` là kiểm tra tương tác với dependency (chấp nhận được vì là ranh giới ra ngoài). Trong test logout tạo 3 spy (`accountResetSpy`, `accessResetSpy`, `tabsResetSpy`) nhưng không dùng, thể hiện ý định assert chi tiết nội bộ nhưng cuối cùng không có.
- **Gợi ý:** Bỏ các spy thừa. Assert kết quả quan sát được: state của account/access/tabs sau logout đã về giá trị khởi tạo, thay vì spy vào hàm reset.

### ❌ equivalence_boundary (medium confidence)
- **Bằng chứng:** Mỗi action chỉ có 1 happy path. Không có case API reject (login/forgotPassword/resetPassword), không có case response rỗng, không có logout khi chưa đăng nhập. Tên test nói 'if response provided' nhưng không test trường hợp không có response.
- **Gợi ý:** Thêm: `login` reject -> promise reject và token vẫn rỗng; `forgotPassword`/`resetPassword` trả `{}`/undefined -> state không bị hỏng; logout khi đã rỗng; reset khi access/tabs có dữ liệu.

### ❌ assertion_strength (high confidence)
- **Bằng chứng:** Test forgotPassword và resetPassword chỉ assert `toHaveBeenCalledWith`, KHÔNG assert state sau khi gọi dù tên test ghi 'updates state'. Test logout: chỉ kiểm account `id` là '' , không kiểm `username`, access hay tabs. Test initialState dùng reset() trong beforeEach nên không chứng minh giá trị khởi tạo thật. Mock response `{success: true}` được merge vào state nhưng không được kiểm.
- **Gợi ý:** Trong forgot/reset mock trả `{accessToken:'x'}` rồi assert `useAuthStore.getState().accessToken === 'x'`. Trong logout assert `useAccountStore.getState()` về initial đầy đủ, `useAccessStore`/`useTabsStore` về initial (đặt dữ liệu trước rồi so sánh sau).

### ⚠️ isolation (medium confidence)
- **Bằng chứng:** beforeEach gọi `vi.clearAllMocks()` và `useAuthStore.getState().reset()` (reset cũng reset 3 store khác, tốt). Tuy nhiên: `vi.clearAllMocks` không reset implementation của mockResolvedValue; persist ghi vào storage (localStorage) không được dọn; `vi.spyOn` không được restore (không có restoreAllMocks/afterEach), spy lên `getState()` object có thể rò rỉ sang test khác.
- **Gợi ý:** Thêm `afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); })` và dùng `mockReset`. Bỏ spy hoặc restore sau test.

### ✅ determinism (high confidence)
- **Bằng chứng:** Không dùng Date/Math.random; async đều có await; mock API trả giá trị cố định.
- **Gợi ý:** Không cần đổi. Nếu thêm test persist, nên clear storage để tránh phụ thuộc môi trường.

### ⚠️ naming_clarity (high confidence)
- **Bằng chứng:** Tên 'calls authApi.forgotPassword and updates state if response provided' không khớp nội dung (không check state, không có case 'không có response'). 'clears token and triggers cascade resets...' khẳng định triggers cascade nhưng không assert spy. Nhóm 'forgotPassword and resetPassword' gộp hai hành vi.
- **Gợi ý:** Đổi tên cho đúng nội dung hoặc bổ sung assertion cho khớp, vd 'forgotPassword merges API response into state'. Tách describe riêng cho từng action.

### ❌ fake_pass_risk (high confidence)
- **Bằng chứng:** Mutation còn pass: (1) xoá `useAccessStore.getState().reset()` trong reset -> test vẫn pass (spy không được assert, access không được kiểm). (2) xoá `useTabsStore.getState().resetTabs()` -> vẫn pass. (3) bỏ `set({...response})` trong forgotPassword/resetPassword -> vẫn pass vì chỉ kiểm toHaveBeenCalledWith. (4) đổi `logout` thành no-op nhưng không... (logout được kiểm token nên fail) – ok; nhưng đổi key persist 'access-token' -> vẫn pass. (5) bỏ `useAccountStore.reset()` -> fail, đúng, đây là cascade duy nhất được bảo vệ. (6) đổi login thành không merge `refreshToken` -> fail, tốt.
- **Gợi ý:** Assert state của access và tabs sau logout; assert state sau forgotPassword/resetPassword; thêm test rejection và test persist key (kiểm `localStorage.getItem('access-token')`).
