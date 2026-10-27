import React from "react";
import { ShieldAlert, Flame, Layers, Files, Activity, Play, History, RotateCcw, CircleCheck, CircleAlert, CircleDashed } from "lucide-react";
import { useArgus } from "../state/store.jsx";
import { go } from "../router.js";
import { STAGES } from "../components/PhaseStrip.jsx";
import { PageHeader, StatCard, EmptyState } from "../ui/primitives.jsx";

const CLASSES = ["Buffer Overflow", "Use-After-Free", "Null-Pointer Dereference", "Unsafe Input Flow"];
const fmt = (ts) => new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const maxRisk = (r) => (r?.findings?.length ? Math.max(...r.findings.map((f) => f.risk_score)) : null);

// Stage state is derived only from real diagnostics in the latest result.
export function stageStates(result) {
  if (!result) return STAGES.map(() => ({ tone: "idle", text: "Not run" }));
  const d = result.diagnostics || {};
  const n = (k) => (d[k] || []).length;
  const early = n("Lexer") + n("Parser");
  const mk = (count, label) => (count ? { tone: "bad", text: `${count} ${label}${count > 1 ? "s" : ""}` } : { tone: "ok", text: "Completed" });
  const later = early ? { tone: "warn", text: "Partial input" } : { tone: "ok", text: "Completed" };
  return [
    mk(n("Lexer"), "error"), mk(n("Parser"), "error"), mk(n("Semantic"), "error"),
    later,
    early ? later : { tone: "ok", text: `${result.finding_count} finding${result.finding_count === 1 ? "" : "s"}` },
    later,
  ];
}

