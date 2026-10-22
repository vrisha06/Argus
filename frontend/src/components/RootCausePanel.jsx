import React from "react";

// Findings grouped by shared root cause and ranked "fix this first".
// Shown only when there is more than one finding to triage.
export default function RootCausePanel({ groups, count, onJump }) {
  if (!groups || count < 2) return null;
  const shared = groups.some((g) => g.count > 1);

  return (
    <div className="rc-panel">
      <div className="rc-head">
        <h4>🎯 Fix in this order</h4>
        <span className="rc-sum">
          {count} findings · {groups.length} root cause{groups.length > 1 ? "s" : ""}
        </span>
      </div>
      {shared && (
        <p className="rc-note">Some findings share one cause — fixing it once clears several.</p>
      )}
      <ol className="rc-list">
        {groups.map((g) => (
          <li key={g.id} className="rc-item">
            <div className="rc-item-head">
              <span className="rc-rank">{g.rank}</span>
              <span className="rc-label">{g.label}</span>
              <span className="rc-risk">risk {Number(g.max_risk).toFixed(1)}</span>
            </div>
            <p className="rc-headline">
              {g.headline}
              {g.count > 1 && <b> — resolves {g.count}</b>}
            </p>
            <p className="rc-advice">{g.advice}</p>
            <div className="rc-chips">
              {g.finding_indexes.map((i) => (
                <button key={i} className="rc-chip" onClick={() => onJump(`finding-${i}`)}>
                  #{i + 1}
                </button>
              ))}
              <span className="rc-classes">{g.classes.join(" · ")}</span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
