# Plan 005: Support prefix `++`/`--` and make chained assignment `a = b = c` work correctly

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Touch
> only the in-scope files. If anything in "STOP conditions" occurs, stop and
> report — do not improvise. Commit your work in the worktree (normal commit on
> the current worktree branch; do NOT push or open a PR). SKIP updating
> `plans/README.md` — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 28ead19..HEAD -- securecompile_x/parser.py securecompile_x/ir.py securecompile_x/semantic.py tests/test_parser_extras.py`
> If any changed, compare the "Current state" excerpts against the live code. On
> a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches parser, IR, and semantic analyser; the full test suite must stay green)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `28ead19`, 2026-10-11

## Why this matters

Two expression-grammar gaps remain after plan 004:

1. **Prefix `++i` / `--i` are unsupported** — only postfix `i++`/`i--` were added.
   `for (i=0; i<n; ++i)` and `++i;` currently fail to parse.
2. **Chained assignment `a = b = c` is *rejected*** (plan 004 added a clear
   error) rather than supported. We now want it to work: `a = b = c` should
   assign `c`'s value to both `b` and `a`, and taint must flow through it.

The internal parser node `_AssignExpr` represents an assignment used as an
expression. Today it is only ever *lifted* to a statement `A.Assign` at
statement / for-init / for-step boundaries; a *nested* `_AssignExpr` (the value
of another assignment, i.e. a chain) was rejected because the IR generator had
no case for it. This plan (a) promotes `_AssignExpr` to a public node name
`AssignExpr`, (b) teaches the IR generator and semantic analyser to handle a
nested `AssignExpr`, and (c) removes the rejection and adds prefix `++`/`--`.

Reproduce the current state first:
```bash
printf 'int main(){int i; i=0; ++i; return i;}' > /tmp/pre.c
python -m securecompile_x.cli /tmp/pre.c      # CURRENT: parse error on '++'
printf 'int main(){int a;int b;int c;c=1;a=b=c;return a;}' > /tmp/ch.c
python -m securecompile_x.cli /tmp/ch.c       # CURRENT: "chained assignment is not supported"
```

## Current state

### `securecompile_x/parser.py`

- The internal node is defined near the bottom: `class _AssignExpr(A.Node):`
  (around line 312) with `.target`, `.value`, `.line`, `.col`.
- `_AssignExpr` is referenced in 7 places (confirm with
  `grep -n "_AssignExpr" securecompile_x/parser.py`): the class definition, the
  statement lift (~line 155), for-init (~199), for-step (~210), the
  chained-assignment reject guard (~226-229), the return in `assignment()`
  (~232), and the postfix `++`/`--` branch (~291).
- `assignment()` (lines 220-233) currently REJECTS chains:
```python
    def assignment(self):
        left = self.logic_or()
        t = self.peek()
        if self.check("OP", "=") or self.check("OP", "+=") or self.check("OP", "-="):
            op = self.advance().value
            right = self.assignment()
            if isinstance(right, _AssignExpr):
                raise ParseError(
                    f"{t.line}:{t.col}: chained assignment is not supported; "
                    "split 'a = b = c' into separate statements")
            if op != "=":
                right = A.Binary(op[0], left, right, t.line, t.col)
            return _AssignExpr(left, right, t.line, t.col)
        return left
```
- `unary()` (lines 261-267) does NOT handle `++`/`--`:
```python
    def unary(self):
        t = self.peek()
        if self.peek().kind == "OP" and self.peek().value in ("*", "&", "-", "!"):
            op = self.advance().value
            operand = self.unary()
            return A.Unary(op, operand, t.line, t.col)
        return self.postfix()
```
- `postfix()` (lines 269-295) already desugars POSTFIX `++`/`--` into
  `_AssignExpr(node, node ± 1)` (plan 004). Leave that logic intact (only the
  class name changes in the rename below).
- `ParseError` and `A` (ast_nodes) are already imported at the top of the file.

### `securecompile_x/ir.py`

- Imports `from . import ast_nodes as A` (top of file). It does NOT import the
  parser node.
- `_gen_assign` (lines 201-213) stores into Var / Index / `*ptr` targets:
```python
    def _gen_assign(self, st):
        val = self._expr(st.value)
        tgt = st.target
        if isinstance(tgt, A.Var):
            self._emit("copy", tgt.name, [val], None, st.line)
        elif isinstance(tgt, A.Index):
            arr = self._expr(tgt.array)
            idx = self._expr(tgt.index)
            self._emit("index_store", None, [arr, idx, val], None, st.line)
        elif isinstance(tgt, A.Unary) and tgt.op == "*":
            ptr = self._expr(tgt.operand)
            self._emit("deref_store", None, [ptr, val], None, st.line)
        else:
            t = self._expr(tgt)
            self._emit("copy", t, [val], None, st.line)
