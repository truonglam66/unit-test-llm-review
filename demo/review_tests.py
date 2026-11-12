#!/usr/bin/env python3
"""LLM review cho unit test: map spec -> source, gửi full source + test + rubric 7 tiêu chí,
nhận structured JSON (tool use bắt buộc), in report Markdown.

Dùng: python review_tests.py tests/foo.service.spec.ts [--model sonnet] [--json]
"""
import argparse, json, sys
from pathlib import Path
import llm

CRITERIA = ["test_vs_implementation", "equivalence_boundary", "assertion_strength",
            "isolation", "determinism", "naming_clarity", "fake_pass_risk"]

SYSTEM = f"""You are a reviewer specialized in UNIT TEST QUALITY (do not review the source code for bugs).
Your only question: does this test actually verify behavior, or does it only create a false sense of safety?
The framework may be Jest or Vitest (vi.fn, vi.mock...), possibly with React Testing Library for components.
For components and hooks, the public boundary is what the user sees and interacts with (DOM, callback props, values returned by the hook).
You only see the source file and the test file; other imported modules are not in context, so do not make confident claims about them.

Rubric (7 criteria):
1 test_vs_implementation: assert on observable results at the public boundary of the unit under test, not on internal details (spying on the unit's own functions, counting calls...). Check: would a behavior-preserving refactor make the test fail?
2 equivalence_boundary: group cases by behavior branch (not by surface output); each class needs values right at its boundaries, and the number of boundary tests equals the number of edges the class touches.
3 assertion_strength: assertions must reliably fail when the logic is wrong (toBeDefined/toBeTruthy are weak; watch for circular assertions). Check: manual mutation.
4 isolation: each test builds its own input AND cleans up shared state. Check: running with it.only or in a different order gives the same result.
5 determinism: same input always gives same output; Date.now/Math.random must be mocked, async must be awaited correctly, beware "time bombs" (comparisons against a fixed date).
6 naming_clarity: the test name describes the specific behavior being verified.
7 fake_pass_risk: summary criterion - if the source logic were broken, which tests would still pass? Name concrete mutations (e.g. changing < to <=).

MANDATORY procedure (put the result in derived_behaviors before grading):
(a) Read the source and list its behaviors / equivalence classes and boundary values yourself.
(b) Compare against the existing tests and point out which classes / boundaries are not tested.
(c) Grade each criterion as pass | warn | fail, with evidence (quoted lines / test names) and a concrete fix suggestion.
Only report problems that have evidence in the code. Criterion 2 depends on domain knowledge, so use low confidence when unsure.
Write all free-text fields in {llm.OUTPUT_LANG}."""

SCHEMA = {
        "type": "object",
        "required": ["derived_behaviors", "criteria", "overall_verdict", "summary"],
        "properties": {
            "derived_behaviors": {"type": "array", "items": {"type": "object",
                "required": ["behavior", "boundary_values", "covered"],
                "properties": {"behavior": {"type": "string"},
                               "boundary_values": {"type": "array", "items": {"type": "string"}},
                               "covered": {"type": "string", "enum": ["yes", "partial", "no"]}}}},
            "criteria": {"type": "array", "items": {"type": "object",
                "required": ["id", "status", "evidence", "suggestion", "confidence"],
                "properties": {"id": {"type": "string", "enum": CRITERIA},
                               "status": {"type": "string", "enum": ["pass", "warn", "fail"]},
                               "evidence": {"type": "string"},
                               "suggestion": {"type": "string"},
                               "confidence": {"type": "string", "enum": ["high", "medium", "low"]}}}},
            "overall_verdict": {"type": "string", "enum": ["good", "needs_work", "unreliable"]},
            "summary": {"type": "string"}}}

ICON = {"pass": "✅", "warn": "⚠️", "fail": "❌"}


def find_source(spec: Path) -> Path:
    """foo.service.spec.ts -> foo.service.ts (tìm trong cùng thư mục, thư mục cha khi test nằm trong __tests__, ../src, src/)"""
    name = spec.name.replace(".spec.", ".").replace(".test.", ".")
    for d in (spec.parent, spec.parent.parent, spec.parent.parent / "src", Path("src")):
        if (d / name).exists():
            return d / name
    sys.exit(f"Không tìm thấy source cho {spec}")


def review_text(src_name: str, src: str, spec_name: str, test: str, model: str = llm.DEFAULT_MODEL) -> tuple[dict, dict]:
    user = (f"## Source (full): {src_name}\n```ts\n{src}\n```\n\n"
            f"## Test (full): {spec_name}\n```ts\n{test}\n```")
    return llm.call(SYSTEM, user, SCHEMA, model)


def review(spec: Path, model: str) -> dict:
    src = find_source(spec)
    return review_text(str(src), src.read_text(), str(spec), spec.read_text(), model)[0]


def render(spec: Path, r: dict) -> str:
    out = [f"# Review: `{spec}` — **{r['overall_verdict'].upper()}**", "", r["summary"], "",
           "## Behavior LLM tự suy ra từ source", "", "| Behavior | Biên | Test hiện có |", "|---|---|---|"]
    for b in r["derived_behaviors"]:
        out.append(f"| {b['behavior']} | {', '.join(b['boundary_values'])} | {b['covered']} |")
    out += ["", "## Rubric", ""]
    for c in sorted(r["criteria"], key=lambda c: CRITERIA.index(c["id"])):
        out += [f"### {ICON[c['status']]} {c['id']} ({c['confidence']} confidence)",
                f"- **Bằng chứng:** {c['evidence']}", f"- **Gợi ý:** {c['suggestion']}", ""]
    return "\n".join(out)


