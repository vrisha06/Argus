"""Proof-of-Vulnerability generator tests. Standalone script: prints [PASS]/
[FAIL] per check and `OK`/`FAILED` with an exit code.

Covers witness synthesis for each vulnerability class (concrete input for
input-driven bugs, trace/condition for control-flow bugs) and the reachability
filter (unreachable findings yield no PoV)."""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x.pov import generate_pov   # noqa: E402


def _read(fn):
    return open(os.path.join(HERE, fn), encoding="utf-8").read()


def _first(r, vclass):
    return next((p for p in r["povs"] if p["class"] == vclass), None)


def main():
    checks = []

    # Buffer overflow (strcpy) -> concrete oversized input, len > capacity.
    r = generate_pov(_read("bof_strcpy.c"), "bof_strcpy.c")
    p = _first(r, "buffer_overflow")
    checks.append(("strcpy: confirmed exploitable", p and p["status"] == "confirmed"))
    checks.append(("strcpy: witness is an input string longer than the buffer",
                   p and p["witness_kind"] == "input" and len(p["input"]) > 16))
    checks.append(("strcpy: delivery names the taint source", p and p["delivery"] == "scanf"))

    # Tainted index -> concrete out-of-bounds index.
    r = generate_pov(_read("bof_index.c"), "bof_index.c")
    p = _first(r, "buffer_overflow")
    checks.append(("index: witness is an out-of-bounds index",
                   p and p["witness_kind"] == "index" and p["input"].isdigit()))

    # Unsafe input flow -> command-injection payload.
    r = generate_pov(_read("uif_direct.c"), "uif_direct.c")
    p = _first(r, "unsafe_input_flow")
    checks.append(("unsafe-input: witness is an injection payload",
                   p and p["witness_kind"] == "payload" and p["status"] == "confirmed"))

    # Null deref -> runtime condition witness.
    r = generate_pov(_read("null_unchecked.c"), "null_unchecked.c")
    p = _first(r, "null_pointer")
    checks.append(("null: witness is a runtime condition",
                   p and p["witness_kind"] == "condition"))

    # Use-after-free -> trace witness.
    r = generate_pov(_read("uaf_use.c"), "uaf_use.c")
    p = _first(r, "use_after_free")
    checks.append(("uaf: witness is an execution trace",
                   p and p["witness_kind"] == "trace" and len(p.get("trace", [])) > 0))

    # Reachability filter: a finding not reachable from main() -> no PoV.
    dead = ("int main() { return 0; }\n"
            "void dead() { char* p; p = malloc(8); *p = 65; }\n")
    r = generate_pov(dead, "dead.c")
    p = _first(r, "null_pointer")
    checks.append(("unreachable finding is not proven exploitable",
                   p and p["status"] == "unreachable"))

    ok = all(p for _, p in checks)
    for n, passed in checks:
        print(f"  [{'PASS' if passed else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
