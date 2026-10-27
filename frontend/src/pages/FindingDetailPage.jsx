import React, { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink, ChevronDown, ChevronUp, FlaskConical, Loader2, Lightbulb, SearchX } from "lucide-react";
import { useArgus } from "../state/store.jsx";
import { generatePov } from "../api.js";
import { go } from "../router.js";
import CodeView from "../ui/CodeView.jsx";
import FlowGraph from "../components/FlowGraph.jsx";
import PhaseStrip from "../components/PhaseStrip.jsx";
import MemoryWalkthrough from "../components/MemoryWalkthrough.jsx";
import { SeverityBadge, ReachBadge, EmptyState, CopyButton, Tip } from "../ui/primitives.jsx";

// Recommendation derived from the actual vulnerable source line. Never applied automatically.
function suggestSnippet(lineText) {
  const t = (lineText || "").trim();
  let m;
  if ((m = t.match(/^strcpy\(\s*(\w+)\s*,\s*(.+?)\s*\)\s*;?$/)))
    return `strncpy(${m[1]}, ${m[2]}, sizeof(${m[1]}) - 1);\n${m[1]}[sizeof(${m[1]}) - 1] = '\\0';`;
  if ((m = t.match(/^strcat\(\s*(\w+)\s*,\s*(.+?)\s*\)\s*;?$/)))
    return `strncat(${m[1]}, ${m[2]}, sizeof(${m[1]}) - strlen(${m[1]}) - 1);`;
  if ((m = t.match(/^gets\(\s*(\w+)\s*\)\s*;?$/))) return `fgets(${m[1]}, sizeof(${m[1]}), stdin);`;
  if ((m = t.match(/^sprintf\(\s*(\w+)\s*,\s*(.+)\)\s*;?$/))) return `snprintf(${m[1]}, sizeof(${m[1]}), ${m[2]});`;
  if ((m = t.match(/^free\(\s*(\w+)\s*\)\s*;?$/))) return `free(${m[1]});\n${m[1]} = NULL;   /* and do not use ${m[1]} again */`;
  if ((m = t.match(/^\*\s*(\w+)\b/))) return `if (${m[1]} == NULL) {\n    return 1;   /* handle the failed allocation */\n}\n${t}`;
  if ((m = t.match(/^system\(\s*(\w+)\s*\)\s*;?$/))) return `/* validate ${m[1]} against an allowlist before running it */\nif (is_allowed(${m[1]})) {\n    ${t}\n}`;
  return null;
}

function RiskBreakdown({ rf, score }) {
  if (!rf) return <p className="muted">Score breakdown unavailable.</p>;
  return (
    <>
      <ul className="rb">
        {rf.factors.map((x) => (
          <li key={x.key} className={x.applied ? "on" : "off"}>
            <span>{x.label}</span>
            <b className="mono">{x.applied ? `${x.points > 0 ? "+" : ""}${x.points.toFixed(1)}` : "—"}</b>
          </li>
        ))}
      </ul>
      <p className="muted sm">
        Sum {rf.raw_total.toFixed(1)}{rf.raw_total !== score ? `, limited to the 0–10 range = ${score.toFixed(1)}` : ""}. The score ranks findings
        deterministically; it is <b>not</b> a probability of exploitation.
      </p>
    </>
  );
}

