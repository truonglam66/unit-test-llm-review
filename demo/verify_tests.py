#!/usr/bin/env python3
"""Bước 4: kiểm chứng test đã sửa bằng mutation mục tiêu, so sánh test cũ với test mới.

Với mỗi <out-dir>/<tên>.fix.json do fix-tests tạo:
  1. Chạy test cũ và test mới trên source gốc: cả hai phải pass.
  2. Với từng mutation mục tiêu: sửa TẠM source, chạy test cũ và test mới.
     Test fail = mutation bị bắt (tốt). Source luôn được khôi phục, kể cả khi bấm Ctrl+C.
  3. Đo code coverage (line / branch / function) của file source với test cũ và test mới.
  4. Ghi bảng kết quả vào <out-dir>/verify.md và verify.json.

Không cần Stryker: chỉ dùng test runner có sẵn của project (vitest hoặc jest).
Test mới = file test hiện tại nếu đã chấp nhận ở bước 3, nếu không thì bản <tên>.proposed.

Dùng: python verify_tests.py ~/wms-review-v1 [--only vat-rate auth.store ...] [--no-coverage]
"""
import argparse
import json
import re
import sys
from pathlib import Path

from project_tools import (B, DIM, GRN, RED, RST, YEL, apply_mutation, coverage_missing, fmt_cov, one_line,
                           run_coverage, run_test)

# Dấu hiệu lỗi biên dịch của esbuild / SWC / tsc / babel. PHÂN BIỆT hoa thường: trước đây dùng re.I nên
# "ERROR: Expected" khớp với "AssertionError: expected 1 to be 0" (assertion fail bình thường).
SYNTAX_ERR = re.compile(r"SyntaxError|Syntax Error|Transform failed|Unexpected token|Expression expected"
                        r"|^\s*(?:✘ \[)?ERROR\]?: |error TS\d+", re.M)
# Suite không load được nên không test nào chạy (vitest / jest).
NO_TESTS_RAN = re.compile(r"Tests\s+no tests|Test suite failed to run|Tests:\s+0 total")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def is_compile_error(log: str) -> bool:
    """Mutant làm hỏng cú pháp: không test nào chạy VÀ có dấu hiệu lỗi biên dịch.

    Cần cả hai điều kiện: assertion fail thì có test chạy; còn nếu module ném lỗi runtime lúc import
    (không phải lỗi cú pháp) thì vẫn coi là bị bắt (killed).
    """
    log = ANSI.sub("", log)
    return bool(NO_TESTS_RAN.search(log) and SYNTAX_ERR.search(log))
MARK = {"killed": f"{GRN}bắt được{RST}", "survived": f"{RED}để sót{RST}"}
MARK_MD = {"killed": "✅ bắt được", "survived": "❌ để sót"}


def verify_one(fix: dict, out: Path, with_coverage: bool = True) -> dict:
    spec, source, root = Path(fix["spec"]), Path(fix["source"]), Path(fix["root"])
    runner = fix["runner"]
    old_test = Path(fix["orig"]).read_text()
    new_test = spec.read_text() if fix["accepted"] else (out / f"{spec.name}.proposed").read_text()
    spec_now, src_now = spec.read_text(), source.read_text()
    print(f"\n{B}== {spec.relative_to(root)}{RST}  {DIM}(test mới: {'đã ghi đè' if fix['accepted'] else 'bản đề xuất'}){RST}")

    def run_with(test_code):
        spec.write_text(test_code)
        return run_test(root, spec, runner)

    rows = []
    try:
        base_old, _ = run_with(old_test)
        base_new, log = run_with(new_test)
        print(f"  Trên source gốc: test cũ {'pass' if base_old else 'FAIL'}, test mới {'pass' if base_new else 'FAIL'}")
        if not base_new:
            print(f"  {RED}Test mới không pass trên source gốc, không kiểm chứng tiếp.{RST}\n{DIM}{log[-1200:]}{RST}")
            return {"spec": str(spec), "baseline_old": base_old, "baseline_new": False, "rows": [], "coverage": None}
        coverage = None
        if with_coverage:
            missing = coverage_missing(root, runner)
            if missing:
                print(f"  {YEL}Bỏ qua coverage.{RST} {missing}")
            else:
                coverage = {}
                for name, code in (("old", old_test), ("new", new_test)):
                    spec.write_text(code)
                    coverage[name] = run_coverage(root, spec, runner, source, out / "coverage-tmp" / name)
                print(f"  Coverage {source.name}: test cũ {fmt_cov(coverage['old'])}  ->  test mới {fmt_cov(coverage['new'])}")
        for i, m in enumerate(fix["mutations"], 1):
            mutated = apply_mutation(src_now, m)
            row = {"n": i, **m}
            if mutated is None:
                row["status"] = "not_applied"
                print(f"  {i}. {YEL}không áp dụng được{RST} (không tìm thấy `{one_line(m['original'])}` ở dòng {m['line']})")
                rows.append(row)
                continue
            source.write_text(mutated)
            try:
                res = {}
                for name, code in (("old", old_test), ("new", new_test)):
                    ok, log = run_with(code)
                    if not ok and is_compile_error(log):
                        res = None
                        break
                    res[name] = "survived" if ok else "killed"
            finally:
                source.write_text(src_now)
            if res is None:
                row["status"] = "invalid"
                print(f"  {i}. {YEL}mutation làm hỏng cú pháp, bỏ qua{RST}: `{one_line(m['original'])}` -> `{one_line(m['replacement'])}`")
            else:
                row.update(status="ok", **res)
                print(f"  {i}. dòng {m['line']}: `{one_line(m['original'])}` -> `{one_line(m['replacement'])}`   "
                      f"test cũ: {MARK[res['old']]}, test mới: {MARK[res['new']]}")
            rows.append(row)
    finally:
        source.write_text(src_now)     # khôi phục tuyệt đối, kể cả khi lỗi / Ctrl+C
        spec.write_text(spec_now)
    return {"spec": str(spec), "baseline_old": base_old, "baseline_new": True, "rows": rows, "coverage": coverage}


