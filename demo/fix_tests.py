#!/usr/bin/env python3
"""Bước 3: sửa test theo các nhận xét đã lọc là ĐÚNG (nhãn 1 trong triage).

Với mỗi file test có nhận xét đúng:
  1. LLM viết lại file test + liệt kê các mutation mục tiêu mà test mới phải bắt được.
  2. Chạy test mới (LLM được sửa 1 lần nếu fail).
  3. Hiện diff, hỏi người dùng có ghi đè file test không. Bản cũ lưu ở <out-dir>/<tên>.orig.
  4. Lưu <out-dir>/<tên>.fix.json (mutation mục tiêu) cho bước 4 (verify-tests).

Dùng: python fix_tests.py ~/wms-review-v1 [--model sonnet] [--only vat-rate auth.store ...] [--yes]
"""
import argparse
import json
import sys
from pathlib import Path

import llm
import review_tests
from project_tools import (B, DIM, GRN, RED, RST, YEL, colored_diff, one_line, detect_runner, find_project_root,
                           load_reviews, run_test)

SYSTEM = f"""You improve an existing unit test file based on review findings that a human has verified as correct.
Rules:
- Address every given finding. Keep existing tests that are still valid; rename or split them if a finding asks for it.
- Tests must PASS against the CURRENT source. If a finding implies the source itself is buggy, do not write a failing test;
  mention it in `notes` instead.
- Assert on observable behavior (return values, thrown errors, rendered output, calls that cross the unit boundary).
  Use exact values, not toBeDefined/toBeTruthy. No shared mutable state between tests. Fixed time, no real network.
- Keep the same imports style, test framework and file location; return the ENTIRE new test file.
- Test names in English.

Also return `mutations`: concrete faults in the SOURCE that the new tests must detect but the OLD tests would miss
(take them from the findings, especially fake_pass_risk, plus any new ones your tests target). For each:
- `line`: 1-based line number in the source,
- `original`: an exact substring of that single source line (copy it verbatim, no line breaks, keep it short but unique on the line),
- `replacement`: what it becomes (must still be valid TypeScript),
- `description`: what bug this simulates.
Give 3 to 10 mutations, only non-equivalent ones (they must change observable behavior).
Write `notes` and `description` in {llm.OUTPUT_LANG}."""

SCHEMA = {
    "type": "object", "required": ["test_code", "mutations", "notes"],
    "properties": {
        "test_code": {"type": "string"},
        "notes": {"type": "string"},
        "mutations": {"type": "array", "items": {"type": "object",
            "required": ["line", "original", "replacement", "description"],
            "properties": {"line": {"type": "integer"}, "original": {"type": "string"},
                           "replacement": {"type": "string"}, "description": {"type": "string"}}}}}}

FIX_FAIL_SYSTEM = "You fix a unit test file that fails. Return the ENTIRE corrected file and keep `mutations` consistent with the source."


def block(title, code, lang="ts"):
    return f"## {title}\n```{lang}\n{code}\n```"


def numbered(src: str) -> str:
    return "\n".join(f"{i:4d} | {l}" for i, l in enumerate(src.split("\n"), 1))


