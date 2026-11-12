# Review: `common/helpers/__tests__/permission.helper.spec.ts` — **NEEDS_WORK**

Test của checkPermission khá tốt (assert ở public boundary, giá trị cụ thể, xác định, có dọn state). Nhưng file source export 4 hàm và 3 hàm (hasPermissionCode, hasRouteAccess, hasRouteViewPermission) không có test nào, dù chứa phần lớn nhánh logic. Thiếu thêm case chéo chọn nguồn quyền theo type. Rủi ro pass giả cao với các hàm chưa test, nên cần bổ sung trước khi tin vào bộ test này.

## Behavior LLM tự suy ra từ source

| Behavior | Biên | Test hiện có |
|---|---|---|
| checkPermission – TENANT_MASTER dùng permissionCodes (dedupe), có code → true | code có trong list, code không có, trùng lặp, permissionCodes undefined, permissionCodes [] | yes |
| checkPermission – non-TENANT_MASTER gom permissionCodes từ các roles | 1 role, nhiều roles, role permissionCodes undefined, roles [] | yes |
| checkPermission – chọn đúng nguồn theo type (TENANT_MASTER bỏ qua roles; non-master bỏ qua permissionCodes cấp store) | TENANT_MASTER có roles chứa code nhưng permissionCodes không, STAFF có permissionCodes cấp store nhưng roles không | no |
| hasPermissionCode – code có '.' so khớp chính xác với rawPermissions; không '.' so khớp phần module (trước dấu chấm) | 'A.VIEW' có/không có, 'A' khi có 'A.VIEW', 'A' khi không có, rawPermissions rỗng, tham số basePermissions truyền vào tường minh | no |
| hasRouteAccess là alias của hasPermissionCode | – | no |
| hasRouteViewPermission – routeKey không có trong map → true; module chứa '.' dùng trực tiếp; module tra PERMISSION_CODES[..].VIEW; không có viewCode → true; ngược lại kiểm tra quyền | routeKey không tồn tại, module có '.', module có VIEW, module không có trong PERMISSION_CODES, user có/không có quyền VIEW | no |

## Rubric

### ✅ test_vs_implementation (high confidence)
- **Bằng chứng:** Test chỉ gọi checkPermission và assert giá trị boolean trả về; set state qua store công khai. Không spy hàm nội bộ hay đếm số lần gọi. Refactor (vd bỏ Set) không làm test fail.
- **Gợi ý:** Giữ cách tiếp cận này khi bổ sung test cho các hàm còn lại.

### ❌ equivalence_boundary (medium confidence)
- **Bằng chứng:** Chỉ checkPermission được test. hasPermissionCode, hasRouteAccess, hasRouteViewPermission (3 export, nhiều nhánh: code có '.' vs không, routeKey không có map, module có '.', không có viewCode) hoàn toàn không có test. Với checkPermission, không có case xác nhận chọn đúng nguồn theo type (master có roles / staff có permissionCodes cấp store).
- **Gợi ý:** Thêm test cho hasPermissionCode: ('A.VIEW', ['A.VIEW']) → true; ('A.VIEW', ['A.EDIT']) → false; ('A', ['A.VIEW']) → true; ('A', ['B.VIEW']) → false; ('A', []) → false. Thêm hasRouteViewPermission với mock NSPermissionConfig cho 4–5 nhánh. Thêm test TENANT_MASTER có roles chứa code nhưng permissionCodes rỗng → false và ngược lại cho STAFF.

### ✅ assertion_strength (medium confidence)
- **Bằng chứng:** Dùng toBe(true)/toBe(false) cụ thể. Case 'handles duplicate permission codes' chỉ assert true, nên không thực sự chứng minh dedupe (kết quả giống nhau dù không dedupe).
- **Gợi ý:** Test dedupe thực chất không quan sát được qua boolean; cân nhắc đổi tên/bỏ, hoặc chấp nhận đây là smoke test. Case 'aggregates' có assert âm tốt.

### ⚠️ isolation (medium confidence)
- **Bằng chứng:** beforeEach gọi useAccountStore.getState().reset() nên state được dọn. Tuy nhiên phụ thuộc vào việc reset() thực sự đưa roles/permissionCodes về giá trị mặc định (không thấy source store). Một số test gộp nhiều lần setState trong cùng một it ('returns false when permissionCodes is empty or undefined').
- **Gợi ý:** Tách case undefined và [] thành hai test riêng; có thể thêm afterEach reset để không rò rỉ sang file test khác.

### ✅ determinism (high confidence)
- **Bằng chứng:** Không dùng Date/Math.random/async; hàm đồng bộ thuần theo state store.
- **Gợi ý:** Không cần thay đổi.

### ⚠️ naming_clarity (medium confidence)
- **Bằng chứng:** Phần lớn tên mô tả rõ hành vi. Riêng 'handles duplicate permission codes in permissionCodes correctly', 'handles roles with undefined or empty permissionCodes gracefully' mơ hồ ('correctly', 'gracefully'); 'returns false when permissionCodes is empty or undefined' gộp hai case.
- **Gợi ý:** Đổi thành vd 'returns true when permission code appears more than once in permissionCodes', 'ignores roles whose permissionCodes is undefined and still reads other roles'.

### ❌ fake_pass_risk (high confidence)
- **Bằng chứng:** Các mutation sau vẫn pass toàn bộ test: (1) đổi `code.includes('.')` thành `!code.includes('.')` trong hasPermissionCode; (2) đổi `split('.')[0]` thành `split('.')[1]`; (3) hasRouteViewPermission `return true` khi không có module đổi thành `return false`; (4) `!viewCode ||` bỏ đi; (5) hasRouteAccess = () => false. Với checkPermission: đảo điều kiện `type === 'TENANT_MASTER'` thành `!==` sẽ bị bắt, nhưng bỏ Set dedupe thì vẫn pass; đổi nguồn sang gộp cả roles lẫn permissionCodes cho master cũng vẫn pass vì chưa có case chéo.
- **Gợi ý:** Bổ sung test cho 3 hàm chưa được cover và các case chéo nguồn quyền (master+roles, staff+permissionCodes) để bắt các mutation trên.
