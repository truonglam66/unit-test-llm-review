#!/usr/bin/env python3
"""Lọc nhận xét của LLM review theo kiểu hỏi đáp trên terminal.

Đọc các file <spec>.json trong thư mục --out-dir của review-tests, hỏi lần lượt từng nhận xét
chưa pass (warn / fail), người dùng gán nhãn và ghi chú. Kết quả lưu sau mỗi câu trả lời vào
triage.json (chạy lại sẽ tiếp tục chỗ còn dở) và xuất triage.md (bảng + thống kê precision).

Dùng: python triage.py ~/wms-review [--redo] [--include-pass]
"""
import argparse
import json
import sys
from pathlib import Path

LABELS = {
    "1": ("correct", "Đúng"),
    "2": ("correct_minor", "Đúng nhưng không đáng sửa"),
    "3": ("wrong", "Sai (false positive)"),
    "4": ("unverifiable", "Không kiểm chứng được"),
}
NAME = {k: v for k, v in LABELS.values()}

B, DIM, RED, YEL, GRN, CYN, RST = "\033[1m", "\033[2m", "\033[31m", "\033[33m", "\033[32m", "\033[36m", "\033[0m"
if not sys.stdout.isatty():
    B = DIM = RED = YEL = GRN = CYN = RST = ""
STATUS = {"fail": f"{RED}✗ fail{RST}", "warn": f"{YEL}! warn{RST}", "pass": f"{GRN}✓ pass{RST}"}

HINT = {
    "fake_pass_risk": "Sửa thử code theo mutation được nêu, chạy đúng file test; test vẫn pass => nhận xét đúng. Nhớ hoàn tác.",
    "equivalence_boundary": "Tìm trong test có case nào chạm vào biên / nhánh đó chưa; case đề xuất có đi vào nhánh mới không.",
    "assertion_strength": "Grep expect trên biến được nêu; thử đổi giá trị trả về xem assertion có fail không.",
    "isolation": "Chạy riêng test đó (it.only) hoặc đổi thứ tự, xem kết quả có đổi không.",
    "determinism": "Tìm Date / Math.random / async chưa await; thử đổi giờ hệ thống.",
    "test_vs_implementation": "Spy / assert có nhắm vào chi tiết nội bộ của chính unit không, hay vào output / side-effect ra ngoài?",
    "naming_clarity": "Đọc tên test: có nói rõ điều kiện và kết quả mong đợi không?",
}


def load_findings(out_dir: Path, include_pass: bool):
    findings = []
    for f in sorted(out_dir.glob("*.json")):
        if f.name == "triage.json":
            continue
        r = json.loads(f.read_text())
        if "criteria" not in r:
            continue
        spec = r.get("_spec", f.stem)
        for c in r["criteria"]:
            if c["status"] == "pass" and not include_pass:
                continue
            findings.append({"key": f"{Path(spec).name}::{c['id']}", "spec": spec, **c})
    return findings


def ask(prompt, valid):
    while True:
        try:
            ans = input(prompt).strip().lower()
        except EOFError:
            return "q"
        if ans in valid:
            return ans
        print(f"  {DIM}Chọn một trong: {', '.join(sorted(valid))}{RST}")


def show(i, n, f):
    print(f"\n{B}[{i}/{n}] {Path(f['spec']).name}{RST}  {CYN}{f['id']}{RST}  {STATUS[f['status']]}  {DIM}(LLM tự tin: {f['confidence']}){RST}")
    print(f"{DIM}{f['spec']}{RST}")
    print(f"\n{B}Bằng chứng:{RST} {f['evidence']}")
    print(f"\n{B}Gợi ý sửa:{RST} {f['suggestion']}")
    print(f"\n{DIM}Cách kiểm chứng: {HINT.get(f['id'], '')}{RST}")


