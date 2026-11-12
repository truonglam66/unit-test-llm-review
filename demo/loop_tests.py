#!/usr/bin/env python3
"""Vòng lặp cải thiện unit test: 1 lệnh = chạy các loop review -> sửa -> đo, có điều kiện dừng.

Loop 0 (mốc): đo test hiện có.   Loop N: đưa nhận xét rubric + mutant còn sống cho LLM sửa test,
rồi đo lại bằng đúng bộ mutant ban đầu để các loop so sánh được với nhau.

Chỉ số mỗi loop (khách quan trước, LLM sau):
  - mutation score trên bộ mutant CỐ ĐỊNH sinh bằng luật (không dùng LLM), chia 2 nhóm:
      feedback (LLM được biết mutant nào còn sống) và holdout (LLM không được biết) để thấy có học vẹt không
  - line / branch coverage của file source
  - rubric 7 tiêu chí: số pass / warn / fail (LLM chấm, dao động giữa các lần)

Chấp nhận / dừng chỉ dựa trên nhóm feedback; holdout chỉ để báo cáo (chia theo khối code, không xen kẽ).
Dừng khi: đạt ngưỡng | --patience loop liên tiếp không được chấp nhận (từ chối / test fail; trả về bản tốt nhất)
| không còn gì để đưa cho LLM | chạm --max-loops.
`--loop`: chỉ chạy 1 loop rồi dừng và xuất báo cáo. Trạng thái lưu trong --out-dir nên chạy lại cùng thư mục
sẽ tiếp tục từ loop tiếp theo (chạy `--loop` nhiều lần = chạy một lần không có cờ, nếu chưa gặp điều kiện dừng).

Dùng (từ thư mục gốc project cần review):
  loop-tests src/store/__tests__/auth.store.spec.ts [--loop] [--threshold 90] [--out-dir DIR] [--apply]
"""
import argparse
import difflib
import hashlib
import json
import random
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import fix_tests
import llm
import review_tests
from project_tools import (B, CYN, DIM, GRN, RED, RST, YEL, coverage_missing, detect_runner, find_project_root,
                           run_coverage, run_test)
from verify_tests import is_compile_error

# ---------- Bộ mutant cố định, sinh bằng luật ----------

RULES = [
    (r"(?<= )<=(?= )", "<"), (r"(?<= )<(?= )", "<="), (r"(?<= )>=(?= )", ">"), (r"(?<= )>(?= )", ">="),
    (r"===", "!=="), (r"!==", "==="), (r"(?<![=!])==(?!=)", "!="), (r"!=(?!=)", "=="),
    (r"&&", "||"), (r"\|\|", "&&"), (r"\?\?", "||"),
    (r"\btrue\b", "false"), (r"\bfalse\b", "true"),
    (r"(?<= )\+(?= )", "-"), (r"(?<= )-(?= )", "+"), (r"(?<= )\*(?= )", "/"),
    (r"\.trim\(\)", ""),
    (r"(?<![\w.$'\"`/])\d+(?:\.\d+)?(?![\w.'\"`%])", "+1"),
]
SKIP_LINE = ("//", "*", "/*", "import ", "export type", "export interface", "type ", "interface ")


def generate_mutants(src: str, max_mutants: int) -> list[dict]:
    found = []
    for i, line in enumerate(src.split("\n")):
        if line.strip().startswith(SKIP_LINE):
            continue
        for pattern, repl in RULES:
            for mt in re.finditer(pattern, line):
                if sum(line[:mt.start()].count(q) for q in "'\"`") % 2:     # đang nằm trong chuỗi
                    continue
                orig = mt.group()
                new = (f"{float(orig) + 1:g}" if repl == "+1" else repl)
                found.append({"line": i + 1, "col": mt.start(), "original": orig, "replacement": new})
    if len(found) > max_mutants:
        found = sorted(random.Random(0).sample(found, max_mutants), key=lambda m: (m["line"], m["col"]))
    for n, m in enumerate(found):
        m["id"] = n + 1
    split_sets(src, found)
    return found


