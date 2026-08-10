# Generating specification.pdf

`website/ext/docs/specification.pdf` is the printable LUKO specification. It is
a **generated artifact** — never edit the PDF, and never hand-maintain a second
copy of the text. Regenerate it whenever `website/specification.html` changes.

## Run it

```bash
node ai/spec-pdf/build.mjs
```

Writes `website/ext/docs/specification.pdf`. Options:

| Flag | Meaning |
|---|---|
| `--out <path>` | write elsewhere (use this to preview before overwriting) |
| `--keep` | keep the temporary Chrome profile (debugging) |

Chrome location is auto-detected for macOS; override with `CHROME_PATH=…` on
other systems (e.g. `CHROME_PATH=/usr/bin/chromium`).

Requirements: Node ≥ 22 (uses the global `WebSocket`) and a Chrome/Chromium
install. No npm packages, no lockfile, nothing to install.

## What it does

1. Serves `website/` on an ephemeral localhost port (Chrome must fetch the
   logo over http, not `file://`).
2. Launches headless Chrome with remote debugging and attaches to the **page**
   target over the DevTools Protocol.
3. Runs a transform **inside the page**: it walks the live DOM of
   `specification.html`, keeps the English content, drops the web chrome
   (header, nav, language toggle, hero, `↑ top`, footer) and the `.lang-lt`
   blocks, then rebuilds the document as cover + contents + numbered sections.
   The DOM is read with real DOM APIs, not regex — so the PDF cannot drift
   from the page.
4. Applies `ai/spec-pdf/print.css` and prints via `Page.printToPDF`.

Because Chrome renders the footer, the page counter (`N / M`) works — plain
`chrome --print-to-pdf` cannot produce one.

## Design intent

The PDF is **light and typeset**, not a screenshot of the dark website. That is
deliberate: it is a document meant to be read and printed.

- A4, generic `serif` body / `monospace` for values and code. Generic families
  are used on purpose — the original PDF was rendered on Linux (Liberation
  Serif / DejaVu Sans Mono), and generic names keep it reproducible anywhere.
  Expect a slight metric difference between macOS (Times) and Linux.
- Page 1: cover — logo medallion, `LUKO`, `GENESIS TOKEN · ERC-20 · BASE`,
  `SPECIFICATION`, gold rule, then contract and genesis block.
- Page 2: `CONTENTS`, numbered, gold section numbers.
- Page 3+: the nine sections, gold rule under each heading.
- Every page: `LUKO Specification · v1.0 · N / M` centered in the footer.

Presentation lives in `ai/spec-pdf/print.css`; the cover and footer strings
live at the top of `ai/spec-pdf/build.mjs` (`DOC_VERSION`, `FOOTER_LABEL`).
Content **never** lives here — edit `website/specification.html`.

## After regenerating, check

- Page count and A4: `pdfinfo website/ext/docs/specification.pdf`
- No Lithuanian leaked in (must be 0):
  `pdftotext website/ext/docs/specification.pdf - | grep -ciE "Kaldinimo|Nekintamumas|Rezerve"`
- No web chrome leaked in (must be 0):
  `pdftotext website/ext/docs/specification.pdf - | grep -ciE "Skip to content|↑ top|Built by LKSPec"`
- Text you just changed is present. Justified text wraps, so **flatten before
  grepping** or you will get false zeros:
  `pdftotext … - | tr '\n' ' ' | grep -c "your phrase"`
- Look at pages 1–3 as images; the cover and contents are the parts that break
  silently.

The build aborts if it finds fewer than 5 sections — that guard catches a
markup change that would otherwise produce a quietly truncated PDF.
