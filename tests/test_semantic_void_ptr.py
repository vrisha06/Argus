"""Regression: void* (malloc) assigned to an object pointer must not produce a
semantic type-mismatch diagnostic; a void result assigned to a non-pointer still must."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from securecompile_x.cli import compile_and_analyze  # noqa: E402


def sem(src):
    _findings, diag = compile_and_analyze(src, "t.c")
    return diag["Semantic"]


def main():
    checks = []

    errs = sem("int main(){char* p; p = malloc(16); free(p); return 0;}")
    checks.append(("malloc->char* has no type mismatch",
                   not any("type mismatch" in e for e in errs)))

    errs = sem("int main(){int* q; q = malloc(16); free(q); return 0;}")
    checks.append(("malloc->int* has no type mismatch",
                   not any("type mismatch" in e for e in errs)))

    errs = sem("int main(){int x; char* p; p = malloc(1); x = free(p); return x;}")
    checks.append(("void->int still flagged",
                   any("type mismatch" in e for e in errs)))

    ok = all(passed for _, passed in checks)
    for name, passed in checks:
        print(f"  [{'PASS' if passed else 'FAIL'}] {name}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