def write_report(out: Path, results: list[dict]):
    md = ["# Kết quả kiểm chứng (bước 4)", "",
          "Mutation mục tiêu do LLM đề xuất ở bước 3, được áp TẠM vào source rồi chạy test thật. "
          "Test fail = mutation bị bắt.", ""]
    tot_old = tot_new = tot = 0
    for r in results:
        valid = [x for x in r["rows"] if x["status"] == "ok"]
        k_old = sum(x["old"] == "killed" for x in valid)
        k_new = sum(x["new"] == "killed" for x in valid)
        tot_old, tot_new, tot = tot_old + k_old, tot_new + k_new, tot + len(valid)
        md += [f"## {Path(r['spec']).name}", ""]
        if not r["baseline_new"]:
            md += ["Test mới không pass trên source gốc, chưa kiểm chứng.", ""]
            continue
        cov = r.get("coverage")
        if cov:
            md += ["**Code coverage** của file source:", "",
                   "| Chỉ số | Test cũ | Test mới |", "|---|---|---|"]
            for key, label in (("lines", "Line"), ("branches", "Branch"), ("functions", "Function"), ("statements", "Statement")):
                cell = lambda c: f"{c[key]['pct']:.1f}% ({c[key]['covered']}/{c[key]['total']})" if c else "không đo được"
                md.append(f"| {label} | {cell(cov['old'])} | {cell(cov['new'])} |")
            md.append("")
        md += [f"Bắt được: test cũ **{k_old}/{len(valid)}**, test mới **{k_new}/{len(valid)}**.", "",
               "| # | Dòng | Mutation | Mô phỏng lỗi | Test cũ | Test mới |", "|---|---|---|---|---|---|"]
        for x in r["rows"]:
            mut = f"`{one_line(x['original'])}` → `{one_line(x['replacement'])}`".replace("|", "\\|")
            if x["status"] == "ok":
                md.append(f"| {x['n']} | {x['line']} | {mut} | {x['description']} | {MARK_MD[x['old']]} | {MARK_MD[x['new']]} |")
            else:
                note = "không áp dụng được" if x["status"] == "not_applied" else "hỏng cú pháp"
                md.append(f"| {x['n']} | {x['line']} | {mut} | {x['description']} | ({note}) | ({note}) |")
        survived_new = [x for x in valid if x["new"] == "survived"]
        if survived_new:
            md += ["", "Mutation test mới vẫn để sót: kiểm tra xem có phải mutation tương đương (không đổi hành vi) "
                       "hay test còn thiếu; nếu thiếu thì quay lại bước 2-3."]
        md.append("")
    if tot:
        md += ["## Tổng", "", f"- Test cũ bắt được: {tot_old}/{tot} ({100 * tot_old / tot:.0f}%)",
               f"- Test mới bắt được: {tot_new}/{tot} ({100 * tot_new / tot:.0f}%)", "",
               "Lưu ý: đây là tập mutation do LLM chọn để nhắm vào lỗ hổng đã biết, nên tỉ lệ này không thay được "
               "mutation score đầy đủ của Stryker.",
               "",
               "Coverage cho biết dòng/nhánh nào được test chạy qua, không cho biết test có bắt được lỗi; "
               "mutation ở trên mới đo điều đó. Coverage cao không chứng minh test tốt, coverage thấp chắc chắn còn chỗ chưa test."]
    (out / "verify.md").write_text("\n".join(md) + "\n")
    (out / "verify.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    return tot_old, tot_new, tot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", type=Path, help="thư mục --out-dir đã chạy fix-tests")
    ap.add_argument("--no-coverage", action="store_true", help="không đo code coverage")
    ap.add_argument("--only", nargs="+", metavar="TÊN", help="chỉ kiểm chứng các file test có tên chứa một trong các chuỗi này")
    a = ap.parse_args()
    out = a.out_dir.expanduser().resolve()
    fixes = [json.loads(f.read_text()) for f in sorted(out.glob("*.fix.json"))]
    fixes = [f for f in fixes if not a.only or any(k in Path(f["spec"]).name for k in a.only)]
    if a.only:
        print(f"Chọn {len(fixes)} file: " + ", ".join(Path(f["spec"]).name for f in fixes))
    if not fixes:
        sys.exit(f"Không có file .fix.json trong {out}. Chạy bước 3 trước: fix-tests {a.out_dir}")
    results = []
    try:
        for fix in fixes:
            results.append(verify_one(fix, out, not a.no_coverage))
    except KeyboardInterrupt:
        print(f"\n{YEL}Dừng. Source và file test đã được khôi phục.{RST}")
    if results:
        k_old, k_new, tot = write_report(out, results)
        if tot:
            print(f"\n{B}Tổng:{RST} test cũ bắt {k_old}/{tot}, test mới bắt {k_new}/{tot}")
        print(f"Báo cáo: {out / 'verify.md'}")


if __name__ == "__main__":
    main()