def write_report(out_dir: Path, findings, answers):
    rows = ["# Kết quả lọc nhận xét", "",
            "| # | Spec | Tiêu chí | LLM chấm | Nhãn | Ghi chú |", "|---|---|---|---|---|---|"]
    for i, f in enumerate(findings, 1):
        a = answers.get(f["key"])
        rows.append(f"| {i} | {Path(f['spec']).name} | {f['id']} | {f['status']} | "
                    f"{NAME[a['label']] if a else '(chưa lọc)'} | {(a or {}).get('note', '').replace('|', '/')} |")
    labeled = [answers[f["key"]] for f in findings if f["key"] in answers]
    count = lambda *ls: sum(a["label"] in ls for a in labeled)
    judged = count("correct", "correct_minor", "wrong")
    rows += ["", "## Thống kê", "",
             f"- Đã lọc: {len(labeled)}/{len(findings)} nhận xét",
             *[f"- {name}: {count(key)}" for key, name in LABELS.values()]]
    if judged:
        rows.append(f"- **Precision** (đúng / đã phán định được, bỏ 'không kiểm chứng được'): "
                    f"{count('correct', 'correct_minor')}/{judged} = {100 * count('correct', 'correct_minor') / judged:.0f}%")
    # precision theo tiêu chí
    per = {}
    for f in findings:
        a = answers.get(f["key"])
        if a and a["label"] != "unverifiable":
            ok, tot = per.get(f["id"], (0, 0))
            per[f["id"]] = (ok + (a["label"] != "wrong"), tot + 1)
    if per:
        rows += ["", "| Tiêu chí | Đúng / đã phán định | Precision |", "|---|---|---|"]
        rows += [f"| {k} | {ok}/{tot} | {100 * ok / tot:.0f}% |" for k, (ok, tot) in sorted(per.items())]
    (out_dir / "triage.md").write_text("\n".join(rows) + "\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out_dir", type=Path, help="thư mục --out-dir của review-tests")
    ap.add_argument("--redo", action="store_true", help="hỏi lại cả những nhận xét đã lọc")
    ap.add_argument("--include-pass", action="store_true", help="hỏi cả các tiêu chí LLM chấm pass")
    a = ap.parse_args()
    out = a.out_dir.expanduser()
    findings = load_findings(out, a.include_pass)
    if not findings:
        sys.exit(f"Không thấy file JSON review trong {out}. Chạy review-tests với --out-dir trước.")
    store = out / "triage.json"
    answers = json.loads(store.read_text()) if store.exists() else {}
    todo = [f for f in findings if a.redo or f["key"] not in answers]
    print(f"{B}{len(findings)} nhận xét{RST}, đã lọc {len(findings) - len(todo)}, còn {len(todo)}.")
    print(f"{DIM}Nhãn: " + "  ".join(f"[{k}] {v}" for k, (_, v) in LABELS.items())
          + f"  [s] bỏ qua  [b] quay lại  [q] thoát{RST}")
    i = 0
    while i < len(todo):
        f = todo[i]
        show(findings.index(f) + 1, len(findings), f)
        prev = answers.get(f["key"])
        if prev:
            print(f"{DIM}Đã gán trước đó: {NAME[prev['label']]}{' - ' + prev['note'] if prev.get('note') else ''}{RST}")
        ans = ask(f"\n{B}Nhãn?{RST} [1/2/3/4/s/b/q] ", set(LABELS) | {"s", "b", "q"})
        if ans == "q":
            break
        if ans == "b":
            i = max(i - 1, 0)
            continue
        if ans != "s":
            try:
                note = input(f"{B}Ghi chú{RST} {DIM}(Enter để bỏ trống):{RST} ").strip()
            except EOFError:
                note = ""
            answers[f["key"]] = {"label": LABELS[ans][0], "note": note}
            store.write_text(json.dumps(answers, ensure_ascii=False, indent=1))
            write_report(out, findings, answers)
        i += 1
    write_report(out, findings, answers)
    print(f"\n{GRN}Đã lưu{RST} {store} và {out / 'triage.md'}")
    print((out / "triage.md").read_text().split("## Thống kê", 1)[1])


if __name__ == "__main__":
    main()
