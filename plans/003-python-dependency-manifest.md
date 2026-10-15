# Plan 003: Add a Python dependency manifest so the web app is reproducible

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result. If anything in "STOP
> conditions" occurs, stop and report. When done, update this plan's status row
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 516d782..HEAD -- securecompile_x/web.py`
> If `web.py` changed since this plan was written, confirm its third-party
> imports still match "Current state". Also confirm no `requirements.txt` /
> `pyproject.toml` already exists at the repo root (`ls requirements.txt
> pyproject.toml`); if one now exists, STOP and reconcile.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `516d782`, 2026-10-11

## Why this matters

The web layer (`securecompile_x/web.py`) imports `fastapi`, `uvicorn`, and
`pydantic`, but the repo has **no** dependency manifest — no `requirements.txt`,
`pyproject.toml`, `setup.py`, or `Pipfile`. A fresh clone cannot run
`python -m securecompile_x.web` without the user guessing and hand-installing the
right packages. The CLI and analysis engine are pure standard library; only the
web app has third-party deps. A single pinned `requirements.txt` (plus a README
line) makes the web app reproducible.

## Current state

- `securecompile_x/web.py` (lines 1–12) imports the third-party packages:

```python
from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
...
def main():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
```

- `securecompile_x/cli.py`, and everything under `securecompile_x/` except
  `web.py`, import only the standard library (`argparse`, `json`, `os`, `sys`)
  and intra-package modules — **no** third-party runtime deps. Do not add a
  manifest requirement for the CLI path.

- Versions currently installed and known-working in this environment (pin to
  these as the lower bound):
  - `fastapi` 0.115.8
  - `uvicorn` 0.34.0
  - `pydantic` 2.10.6 (installed transitively by fastapi; pin explicitly so the
    `BaseModel` import is guaranteed)

- README currently documents the web run as `python -m securecompile_x.web`
  under "Quick start — Web app" but never lists the Python packages to install.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Confirm no manifest yet | `ls requirements.txt pyproject.toml 2>/dev/null` | nothing (or error: not found) |
| Import check (deps present) | `python -c "import fastapi, uvicorn, pydantic; print('ok')"` | prints `ok` |
| CLI still dep-free | `python -m securecompile_x.cli tests/bof_strcpy.c` | prints a report (1 finding) |

(Run from repo root. This plan does **not** require creating a fresh virtualenv;
do not run `pip install` — the goal is to record the manifest, not to mutate the
environment.)

## Scope

**In scope**:
- `requirements.txt` (create, repo root)
- `README.md` (add a one-line install note in the "Quick start — Web app" section)

**Out of scope** (do NOT touch):
- `frontend/package.json` — the Node/React deps are already managed there.
- Any `securecompile_x/*.py` — no code change.
- Do not introduce `pyproject.toml` / packaging metadata in this plan; a single
  `requirements.txt` is the minimal reproducibility fix. (A packaging migration
  can be a later plan.)

## Git workflow

Repo not under git; create the files in place.

## Steps

### Step 1: Create `requirements.txt`

Create `requirements.txt` at the repo root with the web-app dependencies pinned
to a `>=`-with-known-good lower bound. Add a comment noting the CLI needs none:

```
# Runtime dependencies for the Argus web app (securecompile_x/web.py).
# The CLI (python -m securecompile_x.cli) and the analysis engine use only the
# Python standard library — no install needed for CLI-only use.
fastapi>=0.115.8
uvicorn>=0.34.0
pydantic>=2.10.6
```

**Verify**: `python -c "import fastapi, uvicorn, pydantic; print('ok')"` → `ok`
(confirms the named packages import in this environment; pins match what runs).

### Step 2: Document the install step in the README

In `README.md`, inside the "## Quick start — Web app" section, add an install
line **before** the build/run steps. Keep the existing content; insert:

```markdown
```bash
# 0. install the web app's Python dependencies (CLI needs none)
pip install -r requirements.txt
```
```

(Place it as step 0, ahead of the existing `cd frontend && npm install ...`
step. Match the surrounding fenced-`bash` block style.)

**Verify**: `grep -n "requirements.txt" README.md` → at least one match in the
web-app section.

### Step 3: Confirm the CLI path remains dependency-free

**Verify**: `python -m securecompile_x.cli tests/bof_strcpy.c` → prints a report
ending with a Buffer Overflow finding (proves the CLI still runs without any
install step).

## Test plan

- No automated unit tests (this is a manifest/doc change). Verification is the
  three commands above.
- Optional manual check: in a clean virtualenv, `pip install -r requirements.txt`
  then `python -m securecompile_x.web` serves `http://127.0.0.1:8000/`. (Do not
  perform the install as part of this plan — it mutates the environment; note it
  for the reviewer.)

## Done criteria

ALL must hold:

- [ ] `requirements.txt` exists at repo root and pins `fastapi`, `uvicorn`, `pydantic`
- [ ] `python -c "import fastapi, uvicorn, pydantic; print('ok')"` prints `ok`
- [ ] `README.md` "Quick start — Web app" references `pip install -r requirements.txt`
- [ ] `python -m securecompile_x.cli tests/bof_strcpy.c` still runs with no install
- [ ] No file under `securecompile_x/` modified
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report (do not improvise) if:

- `web.py` imports a third-party package not in the list above (add it to the
  manifest and note it) — recheck the import list before finalizing.
- The import check fails (a listed package is not actually installed here) —
  report; do not run `pip install` to paper over it.

## Maintenance notes

- Keep `requirements.txt` in sync with `web.py` imports — if a future plan adds,
  e.g., CORS middleware or a template engine, pin it here too.
- Reviewer: confirm no standard-library module was mistakenly added to the
  manifest, and that the CLI still advertises "no install required."
- Deferred: a proper `pyproject.toml` with console-script entry points
  (`securecompile-x = securecompile_x.cli:main`) is a reasonable later step.
