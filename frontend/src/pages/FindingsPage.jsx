import React, { useMemo, useState } from "react";
import { Search, ArrowUpDown, ChevronUp, ChevronDown, Download, ShieldAlert, Gauge, Files, Layers, Play, SearchX } from "lucide-react";
import { useArgus, DEFAULT_FILTERS } from "../state/store.jsx";
import { go } from "../router.js";
import { exportReportPdf } from "../pdf.js";
import RootCausePanel from "../components/RootCausePanel.jsx";
import { PageHeader, StatCard, SeverityBadge, ReachBadge, PhaseChip, EmptyState, Tip } from "../ui/primitives.jsx";

const PAGE_SIZE = 25;
const COLS = [
  { key: "type", label: "Vulnerability" },
  { key: "severity", label: "Severity", tip: "Derived from the risk score: Critical ≥ 9, High ≥ 7, Medium ≥ 4, Low below." },
  { key: "file", label: "File" },
  { key: "line", label: "Line" },
  { key: "risk", label: "Risk /10", tip: "Deterministic 0–10 score. It is not a probability of exploitation." },
  { key: "reach", label: "Reachability", tip: "Reachable from main(). Not the same as exploitable." },
  { key: "phase", label: "Phase", tip: "Earliest compiler phase at which the finding becomes detectable." },
];

const sortVal = (f, k) => ({
  type: f.vulnerability_type, severity: f.risk_score, file: f.file || "", line: f.line || 0,
  risk: f.risk_score, reach: f.reachable_from_main ? 1 : 0, phase: f.phase || "",
}[k]);

