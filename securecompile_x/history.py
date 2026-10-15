"""Self-analytics store for Argus.

Persists every *manual* analysis run (the Analyze button) to a local SQLite
database and aggregates it into "what mistakes do I make most" statistics —
a personal learning dashboard.

Stdlib-only (sqlite3), so the project keeps its zero-dependency character. The
database is a single file in the project root (git-ignored).

Each run stores one `runs` row plus one `events` row per issue (finding or
compiler diagnostic). Events are categorised into friendly buckets grouped by
compiler phase, which is what the dashboard charts.
"""

import os
import re
import sqlite3
import time

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(_ROOT, "analytics.db")

_LINE_RE = re.compile(r":\s*(\d+):(\d+):")

# Friendly names for the four security classes.
_VCLASS = {
    "buffer_overflow": "Buffer Overflow",
    "use_after_free": "Use-After-Free",
    "null_pointer": "Null-Pointer Dereference",
    "unsafe_input_flow": "Unsafe Input Flow",
}


def _connect():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with _connect() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user TEXT NOT NULL,
                ts REAL NOT NULL,
                source_file TEXT,
                loc INTEGER,
                finding_count INTEGER,
                diag_count INTEGER
            )""")
        c.execute("""
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                user TEXT NOT NULL,
                ts REAL NOT NULL,
                kind TEXT NOT NULL,          -- 'finding' | 'diagnostic'
                phase TEXT,                   -- Lexer/Parser/Semantic/Security
                category TEXT,                -- friendly bucket
                severity TEXT,
                line INTEGER,
                message TEXT
            )""")
        c.execute("CREATE INDEX IF NOT EXISTS idx_events_user ON events(user)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user)")


def _severity(score):
    return "high" if score >= 7 else "medium" if score >= 4 else "low"


def _diag_line(msg):
    m = _LINE_RE.search(msg or "")
    return int(m.group(1)) if m else None


def categorize(phase, message):
    """Map a raw diagnostic message to a friendly mistake category."""
    m = (message or "").lower()
    if phase == "Parser":
        if "expected semi" in m:
            return "Missing semicolon"
        if "expected lparen" in m or "expected rparen" in m:
            return "Parenthesis error"
        if "expected lbrace" in m or "expected rbrace" in m:
            return "Brace error"
        if "expected rbrack" in m or "expected lbrack" in m:
            return "Bracket error"
        if "expected id" in m:
            return "Missing identifier"
        if "lvalue" in m:
            return "Invalid assignment target"
        if "unexpected token" in m:
            return "Unexpected token"
        return "Syntax error"
    if phase == "Semantic":
        if "undeclared" in m:
            return "Undeclared identifier"
        if "type mismatch" in m:
            return "Type mismatch"
        if "redefinition" in m:
            return "Redefinition"
        return "Semantic error"
    if phase == "Lexer":
        return "Lexical error"
    return "Issue"


def record_run(user, source_file, loc, findings, diagnostics):
    """Persist one analysis run. `findings` are finding.to_dict() dicts;
    `diagnostics` is the {phase: [messages]} dict. Returns the run id."""
    user = user or "local"
    ts = time.time()
    diag_count = sum(len(v or []) for v in (diagnostics or {}).values())
    init_db()
    with _connect() as c:
        cur = c.execute(
            "INSERT INTO runs (user, ts, source_file, loc, finding_count, diag_count)"
            " VALUES (?,?,?,?,?,?)",
            (user, ts, source_file, loc, len(findings or []), diag_count))
        run_id = cur.lastrowid

        rows = []
        for f in findings or []:
            rows.append((run_id, user, ts, "finding", "Security",
                         _VCLASS.get(f.get("class"), f.get("vulnerability_type", "Finding")),
                         _severity(f.get("risk_score", 5)),
                         (f.get("location") or {}).get("line"),
                         f.get("vulnerability_type", "")))
        for phase, errs in (diagnostics or {}).items():
            for e in errs or []:
                rows.append((run_id, user, ts, "diagnostic", phase,
                             categorize(phase, e), "high", _diag_line(e), e))
        if rows:
            c.executemany(
                "INSERT INTO events (run_id, user, ts, kind, phase, category,"
                " severity, line, message) VALUES (?,?,?,?,?,?,?,?,?)", rows)
    return run_id


def get_stats(user, recent=15):
    """Aggregate a user's history into dashboard-ready stats."""
    user = user or "local"
    init_db()
    with _connect() as c:
        runs = c.execute("SELECT COUNT(*) n, COALESCE(SUM(finding_count),0) f,"
                         " COALESCE(SUM(diag_count),0) d FROM runs WHERE user=?",
                         (user,)).fetchone()
        total_runs = runs["n"]
        total_issues = runs["f"] + runs["d"]
        clean_runs = c.execute(
            "SELECT COUNT(*) n FROM runs WHERE user=? AND finding_count=0 AND diag_count=0",
            (user,)).fetchone()["n"]

        by_category = [dict(r) for r in c.execute(
            "SELECT category, phase, COUNT(*) count FROM events WHERE user=?"
            " GROUP BY category ORDER BY count DESC", (user,)).fetchall()]
        by_phase = [dict(r) for r in c.execute(
            "SELECT phase, COUNT(*) count FROM events WHERE user=?"
            " GROUP BY phase ORDER BY count DESC", (user,)).fetchall()]
        recent_runs = [dict(r) for r in c.execute(
            "SELECT id, ts, source_file, finding_count, diag_count FROM runs"
            " WHERE user=? ORDER BY ts DESC LIMIT ?", (user, recent)).fetchall()]

        # Security findings vs. compiler diagnostics split.
        kinds = {r["kind"]: r["count"] for r in c.execute(
            "SELECT kind, COUNT(*) count FROM events WHERE user=? GROUP BY kind",
            (user,)).fetchall()}

        # Daily activity (newest first, last 14 days with any run).
        by_day = [dict(r) for r in c.execute(
            "SELECT date(ts, 'unixepoch') day, COUNT(*) runs,"
            " COALESCE(SUM(finding_count + diag_count), 0) issues FROM runs"
            " WHERE user=? GROUP BY day ORDER BY day DESC LIMIT 14",
            (user,)).fetchall()]

        # Current clean streak: most-recent consecutive runs with zero issues.
        streak = 0
        for r in c.execute("SELECT finding_count + diag_count t FROM runs"
                           " WHERE user=? ORDER BY ts DESC", (user,)):
            if r["t"] == 0:
                streak += 1
            else:
                break

    trend = [{"ts": r["ts"], "issues": r["finding_count"] + r["diag_count"]}
             for r in reversed(recent_runs)]
    return {
        "total_runs": total_runs,
        "total_issues": total_issues,
        "clean_runs": clean_runs,
        "clean_streak": streak,
        "top_category": by_category[0]["category"] if by_category else None,
        "by_category": by_category,
        "by_phase": by_phase,
        "by_kind": {"finding": kinds.get("finding", 0),
                    "diagnostic": kinds.get("diagnostic", 0)},
        "by_day": list(reversed(by_day)),   # oldest -> newest for charting
        "recent_runs": recent_runs,
        "trend": trend,
    }


def clear(user):
    user = user or "local"
    init_db()
    with _connect() as c:
        c.execute("DELETE FROM events WHERE user=?", (user,))
        c.execute("DELETE FROM runs WHERE user=?", (user,))
    return True
