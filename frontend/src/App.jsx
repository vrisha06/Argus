import React, { useEffect, useState } from "react";
import { fetchExamples, fetchExample, analyzeMulti } from "./api.js";
import FindingCard from "./components/FindingCard.jsx";

const PHASES = ["Lexer", "Parser", "Semantic", "IR + CFG", "Security", "Report"];

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

  const active = files[activeIdx];
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
  }, []);

  async function onLoadExample(name) {
    if (!name) return;
    try {
      const { code } = await fetchExample(name);
      setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { name, code } : f)));
      setResult(null);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }

  async function onAnalyze() {
    setBusy(true);
    setError(null);
    try {
      setResult(await analyzeMulti(files));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const diag = result?.diagnostics || {};
  const diagEntries = Object.entries(diag).filter(([, v]) => v && v.length);

  return (
    <div className="app">
      <header>
        <div className="brand">
          <span className="logo">⟡</span>
          <div>
            <h1>SecureCompile-X</h1>
            <p className="tag">Secure Code. Smarter Compilers. Safer Software.</p>
          </div>
        </div>
        <nav className="pipeline" title="Six-stage compiler pipeline">
          {PHASES.map((p) => (
            <span key={p} className={p === "Security" ? "hot" : ""}>{p}</span>
          ))}
        </nav>
      </header>

      <main>
        <section className="editor-pane">
          <div className="filebar">
            {files.map((f, i) => (
              <span key={i} className={`filetab ${i === activeIdx ? "active" : ""}`}>
                <button className="filetab-name" onClick={() => setActiveIdx(i)}>{f.name}</button>
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
          </div>
          <textarea
            className="code"
            spellCheck={false}
            value={active.code}
            onChange={(e) => setActiveCode(e.target.value)}
          />
        </section>

        <section className="report-pane">
          {error && <div className="summary err">⚠ {error}</div>}

          {!result && !error && (
            <div className="intro">
              <h4>What SecureCompile-X finds</h4>
              <ul className="intro-classes">
                <li><b>Buffer Overflow</b> — tainted or unbounded data reaching a copy/sink</li>
                <li><b>Use-After-Free</b> — a pointer used after <code>free</code>, or a double free</li>
                <li><b>Null-Pointer Dereference</b> — a <code>malloc</code>/null pointer dereferenced with no guard</li>
                <li><b>Unsafe Input Flow</b> — untrusted input reaching a command sink</li>
              </ul>
              <h4>Compiler-phase attribution</h4>
              <p className="intro-note">Each finding names the earliest phase that could detect it:</p>
              <div className="intro-pipeline">
                {PHASES.map((p) => (
                  <span key={p} className={p === "Security" ? "phase-chip" : "intro-chip"}>{p}</span>
                ))}
              </div>
              <h4>Risk score</h4>
              <p className="intro-note">
                Every finding is scored 0–10 from input origin, reachability from
                <code> main()</code>, and mitigating checks on the path.
              </p>
              <p className="intro-cta">
                Load a seeded example above, or paste your own C, then click <b>Analyze</b>.
              </p>
            </div>
          )}

          {result && (
            <>
              <div className={`summary ${result.finding_count ? "found" : "clean"}`}>
                {result.finding_count === 0 ? (
                  <span>✓ No vulnerabilities detected — <b>clean</b>.</span>
                ) : (
                  <span>
                    <b>{result.finding_count}</b> finding
                    {result.finding_count > 1 ? "s" : ""} in{" "}
                    <code>{result.source_file}</code>
                  </span>
                )}
              </div>

              {diagEntries.length > 0 && (
                <div className="diagnostics">
                  <h4>Compiler diagnostics</h4>
                  {diagEntries.map(([phase, errs]) => (
                    <div key={phase} className="diag-group">
                      <span className="diag-phase">{phase}</span>
                      <ul>{errs.map((e, i) => <li key={i}>{e}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}

              <div className="findings">
                {result.findings.map((f, i) => (
                  <FindingCard key={i} finding={f} index={i} />
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
