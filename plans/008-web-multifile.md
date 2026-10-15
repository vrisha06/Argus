# Plan 008: Multi-file support in the web app (API + React UI)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. Keep
> the single-file path working. Touch only the in-scope files. If anything in
> "STOP conditions" occurs, stop and report. Commit per phase. SKIP updating
> `plans/README.md` — the reviewer maintains it.
>
> **Drift check (run first)**: `git diff --stat 8c0098f..HEAD -- securecompile_x/web.py frontend/src .github/workflows/ci.yml`
> If any changed, re-read its "Current state" excerpt. On a structural mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (React editor becomes multi-file; API gains a files mode)
- **Depends on**: plan 007 (multi-file engine — already merged; `compile_and_analyze_multi` and per-finding `location.file` exist)
- **Category**: feature / dx
- **Planned at**: commit `8c0098f`, 2026-10-11

## Why this matters

The engine and CLI analyse multiple translation units (plan 007), but the web
app still submits a single file. This plan surfaces multi-file in the browser:
the API accepts several `{name, code}` files, the React UI lets you add / switch
/ remove files, and findings show `file:line` so cross-file results are legible.
It reuses `compile_and_analyze_multi` — no engine change.

## Current state

### `securecompile_x/web.py`
- Imports `from .cli import compile_and_analyze` (single-file only).
- Model + endpoint:
```python
class AnalyzeRequest(BaseModel):
    code: str
    filename: str = "input.c"

@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    findings, diagnostics = compile_and_analyze(req.code, req.filename)
    return {
        "tool": "Argus",
        "source_file": req.filename,
        "diagnostics": diagnostics,
        "finding_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }
```
- `compile_and_analyze_multi(units)` exists in `securecompile_x/cli.py` (units =
  list of `(name, source)`), returning `(findings, diagnostics)`. Findings'
  `to_dict()["location"]` now includes `"file"`.

### `frontend/src/api.js`
- Has `fetchExamples()`, `fetchExample(name)`, and
  `analyze(code, filename="input.c")` which POSTs `{code, filename}` to `/api/analyze`.

### `frontend/src/App.jsx`
- Single-file state: `const [code, setCode] = useState(STARTER);` (line 21) and
  `result/busy/error/examples`.
- `onLoadExample(name)` sets `code` (line 35); `onAnalyze()` calls
  `analyze(code)` (line 47).
- Editor pane (lines 76-97): a `.pane-head` with the example `<select>` and the
  Analyze button, then a single `<textarea className="code" value={code}
  onChange={e=>setCode(e.target.value)} />`.
- The idle onboarding panel and motion (added in prior plans) must be preserved.

### `frontend/src/components/FindingCard.jsx`
- Line 25 renders the location: `<code>{f.location.function}()</code> · line {f.location.line}`.

### `.github/workflows/ci.yml`
- `python-tests` job runs the four stdlib test scripts; it does **not**
  `pip install` (the web test added here needs fastapi/pydantic).

Conventions: React function components + hooks, CSS tokens in `styles.css`
(`--panel`, `--panel-2`, `--border`, `--accent`, `--muted`, `--text`), 2-space
JS indent. Python: pydantic models, 4-space indent.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| web import | `python -c "import securecompile_x.web"` | no error |
| web test (new) | `python tests/test_web_multifile.py` | `OK` (or `SKIP` if fastapi missing) |
| existing suites | `python tests/run_tests.py` etc. | all green (13/13, etc.) |
| frontend build | `cd frontend && npm ci && npm run build` | build exits 0, `dist/` produced |

## Scope

**In scope**:
- `securecompile_x/web.py` (API: add files mode)
- `frontend/src/api.js` (add `analyzeMulti`)
- `frontend/src/App.jsx` (multi-file state + tab UI)
- `frontend/src/components/FindingCard.jsx` (show `file:line`)
- `frontend/src/styles.css` (file-tab styles)
- `tests/test_web_multifile.py` (create)
- `.github/workflows/ci.yml` (install requirements + run web test)
- `README.md` (note web multi-file)

**Out of scope**: the analysis engine (`cli.py` multi path already done),
`lexer/parser/semantic/ir/analysis/report`, `tests/expected.json`, the existing
test scripts.

## Steps

### Step 1 — API: accept multiple files (backward compatible)
In `securecompile_x/web.py`:
- change the import to `from .cli import compile_and_analyze, compile_and_analyze_multi`.
- add a `FileInput` model and extend `AnalyzeRequest`:
```python
class FileInput(BaseModel):
    name: str
    code: str

class AnalyzeRequest(BaseModel):
    code: str | None = None
    filename: str = "input.c"
    files: list[FileInput] | None = None
```
- branch in `analyze()`:
```python
@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if req.files:
        units = [(f.name, f.code) for f in req.files]
        findings, diagnostics = compile_and_analyze_multi(units)
        source_file = ", ".join(f.name for f in req.files)
    else:
        findings, diagnostics = compile_and_analyze(req.code or "", req.filename)
        source_file = req.filename
    return {
        "tool": "Argus",
        "source_file": source_file,
        "diagnostics": diagnostics,
        "finding_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }
```
**Verify**: `python -c "import securecompile_x.web"` → no error.