```
- `_expr` (lines 236-263) handles Num/CharLit/Str/Var/Binary/Unary/Index/Call
  and returns `None` for anything else. It has NO case for an assignment-expr.

### `securecompile_x/semantic.py`

- Imports `from . import ast_nodes as A` and `from .rules import LIBRARY_MODELS`.
- `_expr` (lines 202-220) checks Var/Binary/Unary/Index/Call; no assignment-expr case.

Conventions across all three files: 4-space indent, no method type annotations,
`A.` prefix for AST nodes, `self._emit(op, result, [args], note, line)` in IR.

## Commands you will need (run from worktree root)

| Purpose | Command | Expected |
|---------|---------|----------|
| prefix repro/verify | `python -m securecompile_x.cli /tmp/pre.c` | after: no parse error; "No vulnerabilities detected" |
| chained repro/verify | `python -m securecompile_x.cli /tmp/ch.c` | after: no "chained assignment" error; clean report |
| parser-extras test | `python tests/test_parser_extras.py` | last line `OK` |
| phase tests | `python tests/run_phase_tests.py` | `ALL PHASE TESTS PASSED` |
| security oracle | `python tests/run_tests.py` | `13/13 cases passed` |
| semantic regr. | `python tests/test_semantic_void_ptr.py` | `OK` |

## Scope

**In scope**:
- `securecompile_x/parser.py`
- `securecompile_x/ir.py`
- `securecompile_x/semantic.py`
- `tests/test_parser_extras.py` (modify)

**Out of scope** (do NOT touch): `securecompile_x/lexer.py`,
`securecompile_x/analysis.py`, `securecompile_x/rules.py`, the detector logic,
`tests/expected.json`, any other test file.

## Steps

### Step 1: Rename `_AssignExpr` → `AssignExpr` in parser.py (make it public)

In `securecompile_x/parser.py`, rename every occurrence of `_AssignExpr` to
`AssignExpr` (the class definition and all 7 usages). This is a pure rename; do
not change behavior yet.

**Verify**: `grep -n "_AssignExpr" securecompile_x/parser.py` → **no matches**;
`grep -cn "AssignExpr" securecompile_x/parser.py` → ≥ 7 matches. Then
`python -c "import securecompile_x.parser"` → no error.

### Step 2: Remove the chained-assignment rejection in `assignment()`

Delete the reject guard (the `if isinstance(right, AssignExpr): raise ParseError(...)`
block, 4 lines) so `assignment()` becomes:
```python
    def assignment(self):
        left = self.logic_or()
        t = self.peek()
        if self.check("OP", "=") or self.check("OP", "+=") or self.check("OP", "-="):
            op = self.advance().value
            right = self.assignment()
            if op != "=":
                right = A.Binary(op[0], left, right, t.line, t.col)
            return AssignExpr(left, right, t.line, t.col)
        return left
```

**Verify**: `python -m securecompile_x.cli /tmp/ch.c` → no longer prints
"chained assignment is not supported" (it may now error differently or run —
Step 4 makes it correct; a transient failure here is expected until Step 4).

### Step 3: Add prefix `++` / `--` to `unary()`

Insert a prefix branch at the top of `unary()`:
```python
    def unary(self):
        t = self.peek()
        if self.peek().kind == "OP" and self.peek().value in ("++", "--"):
            op = self.advance().value
            operand = self.unary()
            if not isinstance(operand, (A.Var, A.Index, A.Unary)):
                raise ParseError(f"{t.line}:{t.col}: '{op}' requires an lvalue")
            one = A.Num(1, t.line, t.col)
            delta = A.Binary(op[0], operand, one, t.line, t.col)  # operand +/- 1
            return AssignExpr(operand, delta, t.line, t.col)
        if self.peek().kind == "OP" and self.peek().value in ("*", "&", "-", "!"):
            op = self.advance().value
            operand = self.unary()
            return A.Unary(op, operand, t.line, t.col)
        return self.postfix()
```
(Prefix `++i` is desugared to `i = i + 1`; value semantics are not modelled —
same convention as postfix, noted in Maintenance.)

**Verify**: `python -m securecompile_x.cli /tmp/pre.c` → no parse error.

### Step 4: Lower a nested `AssignExpr` in the IR generator

In `securecompile_x/ir.py`:

(a) add the import near the top, after `from . import ast_nodes as A`:
```python
from .parser import AssignExpr
```
(b) extract the store logic into a helper and reuse it in `_gen_assign`:
```python
    def _store(self, tgt, val, line):
        if isinstance(tgt, A.Var):
            self._emit("copy", tgt.name, [val], None, line)
        elif isinstance(tgt, A.Index):
            arr = self._expr(tgt.array)
            idx = self._expr(tgt.index)
            self._emit("index_store", None, [arr, idx, val], None, line)
        elif isinstance(tgt, A.Unary) and tgt.op == "*":
            ptr = self._expr(tgt.operand)
            self._emit("deref_store", None, [ptr, val], None, line)
        else:
            t = self._expr(tgt)
            self._emit("copy", t, [val], None, line)

    def _gen_assign(self, st):
        val = self._expr(st.value)
        self._store(st.target, val, st.line)
```
(c) in `_expr`, add a case (place it before the final `return None`) so an
assignment used as a value emits its store and yields the assigned value:
```python
        if isinstance(e, AssignExpr):
            val = self._expr(e.value)
            self._store(e.target, val, e.line)
            return val
