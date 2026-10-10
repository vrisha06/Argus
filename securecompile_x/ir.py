"""Phase 4: Intermediate Code Generator. FR-4: lower AST to Three-Address Code,
build a real per-function Control Flow Graph (basic blocks + successor edges),
and keep a TAC->source-line mapping.

Control flow lowers to explicit 'ifz'/'goto'/'label' TAC. Blocks carry typed
successor edges; a conditional edge also carries the set of pointers proven
non-NULL along it (branch refinement), which the security engine's forward
dataflow consumes for path-sensitive Null/UAF analysis.

Operands are strings: variable names ('x'), temporaries ('t3'), or constants
materialised by 'const'/'str'/'addr' instructions."""

from . import ast_nodes as A


class Instr:
    __slots__ = ("op", "result", "args", "note", "line", "guards", "block", "refine")

    def __init__(self, op, result, args, note, line, guards):
        self.op = op            # copy/binop/unop/index_load/index_store/
                                # deref_load/deref_store/call/ret/const/str/addr/
                                # label/goto/ifz
        self.result = result
        self.args = args
        self.note = note        # operator, function, literal, or label name
        self.line = line        # FR-4.3: source line
        self.guards = guards    # frozenset of guard var names active here
        self.block = None
        self.refine = None      # ifz only: (true_nonnull:set, false_nonnull:set)

    def __repr__(self):
        a = ",".join(map(str, self.args))
        r = f"{self.result} = " if self.result else ""
        return f"[L{self.line}] {r}{self.op} {self.note or ''} ({a})".strip()


class BasicBlock:
    def __init__(self, bid):
        self.id = bid
        self.instrs = []
        self.succ = []          # list of (succ_block_id, nonnull_frozenset)

    def __repr__(self):
        return f"BB{self.id}(->{[s for s, _ in self.succ]})"


class IRFunction:
    def __init__(self, name, params):
        self.name = name
        self.params = params        # list of (name, Type)
        self.instrs = []            # linear TAC, program order
        self.blocks = []            # CFG basic blocks
        self.defs = {}              # operand -> defining Instr

    def emit(self, instr):
        self.instrs.append(instr)
        if instr.result:
            self.defs[instr.result] = instr
        return instr


