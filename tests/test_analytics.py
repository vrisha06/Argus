"""Self-analytics tests (history store + web endpoints). Standalone script:
prints a [PASS]/[FAIL] line per check and `OK` when all pass, else `FAILED`
with a non-zero exit code.

Covers the diagnostic categorizer, the SQLite record/aggregate/clear round-trip
(against a throwaway database), and the web API record + history endpoints
(self-skips the web part if fastapi is not installed)."""

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from securecompile_x import history  # noqa: E402


def _finding(vclass, name, score, line, file="t.c"):
    return {"class": vclass, "vulnerability_type": name, "risk_score": score,
            "location": {"file": file, "line": line, "function": "f"}}


def main():
    checks = []

    # --- Categorizer buckets ---------------------------------------------
    cat = history.categorize
    cases = [
        ("Parser", "t.c: 2:1: expected SEMI, got '}'", "Missing semicolon"),
        ("Parser", "t.c: 2:1: expected LPAREN, got 'printf'", "Parenthesis error"),
        ("Parser", "t.c: 2:1: expected RBRACE, got X", "Brace error"),
        ("Parser", "t.c: 2:1: expected ID, got X", "Missing identifier"),
        ("Parser", "t.c: 2:1: unexpected token 'X'", "Unexpected token"),
        ("Semantic", "2:1: use of undeclared identifier 'y'", "Undeclared identifier"),
        ("Semantic", "2:1: type mismatch assigning int to char*", "Type mismatch"),
        ("Semantic", "2:1: redefinition of function 'foo'", "Redefinition"),
        ("Lexer", "2:1: bad char", "Lexical error"),
    ]
    for phase, msg, want in cases:
        got = cat(phase, msg)
        checks.append((f"categorize {phase}: {want}", got == want))

    # --- Record / aggregate / clear round-trip (throwaway DB) ------------
    tmp = tempfile.mkdtemp(prefix="scx_analytics_")
    history.DB_PATH = os.path.join(tmp, "test.db")
    history.init_db()
    history.clear("u")   # start clean

    history.record_run("u", "t.c", 5,
                       [_finding("buffer_overflow", "Buffer Overflow", 10, 4)],
                       {"Parser": ["t.c: 2:1: expected SEMI, got '}'"],
                        "Semantic": [], "Lexer": []})
    history.record_run("u", "t.c", 3, [], {})   # a clean run (most recent)

    s = history.get_stats("u")
    checks.append(("stats: total_runs == 2", s["total_runs"] == 2))
    checks.append(("stats: total_issues == 2", s["total_issues"] == 2))
    checks.append(("stats: clean_runs == 1", s["clean_runs"] == 1))
    checks.append(("stats: clean_streak == 1 (latest run clean)", s["clean_streak"] == 1))
    checks.append(("stats: by_kind finding/diagnostic == 1/1",
                   s["by_kind"]["finding"] == 1 and s["by_kind"]["diagnostic"] == 1))
    cats = {c["category"] for c in s["by_category"]}
    checks.append(("stats: categories include Buffer Overflow + Missing semicolon",
                   "Buffer Overflow" in cats and "Missing semicolon" in cats))
    phases = {p["phase"] for p in s["by_phase"]}
    checks.append(("stats: phases include Security + Parser",
                   "Security" in phases and "Parser" in phases))
    checks.append(("stats: trend has 2 points", len(s["trend"]) == 2))

    # isolation between users
    checks.append(("stats: other user is empty",
                   history.get_stats("other")["total_runs"] == 0))

    history.clear("u")
    checks.append(("clear: user history emptied",
                   history.get_stats("u")["total_runs"] == 0))

    # --- Web endpoints (optional) ----------------------------------------
    try:
        from fastapi.testclient import TestClient
        import securecompile_x.web as web
        web.history.DB_PATH = os.path.join(tmp, "web.db")
        web.history.init_db()
        client = TestClient(web.app)
        code = ('void f(char* s){char b[8]; strcpy(b,s);} '
                'int main(){char x[64]; scanf("%s",x); f(x); return 0;}')
        r = client.post("/api/analyze",
                        json={"code": code, "filename": "w.c",
                              "record": True, "user": "wuser"})
        checks.append(("web: analyze ok", r.status_code == 200))
        h = client.get("/api/history", params={"user": "wuser"}).json()
        checks.append(("web: history recorded a run", h["total_runs"] == 1))
        checks.append(("web: history counted the finding", h["total_issues"] >= 1))
        client.delete("/api/history", params={"user": "wuser"})
        h2 = client.get("/api/history", params={"user": "wuser"}).json()
        checks.append(("web: delete cleared history", h2["total_runs"] == 0))
    except ImportError:
        print("  [SKIP] web endpoint tests (fastapi not installed)")

    ok = all(p for _, p in checks)
    for n, p in checks:
        print(f"  [{'PASS' if p else 'FAIL'}] {n}")
    print("OK" if ok else "FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
