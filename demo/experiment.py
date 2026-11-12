#!/usr/bin/env python3
"""Thí nghiệm: sinh test 1 lần (naive) vs pipeline nhiều tầng.

Mỗi file source x mỗi chế độ x mỗi lần lặp lại -> 1 lượt chạy pipeline.py.
Kết quả: results/<tên>/results.csv, rounds.csv, summary.md, chart.png

Dùng: python experiment.py [--model haiku] [--reps 2] [--max-rounds 3] [--threshold 100]
      python experiment.py --report-only results/<tên>   (vẽ lại từ log có sẵn)
"""
import argparse
import csv
import json
import statistics as st
import time
from pathlib import Path

from pipeline import ROOT, Run

SOURCES = ["src/eligibility.ts", "src/shipping-fee.ts", "src/voucher.ts", "src/order.service.ts"]
MODES = ["naive", "pipeline"]
COLORS = {"naive": "#2a78d6", "pipeline": "#eb6834"}   # palette mặc định của dataviz, đã kiểm tra CVD
LABELS = {"naive": "Sinh 1 lần", "pipeline": "Pipeline nhiều tầng"}


def run_all(out: Path, model: str, reps: int, max_rounds: int, threshold: float):
    for src in SOURCES:
        for mode in MODES:
            for rep in range(1, reps + 1):
                name = f"{Path(src).stem}-{mode}-r{rep}"
                # thư mục run phải nằm phẳng trong runs/ (xem ignorePatterns của Stryker)
                run_dir = ROOT / "runs" / f"{out.name}-{name}"
                if (run_dir / "log.json").exists():
                    print(f"bỏ qua {name} (đã có log)")
                    continue
                r = Run(ROOT / src, run_dir, model)
                try:
                    r.run_naive() if mode == "naive" else r.run(max_rounds, threshold)
                except Exception as e:   # một lượt lỗi không làm hỏng cả thí nghiệm
                    print(f"  LỖI {name}: {e}")


def collect(out: Path):
    rows, rounds = [], []
    for log_path in sorted((ROOT / "runs").glob(f"{out.name}-*/log.json")):
        d = json.loads(log_path.read_text())
        last = d["rounds"][-1]
        tag = log_path.parent.name[len(out.name) + 1:]
        file, mode, rep = tag.rsplit("-", 2)
        rows.append({"file": file, "mode": mode, "rep": rep, "rounds": len(d["rounds"]),
                     "mutation_score": last["mutation_score"], "rubric_pass": last["rubric_pass"],
                     "tests": last["tests"], "verdict": last["verdict"], "stop": d["stop_reason"],
                     "cost_usd": d["total_cost_usd"], "seconds": d["total_seconds"]})
        for e in d["rounds"]:
            rounds.append({"file": file, "mode": mode, "rep": rep, **e})
    return rows, rounds


def write_csv(path: Path, rows):
    if rows:
        with path.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)


def summarize(rows):
    """Trung bình theo (file, mode) kèm min-max để thấy độ dao động giữa các lần chạy."""
    out = {}
    for r in rows:
        out.setdefault((r["file"], r["mode"]), []).append(r)
    def agg(rs, k):
        v = [x[k] for x in rs]
        return st.mean(v), min(v), max(v)
    return {key: {k: agg(rs, k) for k in ("mutation_score", "rubric_pass", "tests", "rounds", "cost_usd", "seconds")}
            | {"n": len(rs), "verdicts": ", ".join(x["verdict"] for x in rs)}
            for key, rs in out.items()}


def write_summary(path: Path, s, model):
    files = sorted({f for f, _ in s})
    fmt = lambda t, d=1: f"{t[0]:.{d}f}" + (f" ({t[1]:.{d}f}–{t[2]:.{d}f})" if t[1] != t[2] else "")
    lines = [f"# Kết quả thí nghiệm (model: {model})", "",
             "Giá trị là trung bình các lần chạy; trong ngoặc là min–max khi các lần khác nhau.", "",
             "| File | Chế độ | n | Mutation score % | Rubric pass /7 | Số test | Số vòng | Verdict | Chi phí ước tính USD | Thời gian s |",
             "|---|---|---|---|---|---|---|---|---|---|"]
    for f in files:
        for m in MODES:
            if (f, m) not in s:
                continue
            x = s[(f, m)]
            lines.append(f"| {f} | {LABELS[m]} | {x['n']} | {fmt(x['mutation_score'])} | {fmt(x['rubric_pass'])} | "
                         f"{fmt(x['tests'], 0)} | {fmt(x['rounds'])} | {x['verdicts']} | {fmt(x['cost_usd'], 3)} | {fmt(x['seconds'], 0)} |")
    lines += ["", "Chi phí là con số `total_cost_usd` do Claude CLI báo (quy đổi theo giá API); "
              "khi chạy bằng gói đăng ký thì không bị tính tiền theo token."]
    path.write_text("\n".join(lines) + "\n")


def chart(path: Path, s):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    files = sorted({f for f, _ in s})
    metrics = [("mutation_score", "Mutation score (%)", 100), ("rubric_pass", "Số tiêu chí rubric đạt (/7)", 7)]
    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2), facecolor="#fcfcfb")
    w = 0.38
    for ax, (key, title, ymax) in zip(axes, metrics):
        ax.set_facecolor("#fcfcfb")
        for i, m in enumerate(MODES):
            xs = [j + (i - 0.5) * (w + 0.02) for j in range(len(files))]
            vals = [s[(f, m)][key][0] if (f, m) in s else 0 for f in files]
            bars = ax.bar(xs, vals, width=w, color=COLORS[m], label=LABELS[m], edgecolor="#fcfcfb", linewidth=2)
            for b, v in zip(bars, vals):
                ax.text(b.get_x() + b.get_width() / 2, v + ymax * 0.015, f"{v:.1f}" if key == "mutation_score" else f"{v:.1f}",
                        ha="center", va="bottom", fontsize=8, color="#52514e")
        ax.set_title(title, loc="left", fontsize=11, color="#0b0b0b")
        ax.set_xticks(range(len(files)))
        ax.set_xticklabels(files, fontsize=9, color="#52514e")
        ax.set_ylim(0, ymax * 1.12)
        ax.tick_params(colors="#52514e", labelsize=8)
        ax.grid(axis="y", color="#e5e4df", linewidth=0.8)
        ax.set_axisbelow(True)
        for sp in ("top", "right", "left"):
            ax.spines[sp].set_visible(False)
        ax.spines["bottom"].set_color("#c3c2b7")
    axes[0].legend(frameon=False, fontsize=9, loc="lower left")
    fig.tight_layout()
    fig.savefig(path, dpi=160)


def report(out: Path, model: str):
    rows, rounds = collect(out)
    if not rows:
        raise SystemExit("Chưa có log nào.")
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "results.csv", rows)
    write_csv(out / "rounds.csv", rounds)
    s = summarize(rows)
    write_summary(out / "summary.md", s, model)
    chart(out / "chart.png", s)
    print((out / "summary.md").read_text())


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--reps", type=int, default=2)
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--threshold", type=float, default=100.0)
    ap.add_argument("--name", default=None, help="tên thí nghiệm; chạy lại cùng tên sẽ bỏ qua lượt đã xong")
    ap.add_argument("--report-only", type=Path, default=None)
    a = ap.parse_args()
    if a.report_only:
        report(a.report_only.resolve(), a.model)
    else:
        out = ROOT / "results" / (a.name or f"exp-{a.model}-{time.strftime('%Y%m%d-%H%M')}")
        run_all(out, a.model, a.reps, a.max_rounds, a.threshold)
        report(out, a.model)
