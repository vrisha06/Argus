# Argus — Project Overview

**Compiler-Based Vulnerability Detection and Root-Cause Analysis**
*Secure Code. Smarter Compilers. Safer Software.*

| | |
|---|---|
| **Course** | BCSE307P — Compiler Design Lab, VIT Vellore (SCSE) |
| **Team** | Vrisha Agrawal (24BCE0637), Saksham Raj Singh (24BDS0100) |
| **Faculty guide** | Nithya K, Assistant Professor Senior Grade II |
| **Input** | One or more C source files (`.c`), restricted to a defined C subset |
| **Output** | A structured security report (plain text or JSON), per compilation |

This document is a complete inventory of everything currently in the project:
what it does, how it is built, every file, the tests, the web app, the full
development history, and the known limitations.

---

## 1. What it is

Argus is a C compiler **front-end + middle-end** that, instead of
emitting machine code, detects **security vulnerabilities** during compilation
and tells the developer **which compiler phase first made each one visible**.

Two things make it different from ordinary static analysers (Coverity, CodeQL,
Clang Static Analyzer):

1. **Interprocedural taint propagation** — untrusted data is tracked across
   function boundaries *and across files*, using the whole call graph, instead
   of one function at a time.
2. **Compiler-phase attribution** — every finding names the earliest phase whose
   data structure makes it detectable, and explains *why* earlier phases could
   not catch it. This turns vulnerability detection into a compiler-theory
   exercise.

---

## 2. How to run it

### Command line (one command, zero dependencies — pure standard library)
```bash
python -m securecompile_x.cli file.c                 # analyse one file (text report)
python -m securecompile_x.cli a.c b.c                # analyse several files together
python -m securecompile_x.cli file.c --json          # machine-readable JSON
python -m securecompile_x.cli file.c --out report.txt # write to a file
```

### Web app (FastAPI backend + React frontend, one server)
```bash
pip install -r requirements.txt          # web deps only (CLI needs none)
cd frontend && npm install && npm run build && cd ..
python -m securecompile_x.web            # serves http://127.0.0.1:8000
```
Open `http://127.0.0.1:8000/` — the one server delivers both the API and the
built UI. Interactive API docs at `/docs`.

### Tests
```bash
python tests/run_tests.py            # security oracle (13 seeded cases)
python tests/run_phase_tests.py      # lexer / parser / semantic unit tests
python tests/test_parser_extras.py   # ++/-- and chained assignment
python tests/test_semantic_void_ptr.py
python tests/test_multifile.py       # cross-file analysis
python tests/test_web_multifile.py   # web API multi-file
```

---

## 3. Architecture — the six-stage pipeline

```
source.c (one or many)
   │
   ▼
┌───────────────┐
│ 1. Lexer      │  lexer.py      → tokens (+ line/column), lexical errors
├───────────────┤
│ 2. Parser     │  parser.py     → AST (recursive descent), error recovery
├───────────────┤
│ 3. Semantic   │  semantic.py   → symbol table, type checks, CALL GRAPH
├───────────────┤
│ 4. IR Gen     │  ir.py         → Three-Address Code + real branching CFG
├───────────────┤
│ 5. Security   │  analysis.py   → taint, 4 detectors, phase attribution,
│    Engine     │                  reachability, risk score
├───────────────┤
│ 6. Report     │  report.py     → 7-field report (text + JSON)
└───────────────┘
        ▲
        │  consults
┌───────────────┐
│ Knowledge base│  rules.py      → taint sources, sinks, stdlib models,
│ (data, not    │                  phase-attribution oracle, risk weights
│  engine code) │
└───────────────┘
```

**Design decisions baked in:**
- The **call graph** is built in the semantic stage (it needs resolved names).
- **Taint** is tracked on the **IR**, where data flow is explicit.
- Rules and library models live in a **separate knowledge base** so new patterns
  are added as *data*, with no engine change.
- The security engine is **interprocedural by construction** — it runs a
  worklist over a dict of IR functions + one merged call graph. This is why
  multi-file support (plan 007) was a thin *linking* layer, not a rewrite.

---

## 4. File-by-file inventory

### Analysis engine — `securecompile_x/` (~1,980 lines of Python, stdlib only)

