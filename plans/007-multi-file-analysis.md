# Plan 007: Multi-file (multi–translation-unit) analysis with cross-file taint and per-file attribution

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Keep
> single-file behavior working at every step (the existing suites must stay
> green throughout). Touch only the in-scope files. If anything in "STOP
> conditions" occurs, stop and report. Commit per phase. SKIP updating
> `plans/README.md` — the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 5a46691..HEAD -- securecompile_x/ tests/`
> If any listed file changed, re-read its "Current state" excerpt before editing.
> On a structural mismatch, STOP.

## Status

- **Priority**: P3 (stretch goal; do after the P1/P2 backlog, which is DONE)
- **Effort**: L
- **Risk**: MED (threads a new `file` identity through semantic, IR, analysis,
  report; must preserve single-file behavior and the 13/13 oracle at every step)
- **Depends on**: none (builds on merged plans 001–006)
- **Category**: direction / feature
- **Planned at**: commit `5a46691`, 2026-10-11

## Why this matters

The PRD names **interprocedural taint across the full call graph** as a core
differentiator and lists multi-file as the headline **stretch goal**. Today the
pipeline analyses one translation unit: `compile_and_analyze(source, name)`
takes a single source string. Real C programs span files — a tainted value read
in `main.c` can reach an unsafe sink in `util.c`. This plan links multiple `.c`
files into one analysis so taint, the call graph, reachability, and findings
cross file boundaries, with each finding attributed to its file.

**Architectural key (why this is tractable):** the security engine is *already*
interprocedural. `analyze_security(ir_funcs, symtab, callgraph)` runs a worklist
over a dict of IR functions and a single call graph. Multi-file support is
therefore a **linking/orchestration layer**: parse each file, merge all
functions into one global symbol table + one call graph + one `ir_funcs` dict,
run the existing engine once, and thread a `file` label through for attribution.
No detector or taint-propagation logic changes.

The subset has **no `static`/`extern`/prototypes** (`lexer.py:3`
`KEYWORDS = {"int","char","void","if","else","while","for","return"}`), so every
function lives in one global namespace — exactly a linker's view. Cross-file
calls resolve by name once all files are parsed; a name defined in two files is a
redefinition error.

## Current state

- `securecompile_x/cli.py`
  - `compile_and_analyze(source, source_name="<input>")` (line 18): tokenise →
    parse → `analyze(prog)` → `generate(prog, symtab)` → `analyze_security(...)`;
    returns `(findings, diagnostics)` where `diagnostics` is
    `{"Lexer":[...], "Parser":[...], "Semantic":[...]}`.
  - `main()` (line 36): argparse with a single positional `file` (line 39),
    `--json`, `--out`; calls `compile_and_analyze(src, args.file)` (line 47).
- `securecompile_x/semantic.py`
  - `SemanticAnalyzer.analyze(prog)` (line 81): **pass 1** declares every
    function of `prog` (redefinition check at line 85:
    `self.errors.append(f"{f.line}:{f.col}: redefinition of function '{f.name}'")`),
    then **pass 2** analyses bodies. Module-level `analyze(prog)` (line 227)
    wraps it.
  - Unknown-call diagnostic at line 222: a call whose name is neither a declared
    function nor a `LIBRARY_MODELS` entry → `call to unknown function`.
  - `Symbol` objects carry `name/type/scope/kind/decl_line` (no `file`).
- `securecompile_x/ir.py`
  - `IRGenerator.generate(prog, symtab)` iterates `prog.functions`, building an
    `IRFunction` per function into `self.functions` (name → IRFunction).
    `IRFunction` has `name/params/instrs/blocks/defs` (no `file`).
- `securecompile_x/analysis.py`
  - `Engine(ir_funcs, symtab, callgraph)`; `detect()` computes
    `reach = self.cg.reachable_from("main")` (line 188) and sets `fd.reachable`
    (line 194). `Finding` has `vclass/func/line/col/...` (line 19 `self.func`);
    `to_dict()` location is `{"function","line","col"}` (line 40). **No `file`.**
    Entry point `analyze_security(ir_funcs, symtab, callgraph)` (line 407).
- `securecompile_x/report.py`
  - `to_text(findings, source_file, diagnostics)` and
    `to_json(findings, source_file, diagnostics)`; per-finding location prints
    `function` + `line` only.
- `securecompile_x/ast_nodes.py`
  - `Function(name, ret_type, params, body, line, col)` — plain class (no
    `__slots__`), so a `.file` attribute can be assigned.

Conventions: 4-space indent, no method type annotations, standard-library only,
plain-script tests (`python tests/<name>.py`, prints a PASS/FAIL table).

## Design (the approach the steps implement)

1. **Unit = (name, source).** A new orchestrator
   `compile_and_analyze_multi(units)` parses each unit, tags every parsed
   `Function` with `fn.file = name`, and aggregates diagnostics with the file
   name prefixed onto each message.
2. **Linking in semantics.** Add `SemanticAnalyzer.analyze_programs(progs)`:
   pass 1 declares functions across **all** programs (cross-file redefinition
   reported with both files), pass 2 analyses all bodies. The existing
   single-program `analyze(prog)` becomes `analyze_programs([prog])`. Because all
   functions are declared before any body is analysed, cross-file calls resolve
   and no longer trip the "unknown function" diagnostic. Each `Symbol` for a
   function records `.file`.
3. **Merged IR.** Add `IRGenerator.generate_programs(progs, symtab)` that builds
   IR for every function across all programs into one dict, setting
   `irf.file = fn.file`. `generate(prog, symtab)` becomes
   `generate_programs([prog], symtab)`.
4. **Attribution.** `Finding` gains `.file`; `Engine.detect()` sets
   `fd.file = self.ir[f].file`. `to_dict()` location gains `"file"`. The call
   graph and `reachable_from("main")` already span files once the dict/graph are
   merged — no change to taint or detectors.
5. **Reporting.** `to_text`/`to_json` print `file:line` per finding; the
   data-flow path prefixes function names with their file when it crosses a
   boundary.
6. **CLI.** Accept multiple positional files (`nargs="+"`). One file behaves
   exactly as today (delegates to the multi path with a single unit).

Backward compatibility is a hard requirement: `compile_and_analyze(src, name)`
keeps its signature and delegates to `compile_and_analyze_multi([(name, src)])`.

## Commands you will need (run from repo root / worktree root)

| Purpose | Command | Expected |
|---------|---------|----------|
| oracle | `python tests/run_tests.py` | `13/13 cases passed` |
| phase | `python tests/run_phase_tests.py` | `ALL PHASE TESTS PASSED` |
| parser | `python tests/test_parser_extras.py` | `OK` |
| semantic | `python tests/test_semantic_void_ptr.py` | `OK` |
| multifile (new) | `python tests/test_multifile.py` | `OK` |
| import sanity | `python -c "import securecompile_x.cli"` | no error |

## Scope

**In scope**:
- `securecompile_x/cli.py` (orchestrator + multi-file CLI args)
- `securecompile_x/semantic.py` (`analyze_programs`, file tagging on function symbols, cross-file redefinition message)
- `securecompile_x/ir.py` (`generate_programs`, `IRFunction.file`)
- `securecompile_x/analysis.py` (`Finding.file`, set it in `detect()`, add to `to_dict()`)
- `securecompile_x/report.py` (file in per-finding output + data-flow path)
- `tests/test_multifile.py` (create)
- `README.md` (document multi-file usage)

**Out of scope** (do NOT touch in this plan):
- `securecompile_x/web.py` — multi-file in the web UI/API is a **follow-up**
  (plan 008). Keep the web single-file path working; do not change it here.
- `securecompile_x/lexer.py`, `securecompile_x/ast_nodes.py` structure (you may
  only *assign* `fn.file`, not change the `Function` constructor), the detector
  logic, `rules.py`, `tests/expected.json`, and the existing test scripts.

## Steps

### Step 1 — Thread `file` through semantics (linking)
In `semantic.py`: add `analyze_programs(self, progs)` doing pass 1 over all
programs' functions then pass 2 over all bodies. On a cross-file redefinition,
emit `redefinition of function 'f' (first defined in <file>)`. Set `.file` on
each function `Symbol`. Refactor `analyze(self, prog)` → `return
self.analyze_programs([prog])`. Keep module-level `analyze(prog)` working.
**Verify**: `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`;
`python tests/run_tests.py` → `13/13`.

### Step 2 — Merged IR with file labels
In `ir.py`: add `IRFunction.file = None`; add
`IRGenerator.generate_programs(self, progs, symtab)` iterating all functions
across programs, setting `irf.file = getattr(fn, "file", None)`. Refactor
`generate(prog, symtab)` → `generate_programs([prog], symtab)`.
**Verify**: `python tests/run_tests.py` → `13/13`.

### Step 3 — Finding attribution
In `analysis.py`: add `self.file = None` to `Finding.__init__`; in `detect()`
set `fd.file = getattr(self.ir.get(f), "file", None)`; add `"file"` to the
`to_dict()` `location` map.
**Verify**: `python tests/run_tests.py` → `13/13` (findings now carry a `file`;
single-file findings get the one source name after Step 5 wires it).

### Step 4 — Orchestrator + CLI
In `cli.py`: add `compile_and_analyze_multi(units)` (list of `(name, source)`)
implementing the Design: parse each unit, `fn.file = name`, aggregate
file-prefixed diagnostics, call `analyze_programs`, `generate_programs`,
`analyze_security`. Make `compile_and_analyze(source, name)` delegate to it.
Change `main()` to `nargs="+"` for `file` and pass all files; the report's
`source_file` becomes a comma-joined list or "N files".
**Verify**: `python -c "import securecompile_x.cli"`; single-file
`python -m securecompile_x.cli tests/bof_strcpy.c` still reports the buffer
overflow; all four existing suites still green.

### Step 5 — Report file attribution
In `report.py`: print `file:line` (not just `function` + `line`) per finding in
text, and include `location.file` in JSON. In `analysis.py` `_flow`/`_origin_line`,
prefix a function reference with its file when the path crosses files
(e.g. `main.c:main() [scanf] -> util.c:run(c) -> system(...)`).
**Verify**: all suites green; the Step 6 cross-file test shows file attribution.

### Step 6 — Cross-file tests + README
Create `tests/test_multifile.py` (plain-script style). Cover:
- **Cross-file taint**: unit A `main.c` reads input and calls a helper defined in
  unit B `util.c` that passes it to `system` → exactly one `unsafe_input_flow`
  finding, attributed to `util.c`, reachable from main.
- **Cross-file call resolves**: a call in `main.c` to a function defined in
  `util.c` produces **no** "unknown function" diagnostic.
- **Cross-file redefinition**: two units both defining `foo` → a semantic
  diagnostic containing `redefinition of function 'foo'`.
- **Backward compat**: `compile_and_analyze_multi([("t.c", <the bof_strcpy source>)])`
  yields the same single buffer-overflow finding as the single-file path.

Suggested taint fixture (inline in the test as strings):
```python
MAIN_C = ('int main(){ char cmd[128]; scanf("%s", cmd); run(cmd); return 0; }')
UTIL_C = ('void run(char* c){ system(c); }')
# compile_and_analyze_multi([("main.c", MAIN_C), ("util.c", UTIL_C)])
# -> one finding: class "unsafe_input_flow", file "util.c", reachable True
```
Document multi-file usage in `README.md` (a short "Multi-file analysis" note
under the CLI section: `python -m securecompile_x.cli a.c b.c`).
**Verify**: `python tests/test_multifile.py` → `OK`; all four prior suites still
green.

## Test plan

- New `tests/test_multifile.py`: cross-file taint (+file attribution +
  reachability), cross-file call resolution (no false "unknown function"),
  cross-file redefinition, and a single-file backward-compat equivalence check.
- Pattern: `tests/run_phase_tests.py` (plain script, `check()` collector, `OK`/
  exit code).
- Regression gate: all of `run_tests.py`, `run_phase_tests.py`,
  `test_parser_extras.py`, `test_semantic_void_ptr.py` stay green at every step.

## Done criteria

ALL must hold:
- [ ] `python tests/test_multifile.py` → `OK`
- [ ] `python tests/run_tests.py` → `13/13 cases passed`
- [ ] `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`
- [ ] `python tests/test_parser_extras.py` → `OK`
- [ ] `python tests/test_semantic_void_ptr.py` → `OK`
- [ ] `python -m securecompile_x.cli a.c b.c` (two files) emits one merged report with per-finding `file:line`
- [ ] single-file CLI and `compile_and_analyze(src, name)` behave exactly as before
- [ ] `web.py` unchanged; only the in-scope files modified

## STOP conditions

Stop and report (do not improvise) if:
- Any "Current state" excerpt does not match live code (drift).
- Merging units surfaces a function-name collision the plan's redefinition
  handling can't express (e.g. the engine assumes unique names in `ir_funcs` and
  a collision would silently drop a function) — report before guessing a policy.
- The existing 13/13 oracle drops at any step — a linking change altered
  single-unit behavior; revert that step and report.
- Cross-file reachability from `main()` does not work even though the merged call
  graph contains the edges — report (the engine's `reachable_from` may need the
  callee nodes registered; do not patch detectors).

## Maintenance notes

- Function names are a single global namespace (no `static`); if `static` is ever
  added to the subset, file-local scoping must be introduced here.
- The web layer still runs single-file; plan 008 (follow-up) extends the API to
  accept `[{name, code}]` and the React UI to add/analyse multiple files.
- Reviewer: confirm no detector/taint logic changed — multi-file must be purely a
  linking + attribution layer — and that single-file output is byte-for-byte
  unchanged except for the added `file` field.

## Open design decisions (confirmed defaults — flag if you disagree)

1. **CLI**: multiple positional files (`cli a.c b.c`). One merged report.
2. **Attribution**: each finding gains `file`; text shows `file:line`; JSON
   `location.file`.
3. **Redefinition across files**: reported as a semantic diagnostic; analysis
   proceeds with the first definition.
4. **Web multi-file**: deferred to plan 008 (not in this plan).
5. **No `static`/`extern`**: all functions global (matches the current subset).