def split_sets(src: str, mutants: list[dict]):
    """Chia feedback / holdout theo KHỐI code (đoạn cách nhau bởi dòng trống), không xen kẽ từng mutant.

    Mutant cùng dòng / cùng khối thường bị cùng một test diệt; nếu chia xen kẽ thì holdout tăng "ăn theo"
    feedback và không còn là thước đo độc lập. Khối được gán tham lam vào nhóm đang ít mutant hơn để cân bằng.
    Nếu cả file chỉ có 1 khối thì lùi về chia theo dòng (mutant cùng dòng luôn cùng nhóm).
    """
    block_of, b = {}, 0
    for i, line in enumerate(src.split("\n")):
        if not line.strip():
            b += 1
        block_of[i + 1] = b
    groups: dict[int, list[dict]] = {}
    for m in mutants:
        groups.setdefault(block_of[m["line"]], []).append(m)
    if len(groups) < 2:
        groups = {}
        for m in mutants:
            groups.setdefault(m["line"], []).append(m)
    count = {"feedback": 0, "holdout": 0}
    for key in sorted(groups, key=lambda k: (-len(groups[k]), k)):
        s = "feedback" if count["feedback"] <= count["holdout"] else "holdout"
        for m in groups[key]:
            m["set"] = s
        count[s] += len(groups[key])


def apply_at(src: str, m: dict) -> str:
    lines = src.split("\n")
    i, c = m["line"] - 1, m["col"]
    lines[i] = lines[i][:c] + m["replacement"] + lines[i][c + len(m["original"]):]
    return "\n".join(lines)


def mut_text(m: dict) -> str:
    return f"dòng {m['line']}: `{m['original']}` -> `{m['replacement']}`"


# ---------- Chạy test ----------

def run_quiet(root: Path, spec: Path, runner: str, timeout=90) -> tuple[bool, str]:
    """Như run_test nhưng dừng ở test fail đầu tiên (mutant bị bắt thì khỏi chạy tiếp)."""
    rel = spec.relative_to(root).as_posix()
    cmd = ["npx", "vitest", "run", rel, "--bail=1"] if runner == "vitest" else ["npx", "jest", "--ci", "--bail", rel]
    try:
        p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT"
    return p.returncode == 0, (p.stdout + p.stderr)[-3000:]


class Ctx:
    def __init__(self, spec: Path, out: Path, model: str, max_mutants: int, with_cov: bool):
        self.spec, self.out, self.model, self.max_mutants = spec, out, model, max_mutants
        self.root = find_project_root(spec.parent)
        self.runner = detect_runner(self.root)
        self.source = review_tests.find_source(spec).resolve()
        cov_msg = coverage_missing(self.root, self.runner) if with_cov else None
        self.with_cov = with_cov and not cov_msg
        if cov_msg:
            print(f"{YEL}Bỏ qua coverage.{RST} {cov_msg}")


def run_local(ctx: Ctx, test_code: str, mutants: list[dict], first: bool) -> dict:
    """Ghi tạm test_code vào file spec, đo baseline + coverage + từng mutant; luôn khôi phục source và spec."""
    spec, source = ctx.spec, ctx.source
    src_now, spec_now = source.read_text(), spec.read_text()
    res = {"baseline_pass": False, "coverage": None, "status": {}, "log": ""}
    try:
        spec.write_text(test_code)
        res["baseline_pass"], res["log"] = run_test(ctx.root, spec, ctx.runner)
        if not res["baseline_pass"]:
            return res
        if ctx.with_cov:
            res["coverage"] = run_coverage(ctx.root, spec, ctx.runner, source, ctx.out / "coverage-tmp")
        print(f"  Chạy {len([m for m in mutants if not m.get('invalid')])} mutant ", end="", flush=True)
        for m in mutants:
            if m.get("invalid"):
                continue
            source.write_text(apply_at(src_now, m))
            ok, log = run_quiet(ctx.root, spec, ctx.runner)
            source.write_text(src_now)
            if ok:
                st = "survived"
            elif first and is_compile_error(log):
                st = "invalid"
            else:
                st = "killed"
            res["status"][m["id"]] = st
            print("." if st == "killed" else ("x" if st == "survived" else "?"), end="", flush=True)
        print()
    finally:
        source.write_text(src_now)
        spec.write_text(spec_now)
    return res


