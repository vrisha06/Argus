# Replace the idle report pane's single-line hint with an onboarding panel that teaches what SecureCompile-X detects

Written against: unavailable (workspace is not a git repository)

## Evidence chain

- Surface: `frontend/src/App.jsx` — report pane in its idle state (`!result && !error`), served at `/` by `securecompile_x/web.py`.
- Problem: On first load the entire report pane (~747px tall at desktop) shows one short line — `Paste C code or load an example, then click Analyze.` — leaving ~90% of the product's primary output surface empty. Confirmed in rendered desktop state. The idle canvas teaches the user nothing about what the tool finds, how it attributes phases, or how it scores risk.
- Design evidence (rendered): desktop initial render, report pane one hint line over empty space. Reusable exemplars already in the surface: the diagnostics panel block (`.diagnostics` in `frontend/src/styles.css:95`) and the phase chip (`.phase-chip`, `frontend/src/styles.css:150`), plus the `PHASES` constant (`frontend/src/App.jsx`) and the four vulnerability-class names used across the app.
- Owner: `frontend/src/App.jsx` (renders the idle branch) and `frontend/src/styles.css` (styling authority).
- Scope and affected surfaces: the single-page analyzer dashboard only. No backend, API, or analysis change.
- Uncertainty: none for presentation. Do not surface exact numeric risk weights in the copy — they live in `securecompile_x/rules.py:RISK_WEIGHTS` and are not exposed to the frontend; describe scoring qualitatively (origin, reachability, mitigating checks) to stay accurate without fabricating values.

## Design decision

Replace the one-line idle hint with a lightweight, read-only onboarding panel that reuses the existing panel + chip visual language. It states, accurately and statically: (a) the four vulnerability classes the tool detects, (b) that each finding is attributed to the earliest compiler phase (reinforced with the existing six-stage pipeline chips), (c) that risk is scored 0–10 from input origin, reachability from `main()`, and mitigating checks, and (d) a nudge to load an example or paste code. This resolves the root problem — an empty, non-communicative primary surface on first impression — without changing any behavior, identity, or the post-analysis layout.

## Reuse

- Token/structure: `--panel`, `--panel-2`, `--border`, `--muted`, `--text`, `--green`, `--mono` (all defined in `frontend/src/styles.css:1`).
- Panel exemplar: `.diagnostics` block — `frontend/src/styles.css:95` (background `--panel`, 1px `--border`, 9px radius, 12–16px padding) and its uppercase muted header `.diagnostics h4` (`frontend/src/styles.css:99`).
- Chip exemplar: `.phase-chip` — `frontend/src/styles.css:150` for the pipeline/phase row.
- Data: the `PHASES` array already declared in `frontend/src/App.jsx` (`["Lexer","Parser","Semantic","IR + CFG","Security","Report"]`).

New composition `.intro` (and small children) is required because the current idle element `.summary.empty` (`frontend/src/styles.css:89`) is a single-line status style and cannot express a multi-section onboarding block. It belongs in `frontend/src/styles.css` beside the other report-pane blocks; its only consumer is the idle branch of the report pane in `App.jsx`. Build it from the tokens above — do not introduce new color values.

## Changes

1. `frontend/src/App.jsx`
   - Change: Replace the idle branch
     ```jsx
     {!result && !error && (
       <div className="summary empty">
         Paste C code or load an example, then click <b>Analyze</b>.
       </div>
     )}
     ```
     with an `.intro` panel. Suggested structure (keep copy accurate to the product; adjust wording, not claims):
     ```jsx
     {!result && !error && (
       <div className="intro">
         <h4>What SecureCompile-X finds</h4>
         <ul className="intro-classes">
           <li><b>Buffer Overflow</b> — tainted or unbounded data reaching a copy/sink</li>
           <li><b>Use-After-Free</b> — a pointer used after <code>free</code>, or a double free</li>
           <li><b>Null-Pointer Dereference</b> — a <code>malloc</code>/null pointer dereferenced with no guard</li>
           <li><b>Unsafe Input Flow</b> — untrusted input reaching a command sink</li>
         </ul>
         <h4>Compiler-phase attribution</h4>
         <p className="intro-note">
           Each finding names the earliest phase that could detect it:
         </p>
         <div className="intro-pipeline">
           {PHASES.map((p) => (
             <span key={p} className={p === "Security" ? "phase-chip" : "intro-chip"}>{p}</span>
           ))}
         </div>
         <h4>Risk score</h4>
         <p className="intro-note">
           Every finding is scored 0–10 from input origin, reachability from
           <code> main()</code>, and mitigating checks on the path.
         </p>
         <p className="intro-cta">Load a seeded example above, or paste your own C, then click <b>Analyze</b>.</p>
       </div>
     )}
     ```
   - Preserve: the `!result && !error` guard, the `.summary.err` and post-analysis branches, and the `PHASES` constant (reuse it; do not duplicate the list).
   - Verify: on first load the report pane shows the onboarding panel; after clicking Analyze it is replaced by the summary + findings exactly as before.

