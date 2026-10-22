import React, { useEffect, useRef, useState } from "react";

const MAX_CELLS = 32;

function Controls({ step, max, setStep, playing, setPlaying }) {
  return (
    <div className="mw-controls">
      <button onClick={() => { setPlaying(false); setStep(0); }} title="Restart">⏮</button>
      <button onClick={() => { if (!playing && step >= max) setStep(0); setPlaying(!playing); }}>
        {playing ? "⏸ Pause" : "▶ Play"}
      </button>
      <input type="range" min="0" max={max} value={step}
             onChange={(e) => { setPlaying(false); setStep(Number(e.target.value)); }} />
      <span className="mw-step">{step}/{max}</span>
    </div>
  );
}

// Byte-by-byte animation of an unbounded copy overrunning a fixed buffer.
function BufferView({ m, step }) {
  const unit = Math.max(1, Math.ceil(Math.max(m.capacity, 1) / MAX_CELLS));
  const capCells = Math.ceil(m.capacity / unit);
  const overCells = Math.min(12, Math.ceil(Math.max(0, m.length - m.capacity) / unit));
  const written = step;                       // bytes written so far
  const cells = [];
  for (let i = 0; i < capCells + overCells; i++) {
    const over = i >= capCells;
    const filled = written > i * unit;
    cells.push(
      <span key={i} className={`mw-cell ${over ? "over" : ""} ${filled ? "filled" : ""}`}>
        {filled ? "A" : ""}
      </span>
    );
  }
  const past = Math.max(0, written - m.capacity);
  const caption = written === 0
    ? `${m.name}[${m.capacity}] is empty. The input is ${m.length} bytes long.`
    : past === 0
      ? `${m.sink}() has copied ${written} of ${m.capacity} bytes into ${m.name} — still safe.`
      : `${m.sink}() has copied ${written} bytes: ${past} byte${past > 1 ? "s" : ""} landed past the end of ${m.name}, overwriting adjacent memory.`;
  return (
    <>
      <div className="mw-legend">
        <span><i className="mw-sw" /> {m.name} ({m.capacity} bytes{m.assumed ? ", assumed" : ""}{unit > 1 ? `, 1 cell = ${unit} bytes` : ""})</span>
        <span><i className="mw-sw over" /> adjacent memory (other variables, saved return address)</span>
      </div>
      <div className="mw-row">{cells}</div>
      <p className={`mw-cap ${past ? "bad" : ""}`}>{caption}</p>
    </>
  );
}

function IndexView({ m, step }) {
  const show = Math.min(m.capacity, MAX_CELLS);
  const cells = [];
  for (let i = 0; i < show; i++) {
    cells.push(<span key={i} className="mw-cell filled idx"><small>{i}</small></span>);
  }
  const hit = step >= 1;
  return (
    <>
      <div className="mw-legend">
        <span><i className="mw-sw" /> {m.name}[0..{m.capacity - 1}]</span>
        <span><i className="mw-sw over" /> outside the array</span>
      </div>
      <div className="mw-row">
        {cells}
        <span className={`mw-cell over ${hit ? "filled" : ""}`}><small>{m.index}</small></span>
      </div>
      <p className={`mw-cap ${hit ? "bad" : ""}`}>
        {step === 0
          ? `The program reads an index from input: ${m.index}. Valid indexes are 0 to ${m.capacity - 1}.`
          : `${m.name}[${m.index}] is written — one slot beyond the array, corrupting whatever sits next to it.`}
      </p>
    </>
  );
}

function PointerView({ kind, m, step }) {
  const uaf = kind === "uaf";
  const blockCls = uaf ? (step === 0 ? "ok" : "freed") : (step === 0 ? "ok" : "null");
  const blockTxt = uaf ? (step === 0 ? "heap block\nallocated" : "heap block\nFREED")
                       : (step === 0 ? "malloc(...)\nmay fail" : "no memory\n(address 0)");
  const ptrTxt = uaf ? m.var : `${m.var} = ${step === 0 ? "?" : "NULL"}`;
  const bad = step === 2;
  const captions = uaf ? [
    `${m.var} = malloc(...) — ${m.var} points to a live heap block.`,
    `free(${m.var})${m.free_line ? ` (line ${m.free_line})` : ""} — the block goes back to the allocator, but ${m.var} still holds its address (a dangling pointer).`,
    m.double
      ? `free(${m.var}) again${m.use_line ? ` (line ${m.use_line})` : ""} — double free: the allocator's bookkeeping is corrupted.`
      : `${m.var} is used${m.use_line ? ` (line ${m.use_line})` : ""} — reading or writing memory that is no longer yours.`,
  ] : [
    `${m.var} = malloc(...)${m.alloc_line ? ` (line ${m.alloc_line})` : ""} — the result is never checked.`,
    `Under memory pressure malloc returns NULL, so ${m.var} is 0.`,
    `*${m.var}${m.deref_line ? ` (line ${m.deref_line})` : ""} dereferences address 0 — the program crashes.`,
  ];
  return (
    <>
      <div className="mw-ptr">
        <div className="mw-box">{ptrTxt}</div>
        <div className={`mw-arrow ${bad ? "bad" : ""} ${uaf && step >= 1 ? "dangling" : ""}`}>
          {step === 0 && !uaf ? "→" : uaf ? "→" : "⇢"}
        </div>
        <div className={`mw-box block ${blockCls} ${bad ? "hit" : ""}`}>
          {blockTxt.split("\n").map((l, i) => <div key={i}>{l}</div>)}
        </div>
      </div>
      <p className={`mw-cap ${bad ? "bad" : ""}`}>{captions[step]}</p>
    </>
  );
}

function CommandView({ m, step }) {
  const caps = [
    "The attacker types a payload instead of normal input.",
    `The program passes that text straight into ${m.sink}().`,
    "The shell splits the string at `;` and runs the attacker's command as well.",
  ];
  return (
    <>
      <div className="mw-cmd">
        <code className={step === 0 ? "hl" : ""}>input = "{m.payload}"</code>
        {step >= 1 && <code className={step === 2 ? "bad" : ""}>{m.sink}("{m.payload}")</code>}
        {step >= 2 && <code className="bad">→ runs: (nothing) ; echo PWNED</code>}
      </div>
      <p className={`mw-cap ${step === 2 ? "bad" : ""}`}>{caps[step]}</p>
    </>
  );
}

export default function MemoryWalkthrough({ memory: m }) {
  const max = m.kind === "buffer" ? m.length : m.kind === "index" ? 1 : 2;
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tick = useRef(null);

  useEffect(() => {
    if (!playing) return undefined;
    const inc = m.kind === "buffer" ? Math.max(1, Math.ceil(m.length / 40)) : 1;
    const delay = m.kind === "buffer" ? 60 : 900;
    tick.current = setInterval(() => {
      setStep((s) => {
        if (s >= max) { setPlaying(false); return max; }
        return Math.min(max, s + inc);
      });
    }, delay);
    return () => clearInterval(tick.current);
  }, [playing, max, m.kind, m.length]);

  return (
    <div className="mw">
      {m.kind === "buffer" && <BufferView m={m} step={step} />}
      {m.kind === "index" && <IndexView m={m} step={step} />}
      {(m.kind === "uaf" || m.kind === "null") && <PointerView kind={m.kind} m={m} step={step} />}
      {m.kind === "command" && <CommandView m={m} step={step} />}
      <Controls step={step} max={max} setStep={setStep} playing={playing} setPlaying={setPlaying} />
    </div>
  );
}
