/* Render website/specification.html into ext/docs/specification.pdf.
 *
 * Zero npm dependencies: drives the system Chrome over the DevTools Protocol
 * (Node's global WebSocket, Node >= 22). Chrome's printToPDF gives us the
 * "N / M" page footer, which plain --print-to-pdf cannot do.
 *
 * The English content is lifted from the live specification.html by the
 * browser itself (DOM API, not regex), so the PDF can never drift from the
 * page. Only presentation lives here: print.css plus the cover and contents.
 *
 * Usage:  node ai/spec-pdf/build.mjs [--keep] [--out <path>]
 * See ai/generate-spec-pdf.md.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const SITE = path.join(REPO, "website");
const OUT = path.join(SITE, "ext/docs/specification.pdf");

const CHROME = process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const DOC_VERSION = "v1.0";
const FOOTER_LABEL = "LUKO Specification";

/* ---------- tiny static server (Chrome must fetch assets over http) ---------- */
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".ttf": "font/ttf", ".pdf": "application/pdf" };

function serve(root) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const file = path.join(root, rel === "/" ? "/index.html" : rel);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      try {
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch { res.writeHead(404).end("not found"); }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/* ---------- minimal CDP client ---------- */
async function cdp(port) {
  /* Attach to the page target, not the browser endpoint — the Page domain
     only exists on a page. */
  let target, lastErr;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!target) throw new Error(`No Chrome page target on ${port}: ${lastErr || "none listed"}`);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method && events.has(msg.method)) {
      events.get(msg.method)();
      events.delete(msg.method);
    }
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      ws.send(JSON.stringify({ id: n, method, params }));
    }),
    once: (method) => new Promise((resolve) => events.set(method, resolve)),
    close: () => ws.close()
  };
}

/* ---------- in-page transform: build the print document from the live DOM ---------- */
function transform(css, docVersion) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  /* Prefer the English payload of a bilingual element, else its own markup. */
  const en = (el) => (el.dataset && el.dataset.en) ? esc(el.dataset.en) : el.innerHTML;
  const txt = (el) => (el && el.dataset && el.dataset.en) ? el.dataset.en : (el ? el.textContent.trim() : "");

  const render = (node) => {
    if (node.nodeType !== 1) return "";
    const cls = node.classList;
    if (cls.contains("lang-lt") || cls.contains("panel-head") || cls.contains("to-top")) return "";
    if (cls.contains("lang-en")) return [...node.children].map(render).join("");
    if (node.tagName === "P" && cls.contains("faq-q")) return `<p class="faq-q">${en(node)}</p>`;
    if (node.tagName === "P" && cls.contains("footnote")) return `<p class="note">${en(node)}</p>`;
    if (node.tagName === "P") return `<p>${en(node)}</p>`;
    if (node.tagName === "H3") return `<h3 class="sub">${en(node)}</h3>`;
    if (node.tagName === "UL")
      return `<ul>${[...node.children].map((li) => `<li>${en(li)}</li>`).join("")}</ul>`;
    if (node.tagName === "PRE") return `<pre>${node.textContent.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</pre>`;
    if (cls.contains("faq-item")) return `<div class="faq">${[...node.children].map(render).join("")}</div>`;
    if (cls.contains("table-scroll") || node.tagName === "TABLE") {
      const table = node.tagName === "TABLE" ? node : node.querySelector("table");
      if (!table) return "";
      const rows = [...table.querySelectorAll("tr")].map((tr) => {
        const tds = [...tr.children];
        return `<tr><td>${en(tds[0])}</td><td>${tds[1] ? en(tds[1]) : ""}</td></tr>`;
      }).join("");
      return `<table>${rows}</table>`;
    }
    if (cls.contains("link-rows")) {
      const rows = [...node.children].map((row) => {
        const name = txt(row.querySelector(".link-name"));
        const valEl = row.querySelector("a, code.address, .link-plain");
        const val = valEl ? valEl.textContent.trim().replace(/\s*→$/, "") : "";
        return `<div class="link-row"><span class="name">${esc(name)}</span><span class="val">${esc(val)}</span></div>`;
      }).join("");
      return `<div class="links">${rows}</div>`;
    }
    return [...node.children].map(render).join("");
  };

  const sections = [...document.querySelectorAll("main > section.panel")].map((s) => ({
    title: txt(s.querySelector(".label")),
    body: [...s.children].map(render).join("")
  })).filter((s) => s.title);

  const split = (t) => {
    const m = t.match(/^(\d+)\s*·\s*(.+)$/);
    return m ? { n: m[1], name: m[2] } : { n: "", name: t };
  };

  const toc = sections.map((s) => {
    const { n, name } = split(s.title);
    return `<div class="toc-row"><span class="toc-num">${n}</span><span>${esc(name)}</span></div>`;
  }).join("");

  const body = sections.map((s) => {
    const { n, name } = split(s.title);
    return `<section><h2 class="sec"><span class="n">${n}</span><span>${esc(name)}</span></h2>${s.body}</section>`;
  }).join("");

  const contract = (document.querySelector("code.address") || {}).textContent || "";

  document.head.innerHTML = `<meta charset="utf-8"><title>LUKO Specification</title><style>${css}</style>`;
  document.documentElement.removeAttribute("data-lang");
  document.body.innerHTML = `
    <div class="cover">
      <div class="cover-mark"><img src="assets/logo-mark-dark.svg" alt=""></div>
      <div class="cover-word">LUKO</div>
      <div class="cover-kicker">GENESIS TOKEN · ERC-20 · BASE</div>
      <div class="cover-title">SPECIFICATION</div>
      <div class="cover-rule"></div>
      <p class="cover-meta">LUKO (ERC-20), Base mainnet<br>Document version ${docVersion.replace(/^v/, "")} · Status: Final<br>Contract ${esc(contract.trim())}<br>Genesis block 49364826</p>
    </div>
    <div class="contents">
      <h2>CONTENTS</h2>
      <div class="contents-rule"></div>
      ${toc}
    </div>
    ${body}`;
  return sections.length;
}

