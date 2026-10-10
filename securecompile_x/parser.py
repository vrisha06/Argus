"""Phase 2: Parser. FR-2: recursive-descent parser -> AST, with locations and
statement-level error recovery (FR-2.3)."""

from . import ast_nodes as A


class ParseError(Exception):
    pass


class Parser:
    def __init__(self, tokens):
        self.toks = tokens
        self.pos = 0
        self.errors = []

    # ---- helpers ----
    def peek(self, k=0):
        return self.toks[min(self.pos + k, len(self.toks) - 1)]

    def at_end(self):
        return self.peek().kind == "EOF"

    def advance(self):
        t = self.toks[self.pos]
        if self.pos < len(self.toks) - 1:
            self.pos += 1
        return t

    def check(self, kind, value=None):
        t = self.peek()
        return t.kind == kind and (value is None or t.value == value)

    def match(self, kind, value=None):
        if self.check(kind, value):
            return self.advance()
        return None

    def expect(self, kind, value=None):
        if self.check(kind, value):
            return self.advance()
        t = self.peek()
        raise ParseError(f"{t.line}:{t.col}: expected {value or kind}, got {t.value!r}")

    # ---- entry ----
    def parse(self):
        funcs = []
        while not self.at_end():
            try:
                funcs.append(self.function())
            except ParseError as e:
                self.errors.append(str(e))
                self._recover_top()
        return A.Program(funcs)

    def _recover_top(self):
        # skip to next '}' at depth 0 or EOF, then continue
        depth = 0
        while not self.at_end():
            t = self.advance()
            if t.kind == "LBRACE":
                depth += 1
            elif t.kind == "RBRACE":
                depth -= 1
                if depth <= 0:
                    break

    # ---- types ----
    def _is_type_start(self):
        return self.check("KEYWORD", "int") or self.check("KEYWORD", "char") \
            or self.check("KEYWORD", "void")

    def type_base(self):
        t = self.advance()  # int/char/void
        base = t.value
        ptr = 0
        while self.check("OP", "*"):
            self.advance(); ptr += 1
        return A.Type(base, ptr), t

    # ---- function ----
    def function(self):
        typ, tk = self.type_base()
        name = self.expect("ID")
        self.expect("LPAREN")
        params = []
        if not self.check("RPAREN"):
            # allow 'void' as empty param list
            if self.check("KEYWORD", "void") and self.peek(1).kind == "RPAREN":
                self.advance()
            else:
                params.append(self.param())
                while self.match("COMMA"):
                    params.append(self.param())
        self.expect("RPAREN")
        body = self.block()
        return A.Function(name.value, typ, params, body, tk.line, tk.col)

    def param(self):
        typ, tk = self.type_base()
        name = self.expect("ID")
        # array param: char buf[]
        if self.match("LBRACK"):
            size = None
            if self.check("NUM"):
                size = int(self.advance().value, 0)
            self.expect("RBRACK")
            typ = A.Type(typ.base, typ.ptr, size)
        return A.Param(name.value, typ, tk.line, tk.col)

    # ---- statements ----
    def block(self):
        lb = self.expect("LBRACE")
        stmts = []
        while not self.check("RBRACE") and not self.at_end():
            try:
                stmts.append(self.statement())
            except ParseError as e:
                self.errors.append(str(e))
                self._recover_stmt()
        self.expect("RBRACE")
        return A.Block(stmts, lb.line, lb.col)

    def _recover_stmt(self):
        # FR-2.3: recover at statement boundaries (next ';' or '}')
        while not self.at_end():
            if self.check("SEMI"):
                self.advance(); return
            if self.check("RBRACE"):
                return
            self.advance()

    def statement(self):
        t = self.peek()
        if self.check("LBRACE"):
            return self.block()
        if self._is_type_start():
            return self.var_decl()
        if self.check("KEYWORD", "if"):
            return self.if_stmt()
        if self.check("KEYWORD", "while"):
            return self.while_stmt()
        if self.check("KEYWORD", "for"):
            return self.for_stmt()
        if self.check("KEYWORD", "return"):
            self.advance()
            val = None
            if not self.check("SEMI"):
                val = self.expression()
            self.expect("SEMI")
            return A.Return(val, t.line, t.col)
        # expression statement (incl assignment)
        expr = self.expression()
        self.expect("SEMI")
        if isinstance(expr, _AssignExpr):
            return A.Assign(expr.target, expr.value, expr.line, expr.col)
        return A.ExprStmt(expr, t.line, t.col)

    def var_decl(self):
        typ, tk = self.type_base()
        name = self.expect("ID")
        if self.match("LBRACK"):
            size = None
            if self.check("NUM"):
                size = int(self.advance().value, 0)
            self.expect("RBRACK")
            typ = A.Type(typ.base, typ.ptr, size)
        init = None
        if self.match("OP", "="):
            init = self.expression()
        self.expect("SEMI")
        return A.VarDecl(name.value, typ, init, tk.line, tk.col)

    def if_stmt(self):
        t = self.advance()
        self.expect("LPAREN"); cond = self.expression(); self.expect("RPAREN")
        then = self.statement()
        els = None
        if self.match("KEYWORD", "else"):
            els = self.statement()
        return A.If(cond, then, els, t.line, t.col)

    def while_stmt(self):
        t = self.advance()
        self.expect("LPAREN"); cond = self.expression(); self.expect("RPAREN")
        body = self.statement()
        return A.While(cond, body, t.line, t.col)

    def for_stmt(self):
        t = self.advance()
        self.expect("LPAREN")
        init = None
        if not self.check("SEMI"):
            if self._is_type_start():
                # inline decl without consuming ';' via var_decl (it eats ';')
                init = self.var_decl()
            else:
                e = self.expression(); self.expect("SEMI")
                init = A.Assign(e.target, e.value, e.line, e.col) if isinstance(e, _AssignExpr) \
                    else A.ExprStmt(e, t.line, t.col)
        else:
            self.expect("SEMI")
        cond = None
        if not self.check("SEMI"):
            cond = self.expression()
        self.expect("SEMI")
        step = None
        if not self.check("RPAREN"):
            e = self.expression()
            step = A.Assign(e.target, e.value, e.line, e.col) if isinstance(e, _AssignExpr) \
                else A.ExprStmt(e, t.line, t.col)
        self.expect("RPAREN")
        body = self.statement()
        return A.For(init, cond, step, body, t.line, t.col)

    # ---- expressions (precedence climbing) ----
    def expression(self):
        return self.assignment()

    def assignment(self):
        left = self.logic_or()
        t = self.peek()
        if self.check("OP", "=") or self.check("OP", "+=") or self.check("OP", "-="):
            op = self.advance().value
            right = self.assignment()
            if isinstance(right, _AssignExpr):
                raise ParseError(
                    f"{t.line}:{t.col}: chained assignment is not supported; "
                    "split 'a = b = c' into separate statements")
            if op != "=":
                right = A.Binary(op[0], left, right, t.line, t.col)
            return _AssignExpr(left, right, t.line, t.col)
        return left

    def _binary_level(self, ops, sub):
        left = sub()
        while self.peek().kind == "OP" and self.peek().value in ops:
            t = self.advance()
            right = sub()
            left = A.Binary(t.value, left, right, t.line, t.col)
        return left

    def logic_or(self):
        return self._binary_level({"||"}, self.logic_and)

    def logic_and(self):
        return self._binary_level({"&&"}, self.equality)

    def equality(self):
        return self._binary_level({"==", "!="}, self.relational)

    def relational(self):
        return self._binary_level({"<", ">", "<=", ">="}, self.additive)

    def additive(self):
        return self._binary_level({"+", "-"}, self.multiplicative)

    def multiplicative(self):
        return self._binary_level({"*", "/", "%"}, self.unary)

    def unary(self):
        t = self.peek()
        if self.peek().kind == "OP" and self.peek().value in ("*", "&", "-", "!"):
            op = self.advance().value
            operand = self.unary()
            return A.Unary(op, operand, t.line, t.col)
        return self.postfix()

    def postfix(self):
        node = self.primary()
        while True:
            t = self.peek()
            if self.match("LBRACK"):
                idx = self.expression()
                self.expect("RBRACK")
                node = A.Index(node, idx, t.line, t.col)
            elif self.check("LPAREN") and isinstance(node, A.Var):
                self.advance()
                args = []
                if not self.check("RPAREN"):
                    args.append(self.expression())
                    while self.match("COMMA"):
                        args.append(self.expression())
                self.expect("RPAREN")
                node = A.Call(node.name, args, node.line, node.col)
            elif self.peek().kind == "OP" and self.peek().value in ("++", "--") \
                    and isinstance(node, (A.Var, A.Index, A.Unary)):
                op = self.advance().value          # "++" or "--"
                one = A.Num(1, t.line, t.col)
                delta = A.Binary(op[0], node, one, t.line, t.col)  # node + 1 / node - 1
                node = _AssignExpr(node, delta, t.line, t.col)
                break   # i++ is a complete postfix expression; stop the loop
            else:
                break
        return node

    def primary(self):
        t = self.peek()
        if self.match("LPAREN"):
            e = self.expression(); self.expect("RPAREN"); return e
        if self.check("NUM"):
            self.advance(); return A.Num(int(t.value, 0), t.line, t.col)
        if self.check("STRING"):
            self.advance(); return A.Str(t.value, t.line, t.col)
        if self.check("CHAR"):
            self.advance(); return A.CharLit(t.value, t.line, t.col)
        if self.check("ID"):
            self.advance(); return A.Var(t.value, t.line, t.col)
        raise ParseError(f"{t.line}:{t.col}: unexpected token {t.value!r}")


class _AssignExpr(A.Node):
    """Internal: assignment used as an expression; lifted to A.Assign stmt."""
    def __init__(self, target, value, line, col):
        self.target, self.value = target, value
        self.line, self.col = line, col


def parse(tokens):
    p = Parser(tokens)
    prog = p.parse()
    return prog, p.errors
