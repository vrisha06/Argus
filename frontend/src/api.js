// Thin client for the Argus FastAPI backend.

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

// A stable per-browser id so analytics are "this user's" without any login.
export function getUserId() {
  try {
    let id = localStorage.getItem("scx-user");
    if (!id) {
      id = (crypto.randomUUID?.() || String(Date.now() + Math.random()));
      localStorage.setItem("scx-user", id);
    }
    return id;
  } catch {
    return "local";
  }
}

export async function analyze(code, filename = "input.c", opts = {}) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename, ...opts }),
  });
  if (!r.ok) throw new Error(`analysis failed (${r.status})`);
  return r.json();
}

export async function fetchHistory(user) {
  const r = await fetch(`/api/history?user=${encodeURIComponent(user)}`);
  if (!r.ok) throw new Error("failed to load history");
  return r.json();
}

export async function clearHistory(user) {
  const r = await fetch(`/api/history?user=${encodeURIComponent(user)}`, { method: "DELETE" });
  if (!r.ok) throw new Error("failed to clear history");
  return r.json();
}

export async function analyzeMulti(files, opts = {}) {
  const r = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files, ...opts }),
  });
  if (!r.ok) throw new Error(`analysis failed (${r.status})`);
  return r.json();
}

// AI assist: plain-English suggestions from Gemini, complementing the engine.
export async function aiReview(files, signal) {
  const r = await fetch("/api/ai-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ files }),
    signal,
  });
  if (!r.ok) throw new Error(`ai review failed (${r.status})`);
  return r.json();
}

// Proof-of-Vulnerability: synthesise a triggering input/trace per finding.
export async function generatePov(code, filename = "input.c", signal) {
  const r = await fetch("/api/pov", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename }),
    signal,
  });
  if (!r.ok) throw new Error(`pov failed (${r.status})`);
  return r.json();
}

// Glass-box: serialise every compiler stage for the current source.
export async function inspectPipeline(code, filename = "input.c", signal) {
  const r = await fetch("/api/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename }),
    signal,
  });
  if (!r.ok) throw new Error(`inspect failed (${r.status})`);
  return r.json();
}

export async function fetchAiStatus() {
  const r = await fetch("/api/ai-status");
  if (!r.ok) throw new Error("failed to load ai status");
  return r.json();
}

// Robust "apply all": Gemini returns the whole corrected file.
export async function aiFix(code, filename = "input.c", signal) {
  const r = await fetch("/api/ai-fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, filename }),
    signal,
  });
  if (!r.ok) throw new Error(`ai fix failed (${r.status})`);
  return r.json();
}
