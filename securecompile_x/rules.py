"""Knowledge base (FR-5.8): taint sources, sinks and standard-library models
live here as data, so new patterns are added without changing the engine.

Each library model:
  taint_ret   : the return value is tainted (untrusted input source)
  taints_args : indices of out-pointer args that become tainted
  sink        : dict of sink info (buffer_arg / src_arg / kind) if this is a sink
  deref_args  : indices of pointer args this function dereferences
  alloc       : 'heap' if it returns heap memory
  frees_arg   : index of the arg it frees
"""

# ---- Taint sources: untrusted input enters the program here ----
TAINT_SOURCES = {
    # name: index of arg that receives tainted data, or 'ret' for return value
    "gets":   {"taints_args": [0], "unbounded": True},
    "scanf":  {"taints_args": "rest"},   # all args after the format string
    "fscanf": {"taints_args": "rest"},
    "read":   {"taints_args": [1]},
    "fgets":  {"taints_args": [0]},
    "getenv": {"taint_ret": True},
    "recv":   {"taints_args": [1]},
}

# ---- Sinks: operations that are dangerous with tainted / oversized data ----
SINKS = {
    # name: {kind, buffer_arg, src_arg}
    "strcpy":  {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": 1, "bounded": False},
    "strcat":  {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": 1, "bounded": False},
    "sprintf": {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": None, "bounded": False},
    "memcpy":  {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": 1, "bounded": False},
    "gets":    {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": None, "bounded": False},
    # bounded variants are considered safe sinks
    "strncpy": {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": 1, "bounded": True},
    "snprintf": {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": None, "bounded": True},
    "memmove": {"kind": "buffer_overflow", "buffer_arg": 0, "src_arg": 1, "bounded": True},
}

# ---- Standard-library behavioural models ----
LIBRARY_MODELS = {
    "malloc":  {"ret": "void", "alloc": "heap"},
    "calloc":  {"ret": "void", "alloc": "heap"},
    "realloc": {"ret": "void", "alloc": "heap"},
    "free":    {"ret": "void", "frees_arg": 0},
    "strcpy":  {"ret": "void", "deref_args": [0, 1]},
    "strncpy": {"ret": "void", "deref_args": [0, 1]},
    "strcat":  {"ret": "void", "deref_args": [0, 1]},
    "memcpy":  {"ret": "void", "deref_args": [0, 1]},
    "memmove": {"ret": "void", "deref_args": [0, 1]},
    "sprintf": {"ret": "int", "deref_args": [0]},
    "snprintf": {"ret": "int", "deref_args": [0]},
    "printf":  {"ret": "int"},
    "scanf":   {"ret": "int"},
    "fscanf":  {"ret": "int"},
    "gets":    {"ret": "void", "deref_args": [0]},
    "fgets":   {"ret": "void", "deref_args": [0]},
    "puts":    {"ret": "int"},
    "strlen":  {"ret": "int", "deref_args": [0]},
    "read":    {"ret": "int"},
    "recv":    {"ret": "int"},
    "getenv":  {"ret": "char"},
    "exit":    {"ret": "void"},
    "system":  {"ret": "int"},
    "popen":   {"ret": "void"},
    "execl":   {"ret": "int"},
    "execlp":  {"ret": "int"},
    "execvp":  {"ret": "int"},
    "atoi":    {"ret": "int"},
}

# ---- Phase attribution oracle (section 8) ----
# Maps a detection technique to the earliest compiler phase that makes it visible.
PHASE_ATTRIBUTION = {
    "buffer_overflow": {
        "phase": "Security Analysis",
        "needs": "IR + call graph + taint",
        "why": "Requires data-flow of a tainted/oversized value into a sink; "
               "lexer/parser/semantic phases see syntax and types but not flow.",
    },
    "use_after_free": {
        "phase": "Security Analysis",
        "needs": "IR + CFG (control-flow ordering)",
        "why": "Needs ordering of free() before a later dereference on the CFG; "
               "earlier phases have no notion of execution order.",
    },
    "null_pointer": {
        "phase": "Security Analysis",
        "needs": "IR + CFG (path-sensitive null check)",
        "why": "Needs to know a malloc/null result reaches a dereference with no "
               "guarding check on the path; types alone cannot prove this.",
    },
    "unsafe_input_flow": {
        "phase": "Security Analysis",
        "needs": "IR + interprocedural call graph + taint",
        "why": "Tainted value crosses assignments and function boundaries to a "
               "sink; only interprocedural data-flow on the IR exposes it.",
    },
}

# Risk-score weights (section 8 / open-question 12). Deterministic.
RISK_WEIGHTS = {
    "base": 5.0,
    "tainted_user_input": 3.0,    # origin is direct untrusted input
    "reachable_from_main": 1.5,   # exploitable in normal execution
    "unbounded_sink": 1.0,        # e.g. gets/strcpy with no length
    "mitigating_check": -3.0,     # a bounds/null check guards the path
    "not_reachable": -2.0,
}
