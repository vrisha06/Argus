// Tiny C-subset tokenizer used by the editor overlay and the read-only code viewer.
const KEYWORDS = new Set(["if", "else", "while", "for", "return", "break", "continue", "sizeof"]);
const TYPES = new Set(["int", "char", "void", "long", "short", "float", "double", "unsigned", "signed", "const", "static", "struct"]);

const RE = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|0[xX][0-9a-fA-F]+|\d+|[A-Za-z_]\w*|#[^\n]*|\s+|[\s\S]/g;

function classify(tok, next) {
  if (tok.startsWith("/*") || tok.startsWith("//")) return "cm";
  if (tok[0] === '"' || tok[0] === "'") return "st";
  if (tok[0] === "#") return "pp";
  if (/^(0[xX][0-9a-fA-F]+|\d+)$/.test(tok)) return "nu";
  if (/^[A-Za-z_]/.test(tok)) {
    if (TYPES.has(tok)) return "ty";
    if (KEYWORDS.has(tok)) return "kw";
    return /^\s*\(/.test(next) ? "fn" : "id";
  }
  return "";
}

// Returns one array of {cls, text} per source line.
export function highlightLines(text) {
  const out = [[]];
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(text)) !== null) {
    const tok = m[0];
    const cls = classify(tok, text.slice(RE.lastIndex, RE.lastIndex + 12));
    const parts = tok.split("\n");
    parts.forEach((p, i) => {
      if (i > 0) out.push([]);
      if (p !== "") out[out.length - 1].push({ cls, text: p });
    });
  }
  return out;
}
