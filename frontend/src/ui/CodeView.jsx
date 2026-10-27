import React, { useMemo } from "react";
import { highlightLines } from "../highlight.js";

// Read-only source viewer: real line numbers, highlighted lines, optional context window.
export default function CodeView({ code, name, hit = [], context = 4, focus = null, onLineClick }) {
  const lines = useMemo(() => highlightLines(code || ""), [code]);
  const hitSet = new Set(hit);
  const f = focus || hit[0];
  let from = 1;
  let to = lines.length;
  if (f && context != null) { from = Math.max(1, f - context); to = Math.min(lines.length, f + context); }
  return (
    <div className="cv">
      <div className="cv-head mono"><span>{name}</span><span className="muted">lines {from}–{to} of {lines.length}</span></div>
      <pre className="cv-body" tabIndex={0} aria-label={`Source of ${name}`}>
        {lines.slice(from - 1, to).map((toks, i) => {
          const n = from + i;
          return (
            <div key={n} className={`cv-line ${hitSet.has(n) ? "hit" : ""}`}
                 onClick={onLineClick ? () => onLineClick(n) : undefined}>
              <span className="cv-n">{n}</span>
              <span className="cv-t">{toks.length ? toks.map((t, k) => (
                <span key={k} className={t.cls ? `tk-${t.cls}` : undefined}>{t.text}</span>)) : " "}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}
