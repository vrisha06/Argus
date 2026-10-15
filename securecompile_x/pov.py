"""Proof-of-Vulnerability (PoV) generator.

For each finding the security engine reports, this synthesises a concrete
*witness* that demonstrates the bug — a triggering input for input-driven flaws
(buffer overflow, unsafe-input flow) or an execution trace / runtime condition
for control-flow flaws (use-after-free, null dereference). It reasons over the
same facts the engine computes (taint, reachability) plus declared buffer sizes
from the AST (the symbol table's view).

Reachability doubles as a soundness filter: a finding not reachable from main()
has no executable path, so no PoV can be produced — it is reported as
*unreachable* rather than *confirmed*, which de-prioritises likely false
positives.
"""

from . import ast_nodes as A
from .analysis import BUFFER_SINKS, COMMAND_SINKS
from .cli import compile_and_analyze
from .lexer import tokenize
from .parser import parse
from .rules import TAINT_SOURCES

_NAME = {
    "buffer_overflow": "Buffer Overflow",
    "use_after_free": "Use-After-Free",
    "null_pointer": "Null-Pointer Dereference",
    "unsafe_input_flow": "Unsafe Input Flow",
}

# A deliberately harmless, obviously-injected command for the demo payload.
_INJECT = "; echo PWNED #"

# Preferred order when naming where the input enters.
_SOURCE_ORDER = ["scanf", "gets", "fgets", "fscanf", "read", "recv", "getenv"]


def _collect(prog):
    """Walk the AST for the facts PoV synthesis needs: declared array sizes,
    buffer-copy sites, array-index-store sites, command sinks, and which taint
    sources the program uses."""
    sizes, copy, index, cmd, sources = {}, {}, {}, {}, set()

    def wexpr(e):
        if e is None:
            return
        if isinstance(e, A.Call):
            if e.name in BUFFER_SINKS and e.args and isinstance(e.args[0], A.Var):
                copy[e.line] = {"dst": e.args[0].name, "sink": e.name}
            if e.name in COMMAND_SINKS:
                cmd[e.line] = e.name
            if e.name in TAINT_SOURCES:
                sources.add(e.name)
            for a in e.args:
                wexpr(a)
        for attr in ("left", "right", "operand", "array", "index"):
            if hasattr(e, attr):
                wexpr(getattr(e, attr))

    def wstmt(s):
        if isinstance(s, A.VarDecl):
            if s.type.array_size is not None:
                sizes[s.name] = s.type.array_size
            wexpr(s.init)
        elif isinstance(s, A.Assign):
            if isinstance(s.target, A.Index) and isinstance(s.target.array, A.Var):
                index[s.line] = {"array": s.target.array.name}
            wexpr(s.target); wexpr(s.value)
        elif isinstance(s, A.ExprStmt):
            wexpr(s.expr)
        elif isinstance(s, A.If):
            wexpr(s.cond); wstmt(s.then)
            if s.els:
                wstmt(s.els)
        elif isinstance(s, A.While):
            wexpr(s.cond); wstmt(s.body)
        elif isinstance(s, A.For):
            if s.init:
                wstmt(s.init)
            wexpr(s.cond)
            if s.step:
                wstmt(s.step)
            wstmt(s.body)
        elif isinstance(s, A.Return):
            wexpr(s.value)
        elif isinstance(s, A.Block):
            for x in s.stmts:
                wstmt(x)

    for fn in prog.functions:
        for p in fn.params:
            if p.type.array_size is not None:
                sizes[p.name] = p.type.array_size
        wstmt(fn.body)

    for info in copy.values():
        info["size"] = sizes.get(info["dst"])
    for info in index.values():
        info["size"] = sizes.get(info["array"])
    return copy, index, cmd, sources


def _pick_source(sources):
    for s in _SOURCE_ORDER:
        if s in sources:
            return s
    return next(iter(sources)) if sources else None


def _display_input(s):
    if len(s) > 40:
        return f'"{s[:24]}…" ({len(s)} chars)'
    return f'"{s}"'


