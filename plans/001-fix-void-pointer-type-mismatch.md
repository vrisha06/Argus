# Plan 001: Stop emitting a spurious "type mismatch" diagnostic for `pointer = malloc(...)`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report — do not improvise.
> When done, update this plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat b51bd1b..HEAD -- securecompile_x/semantic.py`
> If `semantic.py` changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `b51bd1b`, 2026-10-11

## Why this matters

The semantic analyser reports `type mismatch assigning void to char*` (or `int*`,
etc.) for **every** `p = malloc(...)` — the single most common heap idiom in the
supported C subset. Assigning a `void*` result to any object pointer is valid C,
so this is a false diagnostic. It surfaces to the user in the report's
`[Semantic] diagnostics` block (and the web UI's "Compiler diagnostics" panel),
undermining trust in the tool on correct programs. The fix is a one-line
condition change plus a regression test.

Reproduce the bug now (so you can confirm the fix later):

```bash
printf 'int main(){char* p; p = malloc(16); free(p); return 0;}' > /tmp/bug.c
python -m securecompile_x.cli /tmp/bug.c
# CURRENT (buggy) output contains:
#   [Semantic] diagnostics:
#       - 1:23: type mismatch assigning void to char*
```

## Current state

- `securecompile_x/semantic.py` — the semantic analyser. The false positive is
  produced in `_typecheck_assign` (lines ~154–161):

```python
    def _typecheck_assign(self, st):
        lt = self._type_of(st.target)
        rt = self._type_of(st.value)
        if lt and rt and lt.base != rt.base and not (lt.is_pointer() and rt.is_pointer()):
            # non-fatal: int<->char are compatible-ish; only warn on struct-like mismatch
            if {lt.base, rt.base} - {"int", "char"}:
                self.errors.append(
                    f"{st.line}:{st.col}: type mismatch assigning {rt} to {lt}")
```

- Why it fires: allocators are modelled in `securecompile_x/rules.py:LIBRARY_MODELS`
  as returning base `"void"` (no pointer level):

```python
    "malloc":  {"ret": "void", "alloc": "heap"},
    "calloc":  {"ret": "void", "alloc": "heap"},
    "realloc": {"ret": "void", "alloc": "heap"},
```

  So for `p = malloc(16)`: `lt` is `char*` (`base="char"`, pointer), `rt` is
  `void` (`base="void"`, **not** a pointer because its pointer level is 0).
  `lt.is_pointer() and rt.is_pointer()` is `False`, so the guard does not
  suppress, and `{"char","void"} - {"int","char"} == {"void"}` is truthy → the
  error is appended.

- Type representation: `securecompile_x/ast_nodes.py:Type` has `base`, `ptr`
  (indirection level), `array_size`; `is_pointer()` returns `ptr>0 or
  array_size is not None`. A bare `void` return has `ptr=0`, so `is_pointer()`
  is `False`.

- Conventions: this file uses 4-space indent, no type annotations on methods,
  `self.errors.append(f"{line}:{col}: ...")` for diagnostics. Match that style.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Reproduce bug | `python -m securecompile_x.cli /tmp/bug.c` | after the fix: **no** `type mismatch` line |
| Full oracle | `python tests/run_tests.py` | last line `13/13 cases passed` |
| Run this plan's test | `python tests/test_semantic_void_ptr.py` | last line `OK` |

(Run all commands from the repo root: `C:\Users\Naman\OneDrive\Desktop\Compiler_project_vrisha`.)

## Scope

**In scope**:
- `securecompile_x/semantic.py` (the `_typecheck_assign` condition only)
- `tests/test_semantic_void_ptr.py` (create)

**Out of scope** (do NOT touch):
- `securecompile_x/rules.py` — do **not** change the allocator models to return
  a pointer type; other code reads `ret` as a base string and modelling a
  pointer there risks wider breakage. Fix stays in `_typecheck_assign`.
- Any detector logic in `securecompile_x/analysis.py`.
- The existing `tests/expected.json` oracle.

## Git workflow

Repo is not under git. Make the edits in place; do not init git unless the user
asks. (See Maintenance notes — git init is recommended but out of scope here.)

## Steps

### Step 1: Suppress the false positive for `void` → pointer assignment

In `securecompile_x/semantic.py`, change the body of `_typecheck_assign` so the
error is **not** appended when the left side is a pointer and the right side is a
bare `void` value (the allocator / void-function case). Target shape:

```python
    def _typecheck_assign(self, st):
        lt = self._type_of(st.target)
        rt = self._type_of(st.value)
        if lt and rt and lt.base != rt.base and not (lt.is_pointer() and rt.is_pointer()):
            # void* (e.g. malloc result) is assignable to any object pointer — valid C.
            if lt.is_pointer() and rt.base == "void":
                return
            # non-fatal: int<->char are compatible-ish; only warn on struct-like mismatch
            if {lt.base, rt.base} - {"int", "char"}:
                self.errors.append(
                    f"{st.line}:{st.col}: type mismatch assigning {rt} to {lt}")
