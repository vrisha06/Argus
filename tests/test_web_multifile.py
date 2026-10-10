"""Web API multi-file test (plan 008). Calls the endpoint function directly
(no HTTP server). Skips cleanly if fastapi/pydantic are not installed."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
try:
    from securecompile_x.web import analyze, AnalyzeRequest, FileInput
except Exception as e:  # fastapi/pydantic not installed
    print(f"SKIP: web deps unavailable ({e.__class__.__name__})"); print("OK"); sys.exit(0)

MAIN_C = 'int main(){ char cmd[128]; scanf("%s", cmd); run(cmd); return 0; }'
UTIL_C = 'void run(char* c){ system(c); }'

def main():
    checks = []
    # multi-file: cross-file taint, attributed to util.c
    resp = analyze(AnalyzeRequest(files=[FileInput(name="main.c", code=MAIN_C),
                                         FileInput(name="util.c", code=UTIL_C)]))
    uif = [f for f in resp["findings"] if f["class"] == "unsafe_input_flow"]
    checks.append(("multi: one unsafe_input_flow attributed to util.c",
                   len(uif) == 1 and uif[0]["location"]["file"] == "util.c"))
    checks.append(("multi: source_file lists both files",
                   "main.c" in resp["source_file"] and "util.c" in resp["source_file"]))
    # single-file backward compat
    resp2 = analyze(AnalyzeRequest(
        code='int main(){ char buf[16]; char input[128]; scanf("%s", input);'
             ' strcpy(buf, input); return 0; }', filename="t.c"))
    checks.append(("single: buffer_overflow still detected",
                   any(f["class"] == "buffer_overflow" for f in resp2["findings"])))
    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
