"""Phase 5: Security Analysis Engine. FR-5: taint sources/propagation/sinks,
interprocedural taint over the call graph, four detectors, phase attribution,
reachability from main(), and a deterministic context-sensitive risk score."""

from .rules import (TAINT_SOURCES, SINKS, LIBRARY_MODELS, PHASE_ATTRIBUTION,
                    RISK_WEIGHTS)

# Unbounded buffer-copy sinks -> Buffer Overflow when fed tainted/unknown data.
BUFFER_SINKS = {n for n, s in SINKS.items()
                if s["kind"] == "buffer_overflow" and not s["bounded"]}
# Sinks that execute/interpret untrusted data -> Unsafe Input Flow.
COMMAND_SINKS = {"system", "popen", "execl", "execlp", "execvp", "exec"}
DEREF_LIBS = {n for n, m in LIBRARY_MODELS.items() if "deref_args" in m}


class Finding:
    def __init__(self, vclass, func, line, col):
        self.vclass = vclass        # buffer_overflow / use_after_free / ...
        self.func = func
        self.file = None            # source file the finding is attributed to
        self.line = line
        self.col = col
        self.root_cause = []        # list[str]
        self.data_flow = ""         # str
        self.reachable = None       # bool
        self.risk = 0.0             # float 0..10
        self.fix = ""               # str
        self.tainted_origin = False
        self.unbounded = False
        self.guarded = False

    @property
    def phase(self):
        return PHASE_ATTRIBUTION[self.vclass]

    def to_dict(self):
        p = self.phase
        return {
            "vulnerability_type": _NAME[self.vclass],
            "class": self.vclass,
            "location": {"file": self.file, "function": self.func,
                         "line": self.line, "col": self.col},
            "root_cause_trace": self.root_cause,
            "data_flow_path": self.data_flow,
            "phase_attribution": {
                "phase": p["phase"], "needs": p["needs"], "why": p["why"]},
            "reachable_from_main": self.reachable,
            "risk_score": self.risk,
            "suggested_fix": self.fix,
        }


_NAME = {
    "buffer_overflow": "Buffer Overflow",
    "use_after_free": "Use-After-Free",
    "null_pointer": "Null-Pointer Dereference",
    "unsafe_input_flow": "Unsafe Input Flow",
}