| File | Lines | Role |
|---|---|---|
| `lexer.py` | 126 | **Phase 1.** Tokenises the C subset; records line/column on every token; reports lexical errors and continues (FR-1). |
| `parser.py` | 326 | **Phase 2.** Recursive-descent parser → AST; preserves source locations; recovers at statement boundaries (FR-2). Handles `++`/`--` (prefix & postfix) and chained assignment. |
| `ast_nodes.py` | 127 | AST node definitions (`Program`, `Function`, statements, expressions) and the `Type` model (`base`, pointer level, array size). |
| `semantic.py` | 250 | **Phase 3.** Symbol table (type/scope/allocation), type checking, undeclared-name detection, and the **call graph** (one node per function, one edge per call site). Links multiple files into one global namespace (FR-3). |
| `ir.py` | 357 | **Phase 4.** Lowers the AST to Three-Address Code and builds a **real branching Control Flow Graph** (basic blocks + successor edges, with branch refinement for non-null facts). Keeps a TAC→source-line map (FR-4). |
| `rules.py` | 108 | **Knowledge base.** Taint sources (`scanf`, `gets`, `read`…), sinks (`strcpy`, `memcpy`, `system`…), standard-library behavioural models, the phase-attribution oracle, and the deterministic risk-score weights (FR-5.8). |
| `analysis.py` | 425 | **Phase 5.** The security engine: interprocedural taint propagation, the four detectors, phase attribution, reachability from `main()`, and context-sensitive risk scoring (FR-5). Also defines the `Finding` object and the 7-field `to_dict()`. |
| `report.py` | 53 | **Phase 6.** Renders findings as a plain-text report and as machine-readable JSON, with `file:line` attribution (FR-6). |
| `cli.py` | 93 | One-command driver. `compile_and_analyze` (single unit) and `compile_and_analyze_multi` (linked units), plus the `argparse` CLI (accepts multiple files). |
| `web.py` | 112 | FastAPI service: `/api/analyze` (single `{code}` or multi `{files:[…]}`), `/api/examples`, and the static mount serving the built React app. |

### Web frontend — `frontend/` (React 18 + Vite 8)

| File | Lines | Role |
|---|---|---|
| `src/App.jsx` | 196 | Main component: multi-file editor (add/switch/remove/rename tabs), example loader, Analyze, and the report pane (idle onboarding + finding cards). |
| `src/components/FindingCard.jsx` | 59 | Renders one finding: type, `file:line`, risk badge (severity-coloured), root-cause trace, data-flow path, phase chip, reachability, suggested fix. |
| `src/styles.css` | 280 | Dark-theme design tokens, layout, responsive breakpoints, file-tab styles, and motion/micro-interactions (`prefers-reduced-motion` respected). |
| `src/api.js` | 33 | Thin client: `analyze`, `analyzeMulti`, `fetchExamples`, `fetchExample`. |
| `src/main.jsx` | 10 | React entry point. |

Build config: `frontend/package.json`, `frontend/vite.config.js` (Vite 8.3.4,
`@vitejs/plugin-react` 6.1.2; dev server proxies `/api` to the backend).

### Tests — `tests/` (13 C fixtures + 6 test scripts + oracle)

- **13 `.c` fixtures**: `bof_strcpy.c`, `bof_gets.c`, `bof_index.c`, `bof_safe.c`,
  `uaf_use.c`, `uaf_double.c`, `uaf_safe.c`, `null_unchecked.c`, `null_checked.c`,
  `null_earlyreturn.c`, `uif_direct.c`, `uif_interproc.c`, `control_safe.c`.
- `expected.json` — the test **oracle** (expected class/line/phase/reachability/
  score-range per case).
- `run_tests.py` — runs the oracle, prints an expected-vs-actual table (**13/13**).
- `run_phase_tests.py` — lexer/parser/semantic unit tests (**10 checks**).
- `test_parser_extras.py` — `++`/`--` and chained assignment (**7 checks**).
- `test_semantic_void_ptr.py` — the `void*`→pointer regression (**3 checks**).
- `test_multifile.py` — cross-file taint, attribution, redefinition, backward-compat (**8 checks**).
- `test_web_multifile.py` — the web API multi-file path (self-skips without fastapi).
- `sample_report.txt`, `sample_report.json` — example outputs.

### Planning & process — `plans/`
`plans/README.md` (index) + nine executed plans `001`–`009`. See §9.

### Other
- `README.md` — quick-start usage. `requirements.txt` — web deps (fastapi,
  uvicorn, pydantic). `.github/workflows/ci.yml` — CI (runs the test suites +
  frontend build). `.gitignore`. `design-plans/` — a UI improvement plan from an
  earlier `/improve-ui` pass.

---

## 5. The four vulnerability classes

| Class | Detected when | Typical sources → sinks |
|---|---|---|
| **Buffer Overflow** | tainted or unbounded data reaches an unbounded copy, or a tainted array index is written with no bounds check | `gets`/`scanf`/`read` → `strcpy`/`memcpy`/`gets`/index |
| **Use-After-Free** | a pointer is dereferenced/used after `free`, or freed twice (reassignment clears the state) — ordering decided on the CFG | `free(p)` then `*p` / `free(p)` again |
| **Null-Pointer Dereference** | a `malloc`/null-origin pointer is dereferenced with no guarding NULL check on the path — path-sensitive via CFG branch refinement | unchecked `malloc` result → `*p` |
| **Unsafe Input Flow** | untrusted input reaches a command sink, intra- or interprocedurally | `scanf` → … → `system`/`popen`/`exec*` |

