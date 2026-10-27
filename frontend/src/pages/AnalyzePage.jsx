import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Eraser, FilePlus2, X, Loader2, FlaskConical, ArrowRight, ShieldCheck, TriangleAlert, Crosshair, Download } from "lucide-react";
import { useArgus } from "../state/store.jsx";
import { fetchExamples } from "../api.js";
import { go } from "../router.js";
import CodeEditor from "../components/CodeEditor.jsx";
import AiPanel from "../components/AiPanel.jsx";
import FriendlyDiagnostics from "../components/FriendlyDiagnostics.jsx";
import RootCausePanel from "../components/RootCausePanel.jsx";
import ProofPanel from "../components/ProofPanel.jsx";
import { exportReportPdf } from "../pdf.js";
import { PageHeader, SeverityBadge, EmptyState, Skeleton } from "../ui/primitives.jsx";

const diagLine = (msg) => { const m = msg.match(/:\s*(\d+):(\d+):/); return m ? parseInt(m[1], 10) : null; };

export default function AnalyzePage() {
  const A = useArgus();
  const { files, active, activeIdx, setActiveIdx, result, findings } = A;
  const [examples, setExamples] = useState([]);
  const [hoverIdx, setHoverIdx] = useState(null);
  const [highlightId, setHighlightId] = useState(null);
  const [exErr, setExErr] = useState(null);
  useEffect(() => { fetchExamples().then(setExamples).catch(() => {}); }, []);

  // ---- resizable split (persisted) ----
  const wrap = useRef(null);
  const [pct, setPct] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("argus-split")); return v >= 30 && v <= 75 ? v : 56; } catch { return 56; }
  });
  useEffect(() => { try { localStorage.setItem("argus-split", String(pct)); } catch { /* ignore */ } }, [pct]);
  function drag(e) {
    e.preventDefault();
    const move = (ev) => {
      const r = wrap.current?.getBoundingClientRect();
      if (!r) return;
      setPct(Math.max(30, Math.min(75, ((ev.clientX - r.left) / r.width) * 100)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ---- gutter markers for the active file (engine findings, friendly diagnostics, AI hints) ----
  const markers = useMemo(() => {
    const out = [];
    if (result) {
      findings.forEach((f) => {
        if (f.file && f.file !== active.name) return;
        out.push({ id: `finding-${f.idx}`, line: f.line, severity: f.risk_score >= 7 ? "high" : f.risk_score >= 4 ? "medium" : "low",
          phase: "Security", title: f.vulnerability_type });
      });
      Object.entries(result.diagnostics || {}).forEach(([phase, errs]) => (errs || []).forEach((e, i) => {
        const fr = (result.friendly_diagnostics || []).find((d) => d.phase === phase && d.index === i);
        const line = fr?.line || diagLine(e);
        const fname = fr?.file || e.split(":")[0].trim();
        if (!line || (fname && fname !== active.name && /\.\w+$/.test(fname))) return;
        out.push({ id: `diag-${phase}-${i}`, line, severity: "high", phase, title: fr?.title || e });
      }));
    }
    (A.aiResult?.suggestions || []).forEach((s, i) => {
      if (s.line) out.push({ id: `ai-${i}`, line: s.line, severity: s.severity, phase: s.phase || "General", title: s.title, ai: true });
    });
    return out;
  }, [result, findings, A.aiResult, active.name]);

  function onMarkerClick(id) {
    if (id.startsWith("finding-")) { go(`/findings/${id.split("-")[1]}`); return; }
    setHighlightId(id);
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    setTimeout(() => setHighlightId((c) => (c === id ? null : c)), 1800);
  }

  // highlighted lines: hovered finding row, or a jump request from another page
  const hl = [];
  const hovered = hoverIdx !== null ? findings[hoverIdx] : null;
  if (hovered && (!hovered.file || hovered.file === active.name)) hl.push(hovered.line);
  const focusLine = A.focus && A.focus.file === active.name ? A.focus : null;
  if (focusLine) hl.push(focusLine.line);

  const hasDiag = Object.values(result?.diagnostics || {}).some((v) => v && v.length);

  return (
    <>
      <PageHeader title="Analyze Code" sub="Write or paste C. Argus compiles it through six stages and reports vulnerabilities with their root cause."
        actions={<>
          <label className="select-wrap" title="Load an example program">
            <FlaskConical size={15} aria-hidden />
            <select aria-label="Load example" value="" onChange={async (e) => {
              if (!e.target.value) return;
              try { setExErr(null); await A.loadExample(e.target.value); } catch (er) { setExErr(er.message); }
            }}>
              <option value="">Load Example</option>
              {examples.map((x) => <option key={x.name} value={x.name}>{x.category} — {x.desc}</option>)}
            </select>
          </label>
          <button className="btn btn-ghost" onClick={A.clearCode}><Eraser size={15} />Clear Code</button>
          <button className="btn btn-ghost" onClick={A.addFile}><FilePlus2 size={15} />Add File</button>
          <button className="btn btn-ghost" onClick={A.runProve} disabled={A.povBusy || !A.activeHasCode}
                  title="Generate a concrete triggering input or trace for each finding">
            {A.povBusy ? <><Loader2 size={15} className="spin" />Proving…</> : <><Crosshair size={15} />Prove exploitable</>}
          </button>
          {result && <button className="btn btn-ghost" onClick={() => exportReportPdf(result)}><Download size={15} />Export PDF</button>}
          <button className="btn btn-primary" onClick={A.onAnalyze} disabled={A.analyzing || !A.activeHasCode}>
            {A.analyzing ? <><Loader2 size={15} className="spin" />Analyzing…</> : <><Play size={15} />Analyze Code</>}
          </button>
        </>} />
      {exErr && <div className="alert err" role="alert">Could not load example: {exErr}</div>}

      <div className="split" ref={wrap} style={{ gridTemplateColumns: `minmax(0, ${pct}fr) 8px minmax(0, ${100 - pct}fr)` }}>
        <section className="card editor-card" aria-label="Source editor">
          <div className="tabs" role="tablist">
            {files.map((f, i) => (
              <span key={i} className={`tab ${i === activeIdx ? "active" : ""}`}>
                <button role="tab" aria-selected={i === activeIdx} onClick={() => setActiveIdx(i)} className="mono">{f.name}</button>
                {files.length > 1 && <button className="tab-x" aria-label={`Remove ${f.name}`} onClick={() => A.removeFile(i)}><X size={13} /></button>}
              </span>
            ))}
          </div>
          <div className="ed-bar">
            <label className="mono ed-name">File name
              <input value={active.name} onChange={(e) => A.renameActive(e.target.value)} spellCheck={false} aria-label="File name" />
            </label>
            <label className="check"><input type="checkbox" checked={A.liveOn} onChange={(e) => A.setLiveOn(e.target.checked)} />Live analysis</label>
            <label className="check"><input type="checkbox" checked={A.aiOn} onChange={(e) => A.setAiOn(e.target.checked)} />AI suggestions</label>
            <label className="check" title="Analyze every open file together (cross-file). Off: only the file in the editor.">
              <input type="checkbox" checked={A.scopeAll} onChange={(e) => A.setScopeAll(e.target.checked)} />Scan all tabs</label>
            <span className="muted ed-status">
              {A.liveBusy ? "analyzing…" : A.liveOn ? "up to date" : "paused"}
              {files.length > 1 ? ` · ${A.scopeAll ? `${files.length} files together` : "this file only"}` : ""}
            </span>
          </div>
          <CodeEditor value={active.code} onChange={A.setActiveCode} markers={markers} onMarkerClick={onMarkerClick}
                      highlight={hl} focusLine={focusLine} placeholder="Paste or type C code here…" />
        </section>

        <div className="gutter" onPointerDown={drag} onDoubleClick={() => setPct(56)} role="separator" aria-orientation="vertical"
             title="Drag to resize · double-click to reset" />

        <section className="results-col" aria-label="Analysis results" aria-live="polite">
          {A.error && <div className="alert err" role="alert"><TriangleAlert size={16} />{A.error}<span className="muted"> Your code is unchanged.</span></div>}

          {!result && !A.error && !A.analyzing && (
            <EmptyState icon={Play} title="No analysis yet"
              body={A.liveOn ? "Start typing and Argus analyzes automatically, or press Analyze Code to record a run." : "Press Analyze Code to compile and analyze your program."} />
          )}
          {A.analyzing && !result && (
            <div className="card pad"><Skeleton h={16} w="60%" /><Skeleton h={12} style={{ marginTop: 12 }} /><Skeleton h={12} w="80%" style={{ marginTop: 8 }} /></div>
          )}

          {result && (
            <div className={`card summary-card ${hasDiag ? "warn" : findings.length ? "bad" : "ok"}`}>
              <div className="sc-head">
                {hasDiag || findings.length ? <TriangleAlert size={18} /> : <ShieldCheck size={18} />}
                <strong>
                  {hasDiag && !findings.length ? "Compiler errors — analysis incomplete"
                    : findings.length ? `${findings.length} finding${findings.length > 1 ? "s" : ""} detected`
                    : "No supported vulnerabilities detected"}
                </strong>
                {A.resultMeta && <span className="badge muted">{A.resultMeta.source === "live" ? "live" : "analyzed"}</span>}
              </div>
              {!hasDiag && !findings.length && (
                <p className="muted">Argus checks four vulnerability classes in the supported C subset. This is not a guarantee that the program is secure.</p>
              )}
              {hasDiag && !findings.length && <p className="muted">The code does not fully parse, so the vulnerability scan could not complete. This is not a clean result.</p>}
            </div>
          )}

          {result && <FriendlyDiagnostics result={result} highlightId={highlightId} />}

          <ProofPanel result={A.povResult} busy={A.povBusy} error={A.povError} findings={findings} />

          <RootCausePanel groups={result?.groups} count={findings.length} onJump={(id) => go(`/findings/${id.split("-")[1]}`)} />

          {findings.length > 0 && (
            <div className="card">
              <div className="card-h"><h2>Findings</h2>
                <button className="btn btn-link" onClick={() => go("/findings")}>Open Findings <ArrowRight size={14} /></button></div>
              <ul className="flist">
                {findings.map((f) => (
                  <li key={f.idx}>
                    <button className="frow" onMouseEnter={() => setHoverIdx(f.idx)} onMouseLeave={() => setHoverIdx(null)}
                            onFocus={() => setHoverIdx(f.idx)} onBlur={() => setHoverIdx(null)} onClick={() => go(`/findings/${f.idx}`)}>
                      <SeverityBadge sev={f.severity} />
                      <span className="frow-t">{f.vulnerability_type}</span>
                      <span className="mono muted">{f.file ? `${f.file}:${f.line}` : `line ${f.line}`}</span>
                      <span className="mono frow-risk">{f.risk_score.toFixed(1)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <AiPanel status={A.aiStatus} result={A.aiResult} busy={A.aiBusy} error={A.aiError}
                   enabled={A.aiOn && (A.activeHasCode || A.aiStatus?.available === false)} highlightId={highlightId}
                   onApplyFix={A.applyFix} onApplyAll={A.applyAllFixes} applyingAll={A.applyingAll} />
        </section>
      </div>
    </>
  );
}
