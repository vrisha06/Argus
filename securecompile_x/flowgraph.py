"""Structured source-to-sink graphs for findings.

Each finding already carries a human-readable ``data_flow_path`` such as
``main() [untrusted input via scanf()] -> copy_name(input) -> strcpy(...) @L4``.
This module parses that same string into nodes and edges and resolves source
locations (file/line) from the AST, so the UI can draw the flow and link every
node to code. Nothing is invented: a node exists only because the report names
it, and ``line`` is ``None`` when it cannot be resolved.
"""

import re

from . import ast_nodes as A
from .grouping import _functions, _walk
from .rules import TAINT_SOURCES

_F = r"(?:(?P<file>[\w.\-]+):)?"
_SRC = re.compile(rf"^{_F}(?P<fn>\w+)\(\) \[(?P<br>[^\]]+)\]$")
_CALL = re.compile(rf"^{_F}(?P<fn>\w+)\((?P<args>[^)]*)\)$")
_SINK = re.compile(r"^(?P<name>\w+)\(\.\.\.\) @L(?P<line>\d+)$")
_FREE = re.compile(r"^(?P<fn>\w+)\(\): free\((?P<v>\w+)\) @L(?P<l>\d+)$")
_END = re.compile(r"^(?P<what>use|free\(\w+\)|deref) @L(?P<l>\d+)$")
_ALLOC = re.compile(r"^(?P<fn>\w+)\(\): (?P<v>\w+) @L(?P<l>\d+) \((?P<why>.*)\)$")
_VIA = re.compile(r"untrusted input via (\w+)\(\)")


def _call_line(funcs, caller, callee):
    """First line in ``caller`` where ``callee`` is called, else None."""
    if caller not in funcs:
        return None
    lines = [c.line for c in _walk(funcs[caller][1])
             if isinstance(c, A.Call) and c.name == callee]
    return min(lines, default=None)


def _file_of(funcs, fn, hint=None):
    return hint or (funcs[fn][0] if fn in funcs else None)


def _graph(f, funcs):
    flow = f.get("data_flow_path", "")
    loc = f.get("location", {})
    segs = flow.split(" -> ")
    nodes, edges = [], []

    def add(kind, label, fn=None, file=None, line=None, detail=None):
        nodes.append({"id": f"n{len(nodes)}", "kind": kind, "label": label,
                      "function": fn, "file": file, "line": line, "detail": detail})
        if len(nodes) > 1:
            edges.append({"from": nodes[-2]["id"], "to": nodes[-1]["id"]})

    prev_fn = None
    for i, seg in enumerate(segs):
        m = _SRC.match(seg)
        if m and i == 0:
            fn, br = m.group("fn"), m.group("br")
            via = _VIA.search(br)
            fname = _file_of(funcs, fn, m.group("file"))
            if via and via.group(1) in TAINT_SOURCES:
                src = via.group(1)
                add("source", f"{src}()", fn, fname, _call_line(funcs, fn, src),
                    "Untrusted input enters the program")
            else:
                add("source", f"{fn}()", fn, fname, None, br[0].upper() + br[1:])
            prev_fn = fn
            continue
        m = _FREE.match(seg)
        if m and i == 0:
            add("source", f"free({m.group('v')})", m.group("fn"),
                _file_of(funcs, m.group("fn")), int(m.group("l")),
                "Memory is released here")
            prev_fn = m.group("fn")
            continue
        m = _ALLOC.match(seg)
        if m and i == 0:
            add("source", m.group("v"), m.group("fn"), _file_of(funcs, m.group("fn")),
                int(m.group("l")), m.group("why")[0].upper() + m.group("why")[1:])
            prev_fn = m.group("fn")
            continue
        m = _SINK.match(seg)
        if m:
            add("sink", f"{m.group('name')}()", loc.get("function"), loc.get("file"),
                int(m.group("line")), "Dangerous operation")
            continue
        m = _END.match(seg)
        if m:
            what = {"use": "use of freed pointer", "deref": "dereference"}.get(
                m.group("what"), m.group("what"))
            add("sink", what, loc.get("function"), loc.get("file"), int(m.group("l")),
                "Unsafe operation")
            continue
        m = _CALL.match(seg)
        if m:
            callee = m.group("fn")
            site = _call_line(funcs, prev_fn, callee) if prev_fn else None
            # the node points at the call SITE, which lives in the caller's file
            fname = (_file_of(funcs, prev_fn) if site else
                     _file_of(funcs, callee, m.group("file")))
            add("call", f"{callee}({m.group('args')})", callee, fname, site,
                f"Tainted value crosses into {callee}()")
            prev_fn = callee
            continue
        add("step", seg)

    if not nodes:
        add("sink", f.get("vulnerability_type", "finding"), loc.get("function"),
            loc.get("file"), loc.get("line"))
    return nodes, edges


def build_flows(findings, sources):
    """One graph per finding: [{finding_index, nodes, edges}]."""
    funcs = _functions(sources)
    out = []
    for i, f in enumerate(findings):
        nodes, edges = _graph(f, funcs)
        out.append({"finding_index": i, "nodes": nodes, "edges": edges})
    return out
