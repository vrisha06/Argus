import React from "react";
import { PageHeader } from "../ui/primitives.jsx";

const TOC = [["what", "What Argus does"], ["subset", "Supported C subset"], ["unsupported", "Not supported"],
  ["classes", "Vulnerability classes"], ["report", "The seven report fields"], ["risk", "Risk score and severity"], ["limits", "Limitations"]];

export default function DocsPage() {
  return (
    <>
      <PageHeader title="Documentation" sub="What Argus analyzes, what it reports, and where its limits are." />
      <div className="docs">
        <nav className="docs-toc card pad" aria-label="On this page">
          {TOC.map(([id, l]) => <a key={id} href={`#/docs`} onClick={(e) => { e.preventDefault(); document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth" }); }}>{l}</a>)}
        </nav>
        <div className="docs-body">
          <section id="doc-what" className="card pad">
            <h2>What Argus does</h2>
            <p>Argus is a C compiler front-end and middle-end that detects security vulnerabilities while compiling. It builds tokens, a syntax tree, a symbol table and call graph, and a control-flow graph, then runs interprocedural taint analysis on the intermediate code. It follows untrusted data across function and file boundaries and reports where each flaw originates.</p>
            <p>Every finding names the earliest compiler phase at which it becomes detectable. For the four supported classes that phase is Security Analysis, because they need data-flow, control-flow, taint or call-graph information that earlier phases do not build.</p>
          </section>
          <section id="doc-subset" className="card pad">
            <h2>Supported C subset</h2>
            <ul>
              <li><code>int</code>, <code>char</code> and <code>void</code>; pointers and fixed-size arrays</li>
              <li>Function definitions and calls, including calls across files</li>
              <li>Expressions, assignment, array indexing, <code>*</code> and <code>&amp;</code>, and <code>++</code>/<code>--</code></li>
              <li><code>if</code>/<code>else</code>, <code>while</code>, <code>for</code> and <code>return</code></li>
              <li><code>malloc</code>, <code>free</code> and modeled library functions such as <code>scanf</code>, <code>gets</code>, <code>strcpy</code>, <code>strncpy</code>, <code>memcpy</code>, <code>system</code> and <code>printf</code></li>
            </ul>
          </section>
          <section id="doc-unsupported" className="card pad">
            <h2>Not supported</h2>
            <ul>
              <li>The preprocessor (<code>#include</code>, <code>#define</code>, macros)</li>
              <li>Function pointers, <code>static</code> and <code>extern</code></li>
              <li>Floating-point and <code>long</code> types, <code>struct</code>/<code>union</code>/<code>enum</code></li>
              <li>Machine-code generation and optimization</li>
              <li>Runtime instrumentation. Argus is compiler-based static analysis, not a runtime sanitizer such as ASan.</li>
            </ul>
          </section>
          <section id="doc-classes" className="card pad">
            <h2>Vulnerability classes</h2>
            <dl className="dl">
              <dt>Buffer Overflow</dt><dd>Tainted or unbounded data reaches an unbounded copy, or a tainted array index is written without a bounds check.</dd>
              <dt>Use-After-Free</dt><dd>A pointer is used, or freed again, after <code>free</code>.</dd>
              <dt>Null-Pointer Dereference</dt><dd>A <code>malloc</code> result is dereferenced with no NULL check on the path.</dd>
              <dt>Unsafe Input Flow</dt><dd>Untrusted input reaches a command sink such as <code>system</code> or <code>popen</code>.</dd>
            </dl>
          </section>
          <section id="doc-report" className="card pad">
            <h2>The seven report fields</h2>
            <ol>
              <li>Vulnerability type and location</li><li>Root-cause trace</li><li>Data-flow path, across functions and files</li>
              <li>Compiler-phase attribution</li><li>Reachability from <code>main()</code></li><li>Risk score (0–10)</li><li>Suggested fix</li>
            </ol>
          </section>
          <section id="doc-risk" className="card pad">
            <h2>Risk score and severity</h2>
            <p>The score is deterministic: base 5, +3 for untrusted input, +1.5 if reachable from <code>main()</code> (−2 if not), +1 for an unbounded sink, −3 for a mitigating check, limited to 0–10. Severity labels are derived from the score: Critical 9 and above, High 7 and above, Medium 4 and above, otherwise Low.</p>
            <p>The score ranks findings; it is not the probability that a vulnerability will be exploited, and reachability from <code>main()</code> is not the same as exploitability.</p>
          </section>
          <section id="doc-limits" className="card pad">
            <h2>Limitations</h2>
            <ul>
              <li>Static analysis over-approximates, so some findings may not be exploitable in practice.</li>
              <li>Unusual branch conditions fall back to no refinement and may be reported conservatively.</li>
              <li>A result with no findings means no supported vulnerability was detected, not that the program is secure.</li>
              <li>Suggested fixes and generated proofs are recommendations and aids; Argus does not apply or verify fixes.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
