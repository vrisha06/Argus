import React, { useEffect, useRef, useState } from "react";
import { inspectPipeline } from "../api.js";

// Each stage: id (for scroll), chip label, heading, and a plain-English blurb.
const STAGES = [
  {
    id: "stage-lexer", chip: "1 · Lexer", heading: "1 · Lexer — token stream",
    blurb: "The first stage reads your raw source text and splits it into tokens — the smallest meaningful pieces: keywords, names, numbers and symbols. Like breaking a sentence into words. Each chip below is one token; the tiny label is its kind.",
  },
  {
    id: "stage-parser", chip: "2 · Parser", heading: "2 · Parser — abstract syntax tree (AST)",
    blurb: "The parser turns that flat list of tokens into a tree that captures structure — which expressions belong to which statements, and which statements to which function. Every later stage works on this tree. Indentation = nesting.",
  },
  {
    id: "stage-semantic", chip: "3 · Semantic", heading: "3 · Semantic — symbol table & call graph",
    blurb: "Now the compiler works out meaning. It records every name you declared in a symbol table (its type, kind, scope and line) and builds a call graph of which function calls which. This is where types are checked and undeclared names are caught.",
  },
  {
    id: "stage-ir", chip: "4 · IR (TAC)", heading: "4 · IR — three-address code (TAC)",
    blurb: "The tree is lowered into simple, uniform instructions — each doing one operation, e.g. t1 = a + b. Names like t1, t2 are temporary values the compiler invents. This flat form makes data flow explicit, which is exactly what the security analysis needs.",
  },
  {
    id: "stage-cfg", chip: "5 · CFG", heading: "5 · CFG — control-flow graph",
    blurb: "The instructions are grouped into basic blocks (straight runs with no jumps) joined by edges that show how control can flow — the branches of your if / while / for. The security engine walks this graph to follow tainted data and to check whether a guard protects a dereference. An edge tagged [p≠0] means “on this branch, p is known to be non-NULL.”",
  },
];

function AstNode({ node, lit }) {
  if (!node) return null;
  const hot = lit.has(node.line);
  return (
    <li>
      <span className={`ast-label ${hot ? "hot" : ""}`}>
        {node.label}
        {node.line ? <span className="ast-line">L{node.line}</span> : null}
      </span>
      {node.children && node.children.length > 0 && (
        <ul>{node.children.map((c, i) => <AstNode key={i} node={c} lit={lit} />)}</ul>
      )}
    </li>
  );
}

