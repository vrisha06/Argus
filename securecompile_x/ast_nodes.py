"""AST node definitions. FR-2.2: every node preserves source location (line/col)."""


class Node:
    line = 0
    col = 0


# ---- Types ----
class Type:
    """base: 'int'|'char'|'void'; ptr: levels of indirection; array_size or None."""
    def __init__(self, base, ptr=0, array_size=None):
        self.base, self.ptr, self.array_size = base, ptr, array_size

    def is_pointer(self):
        return self.ptr > 0 or self.array_size is not None

    def __repr__(self):
        s = self.base + "*" * self.ptr
        if self.array_size is not None:
            s += f"[{self.array_size}]"
        return s


# ---- Top level ----
class Program(Node):
    def __init__(self, functions):
        self.functions = functions


class Function(Node):
    def __init__(self, name, ret_type, params, body, line, col):
        self.name, self.ret_type, self.params, self.body = name, ret_type, params, body
        self.line, self.col = line, col


class Param(Node):
    def __init__(self, name, type_, line, col):
        self.name, self.type = name, type_
        self.line, self.col = line, col


# ---- Statements ----
class Block(Node):
    def __init__(self, stmts, line, col):
        self.stmts = stmts; self.line, self.col = line, col


class VarDecl(Node):
    def __init__(self, name, type_, init, line, col):
        self.name, self.type, self.init = name, type_, init
        self.line, self.col = line, col


class Assign(Node):
    def __init__(self, target, value, line, col):
        self.target, self.value = target, value
        self.line, self.col = line, col


class If(Node):
    def __init__(self, cond, then, els, line, col):
        self.cond, self.then, self.els = cond, then, els
        self.line, self.col = line, col


class While(Node):
    def __init__(self, cond, body, line, col):
        self.cond, self.body = cond, body; self.line, self.col = line, col


class For(Node):
    def __init__(self, init, cond, step, body, line, col):
        self.init, self.cond, self.step, self.body = init, cond, step, body
        self.line, self.col = line, col


class Return(Node):
    def __init__(self, value, line, col):
        self.value = value; self.line, self.col = line, col


class ExprStmt(Node):
    def __init__(self, expr, line, col):
        self.expr = expr; self.line, self.col = line, col


# ---- Expressions ----
class Binary(Node):
    def __init__(self, op, left, right, line, col):
        self.op, self.left, self.right = op, left, right
        self.line, self.col = line, col


class Unary(Node):
    def __init__(self, op, operand, line, col):
        self.op, self.operand = op, operand; self.line, self.col = line, col


class Index(Node):
    def __init__(self, array, index, line, col):
        self.array, self.index = array, index; self.line, self.col = line, col


class Call(Node):
    def __init__(self, name, args, line, col):
        self.name, self.args = name, args; self.line, self.col = line, col


class Var(Node):
    def __init__(self, name, line, col):
        self.name = name; self.line, self.col = line, col


class Num(Node):
    def __init__(self, value, line, col):
        self.value = value; self.line, self.col = line, col


class Str(Node):
    def __init__(self, value, line, col):
        self.value = value; self.line, self.col = line, col


class CharLit(Node):
    def __init__(self, value, line, col):
        self.value = value; self.line, self.col = line, col