def summary_table(results: dict[Path, dict]) -> str:
    icon = {s: ICON[s] for s in ICON}
    head = "| Spec | Verdict | " + " | ".join(CRITERIA) + " |"
    rows = [head, "|" + "---|" * (len(CRITERIA) + 2)]
    for spec, r in results.items():
        st = {c["id"]: c["status"] for c in r["criteria"]}
        rows.append(f"| {spec.name} | {r['overall_verdict']} | " + " | ".join(icon.get(st.get(c), "-") for c in CRITERIA) + " |")
    return "\n".join(rows)


def chart_grid(results: dict[Path, dict], path: Path) -> bool:
    """Lưới file x tiêu chí, ô tô màu trạng thái và ghi chữ pass/warn/fail (không dùng màu đơn thuần)."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.patches import FancyBboxPatch
    except ImportError:
        print("Bỏ qua biểu đồ: chưa cài matplotlib (pip install matplotlib).", file=sys.stderr)
        return False
    # Màu trạng thái chuẩn của bảng màu dataviz; chữ trong ô chọn theo độ tương phản với nền.
    fill = {"pass": "#0ca30c", "warn": "#fab219", "fail": "#d03b3b"}
    ink = {"pass": "#ffffff", "warn": "#0b0b0b", "fail": "#ffffff"}
    label = {"pass": "✓ pass", "warn": "! warn", "fail": "✗ fail"}
    cols = ["Test vs\nImpl", "Equiv. &\nBoundary", "Assertion\nStrength", "Isolation", "Determinism", "Naming", "Fake-pass\nRisk"]
    specs = list(results)
    fig_h = 1.3 + 0.55 * len(specs)
    fig, ax = plt.subplots(figsize=(11, fig_h), facecolor="#fcfcfb")
    ax.set_facecolor("#fcfcfb")
    for i, spec in enumerate(specs):
        st = {c["id"]: c["status"] for c in results[spec]["criteria"]}
        for j, cid in enumerate(CRITERIA):
            s = st.get(cid)
            if s not in fill:
                continue
            # khe 2px giữa các ô bằng cách thu nhỏ ô, bo góc nhẹ
            ax.add_patch(FancyBboxPatch((j + 0.04, i + 0.06), 0.92, 0.88, boxstyle="round,pad=0,rounding_size=0.06",
                                        facecolor=fill[s], edgecolor="none"))
            ax.text(j + 0.5, i + 0.5, label[s], ha="center", va="center", fontsize=9, color=ink[s], fontweight="bold")
    ax.set_xlim(0, len(CRITERIA))
    ax.set_ylim(len(specs), 0)
    ax.set_xticks([j + 0.5 for j in range(len(CRITERIA))])
    ax.set_xticklabels(cols, fontsize=9, color="#52514e")
    ax.xaxis.tick_top()
    ax.set_yticks([i + 0.5 for i in range(len(specs))])
    ax.set_yticklabels([f"{s.name}  ({results[s]['overall_verdict']})" for s in specs], fontsize=9, color="#0b0b0b")
    ax.tick_params(length=0)
    for sp in ax.spines.values():
        sp.set_visible(False)
    fig.tight_layout()
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return True


if __name__ == "__main__":
    from concurrent.futures import ThreadPoolExecutor
    ap = argparse.ArgumentParser()
    ap.add_argument("specs", type=Path, nargs="+", help="một hoặc nhiều file test")
    ap.add_argument("--model", default=llm.DEFAULT_MODEL)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out-dir", type=Path, help="lưu mỗi báo cáo thành 1 file + summary.md (nên dùng khi review nhiều file)")
    ap.add_argument("--jobs", type=int, default=5, help="số file review song song")
    a = ap.parse_args()

    def one(spec):
        try:
            return spec, review(spec, a.model), None
        except (SystemExit, Exception) as e:   # một file lỗi không làm dừng các file khác
            return spec, None, str(e)

    results, errors = {}, {}
    with ThreadPoolExecutor(max_workers=a.jobs) as pool:
        for spec, r, err in pool.map(one, a.specs):
            if err:
                errors[spec] = err
                print(f"✗ {spec}: {err}", file=sys.stderr)
                continue
            results[spec] = r
            if a.out_dir:
                a.out_dir.mkdir(parents=True, exist_ok=True)
                ext = "json" if a.json else "md"
                body = json.dumps(r, ensure_ascii=False, indent=2) if a.json else render(spec, r)
                (a.out_dir / f"{spec.name}.{ext}").write_text(body)
                if not a.json:   # luôn lưu thêm JSON để lệnh triage đọc được
                    (a.out_dir / f"{spec.name}.json").write_text(json.dumps(
                        {"_spec": str(spec.resolve()), **r}, ensure_ascii=False, indent=2))
                print(f"✓ {spec} -> {a.out_dir / f'{spec.name}.{ext}'}", file=sys.stderr)
            else:
                print(json.dumps(r, ensure_ascii=False, indent=2) if a.json else render(spec, r))
                if len(a.specs) > 1:
                    print("\n---\n")
    if len(a.specs) > 1 and results:
        table = summary_table(results)
        if a.out_dir:
            (a.out_dir / "summary.md").write_text("# Tổng hợp review\n\n![Biểu đồ](summary.png)\n\n" + table + "\n")
            if chart_grid(results, a.out_dir / "summary.png"):
                print(f"Biểu đồ: {a.out_dir / 'summary.png'}", file=sys.stderr)
        print("\n" + table)
    sys.exit(1 if errors else 0)
