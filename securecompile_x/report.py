"""Phase 6: Security Report Generator. FR-6: one entry per finding with all
seven fields (section 8), plain-text and machine-readable (JSON) output."""

import json


def to_json(findings, source_file, diagnostics):
    return json.dumps({
        "tool": "SecureCompile-X",
        "source_file": source_file,
        "diagnostics": diagnostics,
        "finding_count": len(findings),
        "findings": [f.to_dict() for f in findings],
    }, indent=2)


def to_text(findings, source_file, diagnostics=None):
    out = []
    out.append("=" * 70)
    out.append("SecureCompile-X  -  Security Report")
    out.append(f"Source: {source_file}")
    out.append("=" * 70)
    if diagnostics:
        for phase, errs in diagnostics.items():
            if errs:
                out.append(f"[{phase}] diagnostics:")
                for e in errs:
                    out.append(f"    - {e}")
    if not findings:
        out.append("")
        out.append("No vulnerabilities detected. (clean)")
        out.append("")
        return "\n".join(out)
    out.append(f"\n{len(findings)} finding(s):\n")
    for i, f in enumerate(findings, 1):
        d = f.to_dict()
        p = d["phase_attribution"]
        loc = d["location"]
        where = f"{loc['file']}:{loc['line']}" if loc.get("file") else f"line {loc['line']}"
        out.append(f"--- Finding #{i} " + "-" * 50)
        out.append(f"Vulnerability : {d['vulnerability_type']}  "
                   f"(function {loc['function']}, {where})")
        out.append(f"Risk score    : {d['risk_score']}/10")
        out.append("Root-cause    :")
        for line in d["root_cause_trace"]:
            out.append(f"    {line}")
        out.append(f"Data-flow     : {d['data_flow_path']}")
        out.append(f"Phase         : {p['phase']}  (needs {p['needs']})")
        out.append(f"  why earlier : {p['why']}")
        out.append(f"Reachable     : {'yes' if d['reachable_from_main'] else 'no'} (from main)")
        out.append(f"Suggested fix : {d['suggested_fix']}")
        out.append("")
    return "\n".join(out)