### Step 2 — Web test
Create `tests/test_web_multifile.py` (self-skips if fastapi isn't importable, so
it never breaks a stdlib-only run):
```python
"""Web API multi-file test (plan 008). Calls the endpoint function directly
(no HTTP server). Skips cleanly if fastapi/pydantic are not installed."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
try:
    from securecompile_x.web import analyze, AnalyzeRequest, FileInput
except Exception as e:  # fastapi/pydantic not installed
    print(f"SKIP: web deps unavailable ({e.__class__.__name__})"); print("OK"); sys.exit(0)

MAIN_C = 'int main(){ char cmd[128]; scanf("%s", cmd); run(cmd); return 0; }'
UTIL_C = 'void run(char* c){ system(c); }'

def main():
    checks = []
    # multi-file: cross-file taint, attributed to util.c
    resp = analyze(AnalyzeRequest(files=[FileInput(name="main.c", code=MAIN_C),
                                         FileInput(name="util.c", code=UTIL_C)]))
    uif = [f for f in resp["findings"] if f["class"] == "unsafe_input_flow"]
    checks.append(("multi: one unsafe_input_flow attributed to util.c",
                   len(uif) == 1 and uif[0]["location"]["file"] == "util.c"))
    checks.append(("multi: source_file lists both files",
                   "main.c" in resp["source_file"] and "util.c" in resp["source_file"]))
    # single-file backward compat
    resp2 = analyze(AnalyzeRequest(
        code='int main(){ char buf[16]; char input[128]; scanf("%s", input);'
             ' strcpy(buf, input); return 0; }', filename="t.c"))
    checks.append(("single: buffer_overflow still detected",
                   any(f["class"] == "buffer_overflow" for f in resp2["findings"])))
    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
```
**Verify**: `python tests/test_web_multifile.py` → `OK`.

### Step 3 — Frontend API client
In `frontend/src/api.js`, add:
```javascript
export async function analyzeMulti(files) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!r.ok) throw new Error(`analysis failed (${r.status})`);
  return r.json();
}
```
(Keep the existing `analyze` export.)

### Step 4 — React multi-file state + tab UI
In `frontend/src/App.jsx`:
- Replace the single `code` state with a files array and an active index:
```javascript
  const [files, setFiles] = useState([{ name: "main.c", code: STARTER }]);
  const [activeIdx, setActiveIdx] = useState(0);
```
- Add helpers:
```javascript
  const active = files[activeIdx];
  const setActiveCode = (code) =>
    setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, code } : f)));
  const setActiveName = (name) =>
    setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, name } : f)));
  const addFile = () => {
    setFiles((fs) => [...fs, { name: `file${fs.length + 1}.c`, code: "" }]);
    setActiveIdx(files.length);
  };
  const removeFile = (idx) => {
    if (files.length === 1) return;
    setFiles((fs) => fs.filter((_, i) => i !== idx));
    setActiveIdx((cur) => (cur >= idx && cur > 0 ? cur - 1 : cur));
  };
```
- `onLoadExample(name)`: load into the active file (set its name + code):
```javascript
      const { code } = await fetchExample(name);
      setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { name, code } : f)));
      setResult(null); setError(null);
```
- `onAnalyze()`: `setResult(await analyzeMulti(files));` (import `analyzeMulti`).
- In the editor pane, add a file-tab bar above `.pane-head`, and bind the
  textarea to the active file:
```jsx
        <section className="editor-pane">
          <div className="filebar">
            {files.map((f, i) => (
              <span key={i} className={`filetab ${i === activeIdx ? "active" : ""}`}>
                <button className="filetab-name" onClick={() => setActiveIdx(i)}>{f.name}</button>
                {files.length > 1 && (
                  <button className="filetab-x" title="remove file"
                          onClick={() => removeFile(i)}>×</button>
                )}
              </span>
            ))}
            <button className="filetab-add" onClick={addFile} title="add file">+ file</button>
          </div>
          <div className="pane-head">
            <label htmlFor="ex">Load example</label>
            <select id="ex" defaultValue="" onChange={(e) => onLoadExample(e.target.value)}>
              <option value="">— choose a seeded case —</option>
              {examples.map((x) => (
                <option key={x.name} value={x.name}>{x.category} — {x.desc}</option>
              ))}
            </select>
            <input className="filename-input" value={active.name}
                   onChange={(e) => setActiveName(e.target.value)} spellCheck={false} />
            <button className="primary" onClick={onAnalyze} disabled={busy}>
              {busy ? <><span className="spinner" />Analyzing…</> : "▶ Analyze"}
            </button>
          </div>
          <textarea className="code" spellCheck={false}
                    value={active.code}
                    onChange={(e) => setActiveCode(e.target.value)} />
        </section>
```
Remove the now-unused `code`/`setCode` state and any reference to it.
**Verify** (after Step 6 build): editor shows file tabs; adding/removing/switching
works; Analyze sends all files.

