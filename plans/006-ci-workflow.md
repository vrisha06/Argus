# Plan 006: Add a GitHub Actions CI workflow that runs the test suites and the frontend build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result. Touch only the in-scope
> files. If anything in "STOP conditions" occurs, stop and report. Commit your
> work in the worktree (normal commit; do NOT push or open a PR). SKIP updating
> `plans/README.md` — the reviewer maintains the index.
>
> **Drift check (run first)**: `git diff --stat 28ead19..HEAD -- tests/`
> Confirm the four test scripts named below still exist (`ls tests/run_tests.py
> tests/run_phase_tests.py tests/test_parser_extras.py
> tests/test_semantic_void_ptr.py`). On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `28ead19`, 2026-10-11

## Why this matters

The repo has test suites (security oracle + phase/parser/semantic unit tests)
and a React build, but nothing runs them automatically. A CI workflow makes
every push/PR run the suites and build the frontend, catching regressions
before they land. The deliverable is the workflow file itself; it will execute
once the repo is pushed to GitHub (no remote is required to add the file).

## Current state

- Test scripts, each a standalone `python tests/<name>.py` that exits non-zero on
  failure (verified locally during planning):
  - `tests/run_tests.py` → `13/13 cases passed`
  - `tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`
  - `tests/test_parser_extras.py` → `OK`
  - `tests/test_semantic_void_ptr.py` → `OK`
  These import only the Python standard library (no `pip install` needed).
- Frontend: `frontend/` is a Vite + React app; `frontend/package.json` defines
  `"build": "vite build"`, and `frontend/package-lock.json` exists (so `npm ci`
  works). Node 22 is the local toolchain.
- There is no `.github/` directory yet.

## Commands you will need (run from worktree root)

| Purpose | Command | Expected |
|---------|---------|----------|
| oracle | `python tests/run_tests.py` | `13/13 cases passed` |
| phase | `python tests/run_phase_tests.py` | `ALL PHASE TESTS PASSED` |
| parser | `python tests/test_parser_extras.py` | `OK` |
| semantic | `python tests/test_semantic_void_ptr.py` | `OK` |
| file exists | `ls .github/workflows/ci.yml` | lists the file |

## Scope

**In scope**:
- `.github/workflows/ci.yml` (create)

**Out of scope** (do NOT touch): any source, test, or config file. This plan
adds a CI definition only.

## Steps

### Step 1: Create `.github/workflows/ci.yml`

Create the directory and file with exactly this content:
```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  python-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Security oracle (PRD section 10)
        run: python tests/run_tests.py
      - name: Phase unit tests (lexer/parser/semantic)
        run: python tests/run_phase_tests.py
      - name: Parser extras
        run: python tests/test_parser_extras.py
      - name: Semantic void-pointer regression
        run: python tests/test_semantic_void_ptr.py

  frontend-build:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: npm ci
      - run: npm run build
```

**Verify**: `ls .github/workflows/ci.yml` lists the file; it is non-empty
(`wc -l .github/workflows/ci.yml` ≥ 30).

### Step 2: Validate the referenced Python commands pass locally

Run all four test commands from the worktree root and confirm the expected
output (these are exactly what the `python-tests` job will run):
- `python tests/run_tests.py` → `13/13 cases passed`
- `python tests/run_phase_tests.py` → `ALL PHASE TESTS PASSED`
- `python tests/test_parser_extras.py` → `OK`
- `python tests/test_semantic_void_ptr.py` → `OK`

### Step 3: Validate the YAML is well-formed

If PyYAML is importable, run:
`python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
→ prints `yaml ok`.
If PyYAML is not installed (`ModuleNotFoundError`), that is acceptable — instead
confirm the file has no tab characters (`grep -nP "\t" .github/workflows/ci.yml`
returns nothing) and the top-level keys `name:`, `on:`, `jobs:` are present
(`grep -nE "^(name|on|jobs):" .github/workflows/ci.yml` shows all three).

### Step 4 (optional): Confirm the frontend build command locally

A fresh worktree has no `node_modules`. If you want to confirm the
`frontend-build` job, run `cd frontend && npm ci && npm run build` → build exits
0, `frontend/dist/index.html` is produced. This needs network and ~1-2 min; if
it is unavailable, SKIP and note it — the build command matches the repo's
documented, already-working `npm run build`.

## Test plan

No new automated tests. Verification is Steps 2-3 (the CI runs existing suites).

## Done criteria

ALL must hold:
- [ ] `.github/workflows/ci.yml` exists and is non-empty
- [ ] All four `python tests/*.py` commands pass locally with the expected output
- [ ] YAML validates (Step 3: either `yaml ok`, or no-tabs + the three top-level keys present)
- [ ] Only `.github/workflows/ci.yml` was added (`git status`)

## STOP conditions

Stop and report (do not improvise) if:
- Any of the four test scripts named in "Current state" is missing (drift).
- Any of the four test commands fails locally — that is a pre-existing problem,
  not something this plan should mask; report it.

## Maintenance notes

- When a new test script is added under `tests/`, add a step for it to the
  `python-tests` job.
- Reviewer: confirm action versions are pinned (`@v4`/`@v5`) and the workflow
  only runs existing commands; no secrets or deploy steps are introduced.
- This workflow executes only after the repo is pushed to a GitHub remote; until
  then it is a dormant, valid definition.
