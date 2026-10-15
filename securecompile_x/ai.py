"""Optional AI assist layer for Argus.

This module adds *plain-English* security suggestions on top of the compiler
engine's own findings, using Google's Gemini API (free tier). It is deliberately
**stdlib-only** (urllib + json) so the core project keeps its zero-dependency
character: no `google-generativeai` package is required.

Design:
- The compiler engine (lexer -> ... -> security analysis) remains the source of
  truth for *detection*. Gemini is used only to *explain* and *suggest fixes* in
  natural language, complementing the structured findings.
- If no API key is configured, every entry point degrades gracefully: the caller
  still gets a well-formed response saying the assist is unavailable, and live
  engine detection keeps working.

Configuration (environment variables):
    GEMINI_API_KEY   (or GOOGLE_API_KEY)   - the free key from aistudio.google.com
    GEMINI_MODEL                           - default "gemini-3.8-flash"
    GEMINI_FALLBACK_MODELS                 - comma-separated models tried if the
                                             primary is overloaded/unavailable
"""

import json
import os
import time
import urllib.error
import urllib.request

def _load_dotenv():
    """Load KEY=VALUE pairs from a project-root `.env` into os.environ, without
    overriding variables already set in the real environment. Dependency-free
    (no python-dotenv) to keep the project stdlib-only. Called once at import."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, ".env")
    if not os.path.isfile(path):
        return
    try:
        with open(path, encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                if line.lower().startswith("export "):
                    line = line[7:].lstrip()
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = val
    except OSError:
        pass


_load_dotenv()


_ENDPOINT = ("https://generativelanguage.googleapis.com/v1beta/models/"
             "{model}:generateContent")

_DEFAULT_MODEL = "gemini-3.8-flash"

# When the primary model is overloaded (503) or missing (404), fall through to
# these in order. Lite models are built for speed and tend to stay available.
# Override with GEMINI_FALLBACK_MODELS=a,b,c (empty string disables fallback).
_DEFAULT_FALLBACKS = "gemini-flash-lite-latest,gemini-flash-latest"

# Transient server-side statuses worth retrying with backoff.
_RETRY_STATUS = {429, 500, 503}
_MAX_ATTEMPTS = 3        # attempts per model before moving on
_BACKOFF = 0.6           # seconds; doubled each retry (0.6s, 1.2s)

# Keep suggestions bounded so a noisy model cannot flood the UI.
_MAX_SUGGESTIONS = 8

# Response schema: forces Gemini to return structured JSON we can render
# directly, instead of prose we would have to parse heuristically.
_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "line": {"type": "integer"},
                    "severity": {"type": "string",
                                 "enum": ["low", "medium", "high"]},
                    "phase": {"type": "string",
                              "enum": ["Lexer", "Parser", "Semantic", "IR",
                                       "Security", "General"]},
                    "title": {"type": "string"},
                    "message": {"type": "string"},
                    "fix": {"type": "string"},
                },
                "required": ["severity", "title", "message"],
            },
        }
    },
    "required": ["suggestions"],
}


def api_key():
    """Return the configured key, or None. Accepts either common name."""
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def model_name():
    return os.environ.get("GEMINI_MODEL", _DEFAULT_MODEL)


def _models():
    """Ordered, de-duplicated list of models to try: primary first, then any
    configured fallbacks (used only when the primary fails)."""
    primary = model_name()
    extra = os.environ.get("GEMINI_FALLBACK_MODELS", _DEFAULT_FALLBACKS)
    out, seen = [], set()
    for m in [primary] + [x.strip() for x in extra.split(",")]:
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


def is_available():
    return bool(api_key())


def _build_prompt(code, findings, source_file):
    """Compose the review prompt. The engine's findings are handed to the model
    so it complements (rather than re-derives) the structured detection."""
    findings_json = json.dumps(findings, indent=2) if findings else "[]"
    return f"""You are a senior secure-C code reviewer embedded in a live editor.
The developer is typing C code right now. A compiler-based security engine has
already run and produced structured findings. Your job is to give short,
actionable, plain-English suggestions about issues that *may cause problems
later*, so the developer can improve the code at this moment.

Rules:
- Focus on real risks: memory safety (buffer overflow, use-after-free, double
  free, null-pointer dereference), untrusted-input flow to dangerous sinks
  (system/exec/popen), unchecked return values, and unsafe standard-library use
  (gets, strcpy, scanf("%s"), sprintf, etc.).
- COMPLEMENT the engine findings below; add insight or clearer explanations,
  and you may add issues the engine missed. Do not just restate them verbatim.
