import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { go } from "../router.js";
import {
  analyze, analyzeMulti, aiReview, aiFix, generatePov, fetchAiStatus, fetchExample, getUserId,
} from "../api.js";

const Ctx = createContext(null);
export const useArgus = () => useContext(Ctx);

export const STARTER = `/* Try me, or load an example from the Examples page. */
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

// Severity tiers derived from the 0-10 risk score (documented project thresholds).
export function severityOf(score) {
  if (score >= 9) return { key: "critical", label: "Critical" };
  if (score >= 7) return { key: "high", label: "High" };
  if (score >= 4) return { key: "medium", label: "Medium" };
  return { key: "low", label: "Low" };
}

export const shortPhase = (p) => (!p ? "General" : /security/i.test(p) ? "Security"
  : /ir/i.test(p) ? "IR" : p.split(" ")[0]);

const ENGINE_DELAY = 650;
const AI_DELAY = 1800;
const MAX_HISTORY = 8;

const load = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
};
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota/private mode */ } };

export const DEFAULT_FILTERS = {
  q: "", cls: "all", severity: "all", file: "all", reach: "all", phase: "all",
  minRisk: 0, sortKey: "risk", sortDir: "desc",
};

export function ArgusProvider({ children }) {
  // ---- theme / shell ----
  const [theme, setTheme] = useState(() => load("argus-theme", "dark"));
  const [collapsed, setCollapsed] = useState(() => load("argus-sidebar", false));
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); save("argus-theme", theme); }, [theme]);
  useEffect(() => save("argus-sidebar", collapsed), [collapsed]);

  // ---- workspace ----
  const [files, setFiles] = useState(() => {
    const f = load("argus-files", null);
    return Array.isArray(f) && f.length ? f : [{ name: "main.c", code: STARTER }];
  });
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => save("argus-files", files), [files]);
  const active = files[Math.min(activeIdx, files.length - 1)];
  const activeHasCode = files.some((f) => f.code.trim().length > 0);
  const filesKey = JSON.stringify(files);

  const setActiveCode = (code) => setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, code } : f)));
  const renameActive = (name) => setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, name } : f)));
  const addFile = () => {
    setFiles((fs) => {
      let n = fs.length + 1;
      while (fs.some((f) => f.name === `file${n}.c`)) n += 1;
      return [...fs, { name: `file${n}.c`, code: "" }];
    });
    setActiveIdx(files.length);
  };
  const removeFile = (idx) => {
    if (files.length === 1) return;
    setFiles((fs) => fs.filter((_, i) => i !== idx));
    setActiveIdx((cur) => (cur >= idx && cur > 0 ? cur - 1 : cur));
  };
  const clearCode = () => {
    setFiles((fs) => fs.map((f, i) => (i === activeIdx ? { ...f, code: "" } : f)));
    setResult(null); setAiResult(null); setError(null);
  };

  // Jump-to-source requests from other pages (finding detail, flow-graph nodes).
  const [focus, setFocus] = useState(null);
  function openInEditor(file, line) {
    const i = files.findIndex((f) => f.name === file);
    if (i >= 0) setActiveIdx(i);
    setFocus({ file, line, n: Date.now() });
    go("/analyze");
  }

  // ---- analysis ----
  const [result, setResult] = useState(null);
  const [resultMeta, setResultMeta] = useState(null);   // {ts, source, files}
  const [analyzing, setAnalyzing] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [error, setError] = useState(null);
  const [liveOn, setLiveOn] = useState(true);
  const [scopeAll, setScopeAll] = useState(() => load("argus-scope-all", true));
  useEffect(() => save("argus-scope-all", scopeAll), [scopeAll]);
  const [history, setHistory] = useState(() => load("argus-history", []));
  const [analyticsKey, setAnalyticsKey] = useState(0);
  useEffect(() => save("argus-history", history), [history]);

  // "Scan all tabs" on: every non-empty file is linked and analyzed together.
  // Off: only the file in the editor is analyzed.
  const runAnalysis = useCallback(async (fs, opts) => {
    const pool = scopeAll ? fs : [fs[Math.min(activeIdx, fs.length - 1)]];
    const nonEmpty = pool.filter((f) => f.code.trim());
    return nonEmpty.length > 1 ? analyzeMulti(nonEmpty, opts)
      : analyze(nonEmpty[0].code, nonEmpty[0].name, opts);
  }, [scopeAll, activeIdx]);

  // Manual analyze: recorded to analytics + kept in the recent-analyses history.
  async function onAnalyze() {
    if (analyzing || !activeHasCode) return;
    setAnalyzing(true); setError(null);
    try {
      const r = await runAnalysis(files, { record: true, user: getUserId() });
      const ts = Date.now();
      setResult(r);
      setResultMeta({ ts, source: "manual", files: files.map((f) => f.name) });
      setHistory((h) => [{ id: ts, ts, files: files.map((f) => ({ ...f })), result: r }, ...h].slice(0, MAX_HISTORY));
      setAnalyticsKey((k) => k + 1);
    } catch (e) {
      setError(e.message || "Analysis failed");   // source code is preserved
    } finally {
      setAnalyzing(false);
    }
  }

  // Live detection: debounced re-analysis while typing.
  useEffect(() => {
    if (!liveOn || !activeHasCode) return undefined;
    const t = setTimeout(async () => {
      setLiveBusy(true);
      try {
        const r = await runAnalysis(files);
        setResult(r);
        setResultMeta((m) => ({ ts: Date.now(), source: "live", files: files.map((f) => f.name),
          manualTs: m?.manualTs }));
        setError(null);
      } catch (e) {
        setError(e.message);
      } finally {
        setLiveBusy(false);
      }
    }, ENGINE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey, liveOn, scopeAll, activeIdx]);

  function reopen(entry) {
    setFiles(entry.files.map((f) => ({ ...f })));
    setActiveIdx(0);
    setResult(entry.result);
    setResultMeta({ ts: entry.ts, source: "manual", files: entry.files.map((f) => f.name) });
    setError(null);
  }

  // ---- examples ----
  async function loadExample(name) {
    const ex = await fetchExample(name);
    const next = ex.files ? ex.files : [{ name, code: ex.code }];
    if (ex.files) setScopeAll(true);   // multi-file examples need cross-file linking
    setFiles(next.map((f) => ({ name: f.name, code: f.code })));
    setActiveIdx(0);
    setResult(null); setResultMeta(null); setAiResult(null); setError(null);
  }

  // ---- AI (optional) ----
  const [aiOn, setAiOn] = useState(true);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiResult, setAiResult] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const aiAbort = useRef(null);
  useEffect(() => { fetchAiStatus().then(setAiStatus).catch(() => {}); }, []);

  useEffect(() => {
    if (!aiOn || !active?.code.trim()) return undefined;
    if (aiStatus && aiStatus.available === false) return undefined;
    const t = setTimeout(async () => {
      if (aiAbort.current) aiAbort.current.abort();
      const ctrl = new AbortController();
      aiAbort.current = ctrl;
      setAiBusy(true); setAiError(null);
      try { setAiResult(await aiReview([active], ctrl.signal)); }
      catch (e) { if (e.name !== "AbortError") setAiError(e.message); }
      finally { if (aiAbort.current === ctrl) setAiBusy(false); }
    }, AI_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.code, active?.name, aiOn, aiStatus]);

  function applyFix(s) {
    if (!s?.fix) return;
    setFiles((fs) => fs.map((f, i) => {
      if (i !== activeIdx) return f;
      const lines = f.code.split("\n");
      if (s.line && s.line >= 1 && s.line <= lines.length) {
        lines.splice(s.line - 1, 1, ...s.fix.split("\n"));
        return { ...f, code: lines.join("\n") };
      }
      return { ...f, code: f.code + (f.code.endsWith("\n") ? "" : "\n") + s.fix + "\n" };
    }));
  }
  async function applyAllFixes() {
    if (!active?.code.trim() || applyingAll) return;
    setApplyingAll(true); setAiError(null);
    try {
      const r = await aiFix(active.code, active.name);
      if (r.error) setAiError(r.error);
      else if (r.code && r.code !== active.code) setActiveCode(r.code);
    } catch (e) { setAiError(e.message); }
    finally { setApplyingAll(false); }
  }

  // ---- proof of vulnerability for the file in the editor ----
  const [povResult, setPovResult] = useState(null);
  const [povBusy, setPovBusy] = useState(false);
  const [povError, setPovError] = useState(null);
  useEffect(() => { setPovResult(null); setPovError(null); }, [active?.code, active?.name]);
  async function runProve() {
    if (!active?.code.trim() || povBusy) return;
    setPovBusy(true); setPovError(null);
    try { setPovResult({ ...(await generatePov(active.code, active.name)), file: active.name }); }
    catch (e) { setPovError(e.message); }
    finally { setPovBusy(false); }
  }

  // ---- findings view-state (kept across navigation so context is never lost) ----
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const findings = useMemo(() => (result?.findings || []).map((f, i) => ({
    ...f, idx: i, severity: severityOf(f.risk_score),
    file: f.location?.file || null, line: f.location?.line, phase: f.phase_attribution?.phase,
  })), [result]);

  const value = {
    theme, setTheme, collapsed, setCollapsed,
    files, setFiles, activeIdx, setActiveIdx, active, activeHasCode,
    setActiveCode, renameActive, addFile, removeFile, clearCode,
    result, resultMeta, analyzing, liveBusy, error, setError, liveOn, setLiveOn,
    onAnalyze, history, reopen, analyticsKey, findings,
    loadExample, focus, openInEditor, scopeAll, setScopeAll,
    povResult, povBusy, povError, runProve,
    aiOn, setAiOn, aiStatus, aiResult, aiBusy, aiError, applyingAll, applyFix, applyAllFixes,
    filters, setFilters,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
