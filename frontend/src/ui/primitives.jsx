import React, { useState } from "react";
import { OctagonAlert, TriangleAlert, CircleAlert, Info, Route, Copy, Check } from "lucide-react";

export function Tip({ text, children }) {
  return <span className="tip" data-tip={text} tabIndex={0}>{children}</span>;
}

const SEV_ICON = { critical: OctagonAlert, high: TriangleAlert, medium: CircleAlert, low: Info };
export function SeverityBadge({ sev }) {
  const Icon = SEV_ICON[sev.key] || Info;
  return <span className={`badge sev-${sev.key}`}><Icon size={13} aria-hidden />{sev.label}</span>;
}

export function ReachBadge({ reachable }) {
  if (reachable === null || reachable === undefined) return <span className="badge muted">Unavailable</span>;
  return (
    <Tip text="Whether a call path from main() reaches this code. This is not a statement about exploitability.">
      <span className={`badge ${reachable ? "reach-yes" : "reach-no"}`}>
        <Route size={13} aria-hidden />{reachable ? "Reachable" : "Not reachable"}
      </span>
    </Tip>
  );
}

export function PhaseChip({ phase }) {
  return <span className="badge phase">{phase || "Unavailable"}</span>;
}

export function StatCard({ icon: Icon, label, value, hint, tone }) {
  return (
    <div className={`stat ${tone || ""}`}>
      <div className="stat-top"><span className="stat-label">{label}</span>{Icon && <Icon size={16} aria-hidden />}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="empty">
      {Icon && <span className="empty-ico"><Icon size={26} aria-hidden /></span>}
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 14, w = "100%", style }) {
  return <span className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export function CopyButton({ text, label = "Copy" }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => {
      try { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400); } catch { /* ignore */ }
    }}>
      {done ? <Check size={14} /> : <Copy size={14} />}{done ? "Copied" : label}
    </button>
  );
}

export function PageHeader({ title, sub, actions }) {
  return (
    <div className="ph">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}
