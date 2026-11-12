# Demo: viết unit test nhiều tầng bằng LLM

```
Tầng 1  Phân tích source   -> behavior / equivalence class / biên
Tầng 2  Sinh test           -> chạy Jest (LLM được sửa 1 lần nếu lỗi)
Tầng 3  Đánh giá            -> Stryker (mutation score) + review rubric 7 tiêu chí
Tầng 4  Tinh chỉnh          -> đưa mutant sống sót + nhận xét rubric cho LLM, quay lại tầng 3
Dừng khi: đạt ngưỡng mutation score | hết số vòng | không cải thiện so với vòng trước
```

## Cài đặt

```bash
npm install                      # Jest, ts-jest, TypeScript 5, Stryker
python3 -m venv .venv && .venv/bin/pip install matplotlib   # chỉ cần cho biểu đồ
```

LLM được gọi qua `claude -p` (Claude Code CLI) bằng tài khoản đã login, **không cần API key**.
Nếu máy có biến `ANTHROPIC_API_KEY`, code tự bỏ biến đó khi gọi CLI.
Muốn dùng API thay vì CLI: `LLM_BACKEND=api` (cần `pip install anthropic` và key còn credit).

## Chạy

```bash
# 1. Review file test có sẵn theo rubric 7 tiêu chí (quy trình đầy đủ ở mục "Quy trình review unit test cho project khác")
./review-tests tests/eligibility.service.spec.ts

# 2. Pipeline nhiều tầng cho một file source
python3 pipeline.py src/shipping-fee.ts --max-rounds 3 --threshold 100
python3 pipeline.py src/shipping-fee.ts --confirm     # dừng sau tầng 1 để người duyệt behavior
python3 pipeline.py src/shipping-fee.ts --naive       # mốc so sánh: sinh test 1 lần

# 3. Thí nghiệm: sinh 1 lần vs pipeline (4 file x 2 chế độ x 2 lần)
.venv/bin/python experiment.py --model haiku --reps 2 --name exp-haiku
.venv/bin/python experiment.py --report-only results/exp-haiku   # vẽ lại từ log
```

Mỗi lượt chạy ghi vào `runs/<tên>/`: `round<N>.spec.ts` (test từng vòng), `final.spec.ts`,
`mutation.json` (báo cáo Stryker), `log.json` (số liệu từng vòng).
Thí nghiệm ghi `results/<tên>/`: `results.csv`, `rounds.csv`, `summary.md`, `chart.png`.

## Quy trình review unit test cho project khác (ví dụ ape_wms_admin)

```
1. Review test  ->  2. Lọc nhận xét  ->  3. Sửa test  ->  4. Kiểm chứng  ->  5. Review lại
   review-tests       triage               fix-tests        verify-tests        review-tests
```

| Bước | Công cụ | Đầu vào | Đầu ra |
|---|---|---|---|
| 1. Review test | `review-tests` | File test + file source | Báo cáo theo rubric 7 tiêu chí |
| 2. Lọc nhận xét | `triage` | Thư mục kết quả bước 1 | Nhãn đúng / sai cho từng nhận xét, precision |
| 3. Sửa test | `fix-tests` | Các nhận xét nhãn "Đúng" | File test mới (hỏi trước khi ghi đè) + danh sách mutation mục tiêu |
| 4. Kiểm chứng | `verify-tests` | Test cũ, test mới, mutation mục tiêu | Code coverage cũ / mới; mỗi mutation bị test cũ / test mới bắt hay để sót |
| 5. Review lại | `review-tests` | File test đã sửa | Báo cáo mới để so với bước 1 |

Bước 2 cần vì LLM có false positive. Bước 4 cần vì nếu không chạy thật thì "test tốt hơn" chỉ là LLM tự nhận.

### Chuẩn bị (mỗi cửa sổ terminal làm một lần)

```bash
cd /Users/turongsosoft/Documents/apetechs/Ape_WMS/ape_wms_admin
DEMO=/Users/turongsosoft/Documents/study/unit-test-llm-review/demo
```

- Mọi lệnh chạy từ **thư mục gốc của project cần review**, vì đường dẫn file test tính từ đó.
- `DEMO` chỉ là biến shell trỏ tới thư mục demo, để gõ `$DEMO/review-tests` thay cho đường dẫn dài.
  Biến mất khi đóng terminal; mở terminal mới thì đặt lại.
