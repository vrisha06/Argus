# Plan 004: Fix the remaining parser gaps (`i++`/`i--` and silently-miscompiled chained assignment)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 516d782..HEAD -- securecompile_x/parser.py`
> If `parser.py` changed since this plan was written, compare the "Current
> state" excerpts against the live code. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (touches the parser's expression grammar — the security oracle
  must stay green)
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `516d782`, 2026-10-11

## Why this matters

Two parser gaps were confirmed by reproduction:

1. **`i++` / `i--` are rejected.** The lexer tokenises `++`/`--`
   (`lexer.py:_OPS`) but the parser never consumes them, so an idiomatic
   counting loop `for (i = 0; i < n; i++)` fails with `expected RPAREN, got
   '++'`. `for` loops are in the PRD subset, so this is a real usability gap.
2. **Chained assignment `a = b = c` silently miscompiles.** The parser builds a
   nested internal `_AssignExpr` as the assignment's value, but the IR generator
   has no case for it, so the inner `b = c` is never emitted and `a` receives a
   `None` operand — with **no error and no diagnostic**. This can cause a silent
   taint false-negative (e.g. `b = a = tainted` would not propagate taint to
   `b`), which is worse than a visible failure in a security tool.

This plan fixes (1) by desugaring postfix `++`/`--` to the assignment the engine
already handles, and fixes (2) by rejecting chained assignment with a clear
parse error (converting silent wrong behavior into an honest diagnostic).

Reproduce both now:

```bash
printf 'int main(){int i; for(i=0;i<3;i++){} return 0;}' > /tmp/incr.c
python -m securecompile_x.cli /tmp/incr.c          # CURRENT: "expected RPAREN, got '++'"
printf 'int main(){int a;int b;int c;c=1;a=b=c;return a;}' > /tmp/chain.c
python -m securecompile_x.cli /tmp/chain.c         # CURRENT: "No vulnerabilities detected" (IR is silently wrong)
```

## Current state

`securecompile_x/parser.py` — recursive-descent parser. Relevant pieces:

- `assignment()` (lines ~220–229) builds the internal `_AssignExpr` node:

```python
    def assignment(self):
        left = self.logic_or()
        t = self.peek()
        if self.check("OP", "=") or self.check("OP", "+=") or self.check("OP", "-="):
            op = self.advance().value
            right = self.assignment()
            if op != "=":
                right = A.Binary(op[0], left, right, t.line, t.col)
            return _AssignExpr(left, right, t.line, t.col)
        return left
```

- `postfix()` (lines ~265–284) handles `[]` indexing and `()` calls, then stops:

```python
    def postfix(self):
        node = self.primary()
        while True:
            t = self.peek()
            if self.match("LBRACK"):
                idx = self.expression()
                self.expect("RBRACK")
                node = A.Index(node, idx, t.line, t.col)
            elif self.check("LPAREN") and isinstance(node, A.Var):
                self.advance()
                args = []
                if not self.check("RPAREN"):
                    args.append(self.expression())
                    while self.match("COMMA"):
                        args.append(self.expression())
                self.expect("RPAREN")
                node = A.Call(node.name, args, node.line, node.col)
            else:
                break
        return node
```

- `_AssignExpr` is an internal parser node (defined near the bottom of
  `parser.py`): `class _AssignExpr(A.Node)` with `.target`, `.value`, `.line`,
  `.col`. `statement()` lifts a top-level `_AssignExpr` into `A.Assign`; the
  `for`-init and `for`-step handlers do the same (see lines ~200–214). Nested
  `_AssignExpr` (an assignment whose *value* is itself an assignment) is never
  lowered anywhere — that is the root of bug (2).
- AST nodes are in `securecompile_x/ast_nodes.py`: `A.Num(value, line, col)`,
  `A.Binary(op, left, right, line, col)`, `A.Var`, `A.Index`, `A.Unary`.
- `ParseError` is defined at the top of `parser.py`; raising it inside an
  expression is recovered at statement boundaries (FR-2.3) — the existing
  mechanism. Match it.

