"""Phase 1: Lexer. FR-1: tokenise the C subset; record line/column; report errors."""

KEYWORDS = {"int", "char", "void", "if", "else", "while", "for", "return"}

# Multi-char operators first so greedy matching works.
_OPS = ["==", "!=", "<=", ">=", "&&", "||", "++", "--", "+=", "-=", "->",
        "+", "-", "*", "/", "%", "=", "<", ">", "!", "&", "|"]
_PUNCT = {"(": "LPAREN", ")": "RPAREN", "{": "LBRACE", "}": "RBRACE",
          "[": "LBRACK", "]": "RBRACK", ";": "SEMI", ",": "COMMA"}


class Token:
    __slots__ = ("kind", "value", "line", "col")

    def __init__(self, kind, value, line, col):
        self.kind, self.value, self.line, self.col = kind, value, line, col

    def __repr__(self):
        return f"Token({self.kind},{self.value!r},{self.line}:{self.col})"


class LexError(Exception):
    pass


def tokenize(src):
    """Return (tokens, errors). FR-1.3: continue after errors where possible."""
    toks, errs = [], []
    i, line, col = 0, 1, 1
    n = len(src)

    def add(kind, value, ln, cl):
        toks.append(Token(kind, value, ln, cl))

    while i < n:
        c = src[i]
        # whitespace
        if c == "\n":
            line += 1; col = 1; i += 1; continue
        if c in " \t\r":
            i += 1; col += 1; continue
        # comments
        if src.startswith("//", i):
            while i < n and src[i] != "\n":
                i += 1
            continue
        if src.startswith("/*", i):
            i += 2; col += 2
            while i < n and not src.startswith("*/", i):
                if src[i] == "\n":
                    line += 1; col = 1
                else:
                    col += 1
                i += 1
            i += 2; col += 2
            continue
        start_col = col
        # identifiers / keywords
        if c.isalpha() or c == "_":
            j = i
            while j < n and (src[j].isalnum() or src[j] == "_"):
                j += 1
            word = src[i:j]
            kind = "KEYWORD" if word in KEYWORDS else "ID"
            add(kind, word, line, start_col)
            col += j - i; i = j; continue
        # numbers (int literals, incl hex)
        if c.isdigit():
            j = i
            if src.startswith(("0x", "0X"), i):
                j += 2
                while j < n and (src[j].isdigit() or src[j] in "abcdefABCDEF"):
                    j += 1
            else:
                while j < n and src[j].isdigit():
                    j += 1
            add("NUM", src[i:j], line, start_col)
            col += j - i; i = j; continue
        # string literal
        if c == '"':
            j = i + 1
            buf = []
            while j < n and src[j] != '"':
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j:j + 2]); j += 2
                else:
                    buf.append(src[j]); j += 1
            if j >= n:
                errs.append(f"{line}:{start_col}: unterminated string literal")
                i = j; col += j - i; continue
            j += 1
            add("STRING", "".join(buf), line, start_col)
            col += j - i; i = j; continue
        # char literal
        if c == "'":
            j = i + 1
            buf = []
            while j < n and src[j] != "'":
                if src[j] == "\\" and j + 1 < n:
                    buf.append(src[j:j + 2]); j += 2
                else:
                    buf.append(src[j]); j += 1
            if j >= n:
                errs.append(f"{line}:{start_col}: unterminated char literal")
                i = j; continue
            j += 1
            add("CHAR", "".join(buf), line, start_col)
            col += j - i; i = j; continue
        # operators
        matched = False
        for op in _OPS:
            if src.startswith(op, i):
                add("OP", op, line, start_col)
                i += len(op); col += len(op); matched = True; break
        if matched:
            continue
        # punctuation
        if c in _PUNCT:
            add(_PUNCT[c], c, line, start_col)
            i += 1; col += 1; continue
        # unknown char -> lexical error, skip (FR-1.3)
        errs.append(f"{line}:{start_col}: unexpected character {c!r}")
        i += 1; col += 1

    add("EOF", None, line, col)
    return toks, errs