export default function FindingDetailPage({ id }) {
  const A = useArgus();
  const { findings, result, files } = A;
  const f = id !== null ? findings[id] : undefined;
  const flow = f ? result?.flows?.find((x) => x.finding_index === f.idx) : null;
  const rf = f ? result?.risk_factors?.[f.idx] : null;

  const codeOf = (name) => (files.find((x) => x.name === name) || (files.length === 1 ? files[0] : null))?.code;
  const [view, setView] = useState(null);                 // override of {file,line} for the evidence viewer
  const [open, setOpen] = useState({});
  const [pov, setPov] = useState({ busy: false, data: null, err: null });
  const [mw, setMw] = useState(false);
  const shared = f && A.povResult && A.povResult.file === f.file
    ? (A.povResult.povs.find((x) => x.class === f.class && x.line === f.line) || null) : null;
  const pd = pov.data || shared;

  const loc = view && f && view.of === f.idx ? view : (f ? { file: f.file, line: f.line } : null);
  const code = f ? codeOf(loc.file) : null;
  const lineText = (c, n) => (c ? c.split("\n")[n - 1] : "");

  const related = useMemo(() => (flow?.nodes || []).filter((n) => n.file && n.line), [flow]);
  const snippet = useMemo(() => (f ? suggestSnippet(lineText(codeOf(f.file), f.line)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f, files]);

  if (!f) {
    return (
      <EmptyState icon={SearchX} title="Finding not found"
        body={result ? "This finding is not part of the current analysis." : "There is no analysis to show. Analyze a program first."}
        action={<button className="btn btn-primary" onClick={() => go("/findings")}>Back to findings</button>} />
    );
  }

  async function prove() {
    const c = codeOf(f.file);
    if (!c) { setPov({ busy: false, data: null, err: "Source for this file is not available." }); return; }
    setPov({ busy: true, data: null, err: null });
    try {
      const r = await generatePov(c, f.file || "input.c");
      const m = r.povs.find((p) => p.class === f.class && p.line === f.line) || null;
      setPov({ busy: false, data: m || false, err: null });
    } catch (e) { setPov({ busy: false, data: null, err: e.message }); }
  }

  const steps = (f.root_cause_trace || []).map((t) => {
    const m = t.match(/^L(\d+):\s*(.*)$/);
    return { text: m ? m[2] : t, line: m ? Number(m[1]) : null };
  });

  return (
    <>
      <div className="dh card pad">
        <div className="dh-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => go("/findings")}><ArrowLeft size={14} />Back to findings</button>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" disabled={f.idx === 0} onClick={() => go(`/findings/${f.idx - 1}`)} aria-label="Previous finding"><ChevronLeft size={14} /></button>
          <span className="muted sm mono">{f.idx + 1} / {findings.length}</span>
          <button className="btn btn-ghost btn-sm" disabled={f.idx >= findings.length - 1} onClick={() => go(`/findings/${f.idx + 1}`)} aria-label="Next finding"><ChevronRight size={14} /></button>
        </div>
        <h1 className="dh-title">{f.vulnerability_type}</h1>
        <div className="dh-meta">
          <SeverityBadge sev={f.severity} />
          <span className="badge muted mono">{f.file ? `${f.file}:${f.line}` : `line ${f.line}`}</span>
          <span className="badge muted mono">{f.location?.function}()</span>
          <span className="badge muted mono">risk {f.risk_score.toFixed(1)}/10</span>
          <ReachBadge reachable={f.reachable_from_main} />
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="card pad" id="evidence">
            <div className="card-h"><h2>Source evidence</h2>
              <button className="btn btn-link" onClick={() => A.openInEditor(loc.file, loc.line)}><ExternalLink size={14} />Open in editor</button></div>
            {code ? <CodeView code={code} name={loc.file || "source"} hit={[loc.line]} context={4} />
              : <p className="muted">Source for this location is not available in the workspace.</p>}
            {related.length > 0 && (
              <div className="rel"><span className="muted sm">Related locations</span>
                {related.map((n) => (
                  <button key={n.id} className={`chip ${loc.file === n.file && loc.line === n.line ? "on" : ""}`}
                          onClick={() => setView({ of: f.idx, file: n.file, line: n.line })}>
                    <span className="mono">{n.file}:{n.line}</span> · {n.kind}</button>))}
              </div>
            )}
          </section>

          <section className="card pad">
            <h2 className="h-sm">Root-cause trace</h2>
            <ol className="trace">
              {steps.map((s, i) => {
                const text = s.line ? lineText(codeOf(f.file), s.line) : "";
                const isOpen = !!open[i];
                return (
                  <li key={i}>
                    <span className="trace-n">{i + 1}</span>
                    <div className="trace-body">
                      <p>{s.text}</p>
                      {s.line && (
                        <>
                          <button className="btn btn-link sm" aria-expanded={isOpen} onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                            {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{f.file ? `${f.file}:` : "line "}{s.line}
                          </button>
                          {isOpen && (
                            <div className="trace-ev"><code className="mono">{text.trim() || "(source unavailable)"}</code>
                              <button className="btn btn-link sm" onClick={() => A.openInEditor(f.file, s.line)}>Open in editor</button></div>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="card pad">
            <h2 className="h-sm">Data flow <span className="muted sm">source → sink</span></h2>
            <FlowGraph flow={flow} onNodeClick={(n) => { setView({ of: f.idx, file: n.file, line: n.line }); document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                       activeId={related.find((n) => n.file === loc.file && n.line === loc.line)?.id} />
            <p className="flow-raw mono">{f.data_flow_path}</p>
          </section>

          <section className="card pad">
            <h2 className="h-sm">Compiler-phase attribution</h2>
            <PhaseStrip attribution={f.phase_attribution} />
          </section>
        </div>

        <aside className="detail-side">
          <section className="card pad">
            <h2 className="h-sm">Risk score</h2>
            <div className="bigscore"><b className="mono">{f.risk_score.toFixed(1)}</b><span>/10</span><SeverityBadge sev={f.severity} /></div>
            <RiskBreakdown rf={rf} score={f.risk_score} />
          </section>

          <section className="card pad">
            <h2 className="h-sm">Reachability</h2>
            <ReachBadge reachable={f.reachable_from_main} />
            <p className="muted sm">
              {f.reachable_from_main
                ? "A call path from main() reaches this code in the analysis."
                : "No call path from main() reaches this code in the analysis."}{" "}
              <Tip text="Reachability only says the code can run. Exploitability also depends on who controls the input.">Reachable ≠ exploitable.</Tip>
            </p>
          </section>

          <section className="card pad">
            <h2 className="h-sm"><Lightbulb size={15} aria-hidden /> Suggested fix</h2>
            <p>{f.suggested_fix}</p>
            {snippet && (
              <div className="snip">
                <div className="snip-h"><span className="muted sm">Suggested alternative</span><CopyButton text={snippet} /></div>
                <pre className="mono">{snippet}</pre>
              </div>
            )}
            <p className="muted sm">A recommendation only. It is not applied, tested or verified by Argus — review it in the context of your program.</p>
          </section>

          <section className="card pad">
            <h2 className="h-sm"><FlaskConical size={15} aria-hidden /> Proof of vulnerability</h2>
            {!pd && pov.data !== false && (
              <button className="btn btn-ghost" onClick={prove} disabled={pov.busy}>
                {pov.busy ? <><Loader2 size={14} className="spin" />Generating…</> : "Generate proof"}</button>
            )}
            {pov.err && <p className="alert err">{pov.err}</p>}
            {pov.data === false && !shared && <p className="muted sm">A proof could not be generated for this finding.</p>}
            {pd && (
              <>
                <span className={`badge ${pd.status === "confirmed" ? "sev-high" : "muted"}`}>
                  {pd.status === "confirmed" ? "Exploitable path found" : "Unreachable — no proof"}</span>
                {pd.input != null && (
                  <div className="snip"><div className="snip-h"><span className="muted sm">Triggering input{pd.delivery ? ` via ${pd.delivery}` : ""}</span>
                    <CopyButton text={pd.input} /></div><pre className="mono wrap">{pd.input}</pre></div>
                )}
                {pd.trigger && <p className="sm"><b>Trigger:</b> <span className="mono">{pd.trigger}</span></p>}
                {pd.explanation && <p className="sm">{pd.explanation}</p>}
                {pd.memory && (
                  <>
                    <button className="btn btn-link" onClick={() => setMw(!mw)}>{mw ? "Hide walkthrough" : "Show how it happens"}</button>
                    {mw && <MemoryWalkthrough memory={pd.memory} />}
                  </>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
