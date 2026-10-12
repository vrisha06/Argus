import React from "react";

function riskTier(score) {
  if (score >= 9) return { label: "CRITICAL", cls: "critical" };
  if (score >= 7) return { label: "HIGH", cls: "high" };
  if (score >= 4) return { label: "MEDIUM", cls: "medium" };
  return { label: "LOW", cls: "low" };
}

export default function FindingCard({ finding, index, id, highlighted }) {
  const f = finding;
  const tier = riskTier(f.risk_score);
  const p = f.phase_attribution;
  return (
    <article id={id} className={`card ${tier.cls} ${highlighted ? "flash" : ""}`}
             style={{ animationDelay: `${index * 70}ms` }}>
      <div className="card-head">
        <span className="idx">#{index + 1}</span>
        <h3>{f.vulnerability_type}</h3>
        <span className={`risk-badge ${tier.cls}`}>
          {f.risk_score.toFixed(1)}<small>/10 · {tier.label}</small>
        </span>
      </div>

      <div className="loc">
        <code>{f.location.function}()</code> ·{" "}
        {f.location.file ? `${f.location.file}:${f.location.line}` : `line ${f.location.line}`}
        <span className={`reach ${f.reachable_from_main ? "yes" : "no"}`}>
          {f.reachable_from_main ? "reachable from main" : "not reachable"}
        </span>
      </div>

      <div className="field">
        <h4>Root-cause trace</h4>
        <ol className="trace">
          {f.root_cause_trace.map((line, i) => <li key={i}><code>{line}</code></li>)}
        </ol>
      </div>

      <div className="field">
        <h4>Data-flow path</h4>
        <code className="flow">{f.data_flow_path}</code>
      </div>

      <div className="field phase">
        <h4>Compiler-phase attribution</h4>
        <div className="phase-row">
          <span className="phase-chip">{p.phase}</span>
          <span className="needs">needs {p.needs}</span>
        </div>
        <p className="why">{p.why}</p>
      </div>

      <div className="field fix">
        <h4>Suggested fix</h4>
        <p>{f.suggested_fix}</p>
      </div>
    </article>
  );
}
