import React, { useLayoutEffect, useRef, useState } from "react";

// C89/C99 keywords.
const KEYWORDS = [
  "auto", "break", "case", "char", "const", "continue", "default", "do",
  "double", "else", "enum", "extern", "float", "for", "goto", "if", "inline",
  "int", "long", "register", "restrict", "return", "short", "signed", "sizeof",
  "static", "struct", "switch", "typedef", "union", "unsigned", "void",
  "volatile", "while",
];

// Standard-library functions the analyzer models (sources, sinks, allocators)
// plus common companions — so completions match what Argus understands.
const FUNCTIONS = [
  "malloc", "calloc", "realloc", "free", "scanf", "sscanf", "fscanf", "printf",
  "fprintf", "sprintf", "snprintf", "puts", "gets", "fgets", "getchar",
  "putchar", "strcpy", "strncpy", "strcat", "strncat", "strcmp", "strncmp",
  "strlen", "memcpy", "memmove", "memset", "system", "popen", "execl", "execlp",
  "execvp", "exit", "fopen", "fclose", "fread", "fwrite", "read", "write",
];

const CANDIDATES = [
  ...KEYWORDS.map((label) => ({ label, kind: "keyword" })),
  ...FUNCTIONS.map((label) => ({ label, kind: "fn" })),
];

const MAX_ITEMS = 8;

// Must match the .code CSS below exactly so the gutter aligns with each line.
const LINE_H = 21;
const PAD_TOP = 16;

const SEV_RANK = { high: 3, medium: 2, low: 1, info: 0 };

// Styles to copy onto the hidden mirror so caret measurement matches the
// textarea exactly (standard textarea-caret-position technique).
const MIRROR_PROPS = [
  "boxSizing", "width", "height", "overflowX", "overflowY",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "fontStyle", "fontVariant", "fontWeight", "fontStretch", "fontSize",
  "lineHeight", "fontFamily", "textAlign", "textTransform", "textIndent",
  "letterSpacing", "wordSpacing", "tabSize", "whiteSpace", "wordWrap",
];

function caretCoords(el, position) {
  const computed = window.getComputedStyle(el);
  const div = document.createElement("div");
  const s = div.style;
  s.position = "absolute";
  s.visibility = "hidden";
  s.whiteSpace = "pre-wrap";
  s.wordWrap = "break-word";
  MIRROR_PROPS.forEach((p) => { s[p] = computed[p]; });
  div.textContent = el.value.substring(0, position);
  const span = document.createElement("span");
  span.textContent = el.value.substring(position) || ".";
  div.appendChild(span);
  document.body.appendChild(div);
  const coords = {
    top: span.offsetTop + parseInt(computed.borderTopWidth, 10),
    left: span.offsetLeft + parseInt(computed.borderLeftWidth, 10),
    height: parseInt(computed.lineHeight, 10) || LINE_H,
  };
  document.body.removeChild(div);
  return coords;
}

function prefixAt(value, caret) {
  let start = caret;
  while (start > 0 && /[A-Za-z0-9_]/.test(value[start - 1])) start--;
  const prefix = value.slice(start, caret);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) return null;
  return { prefix, start };
}

function topSeverity(ms) {
  return ms.reduce((a, m) => (SEV_RANK[m.severity] > SEV_RANK[a] ? m.severity : a), "info");
}