---

## 6. The security report — 7 fields per finding

1. **Vulnerability type + location** — class, function, `file:line`.
2. **Root-cause trace** — the chain of statements that creates the defect.
3. **Data-flow path** — tainted value from source to sink, across functions and
   files (e.g. `main.c:main() [scanf] → util.c:run(c) → system(...)`).
4. **Compiler-phase attribution** — the earliest phase that can detect it, with a
   justification of what earlier phases lacked. (All four classes need data/
   control flow, so they attribute to **Security Analysis**.)
5. **Reachability** — whether the code is reachable from `main()`.
6. **Risk score (0–10)** — deterministic, from `rules.py:RISK_WEIGHTS`:
   `base 5 + 3 (tainted user input) + 1.5 (reachable, else −2) + 1 (unbounded sink)
   − 3 (mitigating check)`, clamped to 0–10.
7. **Suggested fix** — specific to the code, not generic advice.

Severity tiers in the UI: **CRITICAL** (≥9), **HIGH** (≥7), **MEDIUM** (≥4),
**LOW** (<4).

---

## 7. Supported C subset

**Supported:** `int`, `char`, `void`, pointers, fixed-size arrays; function
definitions & calls; expressions, assignment, array indexing, `*`/`&`, `++`/`--`,
chained assignment; `if`/`else`, `while`, `for`, `return`; `malloc`/`free` and
modelled stdlib functions (`scanf`, `gets`, `strcpy`, `strncpy`, `memcpy`,
`system`, `printf`, `free`, …).

**Out of scope (by design):** the preprocessor (`#include`/macros), `long`/
`long long`/floats, `printf` format-string parsing, function pointers, `static`/
`extern`, machine-code generation/optimisation, and runtime instrumentation
(this is **not** a sanitizer like ASan/MSan).

---

## 8. Multi-file analysis (the PRD stretch goal)

Both the CLI and the web app analyse **several translation units at once**.
Because the subset has no `static`/`extern`, all functions share one global
namespace (a linker's view): files are parsed, their functions merged into one
symbol table + call graph + IR dict, and the interprocedural engine runs once.
Taint, reachability, and findings therefore cross file boundaries, and each
finding is **attributed to the file** it occurs in. A cross-file redefinition of
a function is reported as a semantic error.

---

## 9. Development history — the nine plans

The project was built, audited, and hardened through nine reviewed changes
(each executed in an isolated git worktree and verified before merge). Full
records in `plans/`.

| Plan | What it delivered |
|---|---|
| **001** | Fixed a spurious `type mismatch assigning void to char*` emitted on every `p = malloc(...)` (+ regression test). |
| **002** | Added the PRD §10 lexer/parser/semantic unit tests (`run_phase_tests.py`). |
| **003** | Added `requirements.txt` so the web app is reproducible. |
| **004** | Added postfix `i++`/`i--`; made chained assignment fail loudly instead of silently miscompiling. |
| **005** | Added prefix `++i`/`--i` and full chained-assignment support (correct IR lowering). |
| **006** | Added the GitHub Actions CI workflow (test suites + frontend build). |
| **007** | **Multi-file analysis** — cross-file taint + per-file attribution (CLI + engine). |
| **008** | **Multi-file in the web app** — API `files` mode + React multi-file tab UI. |
| **009** | Upgraded Vite 5 → 8 to clear the esbuild dev-server advisory (`npm audit` → 0). |

**Success metrics (all met):** every vulnerability class detected with ≥1 case,
correct phase attribution on every seeded case, interprocedural *and* cross-file
flows detected, all 7 report fields on every finding, and **zero findings on the
safe control programs**.

---

## 10. Known limitations (intentional, documented)

- `++`/`--` are desugared to `x = x ± 1`; pre/post *value* semantics
  (`a = b++`) are not modelled.
- A chained assignment through an allocator (`p = q = malloc(...)`) does not get
  heap/null tracking (pathological edge case).
- CFG branch refinement covers common predicates (`!=0`, `==0`, truthy, `!`,
  `&&`/`||`); exotic conditions fall back to no refinement (safe, may over-report).
- The web UI is single-translation-unit *per file tab* but analyses all tabs
  together; there are no per-file inline editor markers yet.
- Not a runtime tool — no sanitization, no execution of the analysed C.

---

## 11. Technology stack

- **Analysis engine:** Python 3.13, standard library only (hand-written lexer +
  recursive-descent parser; no flex/bison).
- **Web backend:** FastAPI + Uvicorn + Pydantic.
- **Web frontend:** React 18 + Vite 8 (single-page app, no runtime CSS
  framework; design tokens + vanilla CSS).
- **CI:** GitHub Actions (Python test suites + Node frontend build).
- **Quality:** 6 test suites (13-case security oracle + phase/parser/semantic/
  multifile/web unit tests), `npm audit` clean.