def compute_metrics(res: dict, review: dict, mutants: list[dict], cost: float) -> dict:
    def part(sub):
        valid = [m for m in sub if res["status"].get(m["id"]) in ("killed", "survived")]
        k = sum(res["status"][m["id"]] == "killed" for m in valid)
        return {"killed": k, "total": len(valid), "pct": round(100 * k / len(valid), 1) if valid else None}
    cov = res["coverage"]
    st = [c["status"] for c in review["criteria"]]
    return {"mutation": part(mutants),
            "feedback": part([m for m in mutants if m["set"] == "feedback"]),
            "holdout": part([m for m in mutants if m["set"] == "holdout"]),
            "line": cov["lines"]["pct"] if cov else None, "branch": cov["branches"]["pct"] if cov else None,
            "pass": st.count("pass"), "warn": st.count("warn"), "fail": st.count("fail"),
            "verdict": review["overall_verdict"], "criteria": {c["id"]: c["status"] for c in review["criteria"]},
            "cost_usd": cost}


# ---------- Bước sửa test ----------

FIX_SYSTEM = (fix_tests.SYSTEM.split("\n\nAlso return `mutations`")[0]
              .replace("review findings that a human has verified as correct",
                       "review findings that were selected automatically (rubric warn/fail and mutants that survive the current tests)")
              + f"\nFindings with id `mutant-N` mean: if that change were applied to the source, ALL current tests would still pass. "
                "Add or tighten tests so that change makes a test fail.\n"
                f"Write `notes` in {llm.OUTPUT_LANG}.")
FIX_SCHEMA = {"type": "object", "required": ["test_code", "notes"],
              "properties": {"test_code": {"type": "string"}, "notes": {"type": "string"}}}


def build_findings(review: dict, status: dict, mutants: list[dict]) -> list[dict]:
    f = [{"id": c["id"], "evidence": c["evidence"], "suggestion": c["suggestion"]}
         for c in review["criteria"] if c["status"] != "pass"]
    for m in [m for m in mutants if m["set"] == "feedback" and status.get(str(m["id"]), status.get(m["id"])) == "survived"][:10]:
        f.append({"id": f"mutant-{m['id']}", "evidence": f"Mutant survives, every test still passes: {mut_text(m)}",
                  "suggestion": "Add a test with an input where this change gives a different observable result."})
    return f


def fix_step(ctx: Ctx, test_code: str, findings: list[dict]) -> tuple[str | None, str, float, str]:
    """Trả về (test mới hoặc None nếu vẫn fail, ghi chú, chi phí, log lỗi)."""
    src = ctx.source.read_text()
    user = (f"Test framework: {ctx.runner}.\n\n"
            f"{fix_tests.block(f'Source (with line numbers): {ctx.source.name}', fix_tests.numbered(src))}\n\n"
            f"{fix_tests.block(f'Current test: {ctx.spec.name}', test_code)}\n\n"
            f"## Findings to address\n{json.dumps(findings, ensure_ascii=False, indent=1)}")
    data, meta = llm.call(FIX_SYSTEM, user, FIX_SCHEMA, ctx.model)
    cost = meta.get("cost_usd") or 0
    spec_now = ctx.spec.read_text()
    try:
        for attempt in range(2):
            ctx.spec.write_text(data["test_code"])
            ok, log = run_test(ctx.root, ctx.spec, ctx.runner)
            if ok:
                return data["test_code"], data["notes"], cost, ""
            if attempt == 0:
                print(f"  {YEL}Test mới fail, cho LLM sửa 1 lần...{RST}")
                again = (f"{user}\n\n{fix_tests.block('Your new test (failing)', data['test_code'])}\n\n"
                         f"{fix_tests.block('Test runner output', log, '')}")
                data, meta = llm.call(fix_tests.FIX_FAIL_SYSTEM + "\n\n" + FIX_SYSTEM, again, FIX_SCHEMA, ctx.model)
                cost += meta.get("cost_usd") or 0
        return None, data["notes"], cost, log
    finally:
        ctx.spec.write_text(spec_now)


