"""Tests for friendly diagnostics, root-cause grouping and PoV memory walkthrough data.
Standalone: prints [PASS]/[FAIL] per check and OK/FAILED with an exit code."""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.cli import compile_and_analyze          # noqa: E402
from securecompile_x.friendly import explain_all             # noqa: E402
from securecompile_x.grouping import group_findings          # noqa: E402
from securecompile_x.pov import generate_pov                 # noqa: E402


def friendly_for(src):
    _, d = compile_and_analyze(src, "t.c")
    return explain_all(d, {"t.c": src}, "t.c")


def main():
    c = []

    # --- friendly diagnostics ---
    e = friendly_for("int main() {\n    int x = 5\n    return x;\n}\n")[0]
    c.append(("semicolon: titled + moved to previous line",
              e["title"] == "Missing semicolon" and e["line"] == 2))
    e = friendly_for("int main() {\n    int x = 5;\n    return x;\n")[0]
    c.append(("eof: reports unmatched brace", "unmatched" in e["message"]))
    e = friendly_for("#include <stdio.h>\nint main() { return 0; }\n")[0]
    c.append(("#include: explained as unsupported", "Preprocessor" in e["title"]))
    e = friendly_for("int main() {\n    int count = 1;\n    return cnt;\n}\n")[0]
    c.append(("undeclared: did-you-mean", "`count`" in e["hint"]))
    e = friendly_for("int main() {\n    prinft(1);\n    return 0;\n}\n")[0]
    c.append(("unknown fn: did-you-mean printf", "`printf`" in e["hint"]))
    c.append(("clean code: no friendly errors",
              friendly_for("int main() { return 0; }") == []))

    # --- grouping: one scanf feeding two sinks -> one root cause ---
    src = ('void run(char* c) { char b[8]; strcpy(b, c); system(c); }\n'
           'int main() { char n[64]; scanf("%s", n); run(n); return 0; }\n')
    fs, _ = compile_and_analyze(src, "g.c")
    fd = [f.to_dict() for f in fs]
    gs = group_findings(fd, {"g.c": src})
    c.append(("grouping: >=2 findings", len(fd) >= 2))
    c.append(("grouping: shared scanf source is one group", len(gs) == 1 and gs[0]["count"] == len(fd)))
    c.append(("grouping: source line resolved", gs[0]["line"] == 2 and "scanf" in gs[0]["label"]))
    c.append(("grouping: ranked", gs[0]["rank"] == 1))

    # distinct causes stay separate and are ordered by risk
    src2 = ('int main() { char* p; p = malloc(8); *p = 1; char b[4]; gets(b); return 0; }\n')
    fs, _ = compile_and_analyze(src2, "h.c")
    gs = group_findings([f.to_dict() for f in fs], {"h.c": src2})
    c.append(("grouping: independent causes kept apart", len(gs) == len(fs) >= 2))
    c.append(("grouping: sorted by risk",
              all(gs[i]["max_risk"] >= gs[i + 1]["max_risk"] for i in range(len(gs) - 1))))

    # --- PoV memory data ---
    def mem(fn):
        r = generate_pov(open(os.path.join(HERE, fn), encoding="utf-8").read(), fn)
        return r["povs"][0].get("memory")
    m = mem("bof_strcpy.c")
    c.append(("memory: buffer", m and m["kind"] == "buffer" and m["length"] > m["capacity"]))
    m = mem("bof_index.c")
    c.append(("memory: index", m and m["kind"] == "index" and m["index"] >= m["capacity"]))
    m = mem("uaf_use.c")
    c.append(("memory: uaf lines", m and m["kind"] == "uaf" and m["free_line"] and m["use_line"]))
    m = mem("uaf_double.c")
    c.append(("memory: double free flagged", m and m["double"] is True))
    m = mem("null_unchecked.c")
    c.append(("memory: null", m and m["kind"] == "null" and m["deref_line"]))
    m = mem("uif_direct.c")
    c.append(("memory: command", m and m["kind"] == "command"))

    ok = all(bool(p) for _, p in c)
    for n, p in c:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
