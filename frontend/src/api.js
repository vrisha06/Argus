// Thin client for the SecureCompile-X FastAPI backend.

export async function fetchExamples() {
  const r = await fetch("/api/examples");
  if (!r.ok) throw new Error("failed to load examples");
  return r.json();
}

export async function fetchExample(name) {
  const r = await fetch(`/api/examples/${name}`);
  if (!r.ok) throw new Error("failed to load example");
  return r.json();
}

export async function analyze(code, filename = "input.c") {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename }),
  });
  if (!r.ok) throw new Error(`analysis failed (${r.status})`);
  return r.json();
}

export async function analyzeMulti(files) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
  });
  if (!r.ok) throw new Error(`analysis failed (${r.status})`);
  return r.json();
}