# ---------- Đánh giá một phiên bản test ----------

def evaluate(ctx: Ctx, loop: int, test_code: str, mutants: list[dict], extra_cost=0.0) -> tuple[dict | None, dict, dict]:
    """Chạy phần đo cục bộ song song với lần review của LLM. Trả (metrics, review, res); metrics None nếu test fail."""
    src_text = ctx.source.read_text()
    with ThreadPoolExecutor(1) as pool:
        fut = pool.submit(review_tests.review_text, ctx.source.name, src_text, ctx.spec.name, test_code, ctx.model)
        res = run_local(ctx, test_code, mutants, first=(loop == 0))
        review, meta = fut.result()
    if not res["baseline_pass"]:
        return None, review, res
    m = compute_metrics(res, review, mutants, extra_cost + (meta.get("cost_usd") or 0))
    m["tests"] = len(re.findall(r"\b(?:it|test)(?:\.each\([^)]*\))?\(", test_code))   # ước lượng bằng regex
    return m, review, res


# ---------- Trạng thái và báo cáo ----------

def fmt(v, suffix="%"):
    return "-" if v is None else f"{v:g}{suffix}"


def delta(cur, prev):
    if cur is None or prev is None or cur == prev:
        return ""
    return f" ({'+' if cur > prev else ''}{cur - prev:g})"


def table_rows(loops: list[dict]) -> list[list[str]]:
    head = ["Loop", "Mutation", "Feedback", "Holdout", "Line", "Branch", "pass/warn/fail", "Verdict", "Số test", "Quyết định"]
    rows, prev = [head], None
    for lp in loops:
        m = lp["metrics"]
        if m is None:
            rows.append([str(lp["loop"])] + ["-"] * 8 + [lp["decision"]])
            continue
        mu, p = m["mutation"], prev
        rows.append([str(lp["loop"]),
                     f"{mu['killed']}/{mu['total']} = {fmt(mu['pct'])}{delta(mu['pct'], p and p['mutation']['pct'])}",
                     fmt(m["feedback"]["pct"]), fmt(m["holdout"]["pct"]),
                     fmt(m["line"]) + delta(m["line"], p and p["line"]), fmt(m["branch"]) + delta(m["branch"], p and p["branch"]),
                     f"{m['pass']}/{m['warn']}/{m['fail']}", m["verdict"], str(m["tests"]), lp["decision"]])
        if lp["decision"] in ("mốc", "chấp nhận"):
            prev = m
    return rows


def print_table(rows: list[list[str]]):
    w = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for k, r in enumerate(rows):
        print("  " + "  ".join(c.ljust(w[i]) for i, c in enumerate(r)))
        if k == 0:
            print("  " + "  ".join("-" * x for x in w))