def fix_one(spec: Path, findings: list[dict], out: Path, model: str, auto_yes: bool) -> dict | None:
    root = find_project_root(spec.parent)
    runner = detect_runner(root)
    src_path = review_tests.find_source(spec)
    src, old_test = src_path.read_text(), spec.read_text()
    print(f"\n{B}== {spec.relative_to(root)}{RST}  {DIM}({len(findings)} nhận xét đúng, runner: {runner}){RST}")

    user = (f"Test framework: {runner}.\n\n"
            f"{block(f'Source (with line numbers): {src_path.name}', numbered(src))}\n\n"
            f"{block(f'Current test: {spec.name}', old_test)}\n\n"
            f"## Verified findings to address\n{json.dumps(findings, ensure_ascii=False, indent=1)}")
    print("  LLM đang viết lại test...", flush=True)
    data, _ = llm.call(SYSTEM, user, SCHEMA, model)

    orig_copy = out / f"{spec.name}.orig"
    if not orig_copy.exists():          # giữ bản gốc của lần sửa đầu tiên
        orig_copy.write_text(old_test)
    accepted = False
    try:
        spec.write_text(data["test_code"])
        ok, log = run_test(root, spec, runner)
        if not ok:
            print(f"  {YEL}Test mới fail, cho LLM sửa 1 lần...{RST}", flush=True)
            fix_user = (f"{user}\n\n{block('Your new test (failing)', data['test_code'])}\n\n"
                        f"{block('Test runner output', log, '')}")
            data, _ = llm.call(FIX_FAIL_SYSTEM + "\n\n" + SYSTEM, fix_user, SCHEMA, model)
            spec.write_text(data["test_code"])
            ok, log = run_test(root, spec, runner)
        proposal = out / f"{spec.name}.proposed"
        proposal.write_text(data["test_code"])
        if not ok:
            print(f"  {RED}Test mới vẫn fail, giữ nguyên file cũ.{RST} Bản đề xuất: {proposal}\n{DIM}{log[-1500:]}{RST}")
            return None

        print(colored_diff(old_test, data["test_code"], spec.name))
        if data["notes"]:
            print(f"\n{B}Ghi chú của LLM:{RST} {data['notes']}")
        print(f"\n{B}Mutation mục tiêu ({len(data['mutations'])}):{RST}")
        for m in data["mutations"]:
            print(f"  - dòng {m['line']}: `{one_line(m['original'])}` -> `{one_line(m['replacement'])}`  {DIM}{m['description']}{RST}")
        print(f"\n{GRN}Test mới pass.{RST}")
        ans = "y" if auto_yes else input(f"{B}Ghi đè {spec.name} bằng bản mới?{RST} [y/N] ").strip().lower()
        accepted = ans == "y"
    finally:
        if not accepted:                # từ chối, lỗi hay Ctrl+C đều trả file test về bản cũ
            spec.write_text(old_test)

    result = {"spec": str(spec), "source": str(src_path), "runner": str(runner), "root": str(root),
              "orig": str(orig_copy), "accepted": accepted, "model": model,
              "findings": [f["id"] for f in findings], "notes": data["notes"], "mutations": data["mutations"]}
    (out / f"{spec.name}.fix.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"  {'Đã ghi đè' if accepted else 'Giữ nguyên'} {spec.name}. Lưu {out / (spec.name + '.fix.json')}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", type=Path, help="thư mục --out-dir đã chạy review-tests và triage")
    ap.add_argument("--model", default=llm.DEFAULT_MODEL)
    ap.add_argument("--only", nargs="+", metavar="TÊN", help="chỉ sửa các file test có tên chứa một trong các chuỗi này")
    ap.add_argument("--yes", action="store_true", help="tự đồng ý ghi đè, không hỏi")
    a = ap.parse_args()
    out = a.out_dir.expanduser().resolve()
    triage_file = out / "triage.json"
    if not triage_file.exists():
        sys.exit(f"Chưa có {triage_file}. Chạy bước 2 trước: triage {a.out_dir}")
    labels = json.loads(triage_file.read_text())
    done = 0
    for spec, review in load_reviews(out).items():
        if a.only and not any(k in spec.name for k in a.only):
            continue
        correct = []
        for c in review["criteria"]:
            lab = labels.get(f"{spec.name}::{c['id']}")
            if lab and lab["label"] == "correct":
                correct.append({"criterion": c["id"], "evidence": c["evidence"], "suggestion": c["suggestion"],
                                "reviewer_note": lab.get("note", "")} | {"id": c["id"]})
        if not correct:
            print(f"{DIM}Bỏ qua {spec.name}: không có nhận xét nhãn Đúng.{RST}")
            continue
        if not spec.exists():
            print(f"{RED}Không thấy {spec}{RST}")
            continue
        try:
            if fix_one(spec, correct, out, a.model, a.yes):
                done += 1
        except KeyboardInterrupt:
            print(f"\n{YEL}Dừng. File test đã được trả về bản cũ.{RST}")
            break
        except llm.LLMError as e:
            print(f"{RED}Lỗi LLM với {spec.name}: {e}{RST}")
    print(f"\nXong {done} file. Bước tiếp theo: verify-tests {a.out_dir}")


if __name__ == "__main__":
    main()
