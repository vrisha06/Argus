import React, { useEffect, useState } from "react";
import { Bug, ShieldCheck, Files, Code2, Loader2 } from "lucide-react";
import { fetchExamples, fetchExample } from "../api.js";
import { useArgus } from "../state/store.jsx";
import { go } from "../router.js";
import CodeView from "../ui/CodeView.jsx";
import { PageHeader, EmptyState } from "../ui/primitives.jsx";

function Card({ ex }) {
  const A = useArgus();
  const [code, setCode] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function toggle() {
    if (!open && !code) {
      try {
        const r = await fetchExample(ex.name);
        setCode(r.files ? r.files : [{ name: ex.name, code: r.code }]);
      } catch (e) { setErr(e.message); return; }
    }
    setOpen(!open);
  }
  async function load() {
    setBusy(true); setErr(null);
    try { await A.loadExample(ex.name); go("/analyze"); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <article className="card pad ex">
      <div className="ex-top">
        <span className="mono ex-name">{ex.multifile ? ex.name.replace(/_flow$/, "") : ex.name}</span>
        {ex.multifile && <span className="badge muted"><Files size={12} aria-hidden />multi-file</span>}
      </div>
      <p className="ex-desc">{ex.desc}</p>
      <span className={`badge ${ex.kind === "safe" ? "reach-no" : "sev-high"}`}>{ex.kind === "safe" ? "No supported vulnerability" : ex.category}</span>
      {err && <p className="alert err sm">{err}</p>}
      <div className="ex-actions">
        <button className="btn btn-primary btn-sm" onClick={load} disabled={busy}>{busy ? <Loader2 size={14} className="spin" /> : null}Load Example</button>
        <button className="btn btn-ghost btn-sm" onClick={toggle} aria-expanded={open}><Code2 size={14} />{open ? "Hide code" : "View code"}</button>
      </div>
      {open && code && code.map((f) => <CodeView key={f.name} code={f.code} name={f.name} context={null} />)}
    </article>
  );
}

export default function ExamplesPage() {
  const [list, setList] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { fetchExamples().then(setList).catch((e) => setErr(e.message)); }, []);

  if (err) return <EmptyState title="Could not load examples" body={err} />;
  if (!list) return <PageHeader title="Examples" sub="Loading examples…" />;

  const vuln = list.filter((e) => e.kind !== "safe");
  const safe = list.filter((e) => e.kind === "safe");
  return (
    <>
      <PageHeader title="Examples" sub="Real programs from the project's test suite. Load one, then analyze it to see actual results — nothing here is pre-computed." />
      <h2 className="h-sec"><Bug size={16} aria-hidden /> Vulnerable programs <span className="muted sm">{vuln.length}</span></h2>
      <div className="ex-grid">{vuln.map((e) => <Card key={e.name} ex={e} />)}</div>
      <h2 className="h-sec"><ShieldCheck size={16} aria-hidden /> Safe programs <span className="muted sm">{safe.length}</span></h2>
      <div className="ex-grid">{safe.map((e) => <Card key={e.name} ex={e} />)}</div>
    </>
  );
}