def write_report(out: Path, state: dict):
    rows = table_rows(state["loops"])
    md = [f"# Loop cải thiện test: `{Path(state['spec']).name}`", "",
          f"Source: `{Path(state['source']).name}` · Runner: {state['runner']} · Model: {state['model']} · "
          f"Bộ mutant cố định: {sum(not m.get('invalid') for m in state['mutants'])} mutant", "",
          "| " + " | ".join(rows[0]) + " |", "|" + "---|" * len(rows[0])]
    md += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    crit = review_tests.CRITERIA
    md += ["", "## Rubric theo từng loop", "", "| Loop | " + " | ".join(crit) + " |", "|" + "---|" * (len(crit) + 1)]
    for lp in state["loops"]:
        if lp["metrics"]:
            md.append(f"| {lp['loop']} | " + " | ".join(review_tests.ICON.get(lp["metrics"]["criteria"].get(c), "-") for c in crit) + " |")
    md += ["", "## Ghi chú", "",
           "- **Mutation / Feedback / Holdout**: tỉ lệ mutant bị test bắt. Feedback là nhóm LLM được biết mutant nào còn sống; "
           "Holdout là nhóm LLM không được biết. Nếu chỉ Feedback tăng mà Holdout đứng yên thì test đang học vẹt.",
           "- Quyết định chấp nhận / dừng chỉ dựa trên Feedback (và rubric khi Feedback bằng nhau); Holdout không tham gia "
           "chọn bản test nên là thước đo độc lập. Hai nhóm được chia theo khối code (đoạn cách nhau bởi dòng trống) "
           "để mutant gần nhau không rơi vào hai nhóm khác nhau.",
           "- Rubric do LLM chấm, dao động giữa các lần chạy; coi mutation và coverage là tín hiệu chính.",
           "- Một số mutant là tương đương (không đổi hành vi), nên 100% không phải lúc nào cũng đạt được."]
    md += mutant_section(state)
    md += diff_section(out, state)
    for lp in state["loops"]:
        if lp.get("notes"):
            md += ["", f"### Loop {lp['loop']}: ghi chú của LLM", lp["notes"]]
    if state.get("stopped"):
        md += ["", f"**Dừng:** {state['stopped']}"]
    (out / "loop-report.md").write_text("\n".join(md) + "\n")
    chart(out, state)


MUT_ICON = {"killed": "✅", "survived": "❌", "invalid": "·"}


def status_of(lp: dict, mid: int) -> str | None:
    st = lp.get("status") or {}
    return st.get(str(mid), st.get(mid))       # key là int trong bộ nhớ, thành str sau khi qua state.json


def mutant_section(state: dict) -> list[str]:
    loops = [lp for lp in state["loops"] if lp.get("status")]
    if not loops:
        return []
    md = ["", "## Trạng thái từng mutant", "",
          "✅ bị bắt · ❌ còn sống · · không hợp lệ (lỗi cú pháp, bỏ qua). Loop bị từ chối ghi *(từ chối)*.", "",
          "| # | Nhóm | Thay đổi | " + " | ".join(f"L{lp['loop']}" + ("" if lp["decision"] in ("mốc", "chấp nhận") else " *(từ chối)*")
                                            for lp in loops) + " |",
          "|" + "---|" * (3 + len(loops))]
    for m in state["mutants"]:
        cells = ["·" if m.get("invalid") else MUT_ICON.get(status_of(lp, m["id"]), "-") for lp in loops]
        md.append(f"| {m['id']} | {m['set']} | {mut_text(m).replace('|', chr(92) + '|')} | " + " | ".join(cells) + " |")
    return md


def diff_section(out: Path, state: dict) -> list[str]:
    best = best_loop(state)
    if best["loop"] == 0:
        return ["", "## Thay đổi của file test", "", "Chưa có loop nào được chấp nhận; bản tốt nhất vẫn là test gốc."]
    a = (out / "loop0" / "test.spec.ts").read_text().splitlines(keepends=True)
    b = (out / f"loop{best['loop']}" / "test.spec.ts").read_text().splitlines(keepends=True)
    diff = list(difflib.unified_diff(a, b, "loop0/test.spec.ts", f"loop{best['loop']}/test.spec.ts"))
    (out / "best.diff").write_text("".join(diff))
    added = sum(l.startswith("+") and not l.startswith("+++") for l in diff)
    removed = sum(l.startswith("-") and not l.startswith("---") for l in diff)
    b0, bm = state["loops"][0]["metrics"], best["metrics"]
    md = ["", f"## Thay đổi của file test (loop 0 -> loop {best['loop']})", "",
          f"+{added} / -{removed} dòng · số test {b0['tests']} -> {bm['tests']}. Diff đầy đủ: `best.diff`."]
    if len(diff) <= 400:
        md += ["", "```diff", "".join(diff).rstrip("\n"), "```"]
    else:
        md += ["", f"*(Diff dài {len(diff)} dòng, chỉ lưu trong `best.diff`.)*"]
    return md


