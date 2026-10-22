import React from "react";

// Compiler errors in plain English: title, what is wrong, how to fix it, and
// the offending source line with a caret. The raw compiler message stays
// available under "details".
export default function FriendlyDiagnostics({ result, highlightId }) {
  const items = result.friendly_diagnostics || [];
  if (items.length === 0) return null;

  return (
    <div className="diagnostics">
      <h4>Compiler errors{items.length > 1 ? ` (${items.length})` : ""}</h4>
      {items.length > 1 && (
        <p className="fd-tip">Fix the first error first — later ones are often side-effects of it.</p>
      )}
      {items.map((d, i) => {
        const id = `diag-${d.phase}-${d.index}`;
        return (
          <div key={i} id={id} className={`fd-item ${highlightId === id ? "flash" : ""}`}>
            <div className="fd-head">
              <span className="fd-dot" />
              <span className="fd-title">{d.title}</span>
              {d.line && <span className="fd-line">line {d.line}</span>}
              <span className="fd-phase">{d.phase}</span>
            </div>
            <p className="fd-msg">{d.message}</p>
            {d.snippet && (
              <pre className="fd-snippet">
                <span className="fd-ln">{d.snippet.line}</span>{d.snippet.text}
                {"\n"}<span className="fd-ln" />{" ".repeat(Math.max(0, (d.col || 1) - 1))}<span className="fd-caret">^ here</span>
              </pre>
            )}
            {d.hint && <p className="fd-hint">💡 {d.hint}</p>}
            <details className="fd-raw"><summary>compiler message</summary><code>{d.raw}</code></details>
          </div>
        );
      })}
    </div>
  );
}