2. `frontend/src/styles.css`
   - Change: Add an `.intro` block beside the other report-pane rules (e.g. after `.diagnostics` at `frontend/src/styles.css:103`), using only existing tokens. Suggested:
     ```css
     .intro {
       background: var(--panel); border: 1px solid var(--border);
       border-radius: 9px; padding: 18px 18px 16px;
     }
     .intro h4 {
       margin: 16px 0 8px; font-size: 11px; color: var(--muted);
       text-transform: uppercase; letter-spacing: .6px;
     }
     .intro h4:first-child { margin-top: 0; }
     .intro-classes { margin: 0; padding-left: 18px; }
     .intro-classes li { margin: 5px 0; font-size: 13px; color: var(--text); line-height: 1.5; }
     .intro-classes code, .intro-note code { font-family: var(--mono); font-size: 12.5px; color: #cdd9e5; }
     .intro-note { margin: 0 0 8px; font-size: 13px; color: var(--muted); line-height: 1.5; }
     .intro-pipeline { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
     .intro-chip {
       font-size: 12px; padding: 3px 11px; border-radius: 14px;
       background: var(--panel-2); color: var(--muted); border: 1px solid var(--border);
     }
     .intro-cta { margin: 14px 0 0; font-size: 13.5px; color: var(--green); }
     ```
   - Preserve: the existing `.summary.empty` rule (still used by nothing after this change is acceptable, or leave it — it is harmless; do not delete other summary variants).
   - Verify: panel matches the surrounding dark panel language (same border/radius/background as `.diagnostics`), the Security chip stands out via the reused `.phase-chip`, no new colors introduced.

## Scope

- Inherit: the report pane's idle state on the single page.
- Verify: the post-analysis states (findings present, zero findings/clean, and error) still render unchanged — the `.intro` branch must not leak into them.
- Exclude: any backend/API change, exposing numeric risk weights, the editor pane, the header pipeline nav, and all responsive-breakpoint work (that is a separate finding).

## Validation

- Product: load `/` with no analysis run → the report pane teaches the four classes, phase attribution, and scoring; click Analyze on an example → onboarding is replaced by the report.
- Interface: check idle, findings-present, clean (0 findings), and error states; desktop (≥860px, two-column) and narrow (<860px, stacked) — the panel wraps within the pane with no horizontal overflow.
- System: confirm `.intro` reuses `--panel/--border/--muted/--green` and `.phase-chip`; confirm no new color literal and no second onboarding pattern was created elsewhere.
- Repository: `cd frontend && npm run build` → build succeeds; then `python -m securecompile_x.web` and open `http://127.0.0.1:8000/` → idle panel renders.

## Stop conditions

- Stop if the four class names or phase list diverge from the backend (`securecompile_x/analysis.py` detectors / `rules.py`); re-derive the copy from the source of truth rather than hardcoding stale names.
- Stop if the idle branch's guard (`!result && !error`) has changed, or if the `PHASES` constant was removed/renamed.

## Design documentation

- After acceptance and validation: none required (no DESIGN.md exists in this repo; absence is not a finding). Optionally note in `README.md` that the idle report pane serves as onboarding, if the team keeps a UI section there.
