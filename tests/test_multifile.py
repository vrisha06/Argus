"""Multi-file (multi-translation-unit) analysis tests (plan 007). Standalone
script: prints a [PASS]/[FAIL] line per check and `OK` when all pass, else
`FAILED` with a non-zero exit code.

Covers cross-file taint with file attribution + reachability, cross-file call
resolution (no false "unknown function"), cross-file redefinition, and a
single-file backward-compatibility equivalence check."""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.cli import (compile_and_analyze,          # noqa: E402
                                 compile_and_analyze_multi)

# Cross-file taint: input read in main.c flows into a sink in util.c.
MAIN_C = 'int main(){ char cmd[128]; scanf("%s", cmd); run(cmd); return 0; }'
UTIL_C = 'void run(char* c){ system(c); }'


def main():
    checks = []

    # --- Cross-file taint + attribution + reachability --------------------
    findings, diag = compile_and_analyze_multi([("main.c", MAIN_C),
                                                ("util.c", UTIL_C)])
    uif = [f for f in findings if f.vclass == "unsafe_input_flow"]
    checks.append(("cross-file taint: exactly one unsafe_input_flow finding",
                   len(uif) == 1))
    checks.append(("cross-file taint: finding attributed to util.c",
                   len(uif) == 1 and uif[0].file == "util.c"))
    checks.append(("cross-file taint: reachable from main",
                   len(uif) == 1 and uif[0].reachable is True))
    checks.append(("cross-file taint: data-flow path crosses files",
                   len(uif) == 1 and "main.c:main" in uif[0].data_flow
                   and "util.c:run" in uif[0].data_flow))

    # --- Cross-file call resolves (no false "unknown function") -----------
    checks.append(("cross-file call resolves: no 'unknown function' diagnostic",
                   not any("unknown function" in d for d in diag["Semantic"])))

    # --- Cross-file redefinition ------------------------------------------
    _f, rdiag = compile_and_analyze_multi([
        ("a.c", "int foo(){ return 1; } int main(){ return foo(); }"),
        ("b.c", "int foo(){ return 2; }"),
    ])
    checks.append(("cross-file redefinition: reported as semantic diagnostic",
                   any("redefinition of function 'foo'" in d
                       for d in rdiag["Semantic"])))

    # --- Backward compat: single unit == single-file path -----------------
    bof_src = open(os.path.join(HERE, "bof_strcpy.c"), encoding="utf-8").read()
    multi_f, _ = compile_and_analyze_multi([("t.c", bof_src)])
    single_f, _ = compile_and_analyze(bof_src, "t.c")
    multi_bo = [f for f in multi_f if f.vclass == "buffer_overflow"]
    single_bo = [f for f in single_f if f.vclass == "buffer_overflow"]
    checks.append(("backward compat: one buffer_overflow via multi path",
                   len(multi_bo) == 1))
    checks.append(("backward compat: multi == single-file "
                   "(class/line/reachable/risk)",
                   len(multi_bo) == 1 and len(single_bo) == 1
                   and multi_bo[0].vclass == single_bo[0].vclass
                   and multi_bo[0].line == single_bo[0].line
                   and multi_bo[0].reachable == single_bo[0].reachable
                   and multi_bo[0].risk == single_bo[0].risk))

    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