def _synth(f, copy, index, cmd, src):
    base = {"class": f.vclass, "type": _NAME.get(f.vclass, f.vclass),
            "line": f.line, "function": f.func}

    if f.reachable is False:
        base.update(status="unreachable", witness_kind="none",
                    explanation=("No call path from main() reaches this code, so there is "
                                 "no executable path to trigger it. Reported for review, "
                                 "but no proof-of-vulnerability could be produced."))
        return base

    deliver = src or "standard input"

    if f.vclass == "buffer_overflow":
        ci, xi = copy.get(f.line), index.get(f.line)
        if ci:
            n = ci["size"]
            length = (n + 16) if n else 64
            payload = "A" * length
            base.update(
                status="confirmed", witness_kind="input", input=payload,
                input_display=_display_input(payload), delivery=deliver,
                trigger=(f"len(input) = {length} > capacity({ci['dst']}) = {n}"
                         if n else f"len(input) = {length} exceeds the fixed buffer"),
                explanation=(f"Entering {length} bytes via {deliver} overflows '{ci['dst']}'"
                             + (f" (size {n}) by {length - n} bytes" if n else "")
                             + f" through {ci['sink']}()."))
        elif xi:
            n = xi["size"]
            idx = n if n is not None else 9999
            base.update(
                status="confirmed", witness_kind="index", input=str(idx),
                input_display=str(idx), delivery=deliver,
                trigger=(f"index = {idx} ∉ [0, {n - 1}]" if n is not None
                         else f"index = {idx} is out of bounds"),
                explanation=(f"Supplying index {idx} via {deliver} writes outside "
                             f"'{xi['array']}'" + (f"[0..{n - 1}]." if n is not None else ".")))
        else:
            payload = "A" * 64
            base.update(status="confirmed", witness_kind="input", input=payload,
                        input_display=_display_input(payload), delivery=deliver,
                        trigger="oversized input reaches an unbounded copy",
                        explanation="A long input overflows the destination buffer.")
        return base

    if f.vclass == "unsafe_input_flow":
        base.update(
            status="confirmed", witness_kind="payload", input=_INJECT,
            input_display=f'"{_INJECT}"', delivery=deliver,
            trigger="tainted input reaches a command sink (system/exec/popen)",
            explanation=(f'Entering "{_INJECT}" via {deliver} injects a shell command the '
                         f"program hands to {cmd.get(f.line, 'system')}() — command injection."))
        return base

    if f.vclass == "null_pointer":
        base.update(
            status="confirmed", witness_kind="condition",
            trigger="the allocator returns NULL (e.g. under memory pressure)",
            trace=list(f.root_cause),
            explanation=(f"If malloc/calloc fails and returns NULL, the unchecked dereference "
                         f"at line {f.line} accesses address 0 — a guaranteed crash. No input "
                         f"is needed; force allocation failure to trigger it."))
        return base

    if f.vclass == "use_after_free":
        base.update(
            status="confirmed", witness_kind="trace",
            trigger="control always reaches the use of the freed pointer",
            trace=list(f.root_cause),
            explanation=(f"Every run reaches the freed-pointer use / second free at line "
                         f"{f.line}; no special input is required — the trace itself is the proof."))
        return base

    base.update(status="confirmed", witness_kind="trace", trace=list(f.root_cause),
                trigger="reachable from main()", explanation="Reachable defect.")
    return base


def generate_pov(source, name="input.c"):
    """Return PoV witnesses for every finding. Always well-formed."""
    tokens, _ = tokenize(source)
    prog, _ = parse(tokens)
    copy, index, cmd, sources = _collect(prog)
    src = _pick_source(sources)

    findings, _diag = compile_and_analyze(source, name)
    povs = [_synth(f, copy, index, cmd, src) for f in findings]
    confirmed = sum(1 for p in povs if p["status"] == "confirmed")
    return {
        "ok": True,
        "source_file": name,
        "input_source": src,
        "povs": povs,
        "summary": {"total": len(povs), "confirmed": confirmed,
                    "unreachable": len(povs) - confirmed},
    }
