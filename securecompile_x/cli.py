"""Driver: one command to compile and analyse C source files (NFR: usability).

Usage:
    python -m securecompile_x.cli <file.c> [<file.c> ...] [--json] [--out FILE]
"""

import sys
import argparse

from .lexer import tokenize
from .parser import parse
from .semantic import SemanticAnalyzer
from .ir import generate_programs
from .analysis import analyze_security
from . import report


def compile_and_analyze(source, source_name="<input>"):
    """Run the full pipeline on one translation unit.

    Returns (findings, diagnostics). Kept for backward compatibility; delegates
    to the multi-file path with a single unit."""
    return compile_and_analyze_multi([(source_name, source)])


def compile_and_analyze_multi(units):
    """Link and analyse multiple translation units as one program.

    ``units`` is a list of ``(name, source)`` pairs. Every parsed function is
    tagged with its file name, all units are linked into one symbol table, call
    graph and IR dict, and the existing interprocedural engine runs once so
    taint, reachability and findings cross file boundaries. Diagnostics are
    aggregated with each message prefixed by its file. Returns
    ``(findings, diagnostics)``."""
    diagnostics = {"Lexer": [], "Parser": [], "Semantic": []}
    progs = []
    for name, source in units:
        tokens, lex_errs = tokenize(source)
        prog, parse_errs = parse(tokens)
        for f in prog.functions:
            f.file = name
        diagnostics["Lexer"] += [f"{name}: {e}" for e in lex_errs]
        diagnostics["Parser"] += [f"{name}: {e}" for e in parse_errs]
        progs.append(prog)

    sem = SemanticAnalyzer()
    symtab, callgraph, sem_errs = sem.analyze_programs(progs)
    diagnostics["Semantic"] = sem_errs

    ir_funcs = generate_programs(progs, symtab)

    findings = analyze_security(ir_funcs, symtab, callgraph)
    return findings, diagnostics


def main(argv=None):
    ap = argparse.ArgumentParser(prog="securecompile-x",
                                 description="Compiler-based C vulnerability detector")
    ap.add_argument("file", nargs="+",
                    help="one or more C source files (.c) in the supported subset")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    ap.add_argument("--out", help="write report to this file instead of stdout")
    args = ap.parse_args(argv)

    units = []
    for path in args.file:
        with open(path, "r", encoding="utf-8") as fh:
            units.append((path, fh.read()))

    findings, diag = compile_and_analyze_multi(units)

    if len(units) == 1:
        source_file = args.file[0]
    else:
        source_file = ", ".join(args.file)

    if args.json:
        text = report.to_json(findings, source_file, diag)
    else:
        text = report.to_text(findings, source_file, diag)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"report written to {args.out}  ({len(findings)} finding(s))")
    else:
        print(text)

    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
