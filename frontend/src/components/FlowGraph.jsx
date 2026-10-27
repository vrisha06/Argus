import React from "react";
import { LogIn, ArrowRightLeft, OctagonAlert, Circle, ArrowRight, ArrowDown } from "lucide-react";

const KIND = {
  source: { label: "Source", icon: LogIn },
  call: { label: "Call boundary", icon: ArrowRightLeft },
  step: { label: "Step", icon: Circle },
  sink: { label: "Sink", icon: OctagonAlert },
};

// Source-to-sink graph. Every node/edge comes from the analysis report's data-flow path
// (resolved to file/line by the backend); nothing is added client-side.
export default function FlowGraph({ flow, onNodeClick, activeId }) {
  if (!flow || !flow.nodes?.length) return <p className="muted">No data-flow path was reported for this finding.</p>;
  const crossFile = new Set(flow.nodes.map((n) => n.file).filter(Boolean)).size > 1;
  return (
    <div className="fg" role="list" aria-label="Source to sink data flow">
      {flow.nodes.map((n, i) => {
        const K = KIND[n.kind] || KIND.step;
        const Icon = K.icon;
        const clickable = n.file && n.line;
        return (
          <React.Fragment key={n.id}>
            {i > 0 && (
              <span className="fg-edge" aria-hidden>
                <ArrowRight size={18} className="h" /><ArrowDown size={18} className="v" />
              </span>
            )}
            <button role="listitem" className={`fg-node k-${n.kind} ${activeId === n.id ? "active" : ""}`} disabled={!clickable}
                    onClick={() => onNodeClick?.(n)}
                    title={clickable ? `Go to ${n.file}:${n.line}` : "No source location available"}>
              <span className="fg-kind"><Icon size={13} aria-hidden />{K.label}</span>
              <span className="fg-label mono">{n.label}</span>
              {n.function && <span className="fg-meta mono">in {n.function}()</span>}
              <span className="fg-meta mono">{clickable ? `${n.file}:${n.line}` : "location unavailable"}</span>
              {n.detail && <span className="fg-detail">{n.detail}</span>}
            </button>
          </React.Fragment>
        );
      })}
      {crossFile && <p className="fg-note">This flow crosses a file boundary.</p>}
    </div>
  );
}