def chart(out: Path, state: dict):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    ls = [lp for lp in state["loops"] if lp["metrics"] and lp["decision"] in ("mốc", "chấp nhận")]
    if len(ls) < 2:
        return
    xs = [lp["loop"] for lp in ls]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(10, 3.6), facecolor="#fcfcfb")
    series = [("Mutation (tất cả)", [lp["metrics"]["mutation"]["pct"] for lp in ls], "#2563eb", "o"),
              ("Holdout", [lp["metrics"]["holdout"]["pct"] for lp in ls], "#d97706", "s"),
              ("Branch coverage", [lp["metrics"]["branch"] for lp in ls], "#6b7280", "^")]
    for name, ys, color, mk in series:
        if any(y is not None for y in ys):
            a1.plot(xs, ys, color=color, marker=mk, label=name, linewidth=2)
            a1.annotate(f"{ys[-1]:g}%", (xs[-1], ys[-1]), textcoords="offset points", xytext=(6, -3), fontsize=8, color=color)
    a1.set_ylim(0, 105)
    a1.set_title("Chỉ số khách quan (%)", fontsize=10)
    a1.legend(fontsize=8, frameon=False, loc="lower right")
    a2.bar([x - 0.2 for x in xs], [lp["metrics"]["fail"] for lp in ls], 0.4, label="fail", color="#d03b3b")
    a2.bar([x + 0.2 for x in xs], [lp["metrics"]["warn"] for lp in ls], 0.4, label="warn", color="#fab219")
    a2.set_title("Rubric: số tiêu chí chưa đạt", fontsize=10)
    a2.legend(fontsize=8, frameon=False)
    for ax in (a1, a2):
        ax.set_xticks(xs)
        ax.set_xlabel("Loop", fontsize=9)
        ax.set_facecolor("#fcfcfb")
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
    fig.tight_layout()
    fig.savefig(out / "loop-chart.png", dpi=150)
    plt.close(fig)


def save(out: Path, state: dict):
    (out / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1))
    write_report(out, state)


def sha(p: Path) -> str:
    return hashlib.sha1(p.read_bytes()).hexdigest()[:12]


# ---------- Vòng lặp chính ----------

def best_loop(state: dict) -> dict:
    return [lp for lp in state["loops"] if lp["decision"] in ("mốc", "chấp nhận")][-1]


# Mọi quyết định (chấp nhận / dừng) chỉ dựa trên nhóm FEEDBACK. Holdout chỉ để báo cáo; nếu dùng holdout
# để chọn bản test thì nó không còn là thước đo độc lập cho việc "có học vẹt không".

def reached(m: dict, threshold: float) -> bool:
    pct = m["feedback"]["pct"]
    return pct is not None and pct >= threshold and m["fail"] == 0


def improved(cur: dict, prev: dict) -> bool:
    c, p = cur["feedback"]["pct"] or 0, prev["feedback"]["pct"] or 0
    return c > p or (c == p and cur["fail"] + cur["warn"] < prev["fail"] + prev["warn"])


