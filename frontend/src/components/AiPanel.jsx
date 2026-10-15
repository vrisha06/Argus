import React from "react";

// Renders the Gemini-powered live suggestions. Detection is still done by the
// compiler engine (the finding cards); this panel adds plain-English guidance
// about issues that "may cause problems later" so they can be fixed now.
export default function AiPanel({ status, result, busy, error, enabled, highlightId, onApplyFix, onApplyAll, applyingAll }) {
  if (!enabled) return null;

  const available = result ? result.available : status?.available;
  const fixCount = (result?.suggestions || []).filter((s) => s.fix).length;

  return (
    <div className="ai-panel">
      <div className="ai-head">
        <h4>
          <span className="ai-spark">✦</span> AI suggestions
          {busy && <span className="ai-thinking"><span className="spinner" />thinking…</span>}
        </h4>
        <div className="ai-head-right">
          {onApplyAll && (fixCount > 0 || applyingAll) && (
            <button className="ai-apply-all" onClick={onApplyAll} disabled={applyingAll}
                    title="Let AI rewrite the file with every issue fixed">
              {applyingAll ? <><span className="spinner" />Fixing…</> : "✓ Fix all with AI"}
            </button>
          )}
          {available && (status?.model || result?.model) && (
            <span className="ai-model">{result?.model || status?.model}</span>
          )}
        </div>
      </div>

      {available === false && (
        <p className="ai-note">
          Live engine detection (above) works without a key. To turn on
          AI explanations, get a free key at{" "}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>
          , set <code>GEMINI_API_KEY</code>, and restart the server.
        </p>
      )}

      {error && <p className="ai-note err">⚠ {error}</p>}

      {available && result && result.error && (
        <p className="ai-note err">⚠ {result.error}</p>
      )}

      {available && result && !result.error && result.suggestions.length === 0 && !busy && (
        <p className="ai-note ok">✓ The AI reviewer found nothing to flag right now.</p>
      )}

      {available && result && result.suggestions.length > 0 && (
        <ul className="ai-list">
          {result.suggestions.map((s, i) => (
            <li key={i} id={`ai-${i}`}
                className={`ai-item ${s.severity} ${highlightId === `ai-${i}` ? "flash" : ""}`}>
              <div className="ai-item-head">
                <span className={`ai-dot ${s.severity}`} />
                <span className="ai-title">{s.title}</span>
                {s.phase && <span className="ai-phase">{s.phase}</span>}
                {s.line != null && <span className="ai-line">line {s.line}</span>}
              </div>
              <p className="ai-msg">{s.message}</p>
              {s.fix && (
                <div className="ai-fix">
                  <span className="ai-fix-label">Fix</span>
                  <code>{s.fix}</code>
                  {onApplyFix && (
                    <button className="ai-apply" title="Apply this fix to the editor"
                            onClick={() => onApplyFix(s)}>Apply</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
