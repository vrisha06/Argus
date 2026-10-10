"""Phase-level unit tests (PRD section 10): exercise the lexer, parser, and
semantic phases directly. Standalone script, no test framework. Prints a
[PASS]/[FAIL] line per check and exits non-zero if any check fails."""

import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.lexer import tokenize           # noqa: E402
from securecompile_x.parser import parse             # noqa: E402
from securecompile_x.semantic import analyze         # noqa: E402
from securecompile_x.cli import compile_and_analyze  # noqa: E402

LOC_PREFIX = re.compile(r"^\d+:\d+:")

CHECKS = []


def check(name, passed):
    CHECKS.append((name, bool(passed)))


def _ast(src):
    toks, _ = tokenize(src)
    prog, perrs = parse(toks)
    return prog, perrs


def _semantic(src):
    return compile_and_analyze(src, "t.c")[1]["Semantic"]


# --- Lexer checks (FR-1) -------------------------------------------------
def lexer_checks():
    toks, errs = tokenize("int x = 10;")
    kinds = [t.kind for t in toks if t.kind != "EOF"]
    check("lexer: valid input has no errors and expected kinds",
          errs == [] and kinds == ["KEYWORD", "ID", "OP", "NUM", "SEMI"])

    check("lexer: every token records a location (line>=1, col>=1)",
          all(t.line >= 1 and t.col >= 1 for t in toks))

    _, errs2 = tokenize("int x = @;")
    check("lexer: invalid char yields a location-prefixed error, lexing continues",
          len(errs2) >= 1 and LOC_PREFIX.match(errs2[0]) is not None)


# --- Parser checks (FR-2) ------------------------------------------------
def parser_checks():
    prog, perrs = _ast("int main(){ return 0; } int f(){ return 1; }")
    names = [fn.name for fn in prog.functions]
    check("parser: valid program parses to 2 functions [main, f] with no errors",
          perrs == [] and names == ["main", "f"])

    prog2, perrs2 = _ast("int main(){ int x return 0; } int g(){ return 2; }")
    names2 = [fn.name for fn in prog2.functions]
    check("parser: syntax error reported with location AND recovery continues to g",
          len(perrs2) >= 1 and LOC_PREFIX.match(perrs2[0]) is not None
          and "g" in names2)


# --- Semantic checks (FR-3) ----------------------------------------------
def semantic_checks():
    sem = _semantic("int main(){ int x; x = y + 1; return x; }")
    check("semantic: undeclared identifier 'y' reported",
          any("undeclared identifier 'y'" in d for d in sem))

    sem = _semantic("int main(){ foo(1); return 0; }")
    check("semantic: call to unknown function 'foo' reported",
          any("unknown function 'foo'" in d for d in sem))

    sem = _semantic("int f(){return 0;} int f(){return 1;} int main(){return 0;}")
    check("semantic: redefinition of function 'f' reported",
          any("redefinition of function 'f'" in d for d in sem))

    sem = _semantic("int main(){ int x; x = 1; return x; }")
    check("semantic: clean program has no diagnostics", sem == [])

    sem = _semantic("int main(){ char* p; p = malloc(8); free(p); return 0; }")
    check("semantic: malloc->pointer is NOT a type mismatch (depends on plan 001)",
          not any("type mismatch" in d for d in sem))


def main():
    lexer_checks()
    parser_checks()
    semantic_checks()

    failed = 0
    for name, passed in CHECKS:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
        if not passed:
            failed += 1

    print("-" * 60)
    print(f"{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    if failed:
        print("PHASE TESTS FAILED")
        return 1
    print("ALL PHASE TESTS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
