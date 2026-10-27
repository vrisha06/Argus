import React, { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useArgus } from "../state/store.jsx";
import { inspectPipeline } from "../api.js";
import { go } from "../router.js";
import PipelineView from "../components/PipelineView.jsx";
import { STAGES } from "../components/PhaseStrip.jsx";
import { StageStrip, stageStates } from "./OverviewPage.jsx";
import { PageHeader, SeverityBadge, EmptyState } from "../ui/primitives.jsx";

const countNodes = (n) => (n ? 1 + (n.children || []).reduce((a, c) => a + countNodes(c), 0) : 0);

const INFO = {
  lexer: { purpose: "Converts source text into tokens, each with a line and column.", input: "C source text", output: "Token stream" },
  parser: { purpose: "Builds the abstract syntax tree with a recursive-descent parser, recovering at statement boundaries.", input: "Token stream", output: "Abstract syntax tree" },
  semantic: { purpose: "Builds the symbol table, checks types and undeclared names, and constructs the call graph.", input: "Abstract syntax tree", output: "Symbol table and call graph" },
  ir: { purpose: "Lowers the tree to three-address code and builds control-flow graphs of basic blocks.", input: "AST and symbol table", output: "Three-address code and CFG" },
  security: { purpose: "Runs interprocedural taint analysis, detects four vulnerability classes, attributes phases and scores risk.", input: "IR, CFG and call graph", output: "Findings with root cause, data flow, phase and risk" },
  report: { purpose: "Produces the structured seven-field report as text or JSON.", input: "Findings", output: "Report (text, JSON, PDF export)" },
};

export default function PipelinePage() {
  const { active, result, findings } = useArgus();
  const [sel, setSel] = useState("security");
  const [mode, setMode] = useState("explore");   // "explore" | "full"
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const ctl = useRef(null);

  useEffect(() => {
    if (!active.code.trim()) { setData(null); return undefined; }
    const t = setTimeout(async () => {
      ctl.current?.abort();
      const c = new AbortController();
      ctl.current = c;
      try { setData(await inspectPipeline(active.code, active.name, c.signal)); setErr(null); }
      catch (e) { if (e.name !== "AbortError") setErr(e.message); }
    }, 300);
    return () => clearTimeout(t);
  }, [active.code, active.name]);

  if (!active.code.trim()) {
    return (<><PageHeader title="Compiler Pipeline" sub="The six stages Argus runs on your code." />
      <EmptyState title="No source to inspect" body="Add code in the Analyze Code workspace to see what each stage produces."
        action={<button className="btn btn-primary" onClick={() => go("/analyze")}>Analyze Code</button>} /></>);
  }

  const d = result?.diagnostics || {};
  const num = (k) => (d[k] || []).length;
  const metrics = {
    lexer: [["Tokens", data?.tokens?.length], ["Lexical errors", num("Lexer")]],
    parser: [["AST nodes", data ? countNodes(data.ast) : undefined], ["Syntax errors", num("Parser")]],
    semantic: [["Symbols", data?.symbols?.length], ["Call-graph edges", data?.callgraph?.edges?.length], ["Semantic errors", num("Semantic")]],
    ir: [["Functions", data ? Object.keys(data.tac).length : undefined], ["TAC instructions", data ? Object.values(data.tac).reduce((a, b) => a + b.length, 0) : undefined],
      ["Basic blocks", data ? Object.values(data.cfg).reduce((a, b) => a + b.length, 0) : undefined]],
    security: [["Findings", result ? findings.length : undefined], ["Classes", result ? new Set(findings.map((f) => f.vulnerability_type)).size : undefined],
      ["Highest risk", findings.length ? Math.max(...findings.map((f) => f.risk_score)).toFixed(1) : undefined]],
    report: [["Findings in report", result ? findings.length : undefined], ["Fields per finding", 7]],
  };
  const stage = STAGES.find((s) => s.key === sel);
  const info = INFO[sel];
  const states = stageStates(result);

  return (
    <>
      <PageHeader title="Compiler Pipeline" sub={<>Stages for <span className="mono">{active.name}</span>. Counts come from the real compiler output for the file in the editor.</>}
        actions={<div className="seg" role="tablist" aria-label="Pipeline view">
          <button role="tab" aria-selected={mode === "explore"} className={mode === "explore" ? "on" : ""} onClick={() => setMode("explore")}>Stage explorer</button>
          <button role="tab" aria-selected={mode === "full"} className={mode === "full" ? "on" : ""} onClick={() => setMode("full")}>Full glass-box view</button>
        </div>} />
      {mode === "full" ? (
        data ? <section className="card pad"><PipelineView data={data} code={active.code} filename={active.name} /></section>
             : <p className="muted">{err ? `Could not read stage output: ${err}` : "Inspecting the pipeline…"}</p>
      ) : (<>
      <section className="card pad"><StageStrip states={states} onSelect={setSel} selected={sel} /></section>

      <section className="card pad stage-detail">
        <div className="card-h"><h2>{STAGES.indexOf(stage) + 1}. {stage.name}</h2>
          {sel === "security" && <span className="badge phase">where findings are detected</span>}</div>
        <p>{info.purpose}</p>
        <div className="io"><div><span className="muted sm">Input</span><b>{info.input}</b></div><ArrowRight size={16} aria-hidden /><div><span className="muted sm">Output</span><b>{info.output}</b></div></div>
        <div className="metrics">
          {metrics[sel].map(([k, v]) => (
            <div key={k} className="metric"><span className="muted sm">{k}</span><b className="mono">{v === undefined ? "—" : v}</b></div>))}
        </div>
        {err && <p className="alert err">Could not read stage output: {err}</p>}

        {sel === "security" && (findings.length ? (
          <ul className="flist">
            {findings.map((f) => (
              <li key={f.idx}><button className="frow" onClick={() => go(`/findings/${f.idx}`)}>
                <SeverityBadge sev={f.severity} /><span className="frow-t">{f.vulnerability_type}</span>
                <span className="mono muted">{f.file ? `${f.file}:${f.line}` : `line ${f.line}`}</span><span className="mono frow-risk">{f.risk_score.toFixed(1)}</span></button></li>))}
          </ul>
        ) : <p className="muted">{result ? "No findings in the latest analysis." : "Run an analysis to see findings detected at this stage."}</p>)}

        {sel === "report" && (
          <p className="muted">{result ? "The report for the latest analysis is on the Findings page, where it can be exported as PDF." : "Run an analysis to produce a report."}</p>)}

        {data && ["lexer", "parser", "semantic", "ir"].includes(sel) && (
          <div className="stage-out"><h3 className="h-sm">Stage output</h3><PipelineView data={data} stage={sel} code={active.code} filename={active.name} /></div>)}
      </section>
      </>)}
    </>
  );
}
