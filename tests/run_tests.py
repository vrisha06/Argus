"""Validation harness (PRD section 10): run every seeded case against the
oracle in expected.json and print a results table of expected vs actual."""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.cli import compile_and_analyze  # noqa: E402


def match(expected, findings):
    """Return (ok, detail). Each expected finding must match one actual finding
    by class+line+phase+reachability+score-range; counts must be equal."""
    if len(expected) != len(findings):
        return False, f"expected {len(expected)} finding(s), got {len(findings)}"
    acts = [f.to_dict() for f in findings]
    used = [False] * len(acts)
    for e in expected:
        hit = False
        for i, a in enumerate(acts):
            if used[i]:
                continue
            lo, hi = e["score_range"]
            if (a["class"] == e["class"]
                    and a["location"]["line"] == e["line"]
                    and a["phase_attribution"]["phase"] == e["phase"]
                    and a["reachable_from_main"] == e["reachable"]
                    and lo <= a["risk_score"] <= hi):
                used[i] = True; hit = True; break
        if not hit:
            return False, f"no actual finding matched expected {e['class']}@L{e['line']}"
    return True, "ok"


def main():
    oracle = json.load(open(os.path.join(HERE, "expected.json"), encoding="utf-8"))
    rows, passed = [], 0
    for case in oracle["cases"]:
        path = os.path.join(HERE, case["file"])
        src = open(path, encoding="utf-8").read()
        findings, _ = compile_and_analyze(src, case["file"])
        ok, detail = match(case["findings"], findings)
        passed += ok
        exp = ",".join(f["class"] for f in case["findings"]) or "clean"
        act = ",".join(f.vclass for f in findings) or "clean"
        rows.append((case["file"], case["group"], exp, act, "PASS" if ok else "FAIL", detail))

    w = max(len(r[0]) for r in rows)
    print(f"{'FILE':<{w}}  {'GROUP':<18} {'EXPECTED':<18} {'ACTUAL':<18} RESULT")
    print("-" * (w + 70))
    for f, g, e, a, r, d in rows:
        line = f"{f:<{w}}  {g:<18} {e:<18} {a:<18} {r}"
        if r == "FAIL":
            line += f"  ({d})"
        print(line)
    print("-" * (w + 70))
    print(f"{passed}/{len(rows)} cases passed")
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
