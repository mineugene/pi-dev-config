# HTML Report Format

Write one self-contained HTML file to the temp directory. Tailwind and Mermaid
come from CDNs. Use Mermaid for graph-shaped diagrams. Use hand-built divs or
inline SVG for editorial visuals. Mix the two.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Architecture review for {{repo name}}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script type="module">
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <style>
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: linear-gradient(135deg, #0f172a, #1e293b); }
    </style>
  </head>
  <body class="bg-stone-50 text-slate-900 font-sans">
    <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
      <header>...</header>
      <section id="candidates" class="space-y-10">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Rules

1. The header names the repository and date. Include a legend: a solid box
   represents a module, a dashed line a seam, a red arrow leakage, and a thick
   dark box a deep module. Write no introduction paragraph.
2. Each candidate is one `article` with:
   - Title: short, names the deepening.
   - Badge row: recommendation strength (`Strong`, `Worth exploring`,
     `Speculative`) and dependency category (`in-process`,
     `local-substitutable`, `ports and adapters`, `mock`).
   - Files: monospaced list.
   - Before and after diagram: the centrepiece, two columns side by side.
   - Problem: one sentence.
   - Solution: one sentence.
   - Wins: at most 6 bullets of at most 6 words each.
   - ADR callout: one line, when applicable.
3. Let the diagram carry the explanation. Redraw it if it needs a paragraph
   to make its point.
4. Diagram patterns: Mermaid flow or sequence for dependencies and call flow;
   hand-built boxes and arrows when Mermaid's layout fights the point;
   cross-section bands for layered shallowness; mass diagrams for interface as
   wide as implementation; call-graph collapse for scattered calls. Vary the
   pattern; do not make every diagram look the same.
5. End with one Top recommendation card: candidate name, one sentence, and an
   anchor link to its candidate.
6. Use exactly the codebase-design terms: module, interface, implementation,
   depth, deep, shallow, seam, adapter, leverage, locality. Do not substitute
   component, service, unit, API, signature, boundary, layer, or wrapper.
7. Colour sparingly: one accent, red for leakage, amber for warnings. Keep
   diagrams about 320px tall.
8. The only scripts are the Tailwind CDN and the Mermaid ESM import. The report
   is otherwise static.