class IRGenerator:
    def __init__(self, symtab):
        self.symtab = symtab
        self.functions = {}
        self._t = 0
        self._l = 0
        self._cur = None
        self._guards = frozenset()

    def new_temp(self):
        self._t += 1
        return f"t{self._t}"

    def new_label(self):
        self._l += 1
        return f"L{self._l}"

    def generate(self, prog):
        for f in prog.functions:
            self._gen_func(f)
        return self.functions

    def _gen_func(self, f):
        self._l = 0
        irf = IRFunction(f.name, [(p.name, p.type) for p in f.params])
        self.functions[f.name] = irf
        self._cur = irf
        self._guards = frozenset()
        self._stmt(f.body)
        self._build_cfg(irf)

    def _emit(self, op, result, args, note, line):
        return self._cur.emit(Instr(op, result, args, note, line, self._guards))

    # ---- branch-refinement predicates (pointers proven non-NULL) ----
    @staticmethod
    def _nonnull_preds(cond):
        """Return (nonnull_when_true, nonnull_when_false) var sets. Sound subset."""
        def is_zero(e):
            return isinstance(e, A.Num) and e.value == 0
        if isinstance(cond, A.Var):
            return {cond.name}, set()
        if isinstance(cond, A.Unary) and cond.op == "!" and isinstance(cond.operand, A.Var):
            return set(), {cond.operand.name}
        if isinstance(cond, A.Binary):
            l, r, op = cond.left, cond.right, cond.op
            var = None
            if isinstance(l, A.Var) and is_zero(r):
                var = l.name
            elif isinstance(r, A.Var) and is_zero(l):
                var = r.name
            if var and op == "!=":
                return {var}, set()
            if var and op == "==":
                return set(), {var}
            if op == "&&":
                lt, _ = IRGenerator._nonnull_preds(l)
                rt, _ = IRGenerator._nonnull_preds(r)
                return lt | rt, set()
            if op == "||":
                _, lf = IRGenerator._nonnull_preds(l)
                _, rf = IRGenerator._nonnull_preds(r)
                return set(), lf | rf
        return set(), set()

    # ---- statements ----
    def _stmt(self, st):
        if isinstance(st, A.Block):
            for s in st.stmts:
                self._stmt(s)
        elif isinstance(st, A.VarDecl):
            if st.init is not None:
                v = self._expr(st.init)
                self._emit("copy", st.name, [v], None, st.line)
        elif isinstance(st, A.Assign):
            self._gen_assign(st)
        elif isinstance(st, A.If):
            self._gen_if(st)
        elif isinstance(st, A.While):
            self._gen_while(st)
        elif isinstance(st, A.For):
            self._gen_for(st)
        elif isinstance(st, A.Return):
            v = self._expr(st.value) if st.value else None
            self._emit("ret", None, [v] if v else [], None, st.line)
        elif isinstance(st, A.ExprStmt):
            self._expr(st.expr)

    def _gen_if(self, st):
        true_nn, false_nn = self._nonnull_preds(st.cond)
        c = self._expr(st.cond)
        l_else = self.new_label()
        l_end = self.new_label() if st.els else l_else
        ifz = self._emit("ifz", None, [c], l_else, st.line)
        ifz.refine = (true_nn, false_nn)
        saved = self._guards
        self._guards = saved | self._guard_vars(st.cond)
        self._stmt(st.then)
        self._guards = saved
        if st.els:
            self._emit("goto", None, [], l_end, st.line)
            self._emit("label", None, [], l_else, st.line)
            self._stmt(st.els)
            self._emit("label", None, [], l_end, st.line)
        else:
            self._emit("label", None, [], l_else, st.line)

    def _gen_while(self, st):
        true_nn, false_nn = self._nonnull_preds(st.cond)
        l_top = self.new_label()
        l_end = self.new_label()
        self._emit("label", None, [], l_top, st.line)
        c = self._expr(st.cond)
        ifz = self._emit("ifz", None, [c], l_end, st.line)
        ifz.refine = (true_nn, false_nn)
        saved = self._guards
        self._guards = saved | self._guard_vars(st.cond)
        self._stmt(st.body)
        self._guards = saved
        self._emit("goto", None, [], l_top, st.line)
        self._emit("label", None, [], l_end, st.line)

    def _gen_for(self, st):
        if st.init:
            self._stmt(st.init)
        l_top = self.new_label()
        l_end = self.new_label()
        self._emit("label", None, [], l_top, st.line)
        if st.cond:
            true_nn, false_nn = self._nonnull_preds(st.cond)
            c = self._expr(st.cond)
            ifz = self._emit("ifz", None, [c], l_end, st.line)
            ifz.refine = (true_nn, false_nn)
        self._stmt(st.body)
        if st.step:
            self._stmt(st.step)
        self._emit("goto", None, [], l_top, st.line)
        self._emit("label", None, [], l_end, st.line)

    def _gen_assign(self, st):
        val = self._expr(st.value)
        tgt = st.target
        if isinstance(tgt, A.Var):
            self._emit("copy", tgt.name, [val], None, st.line)
        elif isinstance(tgt, A.Index):
            arr = self._expr(tgt.array)
            idx = self._expr(tgt.index)
            self._emit("index_store", None, [arr, idx, val], None, st.line)
        elif isinstance(tgt, A.Unary) and tgt.op == "*":
            ptr = self._expr(tgt.operand)
            self._emit("deref_store", None, [ptr, val], None, st.line)
        else:
            t = self._expr(tgt)
            self._emit("copy", t, [val], None, st.line)

    def _guard_vars(self, cond):
        out = set()

        def walk(e):
            if isinstance(e, A.Var):
                out.add(e.name)
            elif isinstance(e, A.Binary):
                walk(e.left); walk(e.right)
            elif isinstance(e, A.Unary):
                walk(e.operand)
            elif isinstance(e, A.Index):
                walk(e.array); walk(e.index)
            elif isinstance(e, A.Call):
                for a in e.args:
                    walk(a)
        walk(cond)
        return frozenset(out)

    # ---- expressions -> operand ----
    def _expr(self, e):
        if isinstance(e, A.Num):
            t = self.new_temp(); self._emit("const", t, [], str(e.value), e.line); return t
        if isinstance(e, A.CharLit):
            t = self.new_temp(); self._emit("const", t, [], repr(e.value), e.line); return t
        if isinstance(e, A.Str):
            t = self.new_temp(); self._emit("str", t, [], e.value, e.line); return t
        if isinstance(e, A.Var):
            return e.name
        if isinstance(e, A.Binary):
            a = self._expr(e.left); b = self._expr(e.right)
            t = self.new_temp(); self._emit("binop", t, [a, b], e.op, e.line); return t
        if isinstance(e, A.Unary):
            if e.op == "&":
                operand = self._operand_ref(e.operand)
                t = self.new_temp(); self._emit("addr", t, [operand], "&", e.line); return t
            if e.op == "*":
                p = self._expr(e.operand)
                t = self.new_temp(); self._emit("deref_load", t, [p], None, e.line); return t
            v = self._expr(e.operand)
            t = self.new_temp(); self._emit("unop", t, [v], e.op, e.line); return t
        if isinstance(e, A.Index):
            arr = self._expr(e.array); idx = self._expr(e.index)
            t = self.new_temp(); self._emit("index_load", t, [arr, idx], None, e.line); return t
        if isinstance(e, A.Call):
            args = [self._expr(a) for a in e.args]
            t = self.new_temp(); self._emit("call", t, args, e.name, e.line); return t
        return None

    def _operand_ref(self, e):
        if isinstance(e, A.Var):
            return e.name
        return self._expr(e)

    # ---- CFG (FR-4.2): real basic blocks + successor edges ----
    def _build_cfg(self, irf):
        instrs = irf.instrs
        n = len(instrs)
        if n == 0:
            irf.blocks = [BasicBlock(0)]
            return
        # 1) label name -> instruction index
        label_at = {ins.note: i for i, ins in enumerate(instrs) if ins.op == "label"}
        # 2) leaders
        leaders = {0}
        for i, ins in enumerate(instrs):
            if ins.op in ("goto", "ifz"):
                tgt = label_at.get(ins.note)
                if tgt is not None:
                    leaders.add(tgt)
                if i + 1 < n:
                    leaders.add(i + 1)       # fallthrough after branch
            elif ins.op == "ret" and i + 1 < n:
                leaders.add(i + 1)
            elif ins.op == "label":
                leaders.add(i)
        leaders = sorted(leaders)
        # 3) build blocks and an index->block map
        blocks = []
        idx_to_block = {}
        for bi, start in enumerate(leaders):
            end = leaders[bi + 1] if bi + 1 < len(leaders) else n
            bb = BasicBlock(bi)
            bb.instrs = instrs[start:end]
            for ins in bb.instrs:
                ins.block = bi
            for j in range(start, end):
                idx_to_block[j] = bi
            blocks.append(bb)
        label_block = {name: idx_to_block[i] for name, i in label_at.items()}
        start_index = {leaders[bi]: bi for bi in range(len(leaders))}
        # 4) successor edges with branch refinement
        for bi, start in enumerate(leaders):
            bb = blocks[bi]
            last = bb.instrs[-1] if bb.instrs else None
            fall = start_index.get(leaders[bi + 1]) if bi + 1 < len(leaders) else None
            if last is None:
                if fall is not None:
                    bb.succ.append((fall, frozenset()))
            elif last.op == "goto":
                if last.note in label_block:
                    bb.succ.append((label_block[last.note], frozenset()))
            elif last.op == "ifz":
                true_nn, false_nn = last.refine or (set(), set())
                # cond TRUE  -> fallthrough; cond FALSE -> branch target
                if fall is not None:
                    bb.succ.append((fall, frozenset(true_nn)))
                if last.note in label_block:
                    bb.succ.append((label_block[last.note], frozenset(false_nn)))
            elif last.op == "ret":
                pass
            else:
                if fall is not None:
                    bb.succ.append((fall, frozenset()))
        irf.blocks = blocks


def generate(prog, symtab):
    return IRGenerator(symtab).generate(prog)