```

Note on semantics: for `a = b = c`, the outer statement is
`A.Assign(a, AssignExpr(b, c))`. `_expr(AssignExpr(b,c))` emits `b = c` and
returns `c`'s operand, then `a = c` is stored — so both `a` and `b` receive
`c`'s value, and taint from `c` flows to both. This is correct C value semantics
for this subset.

**Verify**: `python -m securecompile_x.cli /tmp/ch.c` → runs with no error,
"No vulnerabilities detected. (clean)".

### Step 5: Recurse into `AssignExpr` in the semantic analyser

In `securecompile_x/semantic.py`:
(a) add import after the existing imports:
```python
from .parser import AssignExpr
```
(b) in `_expr`, add a branch (e.g. after the `A.Index` branch):
```python
        elif isinstance(e, AssignExpr):
            self._expr(e.target)
            self._expr(e.value)
```
This keeps undeclared-identifier checks and call-graph edges working inside a
chained assignment.

**Verify**: `python -c "import securecompile_x.semantic"` → no import error.

### Step 6: Update `tests/test_parser_extras.py`

Replace the file contents with the version below. It flips the old
"chained assign rejected" check to "chained assign parses", adds prefix checks,
and adds a behavior check that taint flows through a chained pointer assignment
to a command sink:
```python
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from securecompile_x.lexer import tokenize            # noqa: E402
from securecompile_x.parser import parse              # noqa: E402
from securecompile_x.cli import compile_and_analyze   # noqa: E402

def perrs(src):
    toks, _ = tokenize(src)
    _prog, errs = parse(toks)
    return errs

def classes(src):
    findings, _ = compile_and_analyze(src, "t.c")
    return [f.vclass for f in findings]

def main():
    checks = [
        ("for i++ parses", perrs("int main(){int i; for(i=0;i<3;i++){} return 0;}") == []),
        ("bare i++ parses", perrs("int main(){int i; i=0; i++; return 0;}") == []),
        ("prefix ++i parses", perrs("int main(){int i; i=0; ++i; return 0;}") == []),
        ("for ++i parses", perrs("int main(){int i; for(i=0;i<3;++i){} return 0;}") == []),
        ("chained assign parses (supported)",
         perrs("int main(){int a;int b;int c;c=1;a=b=c;return a;}") == []),
        ("plain assign still ok", perrs("int main(){int i; i=0; i=i+1; return i;}") == []),
        ("chained assign propagates taint to sink",
         "unsafe_input_flow" in classes(
             "int main(){ char cmd[128]; char* x; char* y; "
             "scanf(\"%s\", cmd); y = x = cmd; system(y); return 0; }")),
    ]
    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
```

**Verify**: `python tests/test_parser_extras.py` → 7 `[PASS]` and `OK`.

### Step 7: Full suite green

**Verify** all four:
- `python tests/run_tests.py` → `13/13 cases passed`
- `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`
- `python tests/test_parser_extras.py` → `OK`
- `python tests/test_semantic_void_ptr.py` → `OK`

## Test plan

- `tests/test_parser_extras.py` rewritten (Step 6): postfix + prefix `++`/`--`,
  chained-assignment now parses, plain-assign regression, and an end-to-end taint
  check through a chained pointer assignment.
- Pattern: existing `tests/run_tests.py` / `tests/run_phase_tests.py`.
- Verification: Step 7 commands.

## Done criteria

ALL must hold:
- [ ] `grep -n "_AssignExpr" securecompile_x/parser.py` → no matches
- [ ] `python -m securecompile_x.cli /tmp/pre.c` and `/tmp/ch.c` both run with no parse error
- [ ] `python tests/test_parser_extras.py` → `OK` (7 PASS)
- [ ] `python tests/run_tests.py` → `13/13 cases passed`
- [ ] `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`
- [ ] `python tests/test_semantic_void_ptr.py` → `OK`
- [ ] Only the four in-scope files changed (`git status`)

## STOP conditions

Stop and report (do not improvise) if:
- Any "Current state" excerpt does not match the live code (drift).
- Adding `from .parser import AssignExpr` to `ir.py` or `semantic.py` causes an
  ImportError / circular import at `python -c "import securecompile_x.cli"` —
  report it (do not restructure imports blindly).
- After Step 4/5, `python tests/run_tests.py` drops below `13/13` — the `_store`
  refactor changed behavior for non-chained assignments; revert and report.
- The chained-taint behavior check in Step 6 fails even though the parse checks
  pass — report (the IR lowering returns the wrong operand); do not weaken the
  assertion.

## Maintenance notes

- `++`/`--` (prefix and postfix) are desugared to `x = x ± 1`; pre/post *value*
  semantics are not modelled (e.g. `a = b++` stores `b+1` into both, not the old
  `b`). If value semantics are ever needed, revisit the desugaring.
- A chained assignment through an allocator (`p = q = malloc(...)`) will not get
  heap/null tracking because the inner value is an `AssignExpr`, not a direct
  `A.Call` — an accepted edge-case limitation.
- Reviewer: confirm `_store` is behavior-identical to the old `_gen_assign` for
  Var/Index/`*ptr`/other targets, and that the `AssignExpr` import did not create
  a circular import.
