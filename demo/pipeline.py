#!/usr/bin/env python3
"""Pipeline viết unit test nhiều tầng bằng LLM.

  Tầng 1  Phân tích source  -> danh sách behavior / equivalence class / biên
  Tầng 2  Sinh test          -> chạy Jest (cho LLM sửa 1 lần nếu test lỗi)
  Tầng 3  Đánh giá           -> Stryker (mutation score) + review rubric 7 tiêu chí
  Tầng 4  Tinh chỉnh         -> đưa mutant sống sót + nhận xét rubric cho LLM, quay lại tầng 3

Vòng 1 chính là "sinh test 1 lần"; các vòng sau là phần lặp. Dừng khi đạt ngưỡng,
hết số vòng, hoặc mutation score không tăng so với vòng trước.

Dùng: python pipeline.py src/shipping-fee.ts [--max-rounds 3] [--threshold 90] [--confirm]
"""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path

import llm
import review_tests

ROOT = Path(__file__).parent
STATUS_OK = ("pass",)

ANALYZE_SYSTEM = f"""You are a test engineer. Read the TypeScript source and list the behaviors that need unit tests.
Group by logic branch (equivalence class), NOT by surface output: two different branches returning the same value are still two classes.
For each class, list the boundary values to test; the number of boundaries equals the number of edges that class touches.
Include error branches (throw) and any time / randomness dependencies.
Write all free-text fields in {llm.OUTPUT_LANG}."""

ANALYZE_SCHEMA = {
    "type": "object", "required": ["behaviors"],
    "properties": {"behaviors": {"type": "array", "items": {"type": "object",
        "required": ["name", "condition", "expected", "boundary_values"],
        "properties": {"name": {"type": "string"}, "condition": {"type": "string"},
                       "expected": {"type": "string"},
                       "boundary_values": {"type": "array", "items": {"type": "string"}}}}}}}

WRITE_RULES = """Test-writing rules (Jest + TypeScript):
- Assert strictly on return values / exceptions (toBe, toEqual, toThrow('...')); do not use toBeDefined/toBeTruthy.
- Each behavior and each boundary value gets its own test; test names describe the specific behavior.
- Do not spy on the function under test; do not share state between tests.
- Time must be fixed (pass a `now` argument or use jest.useFakeTimers); never depend on the current date.
- Import only from the given path. Return the ENTIRE content of the test file.
- Write test names in English."""

CODE_SCHEMA = {"type": "object", "required": ["test_code"],
               "properties": {"test_code": {"type": "string"}, "notes": {"type": "string"}}}


def ts_block(title, code):
    return f"## {title}\n```ts\n{code}\n```"


