"""Phase 3: Semantic Analyser. FR-3: type checking, scope resolution, symbol
table (type/scope/allocation info), call graph, undeclared-name detection."""

from . import ast_nodes as A
from .rules import LIBRARY_MODELS


class Symbol:
    def __init__(self, name, type_, scope, kind="var", decl_line=0):
        self.name, self.type, self.scope, self.kind = name, type_, scope, kind
        self.decl_line = decl_line
        self.alloc = None  # 'stack' | 'heap' | 'static'

    def __repr__(self):
        return f"Symbol({self.name}:{self.type} {self.scope}/{self.kind})"


class SymbolTable:
    """Nested scopes. Global scope holds functions; each function has locals."""
    def __init__(self):
        self.scopes = [{}]          # stack of dicts
        self.functions = {}         # name -> Function
        self.all = []               # flat list of symbols for reporting

    def push(self):
        self.scopes.append({})

    def pop(self):
        self.scopes.pop()

    def declare(self, sym):
        self.scopes[-1][sym.name] = sym
        self.all.append(sym)
        return sym

    def lookup(self, name):
        for s in reversed(self.scopes):
            if name in s:
                return s[name]
        return None


class CallGraph:
    """FR-3.3: one node per function, one edge per call site."""
    def __init__(self):
        self.nodes = set()
        self.edges = {}          # caller -> list of (callee, line)

    def add_node(self, name):
        self.nodes.add(name)
        self.edges.setdefault(name, [])

    def add_edge(self, caller, callee, line):
        self.add_node(caller)
        self.edges.setdefault(caller, []).append((callee, line))

    def callees(self, name):
        return [c for c, _ in self.edges.get(name, [])]

    def reachable_from(self, root="main"):
        seen, stack = set(), [root]
        while stack:
            n = stack.pop()
            if n in seen:
                continue
            seen.add(n)
            for c in self.callees(n):
                if c in self.nodes and c not in seen:
                    stack.append(c)
        return seen


class SemanticAnalyzer:
    def __init__(self):
        self.symtab = SymbolTable()
        self.callgraph = CallGraph()
        self.errors = []
        self.cur_func = None

    def analyze(self, prog):
        # pass 1: declare functions (allows forward/mutual calls)
        for f in prog.functions:
            if f.name in self.symtab.functions:
                self.errors.append(f"{f.line}:{f.col}: redefinition of function '{f.name}'")
            self.symtab.functions[f.name] = f
            self.callgraph.add_node(f.name)
            fsym = Symbol(f.name, f.ret_type, "global", "func", f.line)
            self.symtab.scopes[0][f.name] = fsym
            self.symtab.all.append(fsym)
        # pass 2: bodies
        for f in prog.functions:
            self._func(f)
        return self.symtab, self.callgraph, self.errors

    def _func(self, f):
        self.cur_func = f.name
        self.symtab.push()
        for p in f.params:
            s = Symbol(p.name, p.type, f.name, "param", p.line)
            s.alloc = "heap_or_stack" if p.type.is_pointer() else "stack"
            self.symtab.declare(s)
        self._block(f.body)
        self.symtab.pop()

    def _block(self, b):
        self.symtab.push()
        for st in b.stmts:
            self._stmt(st)
        self.symtab.pop()

    def _stmt(self, st):
        if isinstance(st, A.Block):
            self._block(st)
        elif isinstance(st, A.VarDecl):
            s = Symbol(st.name, st.type, self.cur_func, "var", st.line)
            s.alloc = "stack"
            self.symtab.declare(s)
            if st.init is not None:
                self._expr(st.init)
                if isinstance(st.init, A.Call) and st.init.name == "malloc":
                    s.alloc = "heap"
        elif isinstance(st, A.Assign):
            self._expr(st.target)
            self._expr(st.value)
            # heap tracking: p = malloc(...)
            if isinstance(st.target, A.Var) and isinstance(st.value, A.Call) \
                    and st.value.name == "malloc":
                sym = self.symtab.lookup(st.target.name)
                if sym:
                    sym.alloc = "heap"
            self._typecheck_assign(st)
        elif isinstance(st, A.If):
            self._expr(st.cond); self._stmt(st.then)
            if st.els:
                self._stmt(st.els)
        elif isinstance(st, A.While):
            self._expr(st.cond); self._stmt(st.body)
        elif isinstance(st, A.For):
            self.symtab.push()
            if st.init:
                self._stmt(st.init)
            if st.cond:
                self._expr(st.cond)
            if st.step:
                self._stmt(st.step)
            self._stmt(st.body)
            self.symtab.pop()
        elif isinstance(st, A.Return):
            if st.value:
                self._expr(st.value)
        elif isinstance(st, A.ExprStmt):
            self._expr(st.expr)

    def _typecheck_assign(self, st):
        lt = self._type_of(st.target)
        rt = self._type_of(st.value)
        if lt and rt and lt.base != rt.base and not (lt.is_pointer() and rt.is_pointer()):
            # void* (e.g. malloc result) is assignable to any object pointer — valid C.
            if lt.is_pointer() and rt.base == "void":
                return
            # non-fatal: int<->char are compatible-ish; only warn on struct-like mismatch
            if {lt.base, rt.base} - {"int", "char"}:
                self.errors.append(
                    f"{st.line}:{st.col}: type mismatch assigning {rt} to {lt}")

    def _type_of(self, e):
        if isinstance(e, A.Num):
            return A.Type("int")
        if isinstance(e, A.CharLit):
            return A.Type("char")
        if isinstance(e, A.Str):
            return A.Type("char", 1)
        if isinstance(e, A.Var):
            s = self.symtab.lookup(e.name)
            return s.type if s else None
        if isinstance(e, A.Index):
            bt = self._type_of(e.array)
            if bt:
                return A.Type(bt.base, max(0, bt.ptr - 1))
            return None
        if isinstance(e, A.Unary):
            if e.op == "*":
                bt = self._type_of(e.operand)
                if bt:
                    return A.Type(bt.base, max(0, bt.ptr - 1))
            if e.op == "&":
                bt = self._type_of(e.operand)
                if bt:
                    return A.Type(bt.base, bt.ptr + 1)
            return self._type_of(e.operand)
        if isinstance(e, A.Binary):
            return self._type_of(e.left) or self._type_of(e.right)
        if isinstance(e, A.Call):
            f = self.symtab.functions.get(e.name)
            if f:
                return f.ret_type
            m = LIBRARY_MODELS.get(e.name)
            if m:
                return A.Type(m.get("ret", "int"))
        return None

    def _expr(self, e):
        if isinstance(e, A.Var):
            if self.symtab.lookup(e.name) is None:
                self.errors.append(
                    f"{e.line}:{e.col}: use of undeclared identifier '{e.name}'")
        elif isinstance(e, A.Binary):
            self._expr(e.left); self._expr(e.right)
        elif isinstance(e, A.Unary):
            self._expr(e.operand)
        elif isinstance(e, A.Index):
            self._expr(e.array); self._expr(e.index)
        elif isinstance(e, A.Call):
            # FR-3.3: record call edge
            self.callgraph.add_edge(self.cur_func, e.name, e.line)
            if e.name not in self.symtab.functions and e.name not in LIBRARY_MODELS:
                self.errors.append(
                    f"{e.line}:{e.col}: call to unknown function '{e.name}'")
            for a in e.args:
                self._expr(a)


def analyze(prog):
    return SemanticAnalyzer().analyze(prog)
