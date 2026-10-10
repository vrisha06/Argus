"""Driver: one command to compile and analyse a C source file (NFR: usability).

Usage:
    python -m securecompile_x.cli <file.c> [--json] [--out FILE]
"""

import sys
import argparse

from .lexer import tokenize
from .parser import parse
from .semantic import analyze
from .ir import generate
from .analysis import analyze_security
from . import report


def compile_and_analyze(source, source_name="<input>"):
    """Run the full pipeline. Returns (findings, diagnostics)."""
    diagnostics = {}
    tokens, lex_errs = tokenize(source)
    diagnostics["Lexer"] = lex_errs

    prog, parse_errs = parse(tokens)
    diagnostics["Parser"] = parse_errs

    symtab, callgraph, sem_errs = analyze(prog)
    diagnostics["Semantic"] = sem_errs

    ir_funcs = generate(prog, symtab)

    findings = analyze_security(ir_funcs, symtab, callgraph)
    return findings, diagnostics


def main(argv=None):
    ap = argparse.ArgumentParser(prog="securecompile-x",
                                 description="Compiler-based C vulnerability detector")
    ap.add_argument("file", help="C source file (.c) in the supported subset")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--out", help="write report to this file instead of stdout")
    args = ap.parse_args(argv)

    with open(args.file, "r", encoding="utf-8") as fh:
        src = fh.read()

    findings, diag = compile_and_analyze(src, args.file)

    if args.json:
        text = report.to_json(findings, args.file, diag)
    else:
        text = report.to_text(findings, args.file, diag)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"report written to {args.out}  ({len(findings)} finding(s))")
    else:
        print(text)

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
