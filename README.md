# SecureCompile-X

**Compiler-Based Vulnerability Detection and Root-Cause Analysis**
*Secure Code. Smarter Compilers. Safer Software.*

BCSE307P – Compiler Design Lab, VIT Vellore (SCSE)
Vrisha Agrawal (24BCE0637), Saksham Raj Singh (24BDS0100) · Guide: Nithya K

A C compiler front-end + middle-end that finds security vulnerabilities **during
compilation** and names the **earliest compiler phase** that could first detect
each one. Two differentiators: **interprocedural taint propagation** across the
call graph, and **compiler-phase attribution** for every finding.

## Quick start — CLI

```bash
python -m securecompile_x.cli tests/bof_strcpy.c          # plain-text report
python -m securecompile_x.cli tests/uif_interproc.c --json # machine-readable JSON
python -m securecompile_x.cli file.c --out report.txt      # write to file
python -m securecompile_x.cli main.c util.c               # analyse multiple files
```

One command compiles and analyses. Exit code is non-zero when findings exist.

### Multi-file analysis

Pass several `.c` files to analyse them as one program (one global namespace —
the subset has no `static`/`extern`). The files are linked into a single symbol
table, call graph and IR, so taint, reachability and findings cross file
boundaries, and each finding is attributed to its file (`file:line` in text,
`location.file` in JSON). A function defined in two files is reported as a
redefinition; the first definition wins. A single file behaves exactly as
before.

## Quick start — Web app

Full-stack web UI: **React (Vite) frontend + FastAPI backend**, both calling the
same `compile_and_analyze` core as the CLI, so results are identical.

```bash
# 0. install the web app's Python dependencies (CLI needs none)
pip install -r requirements.txt

# 1. build the React frontend (one time, or after frontend changes)
cd frontend && npm install && npm run build && cd ..

# 2. run the server  ->  http://127.0.0.1:8000
python -m securecompile_x.web
```

Open the URL: paste C code or load a seeded example, click **Analyze**, and the
seven report fields render as severity-coloured cards (risk badge, root-cause
trace, data-flow path, phase-attribution chip, reachability, suggested fix).

**Frontend dev mode** (hot reload, proxies `/api` to the backend):
```bash
python -m securecompile_x.web          # terminal 1 (backend)
cd frontend && npm run dev             # terminal 2 -> http://127.0.0.1:5173
```

### REST API
| Method | Route | Body / returns |
|---|---|---|
| POST | `/api/analyze` | `{code, filename?}` or `{files: [{name, code}, ...]}` → full JSON report |
| GET | `/api/examples` | list of seeded cases |
| GET | `/api/examples/{name}` | one example's source |

The UI supports multiple files: use the add-file tabs to add, switch between,
or remove translation units, then Analyze them together (cross-file findings
show `file:line`). The single-file `{code, filename?}` body still works; sending
`{files: [...]}` runs the multi-file pipeline.

Interactive API docs at `http://127.0.0.1:8000/docs` (FastAPI/OpenAPI).

## Pipeline (six stages + rule base)

```
source.c
  → Lexer          securecompile_x/lexer.py     tokens (+line/col)          [FR-1]
  → Parser         securecompile_x/parser.py    AST (recursive descent)     [FR-2]
  → Semantic       securecompile_x/semantic.py  symbol table, types,
                                                 CALL GRAPH                  [FR-3]
  → IR Generator   securecompile_x/ir.py        Three-Address Code + real
                                                 branching CFG (ifz/goto/label)
                                                 basic blocks + succ edges   [FR-4]
  → Security Engine securecompile_x/analysis.py taint, 4 detectors,
                                                 attribution, risk           [FR-5]
  → Report         securecompile_x/report.py    7-field report, text/JSON   [FR-6]

Knowledge base    securecompile_x/rules.py      sources, sinks, lib models,
                                                 phase oracle, risk weights  [FR-5.8]

Interfaces:
  CLI              securecompile_x/cli.py        one-command compile+analyse
  Web API          securecompile_x/web.py        FastAPI service (/api/*)
  Web UI           frontend/  (React + Vite)     single-page dashboard
```

Both interfaces call the same `compile_and_analyze(source, name)` core
function, so the CLI and the web app always produce identical findings.

Each phase is a separate module with a defined input/output so it can be tested
alone (NFR: modularity). New sources/sinks/patterns are added in `rules.py`
without touching the engine (NFR: extensibility).

## Vulnerability classes

| Class | Detected when |
|---|---|
| Buffer Overflow | tainted/unbounded data reaches `strcpy`/`strcat`/`sprintf`/`memcpy`/`gets`, or a tainted array index is written without a bounds check |
| Use-After-Free | a pointer is dereferenced/used after `free`, or freed twice (reassignment clears the state) — ordering decided on the CFG |
| Null-Pointer Dereference | a `malloc`/null-origin pointer is dereferenced with no guarding NULL check on the path — path-sensitive via CFG branch refinement (handles `if(p!=0){...}` *and* early-return `if(p==0)return;`) |
| Unsafe Input Flow | tainted input reaches a command sink (`system`/`popen`/`exec*`), intra- or interprocedurally |

## The seven report fields (section 8)

vulnerability type + location · root-cause trace · data-flow path ·
compiler-phase attribution (phase + why earlier phases can't) · reachability
from `main()` · risk score 0–10 · specific suggested fix.

### Phase-attribution oracle
A finding is assigned to the **first phase whose data structure makes it
visible**. All four classes need data/control flow, so they attribute to
**Security Analysis** (needs IR + CFG + call graph + taint); the justification
states what the lexer/parser/semantic phases lacked. The mapping lives in
`rules.py:PHASE_ATTRIBUTION` and is used as the test oracle.

### Risk score (deterministic)
`score = 5 (base) + 3 (tainted user input) + 1.5 (reachable from main, else −2)
+ 1 (unbounded sink) − 3 (mitigating check)`, clamped to 0–10. Weights are in
`rules.py:RISK_WEIGHTS`; the same input always yields the same score
(NFR: determinism).

## Supported C subset

`int`, `char`, `void`, pointers, fixed-size arrays; function definitions/calls;
expressions, assignment, array indexing, `*`/`&`; `if`/`else`, `while`, `for`,
`return`; `malloc`/`free` and modelled stdlib functions. Single translation
unit. Out of scope: preprocessor, function pointers, multi-file linking,
floats, codegen/optimisation, runtime instrumentation (not a sanitizer).

## Validation

```bash
python tests/run_tests.py
```

Runs every seeded case in `tests/` against the oracle in `tests/expected.json`
and prints an expected-vs-actual results table. Current status: **13/13 pass** —
all four classes detected with ≥1 case each, correct phase on every case, the
interprocedural flow detected, and zero findings on the safe controls
(including the early-return null guard, resolved path-sensitively on the CFG).

Sample outputs: `tests/sample_report.txt`, `tests/sample_report.json`.

## Open questions resolved for this build

- Implementation: **Python**, hand-written lexer + recursive-descent parser.
- Scope: **single-file** baseline (multi-file is a stretch goal).
- Report: **plain text + JSON**.
- Risk weights & phase oracle: fixed and documented in `rules.py`.
