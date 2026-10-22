"""Plain-English rewrites of compiler diagnostics.

Turns raw messages like ``expected SEMI, got '}'`` into a title, a one-line
explanation, a fix hint and the offending source line. Deterministic - no AI.
For a missing token the reported position is the *next* token, so the fix
location is moved back to just after the previous token (where the user must
actually type the character).
"""

import difflib
import re

from .lexer import KEYWORDS
from .rules import LIBRARY_MODELS

_LOC = re.compile(
    r"^(?:(?P<file>[^:\n]+?):\s*)?(?P<line>\d+):(?P<col>\d+):\s*(?P<msg>.*)$", re.S)

_TOK = {"SEMI": ";", "LPAREN": "(", "RPAREN": ")", "LBRACE": "{", "RBRACE": "}",
        "LBRACK": "[", "RBRACK": "]", "COMMA": ","}


def _strip(src):
    """Remove comments and string/char contents so braces can be counted."""
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    src = re.sub(r"//[^\n]*", "", src)
    return re.sub(r'"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])*\'', '""', src)


def _insert_point(lines, line, col):
    """(line, col) just after the last non-blank char before (line, col)."""
    off = sum(len(l) + 1 for l in lines[:line - 1]) + col - 1
    text = "\n".join(lines)
    i = min(off, len(text)) - 1
    while i >= 0 and text[i].isspace():
        i -= 1
    if i < 0:
        return line, col, None
    before = text[:i + 1]
    return before.count("\n") + 1, len(before) - before.rfind("\n"), text[i]


def _suggest(name, pool):
    m = difflib.get_close_matches(name, [w for w in pool if w != name], n=1, cutoff=0.72)
    return m[0] if m else None


def explain(phase, raw, sources, default=None):
    """One diagnostic -> dict(title, message, hint, line, col, snippet, raw...)."""
    m = _LOC.match(raw or "")
    out = {"phase": phase, "raw": raw, "file": None, "line": None, "col": None,
           "title": "Compiler error", "message": raw, "hint": None, "snippet": None}
    if not m:
        return out
    fname = m.group("file") or default
    line, col, msg = int(m.group("line")), int(m.group("col")), m.group("msg").strip()
    src = sources.get(fname) or sources.get(default) or ""
    lines = src.split("\n")
    out.update(file=fname, line=line, col=col)
    words = {w for w in re.findall(r"[A-Za-z_]\w*", src) if w not in KEYWORDS}

    e = re.match(r"expected (\w+), got (.*)$", msg)
    if e:
        want, got = e.group(1), e.group(2).strip()
        eof = got == "None"
        gtxt = "the end of the file" if eof else f"`{got.strip(chr(39))}`"
        sym = _TOK.get(want)
        if want == "SEMI":
            il, ic, prev = _insert_point(lines, line, col)
            out.update(title="Missing semicolon", line=il, col=ic,
                       message=f"A `;` is missing at the end of line {il}.",
                       hint="Statements in C end with `;`. Add it right after the last "
                            "token on that line.")
        elif want in ("RPAREN", "LPAREN", "RBRACK", "LBRACK"):
            name = {"RPAREN": "closing parenthesis `)`", "LPAREN": "opening parenthesis `(`",
                    "RBRACK": "closing bracket `]`", "LBRACK": "opening bracket `[`"}[want]
            out.update(title=f"Missing {name.split(' `')[0]}",
                       message=f"Expected {'an' if name.startswith('opening') else 'a'} "
                               f"{name} but found {gtxt}.",
                       hint="`if`, `while`, `for` and function definitions need `( )`; "
                            "check every opening bracket has a matching closing one.")
        elif want in ("LBRACE", "RBRACE"):
            depth = _strip(src).count("{") - _strip(src).count("}")
            extra = (f" The file has {abs(depth)} unmatched "
                     f"`{'{' if depth > 0 else '}'}`.") if depth else ""
            out.update(title="Missing brace" if not eof else "Unexpected end of file",
                       message=f"Expected `{sym}` but found {gtxt}.{extra}",
                       hint="Every `{` needs a matching `}`. Check the end of the "
                            "previous function or block.")
        elif want == "ID":
            out.update(title="Name expected",
                       message=f"A variable or function name was expected but {gtxt} was found.",
                       hint="Names start with a letter or `_` and cannot be keywords.")
        else:
            out.update(title="Unexpected token",
                       message=f"Expected {sym or want} but found {gtxt}.",
                       hint="Check the line (and the one above it) for a typo or missing symbol.")
    elif msg.startswith("unexpected token"):
        tok = msg.split("token", 1)[1].strip()
        out.update(title="Unexpected symbol",
                   message=f"{tok} cannot appear here.",
                   hint="Look for two operators in a row, a stray `)` or a missing operand.")
    elif "requires an lvalue" in msg:
        out.update(title="`++` / `--` needs a variable",
                   message=msg, hint="Apply `++`/`--` to a variable or array element, e.g. `i++`.")
    elif msg.startswith("unexpected character"):
        ch = re.search(r"'(.*)'", msg)
        ch = ch.group(1) if ch else "?"
        if ch == "#":
            out.update(title="Preprocessor lines are not supported",
                       message="`#include` / `#define` lines are not part of the supported C subset.",
                       hint="Delete them. Standard functions (printf, malloc, strcpy...) are built in.")
        else:
            out.update(title="Unsupported character",
                       message=f"The character `{ch}` is not part of the supported C subset.",
                       hint="Remove or replace it.")
    elif "unterminated string" in msg:
        out.update(title="String is not closed", message="A string literal is missing its closing `\"`.",
                   hint="Add the closing quote on the same line.")
    elif "unterminated char" in msg:
        out.update(title="Character literal is not closed", message="A char literal is missing its closing `'`.",
                   hint="Add the closing quote.")
    elif msg.startswith("use of undeclared identifier"):
        name = re.search(r"'(.*)'", msg).group(1)
        near = _suggest(name, words)
        out.update(title=f"`{name}` is not declared",
                   message=f"`{name}` is used but never declared.",
                   hint=(f"Did you mean `{near}`? " if near else "")
                        + f"Otherwise declare it first, e.g. `int {name};`.")
    elif msg.startswith("call to unknown function"):
        name = re.search(r"'(.*)'", msg).group(1)
        near = _suggest(name, words | set(LIBRARY_MODELS))
        out.update(title=f"Function `{name}` is not defined",
                   message=f"`{name}()` is called but no such function exists.",
                   hint=(f"Did you mean `{near}`? " if near else "")
                        + "Define it, or use one of the built-in standard functions.")
    elif msg.startswith("type mismatch"):
        out.update(title="Type mismatch", message=msg[0].upper() + msg[1:] + ".",
                   hint="Make both sides the same type (or use the matching pointer/array form).")
    elif msg.startswith("redefinition of function"):
        name = re.search(r"'(.*?)'", msg).group(1)
        out.update(title=f"Function `{name}` is defined twice",
                   message=msg, hint="Keep one definition and remove or rename the other.")

    ln = out["line"]
    if ln and 1 <= ln <= len(lines):
        out["snippet"] = {"line": ln, "text": lines[ln - 1][:120], "col": out["col"]}
    return out


def explain_all(diagnostics, sources, default=None):
    """Friendly list for a {phase: [raw, ...]} dict, keeping (phase, index)."""
    res = []
    for phase, errs in (diagnostics or {}).items():
        for i, raw in enumerate(errs or []):
            d = explain(phase, raw, sources, default)
            d["index"] = i
            res.append(d)
    return res