class Run:
    def __init__(self, source: Path, run_dir: Path, model: str):
        self.source, self.model = source, model
        self.rel_src = source.relative_to(ROOT).as_posix()
        self.dir = run_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        self.spec = self.dir / f"{source.stem}.spec.ts"
        # đường dẫn import từ file test về source, ví dụ ../../src/shipping-fee
        depth = len(self.spec.relative_to(ROOT).parts) - 1
        self.import_path = "../" * depth + self.rel_src[:-3]
        self.src_text = source.read_text()
        self.cost = 0.0
        self.log = {"source": self.rel_src, "model": model, "rounds": []}

    def ask(self, system, user, schema):
        data, meta = llm.call(system, user, schema, self.model)
        self.cost += meta["cost_usd"] or 0
        return data

    # ---------- Tầng 1 ----------
    def analyze(self):
        return self.ask(ANALYZE_SYSTEM, ts_block(f"Source: {self.rel_src}", self.src_text), ANALYZE_SCHEMA)["behaviors"]

    # ---------- Tầng 2 ----------
    def generate(self, behaviors):
        user = (f"{ts_block(f'Source: {self.rel_src}', self.src_text)}\n\n"
                f"## Approved behavior list\n{json.dumps(behaviors, ensure_ascii=False, indent=1)}\n\n"
                f"Import from exactly this path: '{self.import_path}'.")
        return self.ask("You write Jest + TypeScript unit tests.\n" + WRITE_RULES, user, CODE_SCHEMA)["test_code"]

    def generate_naive(self):
        """Mốc so sánh: sinh test 1 lần như cách dùng LLM thông thường, không phân tích, không quy tắc."""
        user = f"{ts_block(f'Source: {self.rel_src}', self.src_text)}\n\nWrite unit tests for this file. Import from '{self.import_path}'."
        return self.ask("You write Jest + TypeScript unit tests.", user, CODE_SCHEMA)["test_code"]

    def jest(self, code) -> tuple[bool, str]:
        self.spec.write_text(code)
        p = subprocess.run(["npx", "jest", "--ci", self.spec.relative_to(ROOT).as_posix()],
                           cwd=ROOT, capture_output=True, text=True, timeout=300)
        return p.returncode == 0, (p.stdout + p.stderr)[-3000:]

    def jest_with_fix(self, code) -> tuple[str, bool]:
        ok, out = self.jest(code)
        if ok:
            return code, True
        # Test fail có thể do test sai, hoặc source có bug. Ở đây chỉ cho sửa test 1 lần.
        user = (f"{ts_block('Source', self.src_text)}\n\n{ts_block('Current test', code)}\n\n"
                f"## Jest output (failing)\n```\n{out}\n```\nFix the test so it passes against the actual behavior of the source. "
                f"Import from exactly this path: '{self.import_path}'.")
        code = self.ask("You fix failing Jest unit tests.\n" + WRITE_RULES, user, CODE_SCHEMA)["test_code"]
        ok, _ = self.jest(code)
        return code, ok

    # ---------- Tầng 3 ----------
    def stryker(self) -> dict:
        report = self.dir / "mutation.json"
        conf = {
            "testRunner": "jest", "mutate": [self.rel_src], "reporters": ["json"],
            "jsonReporter": {"fileName": report.relative_to(ROOT).as_posix()},
            "coverageAnalysis": "perTest", "logLevel": "error",
            # Sandbox của Stryker chỉ chép thư mục run hiện tại trong runs/, bỏ qua các run khác
            "tempDirName": ".stryker-tmp",
            "ignorePatterns": [".venv", "results", "reports", "baseline", "tests", "runs/*",
                               "!" + self.dir.relative_to(ROOT).as_posix()],
            "jest": {"config": {"testEnvironment": "node",
                                "transform": {"^.+\\.ts$": ["ts-jest", {"diagnostics": False}]},
                                "testMatch": ["**/" + self.spec.relative_to(ROOT).as_posix()]}},
        }
        conf_path = self.dir / "stryker.conf.json"
        conf_path.write_text(json.dumps(conf, indent=1))
        subprocess.run(["npx", "stryker", "run", conf_path.relative_to(ROOT).as_posix()],
                       cwd=ROOT, capture_output=True, text=True, timeout=900)
        mutants = json.loads(report.read_text())["files"][self.rel_src]["mutants"]
        count = lambda *st: sum(m["status"] in st for m in mutants)
        detected, undetected = count("Killed", "Timeout"), count("Survived", "NoCoverage")
        lines = self.src_text.splitlines()
        survived = [{"line": m["location"]["start"]["line"],
                     "code": lines[m["location"]["start"]["line"] - 1].strip(),
                     "mutator": m["mutatorName"], "replacement": m.get("replacement", "")}
                    for m in mutants if m["status"] in ("Survived", "NoCoverage")]
        return {"score": round(100 * detected / max(detected + undetected, 1), 1),
                "killed": detected, "survived": undetected, "total": len(mutants), "survivors": survived}

    def review(self, code):
        r, meta = review_tests.review_text(self.rel_src, self.src_text, self.spec.name, code, self.model)
        self.cost += meta["cost_usd"] or 0
        return r

    # ---------- Tầng 4 ----------
    def refine(self, code, mut, rev):
        weak = [c for c in rev["criteria"] if c["status"] not in STATUS_OK]
        user = (f"{ts_block('Source', self.src_text)}\n\n{ts_block('Current test', code)}\n\n"
                f"## Surviving mutants (NOT detected by the current tests)\n{json.dumps(mut['survivors'], ensure_ascii=False, indent=1)}\n\n"
                f"## Rubric findings not yet passing\n{json.dumps(weak, ensure_ascii=False, indent=1)}\n\n"
                "Rewrite the test file to: (1) add a test that fails for each surviving mutant, unless that mutant is equivalent to the original code, "
                "(2) address the rubric findings. Keep the existing good tests. "
                f"Import from exactly this path: '{self.import_path}'.")
        return self.ask("You improve Jest unit tests based on feedback.\n" + WRITE_RULES, user, CODE_SCHEMA)["test_code"]

    # ---------- Vòng lặp ----------
    def evaluate(self, rnd, code, jest_ok, t0):
        mut = self.stryker() if jest_ok else {"score": 0.0, "killed": 0, "survived": 0, "total": 0, "survivors": []}
        rev = self.review(code)
        (self.dir / f"round{rnd}.spec.ts").write_text(code)
        entry = {"round": rnd, "jest_pass": jest_ok, "mutation_score": mut["score"],
                 "killed": mut["killed"], "survived": mut["survived"], "mutants": mut["total"],
                 "tests": len(re.findall(r"\b(?:it|test)(?:\.each\([^)]*\))?\s*\(", code)),
                 "rubric_pass": sum(c["status"] == "pass" for c in rev["criteria"]),
                 "verdict": rev["overall_verdict"], "cost_usd": round(self.cost, 4),
                 "seconds": round(time.time() - t0, 1)}
        self.log["rounds"].append(entry)
        print(f"  vòng {rnd}: jest={'pass' if jest_ok else 'FAIL'} mutation={mut['score']}% "
              f"({mut['killed']}/{mut['killed'] + mut['survived']}) tests={entry['tests']} "
              f"rubric={entry['rubric_pass']}/7 verdict={rev['overall_verdict']}", flush=True)
        return mut, rev

    def run_naive(self):
        t0 = time.time()
        print(f"[{self.rel_src}] naive: sinh test 1 lần", flush=True)
        code, ok = self.jest_with_fix(self.generate_naive())
        _, rev = self.evaluate(1, code, ok, t0)
        self.log.update(mode="naive", stop_reason="single_shot", final_review=rev,
                        total_seconds=round(time.time() - t0, 1), total_cost_usd=round(self.cost, 4))
        (self.dir / "final.spec.ts").write_text(code)
        (self.dir / "log.json").write_text(json.dumps(self.log, ensure_ascii=False, indent=1))
        return self.log

    def run(self, max_rounds=3, threshold=90.0, confirm=False):
        t0 = time.time()
        self.log["mode"] = "pipeline"
        print(f"[{self.rel_src}] tầng 1: phân tích", flush=True)
        behaviors = self.analyze()
        self.log["behaviors"] = behaviors
        if confirm:
            for b in behaviors:
                print(f"  - {b['name']}: {b['condition']} -> {b['expected']} | biên {', '.join(b['boundary_values'])}")
            if input("Duyệt danh sách behavior? [y/N] ").strip().lower() != "y":
                raise SystemExit("Dừng theo yêu cầu người duyệt.")
        print("  tầng 2: sinh test", flush=True)
        code, ok = self.jest_with_fix(self.generate(behaviors))
        mut, rev = self.evaluate(1, code, ok, t0)
        stop = "max_rounds"
        for rnd in range(2, max_rounds + 1):
            if ok and mut["score"] >= threshold:
                stop = "threshold"
                break
            prev = mut["score"]
            new_code, new_ok = self.jest_with_fix(self.refine(code, mut, rev))
            if not new_ok:   # bản tinh chỉnh không chạy được thì giữ bản trước
                stop = "refine_failed"
                break
            code, ok = new_code, new_ok
            mut, rev = self.evaluate(rnd, code, ok, t0)
            if mut["score"] <= prev:
                stop = "no_improvement"
                break
        else:
            if ok and mut["score"] >= threshold:
                stop = "threshold"
        self.log.update(stop_reason=stop, final_review=rev, total_seconds=round(time.time() - t0, 1),
                        total_cost_usd=round(self.cost, 4))
        (self.dir / "final.spec.ts").write_text(code)
        (self.dir / "log.json").write_text(json.dumps(self.log, ensure_ascii=False, indent=1))
        print(f"  dừng: {stop}; log: {(self.dir / 'log.json').relative_to(ROOT)}", flush=True)
        return self.log


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("source", type=Path)
    ap.add_argument("--max-rounds", type=int, default=3)
    ap.add_argument("--threshold", type=float, default=90.0)
    ap.add_argument("--model", default=llm.DEFAULT_MODEL)
    ap.add_argument("--confirm", action="store_true", help="dừng sau tầng 1 để người duyệt behavior")
    ap.add_argument("--naive", action="store_true", help="mốc so sánh: sinh test 1 lần, không phân tích/phản hồi")
    ap.add_argument("--out", type=Path, default=None)
    a = ap.parse_args()
    src = a.source.resolve()
    out = a.out or ROOT / "runs" / f"{src.stem}-{time.strftime('%Y%m%d-%H%M%S')}"
    run = Run(src, out.resolve(), a.model)
    run.run_naive() if a.naive else run.run(a.max_rounds, a.threshold, a.confirm)
