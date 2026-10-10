"""Web layer for SecureCompile-X: a FastAPI service wrapping the compiler
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

from .cli import compile_and_analyze

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND = os.path.join(ROOT, "frontend")
DIST = os.path.join(FRONTEND, "dist")       # Vite production build
TESTS = os.path.join(ROOT, "tests")

app = FastAPI(title="SecureCompile-X", version="1.0.0",
              description="Compiler-based C vulnerability detection and "
                          "root-cause analysis.")


class AnalyzeRequest(BaseModel):
    code: str
    filename: str = "input.c"


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
    findings, diagnostics = compile_and_analyze(req.code, req.filename)
    return {
        "tool": "SecureCompile-X",
        "source_file": req.filename,
        "diagnostics": diagnostics,
        "finding_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }


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
