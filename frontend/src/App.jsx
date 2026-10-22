import React, { useEffect, useMemo, useRef, useState } from "react";
import { fetchExamples, fetchExample, analyze, analyzeMulti, aiReview, aiFix, generatePov, fetchAiStatus, getUserId } from "./api.js";
import FindingCard from "./components/FindingCard.jsx";
import AiPanel from "./components/AiPanel.jsx";
import PovPanel from "./components/PovPanel.jsx";
import FriendlyDiagnostics from "./components/FriendlyDiagnostics.jsx";
import RootCausePanel from "./components/RootCausePanel.jsx";
import CodeEditor from "./components/CodeEditor.jsx";
import Analytics from "./components/Analytics.jsx";
import PipelineView from "./components/PipelineView.jsx";
import { exportReportPdf } from "./pdf.js";

const PHASES = ["Lexer", "Parser", "Semantic", "IR + CFG", "Security", "Report"];

// Map a 0–10 risk score to a marker severity.
const riskSeverity = (s) => (s >= 7 ? "high" : s >= 4 ? "medium" : "low");
// Short phase label for the gutter chips (e.g. "Security Analysis" -> "Security").
const shortPhase = (p) => (!p ? "General" : /security/i.test(p) ? "Security"
  : /ir/i.test(p) ? "IR" : p.split(" ")[0]);
// Pull the 1-based line out of a diagnostic string like "f.c: 2:1: msg".
const diagLine = (msg) => {
  const m = msg.match(/:\s*(\d+):(\d+):/);
  return m ? parseInt(m[1], 10) : null;
};


// Live-analysis debounce windows (ms after the last keystroke).
const ENGINE_DELAY = 650;   // the compiler engine is instant, so react fast
const AI_DELAY = 1800;      // Gemini is a network call — wait for a real pause

const STARTER = `/* Try me, or load a seeded example. */
void copy_name(char* input) {
    char buf[16];
    strcpy(buf, input);
}
int main() {
    char input[128];
    scanf("%s", input);
    copy_name(input);
    return 0;
}
`;

