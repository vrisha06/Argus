"""Flow-graph / risk-factor tests. Standalone: [PASS]/[FAIL] per check, OK/FAILED."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.cli import compile_and_analyze_multi   # noqa: E402
from securecompile_x.flowgraph import build_flows           # noqa: E402


def _t(n):
    return open(os.path.join(HERE, n), encoding="utf-8").read()


def flows(units):
    fs, _ = compile_and_analyze_multi(units)
    return fs, build_flows([f.to_dict() for f in fs], dict(units))


def main():
    c = []
    fs, fl = flows([("a.c", _t("bof_strcpy.c"))])
    kinds = [n["kind"] for n in fl[0]["nodes"]]
    c.append(("interprocedural: source -> call -> sink", kinds == ["source", "call", "sink"]))
    c.append(("source line resolved (scanf)", fl[0]["nodes"][0]["line"] == 8))
    c.append(("sink line from report", fl[0]["nodes"][2]["line"] == 4))
    c.append(("edges connect consecutive nodes", len(fl[0]["edges"]) == 2))

    fs, fl = flows([("multi_main.c", _t("multi_main.c")), ("multi_util.c", _t("multi_util.c"))])
    n = fl[0]["nodes"]
    c.append(("cross-file: source in main file", n[0]["file"] == "multi_main.c"))
    c.append(("cross-file: call site in caller file", n[1]["file"] == "multi_main.c" and n[1]["line"] == 5))
    c.append(("cross-file: sink in util file", n[2]["file"] == "multi_util.c"))

    fs, fl = flows([("u.c", _t("uaf_double.c"))])
    c.append(("uaf: free -> second free", [x["kind"] for x in fl[0]["nodes"]] == ["source", "sink"]))
    fs, fl = flows([("n.c", _t("null_unchecked.c"))])
    c.append(("null: alloc -> deref", [x["kind"] for x in fl[0]["nodes"]] == ["source", "sink"]))

    fs, _ = flows([("a.c", _t("bof_strcpy.c"))])
    rf = fs[0].risk_factors()
    c.append(("risk factors sum to clamped score",
              min(10.0, max(0.0, rf["raw_total"])) == rf["score"]))
    c.append(("risk factors list base + 4 terms", len(rf["factors"]) == 5))

    ok = all(bool(p) for _, p in c)
    for name, p in c:
        print(f"  [{'PASS' if p else 'FAIL'}] {name}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