- Be concrete. Each `fix` should be a specific code-level change (a safer
  function, a bounds/NULL check, a size argument), not generic advice.
- `line` is the 1-based line number in the source the suggestion refers to.
- `phase` is the compiler phase that would FIRST reveal this issue — choose the
  earliest that applies:
    Lexer    (bad tokens / characters),
    Parser   (syntax / grammar errors),
    Semantic (types, declarations, scope, undeclared names),
    IR       (control-/data-flow construction issues),
    Security (taint or memory-safety problems found by flow analysis),
    General  (anything else, e.g. style or portability).
- If the code looks safe, return an empty suggestions array. Do NOT invent
  problems. Return at most {_MAX_SUGGESTIONS} suggestions, most important first.
- Keep each `message` to 1-2 sentences.

Source file: {source_file}

--- ENGINE FINDINGS (JSON) ---
{findings_json}

--- CODE ---
{code}
"""


def _extract_text(payload):
    """Pull the model's text out of a Gemini generateContent response."""
    candidates = payload.get("candidates") or []
    if not candidates:
        return None
    parts = (candidates[0].get("content") or {}).get("parts") or []
    for part in parts:
        if "text" in part:
            return part["text"]
    return None


def _call_once(model, key, body, timeout):
    """One HTTP call. Returns (payload|None, status|None, detail|None)."""
    url = _ENDPOINT.format(model=model)
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8")), None, None
    except urllib.error.HTTPError as e:
        return None, e.code, e.read().decode("utf-8", "replace")[:300]
    except urllib.error.URLError as e:
        return None, None, f"network error: {e.reason}"
    except (TimeoutError, OSError) as e:
        return None, None, f"request failed: {e}"


def _run(prompt, gen_base, timeout):
    """Generate text from `prompt`, resiliently. Returns (text|None, error, model).

    Handles the free-tier failure modes shared by all calls: transient overload
    (503/429) retried with backoff, a retired/unknown model (404) falling through
    to the configured fallbacks, and models that reject thinkingConfig (generic
    400) retried once without it. Disabling "thinking" cuts latency."""
    key = api_key()
    if not key:
        return None, None, model_name()
    last_status, last_detail = None, None
    for model in _models():
        include_thinking = True
        attempt = 0
        while attempt < _MAX_ATTEMPTS:
            gen = dict(gen_base)
            if include_thinking:
                gen["thinkingConfig"] = {"thinkingBudget": 0}
            body = {"contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": gen}
            payload, status, detail = _call_once(model, key, body, timeout)
            if payload is not None:
                return _extract_text(payload), None, model
            last_status, last_detail = status, detail
            if status == 400 and include_thinking:
                include_thinking = False
                continue
            if status in _RETRY_STATUS:
                time.sleep(_BACKOFF * (2 ** attempt))
                attempt += 1
                continue
            break  # 404 / other 4xx: try next model
    return None, _friendly_error(last_status, last_detail), model_name()


def _friendly_error(status, detail):
    if status == 429:
        return ("Gemini free-tier quota reached (requests per minute/day). Wait "
                "a minute and try again, or check your limits at "
                "ai.google.dev/gemini-api/docs/rate-limits.")
    if status == 503:
        return ("Gemini is busy right now (high demand). The server retried "
                "automatically — please try again in a moment.")
    if status == 404:
        return ("No available Gemini model responded. Set GEMINI_MODEL in .env "
                "to a current model (e.g. gemini-3.8-flash).")
    if status is not None:
        return f"Gemini HTTP {status}: {detail}"
    return f"Could not reach Gemini: {detail}"


def review(code, findings, source_file="input.c", timeout=20):
    """Ask Gemini for suggestions on `code`. Always returns a well-formed dict:
    {available, model, suggestions:[...], error: str|None}."""
    key = api_key()
    base = {"available": bool(key), "model": model_name(), "suggestions": [],
            "error": None}
    if not key or not (code or "").strip():
        return base

    gen = {"responseMimeType": "application/json", "responseSchema": _RESPONSE_SCHEMA,
           "temperature": 0.2, "maxOutputTokens": 1024}
    text, error, model = _run(_build_prompt(code, findings, source_file), gen, timeout)
    base["model"] = model
    if error:
        base["error"] = error
        return base
    if not text:
        base["error"] = "Gemini returned no content."
        return base
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        base["error"] = "Gemini returned non-JSON content."
        return base
    base["suggestions"] = _sanitize(
        parsed.get("suggestions", []) if isinstance(parsed, dict) else [])
    return base


