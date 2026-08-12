# tabrunner.app — Website Brief

Contract between this repo (`tabrunner`, the extension) and the site repo (tabrunner.app, the
marketing/download site, a sibling directory `../site`). The site is static, deploys on its own
cadence, and must **never hardcode a version number** — everything versioned comes from the
GitHub Releases URLs below.

## Download contract

Every pushed `v*` tag builds and attaches these to the GitHub Release
(`.github/workflows/release.yml`):

| URL (stable — hotlink these)                                                                | What                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `https://github.com/tabrunner/tabrunner/releases/latest/download/tabrunner-latest-chrome.zip` | The download — keyed, installs under the store's id |
| `https://github.com/tabrunner/tabrunner/releases/latest`                                      | Release notes + versioned artifacts             |

The versioned artifacts (`tabrunner-<version>-chrome.zip`, `-mcp.js`) sit on the same release for
the permanent record; the site links only the `latest` aliases and the release page, so shipping a
new version requires no site deploy.

The Chrome Web Store upload is a **third, unlinked artifact** — `tabrunner-<version>-store.zip`,
built locally by `bun run zip:store`. It is the same build with the manifest `key` removed, since
the store rejects an upload that declares one. Never offer it as a download: without the key an
unpacked install lands on a per-machine id.

## Install instructions to present (until the store listing is approved)

**The zip, loaded unpacked, is the only install the site offers:**

1. Download and unzip.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select the unzipped folder.

**There is no CRX to link, and never will be.** Chrome only installs a CRX that arrives through
the store's own flow, and the store signs with a key only Google holds — so a self-signed CRX is
refused (`CRX_REQUIRED_PROOF_MISSING`) and the store's own CRX has no public URL a site may
hotlink. The per-revision link the dashboard shows (`.../revision/000NN/package/main/crx/3`) is a
dashboard preview: it changes every revision and Chrome blocks installing it from a page. So the
flip when the listing lands is **zip → the listing URL** (`LINKS.store`, an *Add to Chrome*
button), never zip → any CRX. Until then the store link is plain text, not a dead button.

Releases up to v0.2.2 still carry a `.crx` asset, so the site's "the .crx won't drag-and-drop
install — use the ZIP" caveat stays accurate and stays up until the store flip rewrites that
section.

Caveats the site must state plainly:

- Unpacked installs show Chrome's "disable developer mode extensions" nag on each restart.
- The store version will install as a **separate** extension (different ID); users should remove
  the unpacked one after migrating. Browser-stored settings don't carry over.
- No auto-update: new versions are manual re-installs from the site (this is why the download
  links are `latest` aliases — the instructions never change).

## Content sources in this repo

- Product copy and permission justifications: `docs/store-listing.md` (written for a CWS reviewer;
  adapt tone for a landing page).
- What it is / how the MCP bridge works: `README.md`, `docs/mcp.md`.
- Screenshots: `docs/screenshots/`.
- Social image: `docs/og.png`.
- Brand mark is generated from `src/shared/logo.ts` (`bun run icons`) — never hand-edit the PNGs.
  If the site needs other sizes, regenerate from the source, don't upscale.
- Brand color: the `brand-*` comet-burn emerald scale in `src/lib/theme.css`, with the
  `telemetry` gold reserved for anything that measures. Two lights only — the retired purple and
  the brief cyan must not come back.

## Hard requirements

- Chromium-only (Chrome, Brave, Edge, Arc…) — `chrome.debugger` has no Firefox/Safari equivalent;
  say so rather than offering dead download buttons for other browsers.
- Link the privacy doc (`PRIVACY.md`) — an agent that drives your logged-in browser must answer
  the data question up front.