/* ---------- main ---------- */
const argv = process.argv.slice(2);
const outPath = argv.includes("--out") ? path.resolve(argv[argv.indexOf("--out") + 1]) : OUT;

const css = await readFile(path.join(HERE, "print.css"), "utf8");
const { server, port } = await serve(SITE);
const profile = await mkdtemp(path.join(tmpdir(), "luko-pdf-"));
const debugPort = 9333 + Math.floor(process.pid % 500);

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-component-update", "--disable-background-networking",
  `--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, "about:blank"
], { stdio: "ignore" });

let failure = null;
try {
  const client = await cdp(debugPort);
  await client.send("Page.enable");
  const loaded = client.once("Page.loadEventFired");
  await client.send("Page.navigate", { url: `http://127.0.0.1:${port}/specification.html` });
  await loaded;
  await new Promise((r) => setTimeout(r, 700));

  const result = await client.send("Runtime.evaluate", {
    expression: `(${transform.toString()})(${JSON.stringify(css)}, ${JSON.stringify(DOC_VERSION)})`,
    returnByValue: true, awaitPromise: false
  });
  if (result.exceptionDetails) throw new Error("transform failed: " + JSON.stringify(result.exceptionDetails));
  const sectionCount = result.result.value;
  if (!sectionCount || sectionCount < 5) throw new Error(`only ${sectionCount} sections found — aborting`);
  await new Promise((r) => setTimeout(r, 400));

  const footer = `<div style="width:100%;font-family:monospace;font-size:7pt;color:#55524C;text-align:center;">
    ${FOOTER_LABEL} · ${DOC_VERSION} &nbsp;·&nbsp; <span class="pageNumber"></span> / <span class="totalPages"></span></div>`;

  const pdf = await client.send("Page.printToPDF", {
    printBackground: true, preferCSSPageSize: true,
    displayHeaderFooter: true, headerTemplate: "<div></div>", footerTemplate: footer
  });
  await writeFile(outPath, Buffer.from(pdf.data, "base64"));
  client.close();
  console.log(`✓ ${path.relative(REPO, outPath)} — ${sectionCount} sections`);
} catch (err) {
  failure = err;
  console.error("✗ PDF build failed:", err.message);
} finally {
  chrome.kill("SIGKILL");
  server.close();
  if (!argv.includes("--keep")) await rm(profile, { recursive: true, force: true });
}
process.exit(failure ? 1 : 0);
