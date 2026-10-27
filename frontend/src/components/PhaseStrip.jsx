import React from "react";
import { FileText, Braces, Table2, Network, ShieldAlert, FileOutput, ChevronRight, ChevronDown } from "lucide-react";

export const STAGES = [
  { key: "lexer", name: "Lexer", icon: FileText, sees: "tokens and their positions", match: /lex/i },
  { key: "parser", name: "Parser", icon: Braces, sees: "syntax structure (the AST)", match: /pars/i },
  { key: "semantic", name: "Semantic Analysis", icon: Table2, sees: "types, scopes and the call graph", match: /semantic/i },
  { key: "ir", name: "IR Generation", icon: Network, sees: "three-address code and control-flow graphs", match: /\bir\b|intermediate/i },
  { key: "security", name: "Security Analysis", icon: ShieldAlert, sees: "taint, data flow and reachability", match: /security/i },
  { key: "report", name: "Report Generation", icon: FileOutput, sees: "the finished findings", match: /report/i },
];

export const stageIndex = (phase) => Math.max(0, STAGES.findIndex((s) => s.match.test(phase || "")));

// The six-stage pipeline with the engine-attributed phase highlighted.
export default function PhaseStrip({ attribution }) {
  const hit = attribution ? STAGES.findIndex((s) => s.match.test(attribution.phase || "")) : -1;
  return (
    <div>
      <ol className="ps" aria-label="Compiler pipeline">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const state = i === hit ? "hit" : hit >= 0 && i < hit ? "before" : "after";
          return (
            <React.Fragment key={s.key}>
              {i > 0 && <li className="ps-sep" aria-hidden><ChevronRight size={16} className="h" /><ChevronDown size={16} className="v" /></li>}
              <li className={`ps-stage ${state}`} aria-current={i === hit ? "step" : undefined}>
                <Icon size={16} aria-hidden />
                <span className="ps-name">{s.name}</span>
                <span className="ps-sees">{state === "before" ? `sees ${s.sees} only` : state === "hit" ? "detectable here" : ""}</span>
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      {attribution && (
        <dl className="attr">
          <div><dt>Attributed phase</dt><dd><b>{attribution.phase}</b></dd></div>
          <div><dt>Why it becomes detectable here</dt><dd>It needs {attribution.needs}.</dd></div>
          <div><dt>What the earlier phases lack</dt><dd>{attribution.why}</dd></div>
        </dl>
      )}
      <p className="muted sm">Attribution follows Argus's documented rules for this vulnerability class. It does not claim to be the optimal assignment for every compiler design.</p>
    </div>
  );
}