export function StageStrip({ states, onSelect, selected }) {
  const ico = { ok: CircleCheck, bad: CircleAlert, warn: CircleAlert, idle: CircleDashed };
  return (
    <ol className="pipe">
      {STAGES.map((s, i) => {
        const Icon = s.icon, St = ico[states[i].tone];
        const Tag = onSelect ? "button" : "div";
        return (
          <li key={s.key} className={`pipe-i ${s.key === "security" ? "prime" : ""}`}>
            <Tag className={`pipe-stage ${selected === s.key ? "sel" : ""}`} onClick={onSelect ? () => onSelect(s.key) : undefined}
                 aria-pressed={onSelect ? selected === s.key : undefined}>
              <span className="pipe-ico"><Icon size={18} aria-hidden /></span>
              <span className="pipe-name">{i + 1}. {s.name}</span>
              <span className={`pipe-state ${states[i].tone}`}><St size={12} aria-hidden />{states[i].text}</span>
            </Tag>
            {i < STAGES.length - 1 && <span className="pipe-link" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

export default function OverviewPage() {
  const { result, findings, history, reopen, resultMeta } = useArgus();
  const hasAny = result || history.length > 0;

  if (!hasAny) {
    return (
      <>
        <PageHeader title="Overview" sub="Compiler-based vulnerability detection and root-cause analysis for C." />
        <EmptyState icon={ShieldAlert} title="Analyze your first program"
          body="Argus compiles C code through six stages, detects vulnerabilities, and traces each one back to its root cause. Nothing has been analyzed yet."
          action={<button className="btn btn-primary" onClick={() => go("/analyze")}><Play size={15} />Analyze Code</button>} />
        <section className="card pad"><h2 className="h-sm">Compiler pipeline</h2><StageStrip states={stageStates(null)} /></section>
      </>
    );
  }

  const byCls = Object.fromEntries(CLASSES.map((c) => [c, 0]));
  findings.forEach((f) => { byCls[f.vulnerability_type] = (byCls[f.vulnerability_type] || 0) + 1; });
  const high = findings.filter((f) => f.risk_score >= 7).length;
  const detected = Object.values(byCls).filter((n) => n > 0).length;
  const hasDiag = Object.values(result?.diagnostics || {}).some((v) => v && v.length);
  const status = !result ? "—" : hasDiag && !findings.length ? "Compiler errors" : findings.length ? "Findings detected" : "No findings";
  const filesN = resultMeta?.files?.length || 0;
  const mx = Math.max(1, ...Object.values(byCls));
  const risks = findings.map((f) => f.risk_score);
  const tier = (lo, hi) => findings.filter((f) => f.risk_score >= lo && f.risk_score < hi).length;

  return (
    <>
      <PageHeader title="Overview" sub="Summary of the latest analysis in this session."
        actions={<button className="btn btn-primary" onClick={() => go("/analyze")}><Play size={15} />Analyze Code</button>} />

      <div className="stats">
        <StatCard icon={ShieldAlert} label="Total findings" value={result ? findings.length : "—"} />
        <StatCard icon={Flame} label="High or critical" value={result ? high : "—"} tone={high ? "bad" : ""} hint="risk score ≥ 7" />
        <StatCard icon={Layers} label="Classes detected" value={result ? `${detected}/4` : "—"} />
        <StatCard icon={Files} label="Files analyzed" value={result ? filesN || 1 : "—"} />
        <StatCard icon={Activity} label="Latest status" value={<span className="stat-sm">{status}</span>}
                  hint={resultMeta ? `${resultMeta.source === "live" ? "live" : "manual"} · ${fmt(resultMeta.ts)}` : null} />
      </div>

      <div className="grid-2">
        <section className="card pad">
          <h2 className="h-sm">Vulnerability distribution</h2>
          <div className="bars">
            {CLASSES.map((c) => (
              <div key={c} className="bar-row"><span>{c}</span><div className="bar"><i style={{ width: `${(byCls[c] / mx) * 100}%` }} /></div><b className="mono">{byCls[c]}</b></div>
            ))}
          </div>
        </section>
        <section className="card pad">
          <h2 className="h-sm">Risk overview</h2>
          {risks.length ? (
            <>
              <div className="risk-sum">
                <div><span className="muted sm">Highest</span><b className="mono">{Math.max(...risks).toFixed(1)}</b></div>
                <div><span className="muted sm">Average</span><b className="mono">{(risks.reduce((a, b) => a + b, 0) / risks.length).toFixed(1)}</b></div>
                <div><span className="muted sm">Lowest</span><b className="mono">{Math.min(...risks).toFixed(1)}</b></div>
              </div>
              <div className="tiers">
                <span className="badge sev-critical">Critical {tier(9, 11)}</span><span className="badge sev-high">High {tier(7, 9)}</span>
                <span className="badge sev-medium">Medium {tier(4, 7)}</span><span className="badge sev-low">Low {tier(0, 4)}</span>
              </div>
            </>
          ) : <p className="muted">No findings in the latest analysis.</p>}
          <p className="muted sm">The risk score is a deterministic 0–10 ranking built from taint, reachability and mitigating checks. It is not the probability that a vulnerability will be exploited.</p>
        </section>
      </div>

      <section className="card pad">
        <div className="card-h"><h2>Compiler pipeline</h2><button className="btn btn-link" onClick={() => go("/pipeline")}>Explore stages</button></div>
        <StageStrip states={stageStates(result)} />
      </section>

      <section className="card pad">
        <div className="card-h"><h2><History size={15} aria-hidden /> Recent analyses</h2></div>
        {history.length === 0 ? (
          <p className="muted">No recorded analyses yet. Press <b>Analyze Code</b> to record one; live results are not listed here.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Files</th><th>Time</th><th>Findings</th><th>Highest risk</th><th><span className="sr">Open</span></th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{h.files.map((f) => f.name).join(", ")}</td>
                  <td>{fmt(h.ts)}</td>
                  <td>{h.result.finding_count}</td>
                  <td className="mono">{maxRisk(h.result) === null ? "—" : maxRisk(h.result).toFixed(1)}</td>
                  <td><button className="btn btn-link" onClick={() => { reopen(h); go("/findings"); }}><RotateCcw size={13} />Reopen report</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