def _strip_fences(text):
    """Remove a leading ```lang fence and trailing ``` if the model added them."""
    t = (text or "").strip()
    if t.startswith("```"):
        lines = t.split("\n")
        lines = lines[1:]                      # drop opening ``` / ```c
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]                 # drop closing ```
        t = "\n".join(lines)
    return t


def fix_code(code, findings, source_file="input.c", remaining=None, timeout=30):
    """Ask Gemini to rewrite the whole program with every issue fixed, returning
    the complete corrected source. Robust "apply all": no per-line stitching.
    `remaining` is an optional list of compiler errors from a prior attempt to
    eliminate on this pass. Returns {available, model, code, error}."""
    key = api_key()
    base = {"available": bool(key), "model": model_name(), "code": None, "error": None}
    if not key:
        return base
    if not (code or "").strip():
        base["code"] = code
        return base

    findings_json = json.dumps(findings, indent=2) if findings else "[]"
    remaining_block = ""
    if remaining:
        remaining_block = ("\n--- A PREVIOUS FIX STILL PRODUCED THESE ERRORS; "
                           "ELIMINATE THEM ---\n" + "\n".join(remaining) + "\n")
    prompt = f"""You are a secure-C auto-fixer. Rewrite the C program below so that
EVERY issue is fixed and the program is correct, safe, and compilable.

Fix: the engine findings listed; memory-safety problems (buffer overflow,
use-after-free, double free, null deref); untrusted input reaching dangerous
sinks; and plain syntax/semantic errors (missing semicolons, parentheses,
braces, undeclared names, missing includes/return types).

Hard rules for your output:
- Output ONLY the corrected C source code for the SAME program.
- NO markdown, NO ``` fences, NO comments explaining the changes, NO prose.
- Preserve the program's original intent and structure; make the minimal changes
  needed to make it correct and safe (e.g. strcpy -> snprintf with sizeof,
  scanf("%s") -> width-limited "%Ns", add NULL checks after malloc, set freed
  pointers to NULL, add missing semicolons/parentheses/braces/return types).
- CRITICAL — stay strictly inside this analyzer's supported C subset:
  * Do NOT use the preprocessor: NO #include and NO #define lines at all.
  * Use only int, char, void, pointers, and fixed-size arrays. No long/float/
    double, no struct/union/enum, no typedef, no function pointers, no static.
  * Allowed statements: declarations, assignment, if/else, while, for, return,
    expressions, and calls to standard functions (scanf, printf, snprintf,
    strncpy, strcpy, memcpy, malloc, free, system, ...) WITHOUT any headers —
    the analyzer models these directly, so headers are unnecessary and will be
    treated as errors.
  * Call standard functions by their PLAIN names (strncpy, snprintf, memcpy, ...)
    — never compiler builtins like __builtin_strncpy.
- The result must re-analyze with ZERO errors and ZERO vulnerabilities.
{remaining_block}
--- ENGINE FINDINGS (JSON) ---
{findings_json}

--- CODE ({source_file}) ---
{code}
"""
    gen = {"responseMimeType": "text/plain", "temperature": 0.1,
           "maxOutputTokens": 4096}
    text, error, model = _run(prompt, gen, timeout)
    base["model"] = model
    if error:
        base["error"] = error
        return base
    fixed = _strip_fences(text)
    if not fixed.strip():
        base["error"] = "Gemini returned no corrected code."
        return base
    base["code"] = fixed if fixed.endswith("\n") else fixed + "\n"
    return base


def _sanitize(suggestions):
    """Clamp/normalise model output so the frontend can trust it."""
    clean = []
    for s in suggestions[:_MAX_SUGGESTIONS]:
        if not isinstance(s, dict):
            continue
        sev = str(s.get("severity", "medium")).lower()
        if sev not in ("low", "medium", "high"):
            sev = "medium"
        ph = str(s.get("phase", "General")).strip().lower()
        phase = {"lexer": "Lexer", "parser": "Parser", "semantic": "Semantic",
                 "ir": "IR", "security": "Security"}.get(ph, "General")
        item = {
            "severity": sev,
            "phase": phase,
            "title": str(s.get("title", "Suggestion"))[:140],
            "message": str(s.get("message", ""))[:600],
        }
        line = s.get("line")
        if isinstance(line, int) and line > 0:
            item["line"] = line
        fix = s.get("fix")
        if fix:
            item["fix"] = str(fix)[:600]
        clean.append(item)
    return clean
