import { jsPDF } from "jspdf";

const tier = (s) => (s >= 9 ? "CRITICAL" : s >= 7 ? "HIGH" : s >= 4 ? "MEDIUM" : "LOW");

// Build and download a clean, text-based PDF of a report `result`
// (the object returned by /api/analyze).
export function exportReportPdf(result) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const maxW = pageW - margin * 2;
  let y = margin;

  const ensure = (h) => {
    if (y + h > pageH - margin) { doc.addPage(); y = margin; }
  };
  const text = (str, o = {}) => {
    const { size = 10, font = "helvetica", style = "normal",
            color = [40, 40, 40], gap = 4, indent = 0 } = o;
    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor(color[0], color[1], color[2]);
    const lines = doc.splitTextToSize(String(str ?? ""), maxW - indent);
    for (const ln of lines) {
      ensure(size + gap);
      doc.text(ln, margin + indent, y);
      y += size + gap;
    }
  };
  const rule = () => {
    ensure(12);
    doc.setDrawColor(214, 220, 206);
    doc.line(margin, y, pageW - margin, y);
    y += 12;
  };

  // Header
  text("Argus  —  Security Report", { size: 16, style: "bold", color: [20, 90, 67] });
  text(`Source: ${result.source_file || "input.c"}`, { size: 10, color: [100, 100, 100] });
  text(`Generated: ${new Date().toLocaleString()}`, { size: 9, color: [150, 150, 150], gap: 6 });
  rule();

  // Summary
  const diag = result.diagnostics || {};
  const diagCount = Object.values(diag).reduce((a, v) => a + (v ? v.length : 0), 0);
  if (result.finding_count > 0) {
    text(`${result.finding_count} finding${result.finding_count > 1 ? "s" : ""} detected.`,
         { size: 11, style: "bold", color: [150, 70, 40] });
  } else if (diagCount > 0) {
    text("Compiler errors present — vulnerability scan incomplete.",
         { size: 11, style: "bold", color: [150, 110, 30] });
  } else {
    text("No vulnerabilities detected — clean.", { size: 11, style: "bold", color: [60, 110, 70] });
  }
  y += 4;

  // Compiler diagnostics
  if (diagCount > 0) {
    text("Compiler diagnostics", { size: 11, style: "bold" });
    for (const [phase, errs] of Object.entries(diag)) {
      if (!errs || !errs.length) continue;
      text(phase, { size: 10, style: "bold", color: [20, 90, 67] });
      errs.forEach((e) => text("- " + e, { size: 9, font: "courier", indent: 10 }));
    }
    y += 4;
    rule();
  }

  // Findings
  (result.findings || []).forEach((f, i) => {
    ensure(24);
    text(`#${i + 1}   ${f.vulnerability_type}    ${f.risk_score}/10 · ${tier(f.risk_score)}`,
         { size: 12, style: "bold", color: [30, 30, 30] });
    const loc = f.location || {};
    const where = loc.file ? `${loc.file}:${loc.line}` : `line ${loc.line}`;
    text(`${loc.function}()   ·   ${where}   ·   ${f.reachable_from_main ? "reachable from main" : "not reachable"}`,
         { size: 9, color: [110, 110, 110] });

    text("Root-cause trace", { size: 9, style: "bold", color: [90, 90, 90] });
    (f.root_cause_trace || []).forEach((l) => text("• " + l, { size: 9, font: "courier", indent: 10 }));

    text("Data-flow path", { size: 9, style: "bold", color: [90, 90, 90] });
    text(f.data_flow_path, { size: 9, font: "courier", indent: 10 });

    const p = f.phase_attribution || {};
    text("Compiler-phase attribution", { size: 9, style: "bold", color: [90, 90, 90] });
    text(`${p.phase} — needs ${p.needs}`, { size: 9, indent: 10 });
    text(p.why, { size: 9, color: [90, 90, 90], indent: 10 });

    text("Suggested fix", { size: 9, style: "bold", color: [90, 90, 90] });
    text(f.suggested_fix, { size: 9, color: [60, 110, 70], indent: 10 });

    y += 6;
    rule();
  });

  const base = String(result.source_file || "report")
    .replace(/\.c\b/g, "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "report";
  doc.save(`${base}-argus.pdf`);
}
