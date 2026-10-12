import React, { useEffect, useState } from "react";
import { fetchHistory, clearHistory } from "../api.js";

const PHASE_ORDER = ["Lexer", "Parser", "Semantic", "Security"];

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts * 1000) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Tiny inline-SVG sparkline of issues-per-run over time.
function Sparkline({ data }) {
  if (!data.length) return null;
  const w = 220, h = 40, pad = 3;
  const max = Math.max(1, ...data.map((d) => d.issues));
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => {
    const x = pad + i * step;
    const y = h - pad - (d.issues / max) * (h - pad * 2);
    return [x, y];
  });
  const line = pts.map((p) => p.join(",")).join(" ");
  const area = `${pad},${h - pad} ${line} ${pad + (data.length - 1) * step},${h - pad}`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polygon points={area} className="spark-area" />
      <polyline points={line} className="spark-line" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" className="spark-dot" />)}
    </svg>
  );
}

// Vertical daily-activity bars (issues per day).
function DayBars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.issues));
  return (
    <div className="daybars">
      {data.map((d, i) => (
        <div className="daybar" key={i}
             title={`${d.day}: ${d.runs} run(s), ${d.issues} issue(s)`}>
          <div className={`daybar-col ${d.issues ? "" : "zero"}`}
               style={{ height: `${(d.issues / max) * 100}%` }} />
          <span className="daybar-lbl">{d.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ items, labelKey, max }) {
  return (
    <div className="bars">
      {items.map((it, i) => (
        <div key={i} className="bar-row">
          <span className="bar-label">{it[labelKey]}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(it.count / max) * 100}%` }} />
          </div>
          <span className="bar-count">{it.count}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics({ userId, refreshKey }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setStats(await fetchHistory(userId));
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId, refreshKey]);

  async function onClear() {
    if (!window.confirm("Clear all your analytics history? This can't be undone.")) return;
    try { await clearHistory(userId); await load(); } catch (e) { setError(e.message); }
  }

  if (loading && !stats) return <div className="analytics"><p className="an-empty">Loading your analytics…</p></div>;
  if (error) return <div className="analytics"><div className="summary err">⚠ {error}</div></div>;

  const s = stats || {};
  const hasData = (s.total_runs || 0) > 0;
  const catMax = Math.max(1, ...(s.by_category || []).map((c) => c.count));
  const phaseData = PHASE_ORDER
    .map((p) => (s.by_phase || []).find((x) => x.phase === p) || { phase: p, count: 0 });
  const phaseMax = Math.max(1, ...phaseData.map((p) => p.count));
  const cleanRate = s.total_runs ? Math.round((s.clean_runs / s.total_runs) * 100) : 0;

  return (
    <div className="analytics">
      <div className="an-head">
        <div>
          <h2>Your coding analytics</h2>
          <p className="an-sub">Recorded each time you click <b>Analyze</b>. Tracks the mistakes you make most, by compiler phase.</p>
        </div>
        {hasData && <button className="an-clear" onClick={onClear}>Clear history</button>}
      </div>

      {!hasData ? (
        <div className="an-empty">
          <p>No analyses recorded yet.</p>
          <p className="an-sub">Go to the <b>Analyzer</b>, write some C, and click <b>Analyze</b> — your mistakes will show up here so you can see what to work on.</p>
        </div>
      ) : (
        <>
          <div className="an-tiles">
            <div className="tile"><span className="tile-num">{s.total_runs}</span><span className="tile-lbl">analyses</span></div>
            <div className="tile"><span className="tile-num">{s.total_issues}</span><span className="tile-lbl">issues found</span></div>
            <div className="tile"><span className="tile-num">{cleanRate}%</span><span className="tile-lbl">clean runs</span></div>
            <div className="tile"><span className="tile-num">{s.clean_streak || 0}</span><span className="tile-lbl">clean streak</span></div>
            <div className="tile"><span className="tile-num tile-sm">{s.top_category || "—"}</span><span className="tile-lbl">most common mistake</span></div>
          </div>

          <div className="an-grid">
            <section className="an-card">
              <h3>Your most common mistakes</h3>
              {s.by_category.length
                ? <Bars items={s.by_category} labelKey="category" max={catMax} />
                : <p className="an-sub">None yet — nice!</p>}
            </section>

            <section className="an-card">
              <h3>By compiler phase</h3>
              <Bars items={phaseData} labelKey="phase" max={phaseMax} />
            </section>

            <section className="an-card">
              <h3>Security findings vs. compiler errors</h3>
              <Bars
                items={[
                  { label: "Security findings", count: s.by_kind?.finding || 0 },
                  { label: "Compiler errors", count: s.by_kind?.diagnostic || 0 },
                ]}
                labelKey="label"
                max={Math.max(1, s.by_kind?.finding || 0, s.by_kind?.diagnostic || 0)}
              />
            </section>

            <section className="an-card">
              <h3>Trend <span className="an-sub">(issues per analysis)</span></h3>
              <Sparkline data={s.trend} />
              {!s.trend.length && <p className="an-sub">Run a few analyses to see a trend.</p>}
            </section>

            <section className="an-card">
              <h3>Daily activity <span className="an-sub">(issues per day)</span></h3>
              {s.by_day?.length
                ? <DayBars data={s.by_day} />
                : <p className="an-sub">No activity yet.</p>}
            </section>

            <section className="an-card">
              <h3>Recent analyses</h3>
              <ul className="an-recent">
                {s.recent_runs.map((r) => {
                  const total = r.finding_count + r.diag_count;
                  return (
                    <li key={r.id}>
                      <span className="an-file">{r.source_file || "input.c"}</span>
                      <span className="an-time">{timeAgo(r.ts)}</span>
                      <span className={`an-badge ${total ? "bad" : "good"}`}>
                        {total ? `${total} issue${total > 1 ? "s" : ""}` : "clean"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
