# Plan 002: Add PRD §10 unit tests for the lexer, parser, and semantic phases

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If
> anything in "STOP conditions" occurs, stop and report. When done, update this
> plan's status row in `plans/README.md`.
>
> **Drift check (run first)**: repo is not under git. Before writing, open the
> four files named in "Current state" and confirm the cited public functions
> still exist with the signatures shown. On a mismatch, STOP.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/001-fix-void-pointer-type-mismatch.md (a semantic case
  below asserts `malloc`→pointer produces no diagnostic; that is only true after
  001 lands)
- **Category**: tests
- **Planned at**: commit `unavailable` (repo is not a git repository), 2026-10-11

## Why this matters

`tests/run_tests.py` validates only the end-to-end **security oracle** (13
vulnerability cases). The PRD §10 test plan also calls for "Lexer and parser"
and "Semantic" test groups — tokenisation, parse + error recovery, and semantic
errors (type / scope / undeclared / unknown-call / redefinition). None exist as
tests today, so regressions in the front-end phases (like the void-pointer false
positive fixed in 001) go uncaught. Adding a phase-level test harness closes the
gap the PRD already specified and guards every future front-end change.

## Current state

The three phases expose simple, directly testable entry points:

- `securecompile_x/lexer.py` — `tokenize(src) -> (tokens, errors)`. Each token
  has `.kind` (`"KEYWORD"|"ID"|"NUM"|"STRING"|"CHAR"|"OP"|"LPAREN"|...|"EOF"`),
  `.value`, `.line`, `.col`. `errors` is a list of `"line:col: message"` strings.
  Unknown characters produce an error and lexing continues.
- `securecompile_x/parser.py` — `parse(tokens) -> (program, errors)` where
  `program` is `ast_nodes.Program` with `.functions` (list of
  `ast_nodes.Function`). `errors` is a list of `"line:col: ..."` strings;
  recovery happens at statement/`}` boundaries so later functions still parse.
- `securecompile_x/semantic.py` — `analyze(program) -> (symtab, callgraph, errors)`.
  `errors` includes messages such as `use of undeclared identifier 'y'`,
  `call to unknown function 'foo'`, `redefinition of function 'f'`,
  `type mismatch assigning ... to ...`.
- `securecompile_x/cli.py` — `compile_and_analyze(src, name) -> (findings, diagnostics)`
  where `diagnostics` is `{"Lexer": [...], "Parser": [...], "Semantic": [...]}`.
  This is the easiest surface for whole-pipeline diagnostic assertions.

Exemplar to copy for structure (plain script, no pytest, prints a table, exits
non-zero on failure): `tests/run_tests.py` lines 1–12 (sys.path insert + import)
and its `main()` loop that tallies `passed` and prints a result line.

Repo convention: **no test framework** — tests are standalone scripts run with
`python tests/<name>.py`. Do NOT add pytest or any dependency. 4-space indent,
module docstring at top.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Run new phase tests | `python tests/run_phase_tests.py` | last line `ALL PHASE TESTS PASSED` |
| Existing oracle | `python tests/run_tests.py` | `13/13 cases passed` |
| 001's regression test | `python tests/test_semantic_void_ptr.py` | `OK` |

(Run from repo root.)

## Scope

**In scope**:
- `tests/run_phase_tests.py` (create)

**Out of scope** (do NOT touch):
- `securecompile_x/*` — this plan adds tests only; it must not change engine
  behavior. If a test reveals a real bug, STOP and report it (do not fix here).
- `tests/run_tests.py`, `tests/expected.json`, `tests/*.c` — leave the oracle
  harness and fixtures unchanged.

## Git workflow

Repo not under git; add the file in place.

## Steps

### Step 1: Create the phase-test harness skeleton

Create `tests/run_phase_tests.py` modelled on `tests/run_tests.py`: insert the
repo root on `sys.path`, import `tokenize`, `parse`, `analyze`, and
`compile_and_analyze`, define a small `check(name, bool)` collector, and a
`main()` that prints `[PASS]/[FAIL]` per check and `ALL PHASE TESTS PASSED` /
`PHASE TESTS FAILED` with the matching exit code.

```python
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from securecompile_x.lexer import tokenize          # noqa: E402
from securecompile_x.parser import parse            # noqa: E402
from securecompile_x.semantic import analyze        # noqa: E402
from securecompile_x.cli import compile_and_analyze # noqa: E402

CHECKS = []
def check(name, passed): CHECKS.append((name, bool(passed)))

def _ast(src):
    toks, _ = tokenize(src)
    prog, perrs = parse(toks)
    return prog, perrs
```

