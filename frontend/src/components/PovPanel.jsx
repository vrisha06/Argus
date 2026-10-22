import React, { useState } from "react";
import MemoryWalkthrough from "./MemoryWalkthrough.jsx";

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="pov-copy" onClick={() => {
      try { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* ignore */ }
    }}>{done ? "copied" : "copy"}</button>
  );
}

export default function PovPanel({ result, busy }) {
  const [open, setOpen] = useState({});
  if (!result && !busy) return null;

  return (
    <div className="pov-panel">
      <div className="pov-head">
        <h4><span className="pov-ico">🧪</span> Proof of Vulnerability
          {busy && <span className="pov-busy"><span className="spinner" />generating…</span>}
        </h4>
        {result && (
          <span className="pov-count">
            {result.summary.confirmed} of {result.summary.total} proven exploitable
          </span>
        )}
      </div>

      {result && result.summary.total === 0 && (
        <p className="pov-note">No findings to prove — run <b>Analyze</b> first (or the code is clean).</p>
      )}

      {result && result.povs.map((p, i) => (
        <div key={i} className={`pov-item ${p.status}`}>
          <div className="pov-item-head">
            <span className={`pov-badge ${p.status}`}>
              {p.status === "confirmed" ? "Exploitable · PoV" : "Unreachable · no PoV"}
            </span>
            <span className="pov-type">{p.type}</span>
            <span className="pov-line">line {p.line} · {p.function}()</span>
          </div>

          {p.input != null && (
            <div className="pov-witness">
              <span className="pov-wlabel">
                Triggering input{p.delivery ? ` — type this at ${p.delivery}` : ""}
              </span>
              <div className="pov-wrow">
                <code>{p.input}</code>
                <CopyBtn text={p.input} />
              </div>
            </div>
          )}

          {p.trigger && <p className="pov-trigger"><b>Trigger condition:</b> {p.trigger}</p>}
          {p.explanation && <p className="pov-expl">{p.explanation}</p>}

          {p.memory && (
            <div className="pov-mw">
              <button className="pov-mw-toggle" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                {open[i] ? "▾ Hide walkthrough" : "▸ Show how it happens"}
              </button>
              {open[i] && <MemoryWalkthrough memory={p.memory} />}
            </div>
          )}

          {p.trace && p.trace.length > 0 && (
            <ol className="pov-trace">
              {p.trace.map((t, k) => <li key={k}><code>{t}</code></li>)}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}