```

Do **not** broaden this to suppress all `void` — assigning a void result to a
non-pointer (e.g. `int x; x = free(p);`) must still be reported (Step 2 asserts
this).

**Verify**: `python -m securecompile_x.cli /tmp/bug.c` → output no longer
contains a `type mismatch` line (the report shows the Buffer/other analysis, or
"No vulnerabilities detected").

### Step 2: Add a regression test

Create `tests/test_semantic_void_ptr.py` following the plain-script, no-pytest
style of `tests/run_tests.py` (it imports from `securecompile_x` after inserting
the repo root on `sys.path`, asserts, and prints a result line). Content:

```python
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

    # 1) malloc result -> char* : NO type-mismatch diagnostic
    errs = sem("int main(){char* p; p = malloc(16); free(p); return 0;}")
    checks.append(("malloc->char* has no type mismatch",
                   not any("type mismatch" in e for e in errs)))

    # 2) malloc result -> int* : NO type-mismatch diagnostic
    errs = sem("int main(){int* q; q = malloc(16); free(q); return 0;}")
    checks.append(("malloc->int* has no type mismatch",
                   not any("type mismatch" in e for e in errs)))

    # 3) negative control: void result -> int must STILL be flagged
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
```

**Verify**: `python tests/test_semantic_void_ptr.py` → prints three `[PASS]`
lines and `OK`.

### Step 3: Confirm no regression in the security oracle

**Verify**: `python tests/run_tests.py` → last line `13/13 cases passed`.

## Test plan

- New test file `tests/test_semantic_void_ptr.py` (created in Step 2) covering:
  happy path (`malloc`→`char*` and `malloc`→`int*` produce no diagnostic) and
  the regression's negative control (`void`→`int` still flagged).
- Structural pattern: model after `tests/run_tests.py` (sys.path insert, import
  `compile_and_analyze`, assert, print, exit code).
- Verification: `python tests/test_semantic_void_ptr.py` → `OK`.

## Done criteria

ALL must hold:

- [ ] `python -m securecompile_x.cli /tmp/bug.c` output contains no `type mismatch` line
- [ ] `python tests/test_semantic_void_ptr.py` prints `OK` (3 PASS)
- [ ] `python tests/run_tests.py` prints `13/13 cases passed`
- [ ] Only `securecompile_x/semantic.py` and `tests/test_semantic_void_ptr.py` changed
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report (do not improvise) if:

- The `_typecheck_assign` code in the live file does not match the "Current
  state" excerpt (the code has drifted).
- After Step 1, `tests/run_tests.py` drops below `13/13` — the change affected a
  detector path it should not have; revert and report.
- The negative-control assertion (check 3) cannot be made to pass without also
  breaking check 1/2 — report back; the type model may need the broader fix
  that is out of scope here.

## Maintenance notes

- If allocator modelling in `rules.py` is ever changed to return a real pointer
  type, revisit this suppression — it may become redundant.
- Reviewer: confirm the suppression is narrow (`lt.is_pointer() and rt.base ==
  "void"`), not a blanket `"void"` skip, so genuine void-to-scalar assignments
  stay flagged.
- Recommended follow-up (out of scope): run `git init` in the repo so future
  plans can stamp a commit SHA and use drift detection.