- `review-tests`, `triage`, `fix-tests`, `verify-tests` là lệnh bọc, tự dùng Python trong `demo/.venv`.
- Cần đã login Claude Code (`claude` chạy được). Không cần API key.

---

### Bước 1. Review test

**Cú pháp**

```
$DEMO/review-tests <file-test> [<file-test> ...] [--out-dir <thư-mục>] [--model <tên>] [--jobs <số>] [--json]
```

| Thành phần | Bắt buộc | Ý nghĩa |
|---|---|---|
| `<file-test>` | Có, ít nhất 1 | Đường dẫn file `.spec.ts` / `.test.tsx`, tính từ thư mục hiện tại. Nhiều file cách nhau bằng dấu cách; dùng được glob như `src/store/__tests__/*.spec.ts`. Các file được review song song. |
| `--out-dir <thư-mục>` | Không | Lưu kết quả ra thư mục thay vì in đầy đủ ra terminal (giải thích bên dưới). |
| `--model <tên>` | Không | `sonnet` (mặc định, nhận xét sâu hơn) hoặc `haiku` (nhanh, rẻ hơn). |
| `--jobs <số>` | Không | Số file review cùng lúc, mặc định 5. |
| `--json` | Không | Xuất JSON thay vì Markdown. |
| `LLM_OUTPUT_LANG=English` | Không | Đặt **trước** lệnh để LLM viết nhận xét bằng tiếng Anh (mặc định tiếng Việt). |

Mỗi file test phải map được về file source: `foo.spec.ts` / `foo.test.tsx` nằm cùng thư mục với `foo.ts`,
hoặc nằm trong `__tests__/` ngay dưới thư mục đó. File không map được báo `✗`, các file khác vẫn chạy tiếp.

**Về `--out-dir`**

| | Không có `--out-dir` | Có `--out-dir ~/wms-review` |
|---|---|---|
| Terminal | Báo cáo đầy đủ từng file, rồi bảng tổng hợp | Một dòng `✓` mỗi file và bảng tổng hợp |
| Lưu file | Không | `<tên-file>.md`, `<tên-file>.json` cho từng file |
| `summary.md`, `summary.png` (biểu đồ) | Không | Có, **chỉ khi review từ 2 file trở lên** |
| Dùng được cho bước 2 (`triage`) | Không | Có (cần file `.json`) |

- `~/wms-review` nghĩa là thư mục `wms-review` trong thư mục home (`/Users/<tên>/wms-review`). Có thể dùng đường dẫn bất kỳ.
- Thư mục chưa có thì tự tạo. Đã có thì file **cùng tên bị ghi đè**, file khác giữ nguyên.
- Nên đặt thư mục **ngoài repo** để không làm bẩn `git status`.
- Mỗi lần review nên dùng **một thư mục riêng** (`~/wms-review-v1`, `~/wms-review-v2`...), vì kết quả lọc ở bước 2
  (`triage.json`) nằm trong thư mục đó và gắn với lần review ấy.

**Ví dụ**

```bash
# Xem đầy đủ trên terminal, không lưu
$DEMO/review-tests src/store/__tests__/auth.store.spec.ts

# 5 file, lưu kết quả + biểu đồ vào ~/wms-review-v1
$DEMO/review-tests \
  src/views/main/setting/billing-category/utils/vat-rate.spec.ts \
  src/common/helpers/__tests__/permission.helper.spec.ts \
  src/store/__tests__/auth.store.spec.ts \
  src/views/main/billing/period/hooks/use-period-actions.test.ts \
  src/views/main/billing/period/components/payment-panel.test.tsx \
  --out-dir ~/wms-review-v1

open ~/wms-review-v1/summary.png   # xem biểu đồ (macOS)

# Cả thư mục, dùng Haiku, nhận xét tiếng Anh
LLM_OUTPUT_LANG=English $DEMO/review-tests src/store/__tests__/*.spec.ts --model haiku --out-dir ~/wms-review-store
```