export default function App() {
  const [files, setFiles] = useState([{ name: "main.c", code: STARTER }]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [examples, setExamples] = useState([]);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Theme (light / dark) — defaults to the OS preference, then persists.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("scx-theme");
      if (saved === "light" || saved === "dark") return saved;
    } catch { /* ignore */ }
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("scx-theme", theme); } catch { /* ignore */ }
  }, [theme]);

  // Resizable split between the editor and report panes (percent width of editor).
  const mainRef = useRef(null);
  const [splitPct, setSplitPct] = useState(() => {
    try {
      const v = parseFloat(localStorage.getItem("scx-split"));
      if (v >= 20 && v <= 80) return v;
    } catch { /* ignore */ }
    return 50;
  });
  useEffect(() => {
    try { localStorage.setItem("scx-split", String(splitPct)); } catch { /* ignore */ }
  }, [splitPct]);
  function startDrag(e) {
    e.preventDefault();
    const move = (ev) => {
      const r = mainRef.current?.getBoundingClientRect();
      if (!r) return;
      const pct = ((ev.clientX - r.left) / r.width) * 100;
      setSplitPct(Math.max(25, Math.min(75, pct)));
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

  // Live analysis + AI assist state.
  const [liveOn, setLiveOn] = useState(true);
  const [liveBusy, setLiveBusy] = useState(false);
  const [aiOn, setAiOn] = useState(true);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const aiAbort = useRef(null);

  // Cross-panel linking: which right-panel detail is flashing from a marker click.
  const [highlightId, setHighlightId] = useState(null);
  const [applyingAll, setApplyingAll] = useState(false);
  // Proof-of-Vulnerability state.
  const [povResult, setPovResult] = useState(null);
  const [povBusy, setPovBusy] = useState(false);

  // View switch + analytics refresh trigger.
  const [view, setView] = useState("analyze");   // "analyze" | "analytics"
  const [analyticsKey, setAnalyticsKey] = useState(0);

  // Analyze the active tab only, or link all open tabs (PRD cross-file demo).
  const [scopeAll, setScopeAll] = useState(() => {
    try { return localStorage.getItem("scx-scope-all") === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem("scx-scope-all", scopeAll ? "1" : "0"); } catch { /* ignore */ }
  }, [scopeAll]);

  const active = files[activeIdx];
  // Only the file the user is on gets analyzed — unless "scan all tabs" is on.
  const activeHasCode = active.code.trim().length > 0;
  const filesKey = JSON.stringify(files);

  const setActiveCode = (code) =>
    setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, code } : f)));
  const setActiveName = (name) =>
    setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, name } : f)));
  const addFile = () => {
    setFiles((fs) => [...fs, { name: `file${fs.length + 1}.c`, code: "" }]);
    setActiveIdx(files.length);
  };
  const removeFile = (idx) => {
    if (files.length === 1) return;
    setFiles((fs) => fs.filter((_, i) => i !== idx));
    setActiveIdx((cur) => (cur >= idx && cur > 0 ? cur - 1 : cur));
  };

  useEffect(() => {
    fetchExamples().then(setExamples).catch(() => {});
    fetchAiStatus().then(setAiStatus).catch(() => {});
  }, []);

  // Live engine detection: debounced. Active file only, or all tabs if scopeAll.
  useEffect(() => {
    if (!liveOn || !activeHasCode) return;
    const t = setTimeout(async () => {
      setLiveBusy(true);
      try {
        const r = scopeAll ? await analyzeMulti(files)
                           : await analyze(active.code, active.name);
        setResult(r);
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLiveBusy(false);
      }
    }, ENGINE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, active.code, active.name, liveOn, scopeAll]);

  // AI assist on the ACTIVE file: longer debounce, aborts any in-flight request.
  useEffect(() => {
    if (!aiOn || !activeHasCode) return;
    if (aiStatus && aiStatus.available === false) return; // no key: show note only
    const t = setTimeout(async () => {
      if (aiAbort.current) aiAbort.current.abort();
      const ctrl = new AbortController();
      aiAbort.current = ctrl;
      setAiBusy(true);
      setAiError(null);
      try {
        const r = await aiReview([active], ctrl.signal);
        setAiResult(r);
      } catch (e) {
        if (e.name !== "AbortError") setAiError(e.message);
      } finally {
        if (aiAbort.current === ctrl) setAiBusy(false);
      }
    }, AI_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.code, active.name, aiOn, aiStatus]);

  async function onLoadExample(name) {
    if (!name) return;
    try {
      const { code } = await fetchExample(name);
      setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { name, code } : f)));
      setResult(null);
      setAiResult(null);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  // Manual Analyze: this is the one that gets RECORDED to self-analytics.
  async function onAnalyze() {
    setBusy(true);
    setError(null);
    const opts = { record: true, user: getUserId() };
    try {
      setResult(scopeAll ? await analyzeMulti(files, opts)
                         : await analyze(active.code, active.name, opts));
      setAnalyticsKey((k) => k + 1);   // so the dashboard reflects this run
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Proof-of-Vulnerability: synthesise a triggering input/trace per finding.
  async function onProve() {
    if (!activeHasCode || povBusy) return;
    setPovBusy(true);
    setError(null);
    try {
      setPovResult(await generatePov(active.code, active.name));
    } catch (e) {
      setError(e.message);
    } finally {
      setPovBusy(false);
    }
  }

  // Switching tabs: drop the previous file's results so findings never look
  // like they belong to the file now on screen (live analysis repopulates).
  function switchTo(idx) {
    if (idx === activeIdx) return;
    setActiveIdx(idx);
    setResult(null);
    setAiResult(null);
    setPovResult(null);
    setError(null);
  }

  const diag = result?.diagnostics || {};
  const diagEntries = Object.entries(diag).filter(([, v]) => v && v.length);
  const hasDiag = diagEntries.length > 0;

  // Hybrid markers for the editor gutter: the engine gives exact line + phase
  // (authoritative), Gemini adds predictive suggestions. Each marker links to a
  // detailed card on the right by id.
  const markers = useMemo(() => {
    const out = [];
    if (result) {
      // Markers anchor to the editor, so only keep this file's issues as dots;
      // cross-file results still render as cards on the right.
      (result.findings || []).forEach((f, i) => {
        const ffile = f.location?.file;
        if (ffile && ffile !== active.name) return;
        out.push({
          id: `finding-${i}`, line: f.location?.line,
          severity: riskSeverity(f.risk_score),
          phase: shortPhase(f.phase_attribution?.phase), title: f.vulnerability_type,
        });
      });
      Object.entries(result.diagnostics || {}).forEach(([phase, errs]) => {
        (errs || []).forEach((e, i) => {
          const fr = (result.friendly_diagnostics || []).find((d) => d.phase === phase && d.index === i);
          const line = fr?.line || diagLine(e);
          const fname = fr?.file || e.split(":")[0].trim();
          if (!line || (fname && fname !== active.name && /\.\w+$/.test(fname))) return;
          out.push({
            id: `diag-${phase}-${i}`, line, severity: "high", phase,
            title: fr?.title || e.replace(/^.*?:\s*\d+:\d+:\s*/, "") || e,
          });
        });
      });
    }
    (aiResult?.suggestions || []).forEach((s, i) => {
      if (s.line) out.push({
        id: `ai-${i}`, line: s.line, severity: s.severity,
        phase: s.phase || "General", title: s.title, ai: true,
      });
    });
    return out;
  }, [result, aiResult, active.name]);

  // Apply a Gemini suggestion's fix into the active file (#3).
  function applyFix(s) {
    if (!s?.fix) return;
    setFiles((fs) => fs.map((f, i) => {
      if (i !== activeIdx) return f;
      const fixLines = s.fix.split("\n");
      const lines = f.code.split("\n");
      if (s.line && s.line >= 1 && s.line <= lines.length) {
        lines.splice(s.line - 1, 1, ...fixLines);   // replace the referenced line
        return { ...f, code: lines.join("\n") };
      }
      const sep = f.code && !f.code.endsWith("\n") ? "\n" : "";
      return { ...f, code: f.code + sep + s.fix + "\n" };   // else append
    }));
  }

  // Apply ALL fixes in one click: Gemini rewrites the whole active file with
  // every issue fixed, and we replace the editor with the corrected source.
  // (Robust — avoids per-line snippet stitching, which the LLM's prose/line
  // inaccuracies made unreliable.)
  async function applyAllFixes() {
    if (!activeHasCode || applyingAll) return;
    setApplyingAll(true);
    setAiError(null);
    try {
      const r = await aiFix(active.code, active.name);
      if (r.error) setAiError(r.error);
      else if (r.code && r.code !== active.code) setActiveCode(r.code);
    } catch (e) {
      setAiError(e.message);
    } finally {
      setApplyingAll(false);
    }
  }

  function onMarkerClick(id) {
    setHighlightId(id);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1800);
  }
  const aiAvailable = aiResult ? aiResult.available : aiStatus?.available;

  return (
    <div className="app">
      <header>
        <div className="brand">
          <div>
            <h1>Argus</h1>
            <p className="tag">Secure Code. Smarter Compilers. Safer Software.</p>
          </div>
        </div>
        <div className="header-right">
          <div className="viewswitch">
            <button className={view === "analyze" ? "active" : ""}
                    onClick={() => setView("analyze")}>Analyzer</button>
            <button className={view === "pipeline" ? "active" : ""}
                    onClick={() => setView("pipeline")}>Pipeline</button>
            <button className={view === "analytics" ? "active" : ""}
                    onClick={() => setView("analytics")}>Analytics</button>
          </div>
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle light / dark mode"
          >
            {theme === "dark" ? "☀ Light" : "☾ Dark"}
          </button>
        </div>
      </header>

      {view === "analytics" ? (
        <main className="analytics-main">
          <Analytics userId={getUserId()} refreshKey={analyticsKey} />
        </main>
      ) : view === "pipeline" ? (
        <main className="analytics-main">
          <PipelineView code={active.code} filename={active.name} />
        </main>
      ) : (
      <main ref={mainRef}>
        <section className="editor-pane" style={{ width: `${splitPct}%` }}>
          <div className="filebar">
            {files.map((f, i) => (
              <span key={i} className={`filetab ${i === activeIdx ? "active" : ""}`}>
                <button className="filetab-name" onClick={() => switchTo(i)}>{f.name}</button>
                {files.length > 1 && (
                  <button className="filetab-x" title="remove file"
                          onClick={() => removeFile(i)}>×</button>
                )}
              </span>
            ))}
            <button className="filetab-add" onClick={addFile} title="add file">+ file</button>
          </div>
          <div className="pane-head">
            <label htmlFor="ex">Load example</label>
            <select id="ex" defaultValue="" onChange={(e) => onLoadExample(e.target.value)}>
              <option value="">— choose a seeded case —</option>
              {examples.map((x) => (
                <option key={x.name} value={x.name}>
                  {x.category} — {x.desc}
                </option>
              ))}
            </select>
            <input className="filename-input" value={active.name}
                   onChange={(e) => setActiveName(e.target.value)} spellCheck={false} />
            <button className="primary" onClick={onAnalyze} disabled={busy}>
              {busy ? <><span className="spinner" />Analyzing…</> : "▶ Analyze"}
            </button>
            <button className="pov-btn" onClick={onProve}
                    disabled={povBusy || !activeHasCode}
                    title="Synthesise a concrete triggering input / trace for each finding">
              {povBusy ? <><span className="spinner" />Proving…</>
                : <>🧪 Prove exploitable</>}
            </button>
          </div>
          <CodeEditor value={active.code} onChange={setActiveCode}
                      markers={markers} onMarkerClick={onMarkerClick} />
          <div className="live-bar">
            <label className="toggle">
              <input type="checkbox" checked={liveOn}
                     onChange={(e) => setLiveOn(e.target.checked)} />
              <span className="live-dot" /> Live detection
            </label>
            <label className="toggle">
              <input type="checkbox" checked={aiOn}
                     onChange={(e) => setAiOn(e.target.checked)} />
              <span className="ai-spark">✦</span> AI suggestions
            </label>
            <label className="toggle" title="Analyze every open tab together (cross-file)">
              <input type="checkbox" checked={scopeAll}
                     onChange={(e) => setScopeAll(e.target.checked)} />
              Scan all tabs
            </label>
            <span className="live-status">
              {liveBusy ? <><span className="spinner" />analyzing…</>
                : aiBusy ? <><span className="spinner" />AI reviewing…</>
                : liveOn ? "up to date" : "paused"}
            </span>
          </div>
        </section>

        <div
          className="gutter"
          onPointerDown={startDrag}
          onDoubleClick={() => setSplitPct(50)}
          title="Drag to resize · double-click to reset"
        />

        <section className="report-pane">
          {error && <div className="summary err">⚠ {error}</div>}

          <PovPanel result={povResult} busy={povBusy} />

          {!result && !error && (
            <div className="intro">
              <h4>What Argus finds</h4>
              <ul className="intro-classes">
                <li><b>Buffer Overflow</b> — tainted or unbounded data reaching a copy/sink</li>
                <li><b>Use-After-Free</b> — a pointer used after <code>free</code>, or a double free</li>
                <li><b>Null-Pointer Dereference</b> — a <code>malloc</code>/null pointer dereferenced with no guard</li>
                <li><b>Unsafe Input Flow</b> — untrusted input reaching a command sink</li>
              </ul>
              <h4>Live as you type</h4>
              <p className="intro-note">
                Detection runs automatically a moment after you stop typing — the
                compiler engine flags issues, and <b>AI suggestions</b> explain
                what may break later and how to fix it now.
              </p>
              <h4>Compiler-phase attribution</h4>
              <p className="intro-note">Each finding names the earliest phase that could detect it:</p>
              <div className="intro-pipeline">
                {PHASES.map((p) => (
                  <span key={p} className={p === "Security" ? "phase-chip" : "intro-chip"}>{p}</span>
                ))}
              </div>
              <p className="intro-cta">
                Load a seeded example above, or just start typing C.
              </p>
            </div>
          )}

          {result && (
            <>
              <div className="report-tools">
                <span className="rt-label">Export</span>
                <button onClick={() => exportReportPdf(result)}>⬇ PDF</button>
              </div>
              <div className={`summary ${result.finding_count ? "found" : hasDiag ? "warn" : "clean"}`}>
                {result.finding_count > 0 ? (
                  <span>
                    <b>{result.finding_count}</b> finding
                    {result.finding_count > 1 ? "s" : ""} in{" "}
                    <code>{result.source_file}</code>
                  </span>
                ) : hasDiag ? (
                  <span>
                    ⚠ Compiler errors — see <b>diagnostics</b> below. The code
                    doesn&apos;t fully parse, so the vulnerability scan is
                    incomplete, not a clean result.
                  </span>
                ) : (
                  <span>✓ No vulnerabilities detected — <b>clean</b>.</span>
                )}
              </div>

              <FriendlyDiagnostics result={result} highlightId={highlightId} />

              <RootCausePanel groups={result.groups} count={result.findings.length}
                              onJump={onMarkerClick} />

              <div className="findings">
                {result.findings.map((f, i) => (
                  <FindingCard key={i} finding={f} index={i}
                               id={`finding-${i}`} highlighted={highlightId === `finding-${i}`} />
                ))}
              </div>
            </>
          )}

          <AiPanel
            status={aiStatus}
            result={aiResult}
            busy={aiBusy}
            error={aiError}
            enabled={aiOn && (activeHasCode || aiAvailable === false)}
            highlightId={highlightId}
            onApplyFix={applyFix}
            onApplyAll={applyAllFixes}
            applyingAll={applyingAll}
          />
        </section>
      </main>
      )}
    </div>
  );
}