def trailing_failures(state: dict) -> int:
    """Số loop liên tiếp gần nhất không được chấp nhận (từ chối hoặc test fail); tính từ state nên đúng cả khi resume."""
    n = 0
    for lp in reversed(state["loops"]):
        if lp["decision"] in ("mốc", "chấp nhận"):
            break
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", type=Path, help="file test cần cải thiện (đường dẫn từ thư mục hiện tại)")
    ap.add_argument("--loop", action="store_true", help="chỉ chạy 1 loop rồi dừng và xuất báo cáo (không có cờ này: chạy tới khi gặp điều kiện dừng)")
    ap.add_argument("--max-loops", type=int, default=10, help="chặn an toàn khi chạy không có --loop (mặc định 10)")
    ap.add_argument("--threshold", type=float, default=90, help="dừng khi mutation score nhóm feedback >= ngưỡng và rubric không còn fail")
    ap.add_argument("--patience", type=int, default=2,
                    help="dừng sau N loop liên tiếp không được chấp nhận (từ chối hoặc test fail); mặc định 2")
    ap.add_argument("--max-mutants", type=int, default=24, help="số mutant trong bộ cố định (mặc định 24)")
    ap.add_argument("--model", default=llm.DEFAULT_MODEL)
    ap.add_argument("--out-dir", type=Path, help="mặc định ~/ut-loop/<tên spec>")
    ap.add_argument("--apply", action="store_true", help="cuối lần chạy, ghi bản tốt nhất vào file spec (mặc định không đụng file spec)")
    ap.add_argument("--no-coverage", action="store_true")
    ap.add_argument("--force", action="store_true", help="chạy tiếp dù lần trước đã dừng vì điều kiện dừng")
    a = ap.parse_args()

    spec = a.spec.resolve()
    out = (a.out_dir or Path.home() / "ut-loop" / spec.name).expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True)
    limit = 1 if a.loop else a.max_loops
    ctx = Ctx(spec, out, a.model, a.max_mutants, not a.no_coverage)
    state_file = out / "state.json"
    orig_spec_text = spec.read_text()

    if state_file.exists():
        state = json.loads(state_file.read_text())
        if state["source_sha"] != sha(ctx.source):
            sys.exit(f"Source đã đổi từ lần chạy trước ({ctx.source.name}); số liệu không so sánh được. Dùng --out-dir khác.")
        if state.get("stopped") and not a.force:
            print(f"{YEL}Lần trước đã dừng:{RST} {state['stopped']}\nDùng --force để chạy tiếp, hoặc --out-dir khác để làm lại từ đầu.")
            print_table(table_rows(state["loops"]))
            return
        state["stopped"] = None
    else:
        state = {"spec": str(spec), "source": str(ctx.source), "runner": ctx.runner, "model": a.model,
                 "source_sha": sha(ctx.source), "mutants": [], "loops": [], "stopped": None}

    try:
        if not state["loops"]:                                          # ---- Loop 0: mốc
            print(f"\n{B}== Loop 0 (mốc){RST}  {DIM}{spec.name}  ·  runner {ctx.runner}{RST}")
            state["mutants"] = generate_mutants(ctx.source.read_text(), a.max_mutants)
            if not state["mutants"]:
                sys.exit("Không sinh được mutant nào từ source này.")
            (out / "original.spec.ts").write_text(orig_spec_text)
            m, review, res = evaluate(ctx, 0, orig_spec_text, state["mutants"])
            if m is None:
                sys.exit(f"{RED}Test hiện tại không pass trên source gốc, không thể đo.{RST}\n{res['log'][-1500:]}")
            for mu in state["mutants"]:
                mu["invalid"] = res["status"].get(mu["id"]) == "invalid"
            (out / "loop0").mkdir(exist_ok=True)
            (out / "loop0" / "test.spec.ts").write_text(orig_spec_text)
            (out / "loop0" / "review.json").write_text(json.dumps(review, ensure_ascii=False, indent=1))
            state["loops"].append({"loop": 0, "decision": "mốc", "metrics": m, "status": res["status"], "notes": "",
                                   "findings": 0})
            save(out, state)
            print_table(table_rows(state["loops"]))

        ran = 0
        while ran < limit:
            best = best_loop(state)
            bm = best["metrics"]
            if reached(bm, a.threshold):
                state["stopped"] = f"đạt ngưỡng (feedback {bm['feedback']['pct']:g}% >= {a.threshold:g}% và rubric không còn fail)"
                break
            review = json.loads((out / f"loop{best['loop']}" / "review.json").read_text())
            findings = build_findings(review, best["status"], state["mutants"])
            if not findings:
                state["stopped"] = "không còn nhận xét hay mutant sống ở nhóm feedback để đưa cho LLM"
                break
            n = len(state["loops"])
            ran += 1
            print(f"\n{B}== Loop {n}{RST}  {DIM}(lần chạy này: {ran}){RST}")
            n_mut = sum(f["id"].startswith("mutant-") for f in findings)
            print(f"  Đưa cho LLM: {len(findings) - n_mut} nhận xét rubric + {n_mut} mutant còn sống")
            test_code = (out / f"loop{best['loop']}" / "test.spec.ts").read_text()
            print("  LLM đang sửa test...", flush=True)
            new_code, notes, fix_cost, log = fix_step(ctx, test_code, findings)
            loop_dir = out / f"loop{n}"
            loop_dir.mkdir(exist_ok=True)
            reason = None
            if new_code is None:
                state["loops"].append({"loop": n, "decision": "test fail", "metrics": None, "notes": notes, "findings": len(findings)})
                (loop_dir / "error.log").write_text(log)
                reason = "test do LLM sửa vẫn fail sau 1 lần thử lại"
            else:
                (loop_dir / "test.spec.ts").write_text(new_code)
                m, review_n, res = evaluate(ctx, n, new_code, state["mutants"], fix_cost)
                (loop_dir / "review.json").write_text(json.dumps(review_n, ensure_ascii=False, indent=1))
                if m is None:
                    state["loops"].append({"loop": n, "decision": "test fail", "metrics": None, "notes": notes, "findings": len(findings)})
                    reason = "test mới fail khi đo lại"
                else:
                    ok = improved(m, bm)
                    state["loops"].append({"loop": n, "decision": "chấp nhận" if ok else "từ chối", "metrics": m,
                                           "status": res["status"], "notes": notes, "findings": len(findings)})
                    if not ok:
                        reason = "không cải thiện (feedback không tăng, rubric không bớt)"
            save(out, state)
            print_table(table_rows(state["loops"]))
            if reason:
                fails = trailing_failures(state)
                if fails >= a.patience:
                    state["stopped"] = f"{fails} loop liên tiếp không được chấp nhận (lần cuối: {reason}), trả về bản tốt nhất"
                    break
                print(f"  {YEL}{reason}; bỏ bản này, thử lại từ bản tốt nhất ({fails}/{a.patience}).{RST}")
    except KeyboardInterrupt:
        print(f"\n{YEL}Dừng giữa chừng. Source và file spec đã được khôi phục; chạy lại cùng --out-dir để tiếp tục.{RST}")
    finally:
        if spec.read_text() != orig_spec_text:
            spec.write_text(orig_spec_text)

    best = best_loop(state)
    if a.apply:
        spec.write_text((out / f"loop{best['loop']}" / "test.spec.ts").read_text())
    save(out, state)
    print(f"\n{B}Kết quả{RST}")
    print_table(table_rows(state["loops"]))
    if state.get("stopped"):
        print(f"\n{CYN}Dừng:{RST} {state['stopped']}")
    best_file = out / f"loop{best['loop']}" / "test.spec.ts"
    print(f"\nBản tốt nhất: loop {best['loop']} -> {best_file}"
          + (f"  {GRN}(đã ghi vào {spec.name}){RST}" if a.apply else f"  {DIM}(chưa ghi vào spec; thêm --apply hoặc copy tay){RST}"))
    print(f"Báo cáo: {out / 'loop-report.md'}" + (f"\nBiểu đồ: {out / 'loop-chart.png'}" if (out / 'loop-chart.png').exists() else ""))


if __name__ == "__main__":
    main()