Dấu `\` ở cuối dòng chỉ để xuống dòng cho dễ đọc; có thể viết tất cả trên một dòng.

---

### Bước 2. Lọc nhận xét

**Cú pháp**

```
$DEMO/triage <thư-mục-out-dir-của-bước-1> [--redo] [--include-pass]
```

| Thành phần | Ý nghĩa |
|---|---|
| `<thư-mục>` | Đúng thư mục đã truyền cho `--out-dir` ở bước 1. |
| `--redo` | Hỏi lại cả những nhận xét đã gán nhãn. |
| `--include-pass` | Hỏi cả các tiêu chí LLM chấm pass, để kiểm tra LLM có bỏ sót lỗi không. |

Lệnh hỏi lần lượt từng nhận xét warn / fail. Mỗi câu hiện spec, tiêu chí, mức LLM chấm, bằng chứng,
gợi ý sửa và cách kiểm chứng gợi ý. Trả lời bằng một phím:

| Phím | Nhãn | Khi nào chọn |
|---|---|---|
| `1` | Đúng | Đã đối chiếu code, lỗi có thật, nên sửa |
| `2` | Đúng nhưng không đáng sửa | Lỗi có thật nhưng rủi ro thấp, sửa tốn công hơn lợi ích |
| `3` | Sai (false positive) | LLM hiểu nhầm code |
| `4` | Không kiểm chứng được | Phụ thuộc module mà LLM không thấy |
| `s` / `b` / `q` | | Bỏ qua / quay lại câu trước / thoát |

Sau mỗi nhãn có thể nhập ghi chú (Enter để bỏ trống). Câu trả lời lưu ngay vào `triage.json`;
thoát giữa chừng rồi chạy lại sẽ hỏi tiếp từ chỗ dở.

**Ví dụ**

```bash
$DEMO/triage ~/wms-review-v1
cat ~/wms-review-v1/triage.md      # bảng nhãn + precision tổng và theo tiêu chí
```

Cách kiểm chứng nhanh theo loại nhận xét:

| Nhận xét dạng | Cách kiểm chứng |
|---|---|
| "Thiếu test cho biên / nhánh X" | Tìm trong file test có case nào chạm vào giá trị hoặc nhánh đó |
| "Đổi `A` thành `B` mà test vẫn pass" | Sửa thử source theo đúng mutation, chạy test (xem bước 4), rồi hoàn tác |
| "Spy / mock không được assert" | Tìm `expect(...)` trên biến đó |
| "Test phụ thuộc thời gian / thứ tự" | Chạy riêng test đó, hoặc đổi thứ tự |

---

### Bước 3. Sửa test

**Cú pháp**

```
$DEMO/fix-tests <thư-mục-out-dir> [--only <tên> [<tên> ...]] [--model <tên>] [--yes]
```

| Thành phần | Ý nghĩa |
|---|---|
| `<thư-mục-out-dir>` | Thư mục đã dùng ở bước 1 và 2 (phải có `triage.json`). |
| `--only <tên> ...` | Chỉ sửa các file test có tên chứa **một trong** các chuỗi này, ví dụ `--only vat-rate` hoặc `--only vat-rate auth.store`. Bỏ trống = tất cả file có nhận xét Đúng. |
| `--model <tên>` | `sonnet` (mặc định) hoặc `haiku`. Nên dùng `sonnet` vì phải viết lại cả file test. |
| `--yes` | Tự đồng ý ghi đè, không hỏi. Chỉ dùng khi đã làm trên branch riêng. |

**Lệnh làm gì, với mỗi file test có ít nhất một nhận xét nhãn 1 (Đúng):**

1. Gửi cho LLM: source (đánh số dòng), test hiện tại, các nhận xét Đúng kèm ghi chú của bạn ở bước 2.
   Nhận xét nhãn 2, 3, 4 **không** được gửi.
2. LLM trả về file test mới và **danh sách mutation mục tiêu**: các lỗi giả lập trong source mà test mới phải bắt
   được còn test cũ thì để sót (ví dụ đổi `age < 18` thành `age <= 18`). Danh sách này dùng cho bước 4.
3. Ghi tạm test mới và chạy bằng test runner của project (tự nhận `vitest` hoặc `jest` từ `package.json`).
   Nếu fail, LLM được sửa 1 lần; vẫn fail thì giữ nguyên file cũ.
4. Hiện diff (đỏ: dòng bỏ, xanh: dòng thêm), ghi chú của LLM và các mutation mục tiêu, rồi hỏi:
   `Ghi đè <tên> bằng bản mới? [y/N]`. Chọn `y` thì giữ bản mới; Enter hoặc `n`, lỗi, Ctrl+C đều trả file về bản cũ.

**File tạo trong thư mục out-dir**

| File | Nội dung |
|---|---|
| `<tên>.orig` | Bản test gốc trước khi sửa (giữ từ lần sửa đầu tiên) |
| `<tên>.proposed` | Bản test LLM đề xuất (kể cả khi bạn không chấp nhận) |
| `<tên>.fix.json` | Mutation mục tiêu, đã chấp nhận hay chưa; đầu vào của bước 4 |

**Ví dụ**

```bash
git checkout -b test/improve-from-review     # nên làm trên branch riêng
$DEMO/fix-tests ~/wms-review-v1               # lần lượt từng file, hỏi y/N
$DEMO/fix-tests ~/wms-review-v1 --only vat-rate              # chỉ 1 file
$DEMO/fix-tests ~/wms-review-v1 --only vat-rate auth.store   # 2 file
git diff                                      # xem lại mọi thay đổi trước khi commit
```

Lưu ý: LLM được yêu cầu viết test **pass với source hiện tại**. Nếu nhận xét cho thấy chính source có bug,
LLM không viết test fail mà ghi vào phần ghi chú; bạn cần tự xử lý bug đó.

---

### Bước 4. Kiểm chứng

**Cú pháp**

```
$DEMO/verify-tests <thư-mục-out-dir> [--only <tên> [<tên> ...]] [--no-coverage]
```

| Thành phần | Ý nghĩa |
|---|---|
| `<thư-mục-out-dir>` | Thư mục đã chạy bước 3. Lệnh chỉ quét các file `*.fix.json` trong đó; mỗi `fix.json` trỏ tới `.orig` (test cũ), `.proposed` (test mới nếu chưa chấp nhận), file test và file source trong repo. |
| `--only <tên> ...` | Chỉ kiểm chứng các file test có tên chứa **một trong** các chuỗi này. Bỏ trống = tất cả `*.fix.json`. |
| `--no-coverage` | Bỏ qua bước đo code coverage. |

`verify.md` / `verify.json` bị ghi đè mỗi lần chạy và chỉ chứa các file của lần chạy đó.

**Lệnh làm gì, với mỗi `<tên>.fix.json`:**

1. Chạy test cũ (`.orig`) và test mới trên source gốc: test mới phải pass.
   Test mới là file hiện tại nếu đã chấp nhận ở bước 3, nếu không thì bản `.proposed`.
2. **Đo code coverage** của đúng file source đang xét (line, branch, function, statement) với test cũ và test mới.
3. Với từng mutation mục tiêu: **sửa tạm file source**, chạy test cũ rồi test mới.
   Test **fail** nghĩa là mutation **bị bắt** (tốt); test vẫn pass nghĩa là **để sót**.
4. **Luôn khôi phục** source và file test về đúng nội dung ban đầu, kể cả khi lỗi hoặc bấm Ctrl+C.
5. Mutation không tìm thấy trong source hoặc làm hỏng cú pháp được đánh dấu và bỏ qua, không tính vào kết quả.

Không cần cài Stryker: chỉ dùng test runner có sẵn của project.

**Code coverage cần gì**

- **Jest:** có sẵn, không cần cài thêm.
- **Vitest:** cần gói `@vitest/coverage-v8` **cùng phiên bản với vitest** của project. Nếu chưa có, lệnh in hướng dẫn cài,
  bỏ qua phần coverage và vẫn chạy phần mutation. Với `ape_wms_admin` (vitest 3.2.4):

  ```bash
  npm install -D @vitest/coverage-v8@3.2.4          # lưu vào package.json (nên làm trên branch riêng)
  npm install --no-save @vitest/coverage-v8@3.2.4   # cài tạm, không sửa package.json; mất khi chạy lại npm install
  ```

- Ngưỡng coverage (thresholds) trong cấu hình của project bị tắt khi đo, nên không làm lệnh fail.
  Báo cáo tạm nằm trong `<out-dir>/coverage-tmp/`, không ghi vào repo.

**Code coverage khác mutation thế nào:** coverage chỉ cho biết dòng / nhánh nào **được chạy qua**, không cho biết test có
**bắt được lỗi** không. Ví dụ trên file test tệ của demo: test cũ đạt **100% line coverage** nhưng chỉ bắt **1/9 mutation**
(branch coverage 50%). Coverage thấp chắc chắn còn chỗ chưa test; coverage cao chưa chứng minh test tốt.

**Ví dụ**

```bash
$DEMO/verify-tests ~/wms-review-v1                              # tất cả file đã sửa
$DEMO/verify-tests ~/wms-review-v1 --only vat-rate              # chỉ 1 file
$DEMO/verify-tests ~/wms-review-v1 --only vat-rate auth.store   # 2 file
cat ~/wms-review-v1/verify.md
```

Kết quả mẫu (chạy thử trên file test tệ của demo):

```
  Trên source gốc: test cũ pass, test mới pass
  Coverage eligibility.service.ts: test cũ line 100% / branch 50% / function 100%  ->  test mới line 100% / branch 100% / function 100%
  1. dòng 3: `age < 18` -> `age <= 18`   test cũ: để sót, test mới: bắt được
  5. dòng 5: `return 'APPROVED';` -> `return 'REJECTED';`   test cũ: bắt được, test mới: bắt được
  ...
