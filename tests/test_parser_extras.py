import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from securecompile_x.lexer import tokenize            # noqa: E402
from securecompile_x.parser import parse              # noqa: E402
from securecompile_x.cli import compile_and_analyze   # noqa: E402

def perrs(src):
    toks, _ = tokenize(src)
    _prog, errs = parse(toks)
    return errs

def classes(src):
    findings, _ = compile_and_analyze(src, "t.c")
    return [f.vclass for f in findings]

def main():
    checks = [
        ("for i++ parses", perrs("int main(){int i; for(i=0;i<3;i++){} return 0;}") == []),
        ("bare i++ parses", perrs("int main(){int i; i=0; i++; return 0;}") == []),
        ("prefix ++i parses", perrs("int main(){int i; i=0; ++i; return 0;}") == []),
        ("for ++i parses", perrs("int main(){int i; for(i=0;i<3;++i){} return 0;}") == []),
        ("chained assign parses (supported)",
         perrs("int main(){int a;int b;int c;c=1;a=b=c;return a;}") == []),
        ("plain assign still ok", perrs("int main(){int i; i=0; i=i+1; return i;}") == []),
        ("chained assign propagates taint to sink",
         "unsafe_input_flow" in classes(
             "int main(){ char cmd[128]; char* x; char* y; "
             "scanf(\"%s\", cmd); y = x = cmd; system(y); return 0; }")),
    ]
    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
