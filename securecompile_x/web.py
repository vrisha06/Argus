"""Web layer for Argus: a FastAPI service wrapping the compiler
pipeline, plus a static single-page frontend.

Run:
    python -m securecompile_x.web            # serves http://127.0.0.1:8000
    uvicorn securecompile_x.web:app --reload # dev mode

The API reuses the exact same `compile_and_analyze` core as the CLI, so the
web and command-line paths always produce identical findings.
"""

import os

from fastapi import FastAPI
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import ai, history, inspect_pipeline, pov
from .cli import compile_and_analyze, compile_and_analyze_multi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
DIST = os.path.join(FRONTEND, "dist")       # Vite production build
TESTS = os.path.join(ROOT, "tests")

app = FastAPI(title="Argus", version="1.0.0",
              description="Compiler-based C vulnerability detection and "
                          "root-cause analysis.")


class FileInput(BaseModel):
    name: str
    code: str


class AnalyzeRequest(BaseModel):
    code: str | None = None
    filename: str = "input.c"
    files: list[FileInput] | None = None
    record: bool = False          # persist this run to the analytics history
    user: str | None = None       # per-browser id for self-analytics


class AiReviewRequest(BaseModel):
    code: str | None = None
    filename: str = "input.c"
    files: list[FileInput] | None = None


# Curated example set (maps to the seeded test suite).
EXAMPLES = [
    ("bof_strcpy.c", "Buffer Overflow", "tainted input copied via strcpy (interprocedural)"),
    ("bof_gets.c", "Buffer Overflow", "unbounded gets()"),
    ("bof_index.c", "Buffer Overflow", "tainted array index, no bounds check"),
    ("uaf_use.c", "Use-After-Free", "pointer dereferenced after free"),
    ("uaf_double.c", "Use-After-Free", "double free"),
    ("null_unchecked.c", "Null-Pointer", "malloc result dereferenced unchecked"),
    ("null_checked.c", "Safe control", "malloc result checked before use"),
    ("null_earlyreturn.c", "Safe control", "early-return null guard"),
    ("uif_direct.c", "Unsafe Input Flow", "scanf value reaches system()"),
    ("uif_interproc.c", "Unsafe Input Flow", "tainted value reaches system() via helper"),
    ("uaf_safe.c", "Safe control", "freed pointer reassigned before use"),
    ("bof_safe.c", "Safe control", "bounded strncpy copy"),
    ("control_safe.c", "Safe control", "clean program"),
]


@app.get("/api/examples")
def list_examples():
    return [{"name": n, "category": c, "desc": d} for n, c, d in EXAMPLES]


@app.get("/api/examples/{name}")
def get_example(name: str):
    if name not in {n for n, _, _ in EXAMPLES}:
        return JSONResponse({"error": "unknown example"}, status_code=404)
    path = os.path.join(TESTS, name)
    if not os.path.isfile(path):
        return JSONResponse({"error": "file missing"}, status_code=404)
    with open(path, encoding="utf-8") as fh:
        return {"name": name, "code": fh.read()}


@app.post("/api/analyze")
def analyze(req: AnalyzeRequest):
    if req.files:
        units = [(f.name, f.code) for f in req.files]
        findings, diagnostics = compile_and_analyze_multi(units)
        source_file = ", ".join(f.name for f in req.files)
    else:
        findings, diagnostics = compile_and_analyze(req.code or "", req.filename)
        source_file = req.filename

    if req.record:
        # Never let a history failure break the analysis response.
        try:
            code = _combined_source(req.files) if req.files else (req.code or "")
            loc = code.count("\n") + 1 if code else 0
            history.record_run(req.user, source_file, loc,
                               [f.to_dict() for f in findings], diagnostics)
        except Exception:  # pragma: no cover - analytics is best-effort
            pass

    return {
        "tool": "Argus",
        "source_file": source_file,
        "diagnostics": diagnostics,
        "finding_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }


@app.get("/api/history")
def get_history(user: str = "local"):
    return history.get_stats(user)


@app.delete("/api/history")
def clear_history(user: str = "local"):
    history.clear(user)
    return {"ok": True}


def _combined_source(files):
    """Join multiple units into one annotated blob for the AI prompt, so the
    model sees file boundaries and can reference lines meaningfully."""
    return "\n\n".join(f"/* ==== {f.name} ==== */\n{f.code}" for f in files)


@app.post("/api/ai-review")
def ai_review(req: AiReviewRequest):
    """Run the compiler engine, then ask Gemini (free tier) for plain-English
    suggestions that complement the structured findings. Degrades gracefully
    when no API key is configured (returns available=false)."""
    if req.files:
        units = [(f.name, f.code) for f in req.files]
        findings, _ = compile_and_analyze_multi(units)
        source_file = ", ".join(f.name for f in req.files)
        code = _combined_source(req.files)
    else:
        findings, _ = compile_and_analyze(req.code or "", req.filename)
        source_file = req.filename
        code = req.code or ""

    result = ai.review(code, [f.to_dict() for f in findings], source_file)
    result["source_file"] = source_file
    result["finding_count"] = len(findings)
    return result


class AiFixRequest(BaseModel):
    code: str = ""
    filename: str = "input.c"


def _issue_count(findings, diagnostics):
    return len(findings) + sum(len(v or []) for v in diagnostics.values())


@app.post("/api/ai-fix")
def ai_fix(req: AiFixRequest):
    """Return a fully corrected version of the code (robust "apply all fixes").
    Asks Gemini to rewrite the whole file, then VERIFIES the result with the
    engine and does one more pass feeding back any remaining errors — so the
    output converges to zero findings/diagnostics within this C subset."""
    name = req.filename
    findings, _ = compile_and_analyze(req.code or "", name)
    result = ai.fix_code(req.code or "", [f.to_dict() for f in findings], name)
    if result.get("error") or not result.get("code"):
        return result

    # Verify + one corrective pass if the engine still reports problems.
    for _ in range(2):
        f2, d2 = compile_and_analyze(result["code"], name)
        if _issue_count(f2, d2) == 0:
            break
        remaining = [m for errs in d2.values() for m in errs]
        retry = ai.fix_code(result["code"], [f.to_dict() for f in f2], name,
                            remaining=remaining)
        if retry.get("error") or not retry.get("code"):
            break   # keep the best result we have
        result = retry
    return result


class PovRequest(BaseModel):
    code: str = ""
    filename: str = "input.c"


@app.post("/api/pov")
def pov_endpoint(req: PovRequest):
    """Proof-of-Vulnerability: synthesise a concrete triggering input / trace for
    each finding, and mark unreachable ones as unconfirmed."""
    return pov.generate_pov(req.code or "", req.filename)


class InspectRequest(BaseModel):
    code: str = ""
    filename: str = "input.c"


@app.post("/api/inspect")
def inspect_endpoint(req: InspectRequest):
    """Glass-box view: serialise every compiler stage for the given source."""
    return inspect_pipeline.inspect_source(req.code or "", req.filename)


@app.get("/api/ai-status")
def ai_status():
    """Lets the frontend show whether the AI assist is configured."""
    return {"available": ai.is_available(), "model": ai.model_name()}


# Serve the built React app (frontend/dist). API routes above take precedence
# because they are registered before this catch-all static mount.
if os.path.isdir(DIST):
    app.mount("/", StaticFiles(directory=DIST, html=True), name="spa")
else:
    @app.get("/")
    def _no_build():
        return PlainTextResponse(
            "Frontend not built. Run:  cd frontend && npm install && npm run build",
            status_code=503)


def main():
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)


if __name__ == "__main__":
    main()