Tổng: test cũ bắt 1/9, test mới bắt 9/9
```

| File tạo | Nội dung |
|---|---|
| `verify.md` | Bảng code coverage cũ / mới; bảng từng mutation: dòng, thay đổi, lỗi mô phỏng, test cũ / test mới bắt hay sót, và tổng |
| `verify.json` | Dữ liệu thô của bảng trên |

**Đọc kết quả**

- "Test cũ: để sót → test mới: bắt được" là bằng chứng test đã tốt lên thật, không chỉ do LLM tự nhận.
- Mutation mà test mới vẫn để sót: hoặc là mutation tương đương (không đổi hành vi, không test nào bắt được),
  hoặc test còn thiếu; nếu thiếu thì quay lại bước 2-3.
- Tập mutation do LLM chọn để nhắm vào lỗ hổng đã biết, nên tỉ lệ này **không thay được mutation score đầy đủ**
  của Stryker (Stryker sinh mutant cho mọi toán tử, không chọn lọc).
- Mỗi mutation chạy test 2 lần; với Vitest khoảng 3-4 giây một lần, 10 mutation mất khoảng 1 phút.

---

### Bước 5. Review lại

Review file test đã sửa vào **thư mục mới**, rồi so với lần đầu:

```bash
$DEMO/review-tests \
  src/views/main/setting/billing-category/utils/vat-rate.spec.ts \
  src/store/__tests__/auth.store.spec.ts \
  --out-dir ~/wms-review-v2

