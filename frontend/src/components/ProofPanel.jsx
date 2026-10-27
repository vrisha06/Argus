import React, { useState } from "react";
import { FlaskConical, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import MemoryWalkthrough from "./MemoryWalkthrough.jsx";
import { CopyButton } from "../ui/primitives.jsx";
import { go } from "../router.js";

// Whole-file proof of vulnerability: a witness for every finding, with an
// "N of M proven exploitable" summary and a step-through walkthrough per proof.
export default function ProofPanel({ result, busy, error, findings }) {
  const [open, setOpen] = useState({});
  if (!result && !busy && !error) return null;
  const idxOf = (p) => findings.find((f) => f.class === p.class && f.line === p.line)?.idx;

  return (
    <section className="card pad pp" aria-label="Proof of vulnerability">
      <div className="card-h">
        <h2><FlaskConical size={15} aria-hidden /> Proof of vulnerability</h2>
        {busy && <span className="muted sm"><Loader2 size={13} className="spin" /> generating…</span>}
        {result && <span className="badge sev-high">{result.summary.confirmed} of {result.summary.total} proven exploitable</span>}
      </div>
      {error && <p className="alert err">{error}</p>}
      {result && result.summary.total === 0 && <p className="muted">No findings to prove — the code has no supported vulnerabilities.</p>}
      {result && result.povs.map((p, i) => (
        <div key={i} className={`pp-item ${p.status}`}>
          <div className="pp-head">
            <span className={`badge ${p.status === "confirmed" ? "sev-high" : "muted"}`}>
              {p.status === "confirmed" ? "Exploitable path found" : "Unreachable — no proof"}</span>
            <b>{p.type}</b>
            <span className="muted mono sm">line {p.line} · {p.function}()</span>
            {idxOf(p) !== undefined && <button className="btn btn-link sm" onClick={() => go(`/findings/${idxOf(p)}`)}>Open finding</button>}
          </div>
          {p.input != null && (
            <div className="snip">
              <div className="snip-h"><span className="muted sm">Triggering input{p.delivery ? ` — type this at ${p.delivery}` : ""}</span><CopyButton text={p.input} /></div>
              <pre className="mono wrap">{p.input}</pre>
            </div>
          )}
          {p.trigger && <p className="sm"><b>Trigger condition:</b> <span className="mono">{p.trigger}</span></p>}
          {p.explanation && <p className="sm">{p.explanation}</p>}
          {p.memory && (
            <>
              <button className="btn btn-link" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                {open[i] ? <ChevronUp size={14} /> : <ChevronDown size={14} />}{open[i] ? "Hide walkthrough" : "Show how it happens"}</button>
              {open[i] && <MemoryWalkthrough memory={p.memory} />}
            </>
          )}
        </div>
      ))}
    </section>
  );
}