export default function CodeEditor({ value, onChange, markers = [], onMarkerClick }) {
  const taRef = useRef(null);
  const gutterInnerRef = useRef(null);
  const pendingCaret = useRef(null);
  const hoverTimer = useRef(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [sel, setSel] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const [hoverLine, setHoverLine] = useState(null);

  // Group markers by line.
  const byLine = new Map();
  for (const m of markers) {
    if (!m.line) continue;
    if (!byLine.has(m.line)) byLine.set(m.line, []);
    byLine.get(m.line).push(m);
  }
  const lines = value.split("\n");

  useLayoutEffect(() => {
    if (pendingCaret.current != null && taRef.current) {
      const c = pendingCaret.current;
      taRef.current.selectionStart = taRef.current.selectionEnd = c;
      pendingCaret.current = null;
    }
  }, [value]);

  function refresh(el) {
    const caret = el.selectionStart;
    const ctx = prefixAt(el.value, caret);
    if (!ctx) { setOpen(false); return; }
    const p = ctx.prefix.toLowerCase();
    const matches = CANDIDATES
      .filter((c) => c.label.toLowerCase().startsWith(p) && c.label !== ctx.prefix)
      .slice(0, MAX_ITEMS);
    if (matches.length === 0) { setOpen(false); return; }
    const co = caretCoords(el, ctx.start);
    setPos({ top: co.top + co.height - el.scrollTop, left: co.left - el.scrollLeft });
    setItems(matches);
    setSel(0);
    setOpen(true);
  }

  function handleChange(e) {
    onChange(e.target.value);
    refresh(e.target);
  }

  function accept(item) {
    const el = taRef.current;
    const caret = el.selectionStart;
    const ctx = prefixAt(el.value, caret);
    if (!ctx) { setOpen(false); return; }
    const next = el.value.slice(0, ctx.start) + item.label + el.value.slice(caret);
    pendingCaret.current = ctx.start + item.label.length;
    onChange(next);
    setOpen(false);
    el.focus();
  }

  function handleKeyDown(e) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault(); setSel((s) => (s + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setSel((s) => (s - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault(); accept(items[sel]);
    } else if (e.key === "Escape") {
      e.preventDefault(); setOpen(false);
    }
  }

  function handleScroll(e) {
    setScrollTop(e.target.scrollTop);
    if (gutterInnerRef.current) {
      gutterInnerRef.current.style.transform = `translateY(${-e.target.scrollTop}px)`;
    }
    setOpen(false);
  }

  function showHover(line) {
    clearTimeout(hoverTimer.current);
    setHoverLine(line);
  }
  function hideHoverSoon() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHoverLine(null), 160);
  }

  const hoverMarkers = hoverLine ? byLine.get(hoverLine) : null;

  return (
    <div className="editor-main">
      <div className="gutter-col" aria-hidden>
        <div className="gutter-inner" ref={gutterInnerRef}>
          {lines.map((_, i) => {
            const line = i + 1;
            const ms = byLine.get(line);
            const sev = ms ? topSeverity(ms) : null;
            return (
              <div
                key={i}
                className="gutter-row"
                onMouseEnter={ms ? () => showHover(line) : undefined}
                onMouseLeave={ms ? hideHoverSoon : undefined}
              >
                {ms ? (
                  <button
                    className={`gutter-mark ${sev}`}
                    title={`${ms.length} issue${ms.length > 1 ? "s" : ""} on line ${line}`}
                    onClick={() => onMarkerClick?.(ms[0].id)}
                  />
                ) : (
                  <span className="gutter-mark empty" />
                )}
                <span className="gutter-num">{line}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="code-editor-wrap">
        <textarea
          ref={taRef}
          className="code"
          spellCheck={false}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
        />

        {open && (
          <ul className="ac-pop" style={{ top: pos.top, left: pos.left }}>
            {items.map((it, i) => (
              <li
                key={it.label}
                className={`ac-item ${i === sel ? "sel" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); accept(it); }}
                onMouseEnter={() => setSel(i)}
              >
                <span className={`ac-kind ${it.kind}`}>{it.kind === "fn" ? "ƒ" : "K"}</span>
                <span className="ac-label">{it.label}</span>
                <span className="ac-tag">{it.kind === "fn" ? "function" : "keyword"}</span>
              </li>
            ))}
          </ul>
        )}

        {hoverMarkers && (
          <div
            className="marker-pop"
            style={{ top: PAD_TOP + (hoverLine - 1) * LINE_H - scrollTop + LINE_H }}
            onMouseEnter={() => showHover(hoverLine)}
            onMouseLeave={hideHoverSoon}
          >
            {hoverMarkers.map((m) => (
              <button key={m.id} className="marker-pop-item" onClick={() => onMarkerClick?.(m.id)}>
                <span className={`mk-dot ${m.severity}`} />
                <span className="mk-title">{m.title}</span>
                <span className={`mk-phase ${m.ai ? "ai" : ""}`}>{m.phase}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