**Verify**: `python tests/run_phase_tests.py` runs without import error (it will
report 0 checks until later steps add them).

### Step 2: Lexer checks

Add checks covering:
- Valid input tokenises with **no** lexer errors and produces the expected kinds.
  Example: `tokenize("int x = 10;")` → `errors == []`, and the token kinds
  (excluding the trailing `EOF`) are `["KEYWORD","ID","OP","NUM","SEMI"]`.
- Every token records a location: all tokens have `line >= 1` and `col >= 1`.
- An invalid character yields an error **with a location** and lexing continues:
  `tokenize("int x = @;")` → `errors` non-empty, first error matches the regex
  `^\d+:\d+:` (line:col prefix).

**Verify**: `python tests/run_phase_tests.py` → the lexer checks print `[PASS]`.

### Step 3: Parser checks

Add checks covering:
- Valid program parses to the right shape: `_ast("int main(){ return 0; } int f(){ return 1; }")`
  → `perrs == []` and `prog.functions` has length 2 with names `["main","f"]`.
- Syntax error is reported with a location AND recovery continues: for
  `int main(){ int x return 0; } int g(){ return 2; }` (missing `;`),
  `perrs` is non-empty, the first error matches `^\d+:\d+:`, and `prog.functions`
  still contains a function named `g` (proves statement-boundary recovery).

**Verify**: `python tests/run_phase_tests.py` → parser checks `[PASS]`.

### Step 4: Semantic checks

Use `compile_and_analyze(src, "t.c")[1]["Semantic"]` (the diagnostics list) for
these. Add checks covering:
- Undeclared identifier: `int main(){ int x; x = y + 1; return x; }` → some
  diagnostic contains `undeclared identifier 'y'`.
- Unknown function call: `int main(){ foo(1); return 0; }` → some diagnostic
  contains `unknown function 'foo'`.
- Function redefinition: `int f(){return 0;} int f(){return 1;} int main(){return 0;}`
  → some diagnostic contains `redefinition of function 'f'`.
- Clean program has no semantic diagnostics: `int main(){ int x; x = 1; return x; }`
  → `Semantic == []`.
- (Depends on 001) `malloc` result assigned to a pointer is NOT a type mismatch:
  `int main(){ char* p; p = malloc(8); free(p); return 0; }` → no diagnostic
  contains `type mismatch`.

**Verify**: `python tests/run_phase_tests.py` → semantic checks `[PASS]` and the
final line is `ALL PHASE TESTS PASSED`.

### Step 5: Confirm the suite is green end to end

**Verify**: all three commands pass:
`python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`;
`python tests/run_tests.py` → `13/13 cases passed`;
`python tests/test_semantic_void_ptr.py` → `OK`.

## Test plan

- New file `tests/run_phase_tests.py` with the lexer / parser / semantic checks
  enumerated in Steps 2–4 (valid + invalid + recovery + the 001 regression).
- Pattern: `tests/run_tests.py`.
- Verification: `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`.

## Done criteria

ALL must hold:

- [ ] `tests/run_phase_tests.py` exists and prints `ALL PHASE TESTS PASSED`
- [ ] It contains at least: 3 lexer, 2 parser, 5 semantic checks
- [ ] `python tests/run_tests.py` still prints `13/13 cases passed`
- [ ] No file under `securecompile_x/` was modified (tests-only change)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report (do not improvise) if:

- Any imported function (`tokenize`, `parse`, `analyze`, `compile_and_analyze`)
  has a different signature or return shape than "Current state" describes.
- A check you wrote to assert *correct* behavior fails because the engine is
  actually wrong (e.g. a semantic error is not raised when it should be) —
  report the discrepancy; do not weaken the assertion to make it pass, and do
  not edit the engine.
- The 001-dependent semantic check fails — 001 has not landed yet; report and
  pause rather than deleting the check.

## Maintenance notes

- When new keywords, operators, or statement forms are added to the subset, add
  a lexer/parser check here alongside them.
- Reviewer: confirm the invalid-input checks assert on a **location-prefixed**
  error (regex `^\d+:\d+:`), not merely that some error exists — location
  reporting is an FR-1.3/FR-2.3 requirement.
- Deferred (not in this plan): tests for the IR generator, the taint engine
  internals, and the web API — separate future plans.