### Step 5 — Show file in findings
In `frontend/src/components/FindingCard.jsx`, change the location line to show the
file when present:
```jsx
        <code>{f.location.function}()</code> ·{" "}
        {f.location.file ? `${f.location.file}:${f.location.line}` : `line ${f.location.line}`}
```

### Step 6 — Styles + build
In `frontend/src/styles.css`, add file-tab styles using existing tokens
(place near `.pane-head`):
```css
.filebar { display: flex; align-items: center; gap: 4px; flex-wrap: wrap;
  padding: 8px 12px 0; background: var(--panel); }
.filetab { display: inline-flex; align-items: center; border: 1px solid var(--border);
  border-bottom: none; border-radius: 7px 7px 0 0; background: var(--panel-2); }
.filetab.active { background: var(--bg); border-color: var(--accent); }
.filetab-name { background: none; border: 0; color: var(--text); padding: 6px 10px;
  font-family: var(--mono); font-size: 12.5px; cursor: pointer; }
.filetab-x { background: none; border: 0; color: var(--muted); cursor: pointer;
  padding: 0 7px 0 0; font-size: 14px; }
.filetab-x:hover { color: var(--red); }
.filetab-add { background: none; border: 1px dashed var(--border); color: var(--muted);
  border-radius: 7px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
.filename-input { background: var(--panel-2); color: var(--text); border: 1px solid var(--border);
  border-radius: 7px; padding: 7px 9px; font-size: 13px; font-family: var(--mono); width: 130px; }
```
Then build:
**Verify**: `cd frontend && npm ci && npm run build` → exits 0; `frontend/dist/index.html` exists.
(If `npm ci` cannot reach the network, STOP and report — the build must be
verified for this plan.)

### Step 7 — CI runs the web test; README note
In `.github/workflows/ci.yml`, in the `python-tests` job, add a
`pip install -r requirements.txt` step after `setup-python`, and a step
`- name: Web API multi-file test` / `run: python tests/test_web_multifile.py`
after the other test steps. In `README.md`, add a line under the web-app section
that the UI supports multiple files (add-file tabs) and the API accepts
`{"files": [{"name","code"}, ...]}`.
**Verify**: `python tests/test_web_multifile.py` → `OK`;
`python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
→ `yaml ok` (or, if PyYAML missing, the file has no tabs and still parses by eye).

### Step 8 — Full regression
**Verify** all green: `python tests/run_tests.py` (13/13),
`python tests/run_phase_tests.py`, `python tests/test_parser_extras.py`,
`python tests/test_semantic_void_ptr.py`, `python tests/test_multifile.py`,
`python tests/test_web_multifile.py`.

## Test plan

- New `tests/test_web_multifile.py` (Step 2): multi-file via the endpoint
  (cross-file attribution + source_file listing) and single-file backward compat;
  self-skips without fastapi.
- Frontend: verified by a successful `npm run build`; the reviewer will visually
  confirm the tab UI in a browser.
- Regression: all existing suites stay green (Step 8).

## Done criteria

ALL must hold:
- [ ] `python -c "import securecompile_x.web"` → no error
- [ ] `python tests/test_web_multifile.py` → `OK`
- [ ] `cd frontend && npm run build` → exits 0, `dist/` produced
- [ ] All five existing suites still green (`run_tests` 13/13, phase, parser-extras, semantic-void-ptr, multifile)
- [ ] `.github/workflows/ci.yml` installs requirements and runs the web test; YAML valid
- [ ] single-file API (`{code, filename}`) still returns findings
- [ ] Only the in-scope files changed

## STOP conditions

Stop and report (do not improvise) if:
- Any "Current state" excerpt does not match live code (drift).
- `npm ci` / `npm run build` fails for a reason other than a transient network
  error (report the error; do not hand-edit lockfiles or bump dependencies).
- `str | None` / `list[FileInput] | None` type hints raise on this Python (they
  require 3.10+; the repo targets 3.13 — if it errors, report rather than
  rewriting the models).
- The single-file API path stops returning findings — backward compat broke;
  report.

## Maintenance notes

- The analysis engine already handles multi-file; this plan is web-layer only.
- Reviewer: open the built app, add a second file, load an example into each,
  Analyze, and confirm findings show `file:line` and cross-file flow. Confirm the
  idle onboarding panel and motion still work, and that removing the last file is
  prevented.
- Future: per-file inline markers in the editor (map findings back to the file
  tab) — explicitly out of scope here.
