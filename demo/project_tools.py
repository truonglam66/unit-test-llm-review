"""Tiện ích dùng chung cho bước 3 (fix-tests) và bước 4 (verify-tests) trên project bên ngoài."""
import difflib
import json
import subprocess
import sys
from pathlib import Path

B, DIM, RED, YEL, GRN, CYN, RST = "\033[1m", "\033[2m", "\033[31m", "\033[33m", "\033[32m", "\033[36m", "\033[0m"
if not sys.stdout.isatty():
    B = DIM = RED = YEL = GRN = CYN = RST = ""


def find_project_root(path: Path) -> Path:
    """Thư mục gần nhất phía trên có package.json."""
    for d in [path, *path.parents]:
        if (d / "package.json").exists():
            return d
    sys.exit(f"Không tìm thấy package.json phía trên {path}")


def detect_runner(root: Path) -> str:
    pkg = json.loads((root / "package.json").read_text())
    deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    if "vitest" in deps:
        return "vitest"
    if "jest" in deps:
        return "jest"
    sys.exit(f"Không nhận ra test runner (vitest/jest) trong {root / 'package.json'}")


def run_test(root: Path, spec: Path, runner: str, timeout=300) -> tuple[bool, str]:
    """Chạy đúng 1 file test, trả về (pass?, output rút gọn)."""
    rel = spec.relative_to(root).as_posix()
    cmd = ["npx", "vitest", "run", rel] if runner == "vitest" else ["npx", "jest", "--ci", rel]
    try:
        p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT"
    return p.returncode == 0, (p.stdout + p.stderr)[-4000:]


def load_reviews(out_dir: Path) -> dict[Path, dict]:
    """{đường dẫn spec tuyệt đối: review JSON} từ thư mục --out-dir."""
    res = {}
    for f in sorted(out_dir.glob("*.json")):
        if f.name == "triage.json" or f.name.endswith(".fix.json"):
            continue
        r = json.loads(f.read_text())
        if "criteria" in r and "_spec" in r:
            res[Path(r["_spec"])] = r
    return res


def colored_diff(old: str, new: str, name: str) -> str:
    out = []
    for line in difflib.unified_diff(old.splitlines(), new.splitlines(), f"{name} (cũ)", f"{name} (mới)", lineterm="", n=2):
        if line.startswith("+") and not line.startswith("+++"):
            out.append(GRN + line + RST)
        elif line.startswith("-") and not line.startswith("---"):
            out.append(RED + line + RST)
        elif line.startswith("@@"):
            out.append(CYN + line + RST)
        else:
            out.append(line)
    return "\n".join(out)


def apply_mutation(src: str, m: dict) -> str | None:
    """Thay `original` bằng `replacement`, ưu tiên đúng dòng `line`; None nếu không định vị được duy nhất."""
    orig, repl = m["original"], m["replacement"]
    if "\n" not in orig.strip("\n"):       # LLM đôi khi kèm ký tự xuống dòng thừa ở hai đầu
        orig, repl = orig.strip("\n"), repl.strip("\n")
    if not orig or orig == repl:
        return None
    lines = src.split("\n")
    i = m.get("line", 0) - 1
    if 0 <= i < len(lines) and lines[i].count(orig) == 1:
        lines[i] = lines[i].replace(orig, repl)
        return "\n".join(lines)
    if src.count(orig) == 1:
        return src.replace(orig, repl)
    return None


def one_line(text: str) -> str:
    return text.replace("\n", "⏎")


COVERAGE_KEYS = ("lines", "branches", "functions", "statements")


def coverage_missing(root: Path, runner: str) -> str | None:
    """None nếu đo được coverage; ngược lại trả về hướng dẫn cài."""
    if runner == "jest":
        return None                     # Jest có sẵn coverage (istanbul)
    if any((root / "node_modules/@vitest" / p).exists() for p in ("coverage-v8", "coverage-istanbul")):
        return None
    try:
        ver = json.loads((root / "node_modules/vitest/package.json").read_text())["version"]
    except (OSError, ValueError, KeyError):
        ver = "<phiên bản vitest>"
    return (f"Vitest chưa có gói đo coverage. Cài trong {root}:\n"
            f"  npm install -D @vitest/coverage-v8@{ver}          # lưu vào package.json\n"
            f"  npm install --no-save @vitest/coverage-v8@{ver}   # cài tạm, không sửa package.json")


def run_coverage(root: Path, spec: Path, runner: str, source: Path, report_dir: Path, timeout=300) -> dict | None:
    """Chạy 1 file test kèm đo coverage, chỉ tính cho file source đang xét.
    Trả về {lines, branches, functions, statements: {covered, total, pct}} hoặc None nếu không đo được."""
    import shutil
    shutil.rmtree(report_dir, ignore_errors=True)
    rel_spec, rel_src = spec.relative_to(root).as_posix(), source.relative_to(root).as_posix()
    if runner == "vitest":
        cmd = ["npx", "vitest", "run", rel_spec, "--coverage.enabled=true", f"--coverage.include={rel_src}",
               "--coverage.reporter=json-summary", f"--coverage.reportsDirectory={report_dir}",
               "--coverage.thresholds.lines=0", "--coverage.thresholds.branches=0",
               "--coverage.thresholds.functions=0", "--coverage.thresholds.statements=0"]
    else:
        cmd = ["npx", "jest", "--ci", rel_spec, "--coverage", f"--collectCoverageFrom={rel_src}",
               "--coverageReporters=json-summary", f"--coverageDirectory={report_dir}", "--coverageThreshold={}"]
    try:
        subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
    summary = report_dir / "coverage-summary.json"
    if not summary.exists():
        return None
    data = json.loads(summary.read_text())
    entry = next((v for k, v in data.items() if k != "total" and Path(k).resolve() == source.resolve()), None)
    if entry is None:
        return None
    return {k: {"covered": entry[k]["covered"], "total": entry[k]["total"], "pct": entry[k]["pct"]} for k in COVERAGE_KEYS}


def fmt_cov(c: dict | None) -> str:
    if not c:
        return "không đo được"
    return " / ".join(f"{label} {c[k]['pct']:.0f}%" for k, label in (("lines", "line"), ("branches", "branch"), ("functions", "function")))