class Engine:
    def __init__(self, ir_funcs, symtab, callgraph):
        self.ir = ir_funcs
        self.symtab = symtab
        self.cg = callgraph
        self.entry_tainted = {f: set() for f in ir_funcs}   # param idx tainted-in
        self.tainted = {}                                   # f -> set(operands)
        self.addr_ref = {}                                  # f -> {temp: var}
        self.ret_summary = {}                               # f -> set(param idx)
        self.callers = {}                                   # callee -> [(caller,line)]
        for caller, es in callgraph.edges.items():
            for callee, line in es:
                self.callers.setdefault(callee, []).append((caller, line))

    # ---------- taint ----------
    def run_taint(self):
        for f in self.ir:
            self.ret_summary[f] = self._compute_ret_summary(f)
        # interprocedural worklist
        work = list(self.ir.keys())
        while work:
            f = work.pop()
            tainted, callsites = self._local_taint(f, self.entry_tainted[f])
            self.tainted[f] = tainted
            for callee, pidxs, _line, _args in callsites:
                if callee in self.entry_tainted:
                    new = pidxs - self.entry_tainted[callee]
                    if new:
                        self.entry_tainted[callee] |= new
                        if callee not in work:
                            work.append(callee)
        # final recompute with stable entry sets
        for f in self.ir:
            self.tainted[f], _ = self._local_taint(f, self.entry_tainted[f])

    def _compute_ret_summary(self, f):
        irf = self.ir[f]
        out = set()
        for i in range(len(irf.params)):
            t, _ = self._local_taint(f, {i}, record_calls=False)
            if any(ins.op == "ret" and ins.args and ins.args[0] in t
                   for ins in irf.instrs):
                out.add(i)
        return out

    def _resolve(self, f, op):
        """Map an addr temp back to the variable it points at."""
        return self.addr_ref.get(f, {}).get(op, op)

    def _local_taint(self, f, entry_params, record_calls=True):
        irf = self.ir[f]
        tainted = set()
        aref = {}
        self.addr_ref[f] = aref
        for idx in entry_params:
            if idx < len(irf.params):
                tainted.add(irf.params[idx][0])
        callsites = []
        # iterate to fixpoint (handles reassignment / loops)
        for _ in range(4):
            changed = False
            cs_this = []

            def mark(x):
                nonlocal changed
                if x and x not in tainted:
                    tainted.add(x); changed = True

            for ins in irf.instrs:
                op = ins.op
                if op == "addr":
                    aref[ins.result] = ins.args[0]
                    if ins.args[0] in tainted:
                        mark(ins.result)
                elif op == "const" or op == "str":
                    pass
                elif op == "copy":
                    if ins.args[0] in tainted:
                        mark(ins.result)
                elif op in ("binop", "unop"):
                    if any(a in tainted for a in ins.args):
                        mark(ins.result)
                elif op == "index_load":
                    if ins.args[0] in tainted:
                        mark(ins.result)
                elif op == "deref_load":
                    if ins.args[0] in tainted:
                        mark(ins.result)
                elif op == "index_store":
                    if ins.args[2] in tainted:
                        mark(ins.args[0])
                elif op == "deref_store":
                    if ins.args[1] in tainted:
                        mark(ins.args[0])
                elif op == "call":
                    fn = ins.note
                    if fn in TAINT_SOURCES:
                        spec = TAINT_SOURCES[fn]
                        targs = spec.get("taints_args")
                        if targs == "rest":
                            idxs = range(1, len(ins.args))
                        elif targs:
                            idxs = targs
                        else:
                            idxs = []
                        for j in idxs:
                            if j < len(ins.args):
                                mark(self._resolve(f, ins.args[j]))
                        if spec.get("taint_ret"):
                            mark(ins.result)
                    elif fn in self.ir:          # user function
                        tp = {j for j, a in enumerate(ins.args)
                              if self._resolve(f, a) in tainted or a in tainted}
                        cs_this.append((fn, tp, ins.line, list(ins.args)))
                        if tp & self.ret_summary.get(fn, set()):
                            mark(ins.result)
                    else:                        # library model
                        m = LIBRARY_MODELS.get(fn, {})
                        if m.get("ret", "void") != "void" and \
                                any(a in tainted for a in ins.args):
                            mark(ins.result)
            callsites = cs_this
            if not changed:
                break
        return tainted, callsites

    # ---------- detectors ----------
    def detect(self):
        findings = []
        reach = self.cg.reachable_from("main") if "main" in self.cg.nodes else set()
        for f, irf in self.ir.items():
            findings += self._buffer_overflow(f, irf)
            findings += self._memory_safety(f, irf)   # UAF + null, CFG dataflow
            findings += self._unsafe_input_flow(f, irf)
        for fd in findings:
            fd.reachable = fd.func in reach
            irf = self.ir.get(fd.func)
            fd.file = getattr(irf, "file", None)
            self._score(fd)
        findings.sort(key=lambda x: (x.line, x.vclass))
        return findings

    def _buffer_overflow(self, f, irf):
        out = []
        tainted = self.tainted.get(f, set())
        for ins in irf.instrs:
            # unbounded buffer-copy sink fed tainted / unknown-length data
            if ins.op == "call" and ins.note in BUFFER_SINKS:
                spec = SINKS[ins.note]
                src = spec.get("src_arg")
                src_tainted = (src is not None and src < len(ins.args)
                               and ins.args[src] in tainted)
                is_gets = ins.note == "gets"
                if src_tainted or is_gets or spec.get("src_arg") is None:
                    fd = Finding("buffer_overflow", f, ins.line, 0)
                    fd.unbounded = True
                    fd.tainted_origin = src_tainted or is_gets
                    buf = ins.args[spec["buffer_arg"]] if spec["buffer_arg"] < len(ins.args) else "?"
                    fd.root_cause = self._trace(f, ins, "reaches unbounded copy "
                                                f"'{ins.note}' into buffer '{buf}'")
                    fd.data_flow = self._flow(f, ins.args[src] if src is not None
                                              and src < len(ins.args) else buf, ins)
                    fd.fix = (f"replace {ins.note} with a bounded variant "
                              f"(strncpy/snprintf) using sizeof({buf})")
                    out.append(fd)
            # tainted, unguarded array-index store -> overflow
            if ins.op == "index_store":
                idx = ins.args[1]
                if idx in tainted and not (ins.guards & {ins.args[0]}):
                    fd = Finding("buffer_overflow", f, ins.line, 0)
                    fd.unbounded = True; fd.tainted_origin = True
                    fd.root_cause = self._trace(f, ins,
                        f"tainted index writes into '{ins.args[0]}' with no bounds check")
                    fd.data_flow = self._flow(f, idx, ins)
                    fd.fix = "validate the index against the array length before writing"
                    out.append(fd)
        return out

    # ---- Use-After-Free + Null-Pointer via forward dataflow over the CFG ----
    def _memory_safety(self, f, irf):
        """Path/ordering-sensitive analysis on the real CFG (FR-4.2 consumer).

        Abstract state per program point: freed{var->line} and
        nullable{var->(line,reason)}. States are merged by union at control-flow
        joins (may-analysis); conditional edges drop pointers proven non-NULL
        by the branch condition. A fixpoint pass computes block-entry states,
        then a single reporting pass emits findings deterministically."""
        blocks = irf.blocks
        if not blocks:
            return []
        entry = {b.id: ({}, {}) for b in blocks}      # id -> (freed, nullable)
        work, inq = [0], {0}
        cap = len(blocks) * len(blocks) + 16
        steps = 0
        while work and steps < cap:
            steps += 1
            bid = work.pop(); inq.discard(bid)
            fin, nin = entry[bid]
            freed, nullable = self._transfer(f, irf, blocks[bid], dict(fin), dict(nin), None)
            for sid, nonnull in blocks[bid].succ:
                s_null = {k: v for k, v in nullable.items() if k not in nonnull}
                if self._merge(entry[sid], freed, s_null) and sid not in inq:
                    work.append(sid); inq.add(sid)
        findings = []
        for b in blocks:                               # reporting pass
            fin, nin = entry[b.id]
            self._transfer(f, irf, b, dict(fin), dict(nin), findings)
        return findings

    @staticmethod
    def _merge(entry_tuple, freed, nullable):
        """Union freed/nullable into entry_tuple; keep earliest line. -> changed."""
        e_freed, e_null = entry_tuple
        changed = False
        for k, v in freed.items():
            if k not in e_freed or v < e_freed[k]:
                e_freed[k] = min(v, e_freed.get(k, v)); changed = True
        for k, v in nullable.items():
            if k not in e_null:
                e_null[k] = v; changed = True
        return changed

    def _transfer(self, f, irf, block, freed, nullable, findings):
        """Run one block. Emit findings only when `findings` is a list."""
        emit = findings is not None
        for ins in block.instrs:
            op, note = ins.op, ins.note
            if op == "call" and note == "free" and ins.args:
                p = self._resolve(f, ins.args[0])
                if emit and p in freed:
                    fd = Finding("use_after_free", f, ins.line, 0)
                    fd.root_cause = [f"L{freed[p]}: free({p})",
                                     f"L{ins.line}: free({p}) again (double free)"]
                    fd.data_flow = f"{f}(): free({p}) @L{freed[p]} -> free({p}) @L{ins.line}"
                    fd.fix = f"remove the second free({p}); free each allocation once"
                    findings.append(fd)
                freed[p] = ins.line
                nullable.pop(p, None)
                continue
            if op == "call" and note in ("malloc", "calloc", "realloc"):
                continue                               # result consumed by copy
            if op == "copy":
                res, src = ins.result, ins.args[0]
                freed.pop(res, None)
                di = irf.defs.get(src)
                if di and di.op == "call" and di.note in ("malloc", "calloc", "realloc"):
                    nullable[res] = (ins.line, f"{di.note}() result may be NULL")
                elif di and di.op == "const" and di.note == "0":
                    nullable[res] = (ins.line, "assigned NULL")
                elif src in nullable:
                    nullable[res] = nullable[src]
                else:
                    nullable.pop(res, None)
                continue
            used = None
            if op in ("deref_load", "deref_store", "index_load", "index_store"):
                used = self._resolve(f, ins.args[0])
            elif op == "call" and note in DEREF_LIBS:
                for j in LIBRARY_MODELS[note]["deref_args"]:
                    if j < len(ins.args):
                        cand = self._resolve(f, ins.args[j])
                        if cand in freed or cand in nullable:
                            used = cand; break
            if used is None:
                continue
            if used in freed:
                if emit:
                    fd = Finding("use_after_free", f, ins.line, 0)
                    fd.root_cause = [f"L{freed[used]}: free({used})",
                                     f"L{ins.line}: '{used}' used after free"]
                    fd.data_flow = f"{f}(): free({used}) @L{freed[used]} -> use @L{ins.line}"
                    fd.fix = (f"set {used}=NULL after free and do not use it; or "
                              "restructure so the free happens after the last use")
                    findings.append(fd)
            elif used in nullable:
                if emit:
                    line0, reason = nullable[used]
                    fd = Finding("null_pointer", f, ins.line, 0)
                    fd.root_cause = [f"L{line0}: {reason}",
                                     f"L{ins.line}: '{used}' dereferenced with no NULL check"]
                    fd.data_flow = f"{f}(): {used} @L{line0} ({reason}) -> deref @L{ins.line}"
                    fd.fix = f"check if ({used} != NULL) before dereferencing it"
                    findings.append(fd)
        return freed, nullable

    def _unsafe_input_flow(self, f, irf):
        out = []
        tainted = self.tainted.get(f, set())
        for ins in irf.instrs:
            if ins.op == "call" and ins.note in COMMAND_SINKS:
                if any(a in tainted for a in ins.args):
                    bad = next(a for a in ins.args if a in tainted)
                    fd = Finding("unsafe_input_flow", f, ins.line, 0)
                    fd.tainted_origin = True
                    fd.root_cause = self._trace(f, ins,
                        f"untrusted data reaches '{ins.note}()'")
                    fd.data_flow = self._flow(f, bad, ins)
                    fd.fix = (f"never pass untrusted input to {ins.note}(); validate "
                              "against an allow-list or avoid the shell entirely")
                    out.append(fd)
        return out

    # ---------- path / trace helpers ----------
    def _trace(self, f, sink_ins, tail):
        lines = []
        origin = self._origin_line(f)
        if origin:
            lines.append(origin)
        lines.append(f"L{sink_ins.line}: {tail}")
        return lines

    def _origin_line(self, f):
        irf = self.ir[f]
        for ins in irf.instrs:
            if ins.op == "call" and ins.note in TAINT_SOURCES:
                return f"L{ins.line}: untrusted input via {ins.note}()"
        if self.entry_tainted.get(f):
            return f"{f}(): receives tainted argument from caller"
        return None

    def _flow(self, f, operand, sink_ins):
        """Readable source->sink data-flow path, interprocedural where needed."""
        prefix = ""
        # interprocedural: tainted came in through a parameter
        pnames = [p for p, _ in self.ir[f].params]
        if operand in pnames and self.callers.get(f):
            caller, cl = self.callers[f][0]
            src = self._origin_line(caller) or f"{caller}()"
            src = src.split(": ", 1)[-1] if ": " in src else src
            prefix = f"{caller}() [{src}] -> {f}({operand}) -> "
        else:
            o = self._origin_line(f)
            if o:
                prefix = f"{f}() [{o.split(': ',1)[-1]}] -> "
        return f"{prefix}{sink_ins.note}(...) @L{sink_ins.line}"

    # ---------- risk scoring (FR-5.7) ----------
    def _score(self, fd):
        w = RISK_WEIGHTS
        s = w["base"]
        if fd.tainted_origin:
            s += w["tainted_user_input"]
        s += w["reachable_from_main"] if fd.reachable else w["not_reachable"]
        if fd.unbounded:
            s += w["unbounded_sink"]
        if fd.guarded:
            s += w["mitigating_check"]
        fd.risk = round(max(0.0, min(10.0, s)), 1)


def analyze_security(ir_funcs, symtab, callgraph):
    eng = Engine(ir_funcs, symtab, callgraph)
    eng.run_taint()
    return eng.detect()
