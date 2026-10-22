"""Root-cause grouping and fix-first prioritisation.

Several findings often share one underlying cause: a single untrusted ``scanf``
feeding both a ``strcpy`` and a ``system`` call, or one ``free(p)`` followed by
two uses. This module groups findings by that shared origin (taken from each
finding's data-flow path) and ranks the groups, so the user fixes the cause
once, in priority order, instead of triaging a flat list. Deterministic.
"""

import re

from . import ast_nodes as A
from .lexer import tokenize
from .parser import parse
from .rules import TAINT_SOURCES

_TAINT = re.compile(r"^(?:[\w.\-]+:)?(?P<fn>\w+)\(\) \[(?P<br>[^\]]+)\] -> ")
_FREE = re.compile(r"^(?P<fn>\w+)\(\): free\((?P<v>\w+)\) @L(?P<l>\d+)")
_ALLOC = re.compile(r"^(?P<fn>\w+)\(\): (?P<v>\w+) @L(?P<l>\d+) \((?P<why>.*)\) -> deref")
_VIA = re.compile(r"untrusted input via (\w+)\(\)")


def _walk(n):
    if isinstance(n, A.Node):
        yield n
        for v in vars(n).values():
            yield from _walk(v)
    elif isinstance(n, (list, tuple)):
        for x in n:
            yield from _walk(x)


def _functions(sources):
    """name -> (file, Function) across all translation units."""
    out = {}
    for fname, code in sources.items():
        prog, _ = parse(tokenize(code)[0])
        for fn in prog.functions:
            out.setdefault(fn.name, (fname, fn))
    return out


def _source_line(funcs, fn, src):
    if fn not in funcs:
        return None
    calls = [c for c in _walk(funcs[fn][1]) if isinstance(c, A.Call) and c.name == src]
    return min((c.line for c in calls), default=None)


def _key(f, i, funcs):
    """(key, kind, label, line, function) describing a finding's shared origin."""
    flow = f.get("data_flow_path", "")
    m = _TAINT.match(flow)
    if m:
        fn, br = m.group("fn"), m.group("br")
        via = _VIA.search(br)
        if via and via.group(1) in TAINT_SOURCES:
            ln = _source_line(funcs, fn, via.group(1))
            lab = f"Untrusted input from {via.group(1)}() in {fn}()"
            return ("in", fn, via.group(1)), "input", lab, ln, fn
        return ("in", fn, br), "input", f"Tainted data entering {fn}()", None, fn
    m = _FREE.match(flow)
    if m:
        v, ln = m.group("v"), int(m.group("l"))
        return ("free", m.group("fn"), v, ln), "free", f"`{v}` freed at line {ln}", ln, m.group("fn")
    m = _ALLOC.match(flow)
    if m:
        v, ln = m.group("v"), int(m.group("l"))
        return (("alloc", m.group("fn"), v, ln), "alloc",
                f"`{v}` may be NULL (line {ln})", ln, m.group("fn"))
    loc = f.get("location", {})
    return ("one", i), "single", f"{f['vulnerability_type']} at line {loc.get('line')}", \
        loc.get("line"), loc.get("function")


def _advice(kind, label, line, n, top):
    where = f" (line {line})" if line else ""
    if kind == "input":
        return (f"One untrusted source feeds {n} findings" if n > 1
                else "Untrusted input reaches a dangerous operation",
                f"Validate or bound this input where it is read{where}. If a sink still "
                f"misuses it, fix that sink too: {top['suggested_fix']}")
    if kind == "free":
        return (f"One free() is followed by {n} unsafe uses" if n > 1
                else "Memory is used after it was freed",
                "After freeing, set the pointer to NULL and never use it again; free each "
                "allocation exactly once.")
    if kind == "alloc":
        return ("An unchecked allocation is dereferenced",
                "Check the pointer against NULL immediately after the allocation.")
    return (top["vulnerability_type"], top["suggested_fix"])


def group_findings(findings, sources):
    """findings: list of Finding.to_dict(); sources: {filename: code}.
    Returns groups sorted fix-first; ``finding_indexes`` index into ``findings``."""
    funcs = _functions(sources)
    buckets, order = {}, []
    for i, f in enumerate(findings):
        key, kind, label, line, fn = _key(f, i, funcs)
        if key not in buckets:
            buckets[key] = {"kind": kind, "label": label, "line": line,
                            "function": fn, "finding_indexes": []}
            order.append(key)
        buckets[key]["finding_indexes"].append(i)

    groups = []
    for key in order:
        g = buckets[key]
        fs = [findings[i] for i in g["finding_indexes"]]
        top = max(fs, key=lambda x: x["risk_score"])
        g["count"] = len(fs)
        g["max_risk"] = top["risk_score"]
        g["classes"] = sorted({x["vulnerability_type"] for x in fs})
        g["headline"], g["advice"] = _advice(g["kind"], g["label"], g["line"], g["count"], top)
        groups.append(g)

    groups.sort(key=lambda g: (-g["max_risk"], -g["count"], g["finding_indexes"][0]))
    for rank, g in enumerate(groups, 1):
        g["rank"] = rank
        g["id"] = f"group-{rank}"
    return groups