Conventions: 4-space indent, no type annotations, `A.` prefix for AST nodes,
tokens checked via `self.check("OP", "++")` / `self.match(...)`.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Repro / verify `++` | `python -m securecompile_x.cli /tmp/incr.c` | after fix: no parse error; "No vulnerabilities detected" |
| Repro / verify chain | `python -m securecompile_x.cli /tmp/chain.c` | after fix: a parse error `chained assignment is not supported` |
| New parser tests | `python tests/test_parser_extras.py` | last line `OK` |
| Security oracle | `python tests/run_tests.py` | `13/13 cases passed` |

(Run from repo root.)

## Scope

**In scope**:
- `securecompile_x/parser.py` (`postfix()` and `assignment()` only)
- `tests/test_parser_extras.py` (create)

**Out of scope** (do NOT touch):
- `securecompile_x/ir.py` — do **not** attempt to lower nested `_AssignExpr` in
  IR (import coupling; chained assignment is *rejected*, not supported, in this
  plan). Correct IR lowering of chained assignment is a deferred enhancement.
- `securecompile_x/lexer.py` — `++`/`--` are already tokenised.
- Prefix increment `++i` / `--i` — out of scope (only postfix `i++`/`i--`).
- Any detector / semantic / IR behavior.

## Git workflow

Repo not under git; edit in place.

## Steps

### Step 1: Desugar postfix `++` / `--` in `postfix()`

In `postfix()`, add a branch (inside the `while True` loop, as another `elif`
before the `else: break`) that consumes a trailing `++` or `--` on an lvalue and
rewrites it to the equivalent assignment `node = node <op> 1`. Target shape:

```python
            elif self.peek().kind == "OP" and self.peek().value in ("++", "--") \
                    and isinstance(node, (A.Var, A.Index, A.Unary)):
                op = self.advance().value          # "++" or "--"
                one = A.Num(1, t.line, t.col)
                delta = A.Binary(op[0], node, one, t.line, t.col)  # node + 1 / node - 1
                node = _AssignExpr(node, delta, t.line, t.col)
                break   # i++ is a complete postfix expression; stop the loop
```

Rationale: this reuses the existing `_AssignExpr` → `A.Assign` lifting in
`statement()` and the `for`-step handler, so `for (i=0; i<n; i++)` and a bare
`i++;` both work. (Pre/post value semantics are not modelled — `i++` is treated
as `i = i + 1`; acceptable for this subset. Note it in Maintenance.)

**Verify**: `python -m securecompile_x.cli /tmp/incr.c` → no parse error; report
says "No vulnerabilities detected".

### Step 2: Reject chained assignment in `assignment()`

In `assignment()`, after computing `right = self.assignment()`, detect the case
where `right` is itself an `_AssignExpr` (i.e. `a = b = c`) and raise a clear
`ParseError` instead of building a nested node the IR cannot lower. Target shape
(insert before the `if op != "=":` line):

```python
            right = self.assignment()
            if isinstance(right, _AssignExpr):
                raise ParseError(
                    f"{t.line}:{t.col}: chained assignment is not supported; "
                    "split 'a = b = c' into separate statements")
            if op != "=":
                right = A.Binary(op[0], left, right, t.line, t.col)
            return _AssignExpr(left, right, t.line, t.col)
```

Note: Step 1 produces an `_AssignExpr` for `i++`. Ensure `i++` used as a
statement still works — it is parsed via `postfix()`, not as the `right` of an
`=`, so it is unaffected by this check. (The new parser test confirms this.)

**Verify**: `python -m securecompile_x.cli /tmp/chain.c` → output contains a
`[Parser] diagnostics` entry `chained assignment is not supported`.

### Step 3: Add parser tests

Create `tests/test_parser_extras.py` in the plain-script style of
`tests/run_tests.py` (sys.path insert, import, assert, print `OK`/`FAILED`,
exit code). Cover:

- `for (i=0; i<3; i++)` parses with **no** parser errors and the program has a
  `main` function. Use `tokenize` + `parse` from `securecompile_x.lexer` /
  `securecompile_x.parser`, assert `perrs == []`.