function scrollTo(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function PipelineView({ code, filename }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const abort = useRef(null);

  useEffect(() => {
    if (!code.trim()) { setData(null); return; }
    const t = setTimeout(async () => {
      if (abort.current) abort.current.abort();
      const ctrl = new AbortController();
      abort.current = ctrl;
      setLoading(true);
      try {
        const r = await inspectPipeline(code, filename, ctrl.signal);
        setData(r); setError(null);
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      } finally {
        if (abort.current === ctrl) setLoading(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [code, filename]);

  if (!code.trim()) {
    return <div className="pipeline"><p className="pl-empty">Write some C in the <b>Analyzer</b> tab, then come back here — this view opens up the compiler and shows you exactly what it does to your code, step by step.</p></div>;
  }
  if (!data) {
    return <div className="pipeline"><p className="pl-empty">{error ? `⚠ ${error}` : "Inspecting the pipeline…"}</p></div>;
  }

  const lit = new Set(data.finding_lines || []);
  const hasVuln = lit.size > 0;

  return (
    <div className="pipeline">
      <div className="pl-head">
        <h2>Glass-box pipeline {loading && <span className="pl-busy"><span className="spinner" />refreshing…</span>}</h2>
        <p className="pl-sub">
          Here is your file <code>{data.source_file}</code> seen the way the <b>compiler</b> sees it.
          A compiler doesn't read code all at once — it passes it through stages, each transforming
          the output of the last. The cards below are those stages, in order. Click a step to jump to it.
        </p>
        <div className="pl-stages">
          {STAGES.map((s) => (
            <button key={s.id} className="pl-stagechip" onClick={() => scrollTo(s.id)}>{s.chip}</button>
          ))}
        </div>
        <div className="pl-legend">
          <span className="pl-legend-item"><span className="pl-swatch hot" /> highlighted = a line that produces a vulnerability</span>
          <span className="pl-legend-item"><span className="pl-swatch" /> the same bug lights up across every stage, so you can trace it</span>
        </div>
      </div>

      {hasVuln ? (
        <div className="pl-flow">
          <h4>⚠ Tainted data-flow — the bug's journey from source to sink</h4>
          <p className="pl-flow-note">
            This is the heart of the tool: it follows an untrusted value from where it enters the
            program to where it causes harm. Watch these lines stay highlighted through every stage below.
          </p>
          {data.findings.map((f, i) => (
            <div key={i} className="pl-flow-row">
              <span className="pl-flow-type">{f.type}</span>
              <code>{f.flow}</code>
            </div>
          ))}
        </div>
      ) : (
        <div className="pl-clean">✓ This program is clean — no vulnerable lines to trace. The stages below still show how it was compiled.</div>
      )}

      {/* 1 · Lexer */}
      <section id="stage-lexer" className="pl-card">
        <h3>{STAGES[0].heading} <span className="pl-count">{data.tokens.length} tokens</span></h3>
        <p className="pl-desc">{STAGES[0].blurb}</p>
        <div className="tok-row">
          {data.tokens.map((t, i) => (
            <span key={i} className={`tok ${lit.has(t.line) ? "hot" : ""}`} title={`line ${t.line}:${t.col}`}>
              <span className="tok-kind">{t.kind}</span>
              {t.value !== "" && <span className="tok-val">{t.value}</span>}
            </span>
          ))}
        </div>
      </section>

      {/* 2 · AST */}
      <section id="stage-parser" className="pl-card">
        <h3>{STAGES[1].heading}</h3>
        <p className="pl-desc">{STAGES[1].blurb}</p>
        <ul className="ast-tree">{data.ast && <AstNode node={data.ast} lit={lit} />}</ul>
      </section>

      {/* 3 · Semantic */}
      <section id="stage-semantic" className="pl-card">
        <h3>{STAGES[2].heading}</h3>
        <p className="pl-desc">{STAGES[2].blurb}</p>
        <table className="sym-table">
          <thead><tr><th>name</th><th>type</th><th>kind</th><th>scope</th><th>declared at</th></tr></thead>
          <tbody>
            {data.symbols.map((s, i) => (
              <tr key={i}>
                <td className="mono">{s.name}</td><td className="mono">{s.type}</td>
                <td>{s.kind}</td><td>{s.scope}</td><td>{s.line ? `line ${s.line}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.callgraph.edges.length > 0 && (
          <div className="cg">
            <span className="cg-title">Call graph (who calls whom)</span>
            {data.callgraph.edges.map((e, i) => (
              <span key={i} className="cg-edge">{e.from} → {e.to} <small>L{e.line}</small></span>
            ))}
          </div>
        )}
      </section>

      {/* 4 · TAC */}
      <section id="stage-ir" className="pl-card">
        <h3>{STAGES[3].heading}</h3>
        <p className="pl-desc">{STAGES[3].blurb}</p>
        {Object.entries(data.tac).map(([fn, instrs]) => (
          <div key={fn} className="tac-fn">
            <div className="tac-fn-name">{fn}()</div>
            <pre className="tac">
              {instrs.map((i, k) => (
                <div key={k} className={`tac-line ${lit.has(i.line) ? "hot" : ""}`}>
                  <span className="tac-ln">L{i.line}</span>{i.text}
                </div>
              ))}
            </pre>
          </div>
        ))}
      </section>

      {/* 5 · CFG */}
      <section id="stage-cfg" className="pl-card">
        <h3>{STAGES[4].heading}</h3>
        <p className="pl-desc">{STAGES[4].blurb}</p>
        {Object.entries(data.cfg).map(([fn, blocks]) => (
          <div key={fn} className="cfg-fn">
            <div className="tac-fn-name">{fn}()</div>
            <div className="cfg-blocks">
              {blocks.map((b) => {
                const hot = b.instrs.some((i) => lit.has(i.line));
                return (
                  <div key={b.id} className={`cfg-block ${hot ? "hot" : ""}`}>
                    <div className="cfg-bid">Block BB{b.id}{hot ? " · contains the bug" : ""}</div>
                    <pre className="cfg-code">
                      {b.instrs.length
                        ? b.instrs.map((i, k) => <div key={k}>{i.text}</div>)
                        : <div className="dim">(empty)</div>}
                    </pre>
                    <div className="cfg-edges">
                      {b.succ.length === 0
                        ? <span className="cfg-exit">→ exit (function returns)</span>
                        : b.succ.map((s, k) => (
                            <span key={k} className="cfg-edge">
                              → BB{s.to}{s.nonnull.length ? <em> [{s.nonnull.join(",")}≠0]</em> : null}
                            </span>
                          ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
