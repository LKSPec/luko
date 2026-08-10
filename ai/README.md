# ai/

Build and maintenance procedures for this repository — the steps that are not
obvious from the code, written so they can be repeated later without
rediscovering them.

The site itself has no build step: `website/` is served as-is by Cloudflare
Pages. Everything in here is about generated artifacts and one-off procedures.

| Document | What it covers |
|---|---|
| [generate-spec-pdf.md](generate-spec-pdf.md) | Regenerate `website/ext/docs/specification.pdf` from `specification.html` |

## Conventions

- **Generated artifacts are never edited by hand.** If a file is produced by a
  script here, change the source and re-run the script.
- **Single source of truth.** Site configuration lives in `website/config.js`
  (addresses, network, RPC pool, donation recipient, genesis streams), imported
  by both the client scripts and the Pages Functions. Cloudflare environment
  variables hold only secrets and bindings — `RPC_URL`, `DRPC_API_KEY`,
  `CARDS`, `MAILJET_*` — never configuration values.
- **The genesis allocation table on the home page is authoritative.** Anything
  restating it (whitepaper, PDF) is a snapshot and must say so.