- A bare `i++;` statement parses with no errors.
- `a = b = c;` produces a parser error whose message contains `chained
  assignment`.
- Regression: an ordinary `i = i + 1;` still parses with no errors (proves the
  new branches didn't break normal assignment).

```python
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from securecompile_x.lexer import tokenize   # noqa: E402
from securecompile_x.parser import parse     # noqa: E402

def perrs(src):
    toks, _ = tokenize(src)
    _prog, errs = parse(toks)
    return errs

def main():
    checks = [
        ("for i++ parses", perrs("int main(){int i; for(i=0;i<3;i++){} return 0;}") == []),
        ("bare i++ parses", perrs("int main(){int i; i=0; i++; return 0;}") == []),
        ("chained assign rejected",
         any("chained assignment" in e for e in perrs("int main(){int a;int b;int c;c=1;a=b=c;return a;}"))),
        ("plain assign still ok", perrs("int main(){int i; i=0; i=i+1; return i;}") == []),
    ]
    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
```

**Verify**: `python tests/test_parser_extras.py` → four `[PASS]` and `OK`.

### Step 4: Confirm the security oracle is unaffected

**Verify**: `python tests/run_tests.py` → `13/13 cases passed`.

## Test plan

- New file `tests/test_parser_extras.py` (Step 3): `i++` in a for-loop, bare
  `i++;`, chained-assignment rejection, and the plain-assignment regression.
- Pattern: `tests/run_tests.py`.
- Verification: `python tests/test_parser_extras.py` → `OK`, and
  `python tests/run_tests.py` → `13/13 cases passed`.

## Done criteria

ALL must hold:

- [ ] `python -m securecompile_x.cli /tmp/incr.c` parses with no parser error
- [ ] `python -m securecompile_x.cli /tmp/chain.c` reports `chained assignment is not supported`
- [ ] `python tests/test_parser_extras.py` prints `OK` (4 PASS)
- [ ] `python tests/run_tests.py` prints `13/13 cases passed`
- [ ] Only `securecompile_x/parser.py` and `tests/test_parser_extras.py` changed
- [ ] `plans/README.md` status row for 004 updated

## STOP conditions

Stop and report (do not improvise) if:

- The `postfix()` or `assignment()` code does not match the "Current state"
  excerpts (drift).
- After Step 1, `python tests/run_tests.py` drops below `13/13` — the `++`
  desugaring affected an unexpected path; revert Step 1 and report.
- `i++` as a statement starts raising the "chained assignment" error after Step
  2 — the ordering/placement is wrong; report rather than loosening the check.

## Maintenance notes

- `i++`/`i--` are desugared to `i = i ± 1`; pre/post *value* semantics are not
  modelled. If expression-value semantics are ever needed (e.g. `a = b++;`),
  this desugaring must be revisited.
- Chained assignment is **rejected**, not supported. If a future plan wants it to
  work, lower the nested `_AssignExpr` in `ir.py` (compute inner, store, reuse
  inner target as the outer operand) and remove the Step-2 guard.
- Reviewer: confirm the new `postfix` branch only fires on lvalue nodes
  (`A.Var`/`A.Index`/`A.Unary`), and that normal `i = i + 1` is untouched.

## Items from the audit folded into this plan (context — no action here)

These were raised alongside the two bugs above; recording the decision so they
aren't re-audited:

- **npm audit "1 high, 1 moderate"**: dev-only. `npm audit --omit=dev` → **0**.
  Build-toolchain (Vite/esbuild) only, not shipped code. No action; clear it by
  bumping `vite` if/when the toolchain is upgraded for other reasons.
- **Dual path-sensitivity mechanisms**: `Instr.guards` (ir.py) is consumed only
  by the buffer-overflow tainted-index check (`analysis.py:225`), while null/UAF
  use the CFG `refine` edges. These are **not** safely mergeable: `guards`
  captures membership of *any* variable in an enclosing condition (a crude
  bounds-check heuristic, e.g. `if (i < size)`), whereas `refine` tracks only
  *non-null pointer* facts. Collapsing `guards` into `refine` would lose the
  bounds-guard suppression. Deferred as low-leverage tech debt; no change here.
