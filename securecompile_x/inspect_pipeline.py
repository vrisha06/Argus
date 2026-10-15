"""Glass-box pipeline inspector.

Runs a single translation unit through every compiler stage and serialises each
stage's own data structure to JSON, so the UI can *show* the compiler's
internals: token stream, parse tree (AST), symbol table, call graph,
three-address code, and the control-flow graph. Findings' lines are included so
the UI can highlight where a vulnerability surfaces across the stages.
"""

from . import ast_nodes as A
from .lexer import tokenize
from .parser import parse
from .semantic import SemanticAnalyzer
from .ir import generate_programs
from .cli import compile_and_analyze


# ---- AST serialisation ------------------------------------------------
def _ast(node):
    if node is None:
        return None
    t = type(node).__name__
    line = getattr(node, "line", 0)
    kids = []

    def add(n):
        j = _ast(n)
        if j:
            kids.append(j)

    if isinstance(node, A.Program):
        label = "Program"
        for f in node.functions:
            add(f)
    elif isinstance(node, A.Function):
        label = f"Function {node.name}() : {node.ret_type}"
        for p in node.params:
            add(p)
        add(node.body)
    elif isinstance(node, A.Param):
        label = f"Param {node.name} : {node.type}"
    elif isinstance(node, A.Block):
        label = "Block"
        for s in node.stmts:
            add(s)
    elif isinstance(node, A.VarDecl):
        label = f"VarDecl {node.name} : {node.type}"
        add(node.init)
    elif isinstance(node, A.Assign):
        label = "Assign ="
        add(node.target); add(node.value)
    elif isinstance(node, A.If):
        label = "If"
        add(node.cond); add(node.then); add(node.els)
    elif isinstance(node, A.While):
        label = "While"
        add(node.cond); add(node.body)
    elif isinstance(node, A.For):
        label = "For"
        add(node.init); add(node.cond); add(node.step); add(node.body)
    elif isinstance(node, A.Return):
        label = "Return"
        add(node.value)
    elif isinstance(node, A.ExprStmt):
        label = "ExprStmt"
        add(node.expr)
    elif isinstance(node, A.Binary):
        label = f"Binary '{node.op}'"
        add(node.left); add(node.right)
    elif isinstance(node, A.Unary):
        label = f"Unary '{node.op}'"
        add(node.operand)
    elif isinstance(node, A.Index):
        label = "Index []"
        add(node.array); add(node.index)
    elif isinstance(node, A.Call):
        label = f"Call {node.name}()"
        for a in node.args:
            add(a)
    elif isinstance(node, A.Var):
        label = f"Var {node.name}"
    elif isinstance(node, A.Num):
        label = f"Num {node.value}"
    elif isinstance(node, A.Str):
        label = f'Str "{node.value}"'
    elif isinstance(node, A.CharLit):
        label = f"Char '{node.value}'"
    else:
        label = t
    return {"type": t, "label": label, "line": line, "children": kids}


# ---- IR / CFG serialisation ------------------------------------------
def _instr_text(i):
    args = ", ".join(str(x) for x in i.args)
    res = f"{i.result} = " if i.result else ""
    note = f"{i.note} " if i.note else ""
    return f"{res}{i.op} {note}({args})".replace("  ", " ").strip()


def _instr(i):
    return {"line": i.line, "block": i.block, "op": i.op, "text": _instr_text(i)}


def _cfg(irf):
    blocks = []
    for bb in irf.blocks:
        blocks.append({
            "id": bb.id,
            "instrs": [_instr(i) for i in bb.instrs],
            "succ": [{"to": sid, "nonnull": sorted(nn)} for sid, nn in bb.succ],
        })
    return blocks


def inspect_source(source, name="input.c"):
    """Serialise every stage. Always returns a well-formed dict (best-effort on
    code that doesn't fully parse)."""
    tokens, lex_errs = tokenize(source)
    tok_json = [{"kind": t.kind, "value": "" if t.value is None else str(t.value),
                 "line": t.line, "col": t.col}
                for t in tokens if t.kind != "EOF"]

    prog, parse_errs = parse(tokens)
    ast_json = _ast(prog)

    sem = SemanticAnalyzer()
    try:
        sem.analyze_programs([prog])
    except Exception:  # pragma: no cover - best effort on malformed input
        pass
    symbols = [{"name": s.name, "type": str(s.type), "kind": s.kind,
                "scope": s.scope, "line": s.decl_line, "alloc": s.alloc}
               for s in sem.symtab.all]
    callgraph = {
        "nodes": sorted(sem.callgraph.nodes),
        "edges": [{"from": caller, "to": callee, "line": ln}
                  for caller, lst in sem.callgraph.edges.items()
                  for callee, ln in lst],
    }

    tac, cfg = {}, {}
    try:
        irfuncs = generate_programs([prog], sem.symtab)
        for fname, irf in irfuncs.items():
            tac[fname] = [_instr(i) for i in irf.instrs]
            cfg[fname] = _cfg(irf)
    except Exception:  # pragma: no cover
        pass

    findings, diagnostics = compile_and_analyze(source, name)
    finding_rows = [{"type": f.to_dict()["vulnerability_type"],
                     "line": f.to_dict()["location"]["line"],
                     "flow": f.to_dict()["data_flow_path"]} for f in findings]
    finding_lines = sorted({r["line"] for r in finding_rows})

    return {
        "ok": True,
        "source_file": name,
        "tokens": tok_json,
        "ast": ast_json,
        "symbols": symbols,
        "callgraph": callgraph,
        "tac": tac,
        "cfg": cfg,
        "findings": finding_rows,
        "finding_lines": finding_lines,
        "diagnostics": {k: v for k, v in diagnostics.items() if v},
        "errors": lex_errs + parse_errs,
    }