# So sánh bảng tổng hợp trước / sau
cat ~/wms-review-v1/summary.md
cat ~/wms-review-v2/summary.md
open ~/wms-review-v1/summary.png ~/wms-review-v2/summary.png
```

Còn nhận xét mới thì lặp lại từ bước 2 với thư mục `~/wms-review-v2`. Dừng khi các nhận xét còn lại đều
được lọc là sai hoặc không đáng sửa.

### Lưu ý chung

- `review-tests` và `triage` chỉ đọc code. `fix-tests` chỉ ghi đè file test khi bạn chọn `y`. `verify-tests` sửa source tạm thời và luôn khôi phục; không nên chạy song song với việc sửa code khác.
- LLM chỉ thấy file source và file test, không thấy các module được import; hook và component nhiều phụ thuộc
  sẽ có nhiều nhận xét nhãn 4 hơn.
- Kết quả dao động giữa các lần chạy và giữa các model; khi so sánh trước / sau nên dùng cùng model.

## Cấu trúc

| File                                | Vai trò                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| `llm.py`                            | Gọi LLM, trả JSON theo schema (backend `claude-cli` hoặc `api`)  |
| `review-tests`                      | Lệnh bọc chạy `review_tests.py` bằng Python của `.venv`          |
| `review_tests.py`                   | Prompt và schema rubric 7 tiêu chí; dùng độc lập hoặc làm tầng 3 |
| `loop_tests.py` / `loop-tests`      | Loop review -> sửa -> đo cho project ngoài, có điều kiện dừng   |
| `pipeline.py`                       | 4 tầng và vòng lặp; chế độ `--naive` làm mốc so sánh             |
| `experiment.py`                     | Chạy hàng loạt, tổng hợp CSV, bảng Markdown, biểu đồ             |
| `src/`                              | 4 file source mẫu (độ khó tăng dần, có collaborator + async)     |
| `tests/eligibility.service.spec.ts` | Test cố tình viết tệ để demo review                              |
| `baseline/eligibility.spec.ts`      | Test tệ làm mốc mutation score (16%)                             |

## Loop cải thiện test (1 lệnh = các loop có điều kiện dừng)

Chỉ chạy trên local, không cần CI. Thay cho việc gõ tay 4 lệnh ở trên và trả lời triage:

```bash
cd /Users/turongsosoft/Documents/apetechs/Ape_WMS/ape_wms_admin
DEMO=/Users/turongsosoft/Documents/study/unit-test-llm-review/demo
$DEMO/loop-tests src/views/main/setting/billing-category/utils/vat-rate.spec.ts --threshold 100          # chạy tới khi gặp điều kiện dừng
$DEMO/loop-tests <spec> --loop   # chỉ 1 loop rồi dừng và xuất báo cáo
```

Mỗi loop: review rubric -> đưa nhận xét warn/fail + mutant còn sống cho LLM sửa -> chạy lại -> đo.
Loop 0 là mốc (test hiện có). Báo cáo ở `~/ut-loop/<tên spec>/loop-report.md` (kèm `loop-chart.png`).

| Cột | Ý nghĩa |
|---|---|
| Mutation | Tỉ lệ mutant bị bắt trên **bộ cố định** sinh bằng luật (đổi `<`/`<=`, `&&`/`||`, `??`/`||`, hằng số +1...), không dùng LLM, nên các loop so sánh được |
| Feedback / Holdout | Mutant chia đôi theo khối code (đoạn cách nhau bởi dòng trống), nên mutant cùng dòng / cùng khối luôn cùng nhóm. LLM chỉ được biết mutant sống ở nhóm Feedback, và mọi quyết định chấp nhận / dừng chỉ dựa trên Feedback. Holdout không tham gia chọn bản test; Holdout tăng theo nghĩa là test tốt lên thật, không học vẹt |
| Line / Branch | Code coverage của file source |
| pass/warn/fail | Rubric 7 tiêu chí do LLM chấm (dao động giữa các lần) |

Không có `--loop`: chạy tới khi gặp điều kiện dừng: Feedback đạt `--threshold` (mặc định 90) và rubric không còn fail | `--patience` (mặc định 2) loop liên tiếp không được chấp nhận, tức bị từ chối hoặc test fail (bản bị bỏ, loop sau thử lại từ bản tốt nhất; khi dừng thì trả về bản tốt nhất) | chạm `--max-loops` (mặc định 10, chặn an toàn).

Ngoài bảng tổng, `loop-report.md` có thêm bảng **trạng thái từng mutant** qua các loop (✅ bị bắt / ❌ còn sống) và **diff giữa test gốc (loop 0) và bản tốt nhất**. Diff đầy đủ cũng được lưu ở `best.diff`.
Thư mục `--out-dir` tạo trước bản cập nhật này vẫn giữ cách chia mutant xen kẽ cũ; muốn dùng cách chia theo khối thì chạy với `--out-dir` mới.
Có `--loop`: chạy đúng 1 loop rồi dừng và xuất báo cáo. Chạy lại cùng `--out-dir` thì tiếp tục từ loop kế tiếp; `--force` để chạy tiếp sau khi đã dừng.
Mặc định **không sửa file spec**; thêm `--apply` để ghi bản tốt nhất vào. Source được sửa tạm khi đo mutant và luôn khôi phục.

## Hạn chế đã biết

- Source mẫu nhỏ: mutation score thường bão hòa ngay vòng 1, kể cả khi sinh 1 lần.
- Một số mutant là tương đương (equivalent mutant), không test nào giết được, nên 100% không phải lúc nào cũng đạt được.
- Kết quả LLM dao động giữa các lần chạy; cỡ mẫu nhỏ nên chỉ là thí nghiệm sơ bộ.
- Chưa có sandbox (Docker); test do LLM sinh chạy trực tiếp trên máy.