export default function FindingsPage() {
  const { findings, result, filters, setFilters, resultMeta } = useArgus();
  const [page, setPage] = useState(0);
  const set = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(0); };

  const options = useMemo(() => ({
    cls: [...new Set(findings.map((f) => f.vulnerability_type))].sort(),
    file: [...new Set(findings.map((f) => f.file).filter(Boolean))].sort(),
    phase: [...new Set(findings.map((f) => f.phase).filter(Boolean))].sort(),
  }), [findings]);

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    const list = findings.filter((f) =>
      (filters.cls === "all" || f.vulnerability_type === filters.cls)
      && (filters.severity === "all" || f.severity.key === filters.severity)
      && (filters.file === "all" || f.file === filters.file)
      && (filters.phase === "all" || f.phase === filters.phase)
      && (filters.reach === "all" || (filters.reach === "yes") === !!f.reachable_from_main)
      && f.risk_score >= filters.minRisk
      && (!q || [f.vulnerability_type, f.file, f.location?.function, f.phase, f.data_flow_path, f.suggested_fix]
        .filter(Boolean).join(" ").toLowerCase().includes(q)));
    const dir = filters.sortDir === "asc" ? 1 : -1;
    return list.sort((a, b) => {
      const x = sortVal(a, filters.sortKey), y = sortVal(b, filters.sortKey);
      return (x < y ? -1 : x > y ? 1 : a.idx - b.idx) * dir;
    });
  }, [findings, filters]);

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const shown = rows.slice(cur * PAGE_SIZE, cur * PAGE_SIZE + PAGE_SIZE);

  const dist = useMemo(() => {
    const byCls = {}, bySev = { critical: 0, high: 0, medium: 0, low: 0 };
    findings.forEach((f) => { byCls[f.vulnerability_type] = (byCls[f.vulnerability_type] || 0) + 1; bySev[f.severity.key] += 1; });
    return { byCls, bySev };
  }, [findings]);

  const header = (
    <PageHeader title="Findings" sub="Every vulnerability from the latest analysis. Select a row to investigate its root cause."
      actions={result && findings.length > 0 ? (
        <button className="btn btn-ghost" onClick={() => exportReportPdf(result)}><Download size={15} />Export PDF</button>
      ) : null} />
  );

  if (!result) {
    return (<>{header}
      <EmptyState icon={ShieldAlert} title="No analysis yet" body="Analyze a program to see its findings here."
        action={<button className="btn btn-primary" onClick={() => go("/analyze")}><Play size={15} />Analyze Code</button>} /></>);
  }
  if (findings.length === 0) {
    return (<>{header}
      <EmptyState icon={ShieldAlert} title="No supported vulnerabilities detected"
        body="Argus checks four vulnerability classes in the supported C subset. This result is not a guarantee that the program is secure."
        action={<button className="btn btn-ghost" onClick={() => go("/analyze")}>Back to editor</button>} /></>);
  }

  const maxCls = Math.max(1, ...Object.values(dist.byCls));
  const analyzedFiles = resultMeta?.files?.length || options.file.length || 1;
  const sortBy = (key) => set({ sortKey: key, sortDir: filters.sortKey === key && filters.sortDir === "desc" ? "asc" : "desc" });
  const active = JSON.stringify({ ...filters, sortKey: 0, sortDir: 0 }) !== JSON.stringify({ ...DEFAULT_FILTERS, sortKey: 0, sortDir: 0 });

  return (
    <>
      {header}
      <div className="stats">
        <StatCard icon={ShieldAlert} label="Total findings" value={findings.length} />
        <StatCard icon={Gauge} label="Highest risk" value={<>{Math.max(...findings.map((f) => f.risk_score)).toFixed(1)}<small>/10</small></>} tone="bad" />
        <StatCard icon={Layers} label="Vulnerability classes" value={Object.keys(dist.byCls).length} />
        <StatCard icon={Files} label="Files analyzed" value={analyzedFiles} />
      </div>

      <div className="grid-2">
        <section className="card pad">
          <h2 className="h-sm">By vulnerability class</h2>
          <div className="bars">
            {Object.entries(dist.byCls).map(([k, n]) => (
              <div key={k} className="bar-row"><span>{k}</span>
                <div className="bar"><i style={{ width: `${(n / maxCls) * 100}%` }} /></div><b className="mono">{n}</b></div>
            ))}
          </div>
        </section>
        <section className="card pad">
          <h2 className="h-sm">By severity</h2>
          <div className="sev-grid">
            {["critical", "high", "medium", "low"].map((k) => (
              <button key={k} className={`sev-cell sev-${k}`} onClick={() => set({ severity: filters.severity === k ? "all" : k })}
                      aria-pressed={filters.severity === k}>
                <b>{dist.bySev[k]}</b><span>{k}</span></button>
            ))}
          </div>
        </section>
      </div>

      <RootCausePanel groups={result.groups} count={findings.length} onJump={(id) => go(`/findings/${id.split("-")[1]}`)} />

      <section className="card">
        <div className="filters">
          <label className="search"><Search size={15} aria-hidden />
            <input value={filters.q} onChange={(e) => set({ q: e.target.value })} placeholder="Search type, file, function, flow…" aria-label="Search findings" /></label>
          <select aria-label="Filter by class" value={filters.cls} onChange={(e) => set({ cls: e.target.value })}>
            <option value="all">All classes</option>{options.cls.map((o) => <option key={o}>{o}</option>)}</select>
          <select aria-label="Filter by severity" value={filters.severity} onChange={(e) => set({ severity: e.target.value })}>
            <option value="all">All severities</option>{["critical", "high", "medium", "low"].map((o) => <option key={o} value={o}>{o[0].toUpperCase() + o.slice(1)}</option>)}</select>
          <select aria-label="Filter by file" value={filters.file} onChange={(e) => set({ file: e.target.value })}>
            <option value="all">All files</option>{options.file.map((o) => <option key={o}>{o}</option>)}</select>
          <select aria-label="Filter by reachability" value={filters.reach} onChange={(e) => set({ reach: e.target.value })}>
            <option value="all">Any reachability</option><option value="yes">Reachable</option><option value="no">Not reachable</option></select>
          <select aria-label="Filter by phase" value={filters.phase} onChange={(e) => set({ phase: e.target.value })}>
            <option value="all">All phases</option>{options.phase.map((o) => <option key={o}>{o}</option>)}</select>
          <label className="range">Min risk <b className="mono">{filters.minRisk.toFixed(1)}</b>
            <input type="range" min="0" max="10" step="0.5" value={filters.minRisk} onChange={(e) => set({ minRisk: Number(e.target.value) })} aria-label="Minimum risk score" /></label>
          {active && <button className="btn btn-link" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(0); }}>Reset filters</button>}
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={SearchX} title="No findings match these filters" body="Adjust or reset the filters to see more." />
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr>
                {COLS.map((c) => (
                  <th key={c.key} aria-sort={filters.sortKey === c.key ? (filters.sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button onClick={() => sortBy(c.key)}>
                      {c.tip ? <Tip text={c.tip}>{c.label}</Tip> : c.label}
                      {filters.sortKey === c.key ? (filters.sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />) : <ArrowUpDown size={12} className="dim" />}
                    </button></th>))}
                <th><span className="sr">Details</span></th>
              </tr></thead>
              <tbody>
                {shown.map((f) => (
                  <tr key={f.idx} tabIndex={0} onClick={() => go(`/findings/${f.idx}`)}
                      onKeyDown={(e) => { if (e.key === "Enter") go(`/findings/${f.idx}`); }}>
                    <td><b>{f.vulnerability_type}</b><div className="muted mono sm">{f.location?.function}()</div></td>
                    <td><SeverityBadge sev={f.severity} /></td>
                    <td className="mono">{f.file || "—"}</td>
                    <td className="mono">{f.line}</td>
                    <td><span className="risk"><i style={{ width: `${f.risk_score * 10}%` }} /></span> <b className="mono">{f.risk_score.toFixed(1)}</b></td>
                    <td><ReachBadge reachable={f.reachable_from_main} /></td>
                    <td><PhaseChip phase={f.phase} /></td>
                    <td><button className="btn btn-link" onClick={(e) => { e.stopPropagation(); go(`/findings/${f.idx}`); }}>View details</button></td>
                  </tr>))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > PAGE_SIZE && (
          <div className="pager"><span className="muted">{cur * PAGE_SIZE + 1}–{Math.min(rows.length, (cur + 1) * PAGE_SIZE)} of {rows.length}</span>
            <button className="btn btn-ghost btn-sm" disabled={cur === 0} onClick={() => setPage(cur - 1)}>Previous</button>
            <button className="btn btn-ghost btn-sm" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next</button></div>
        )}
      </section>
    </>
  );
}
