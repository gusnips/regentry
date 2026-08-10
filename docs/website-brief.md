# tabrunner.app — Website Brief

Contract between this repo (`tabrunner`, the extension) and the site repo (tabrunner.app, the
marketing/download site, a sibling directory `../site`). The site is static, deploys on its own
cadence, and must **never hardcode a version number** — everything versioned comes from the
GitHub Releases URLs below.

## Download contract

Every pushed `v*` tag builds and attaches four files to the GitHub Release
(`.github/workflows/release.yml`):

| URL (stable — hotlink these)                                                                | What                                            |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `https://github.com/gusnips/tabrunner/releases/latest/download/tabrunner-latest-chrome.zip` | The download — keyed, installs under the CRX's id |
| `https://github.com/gusnips/tabrunner/releases/latest`                                      | Release notes + versioned artifacts             |
| `https://github.com/gusnips/tabrunner/releases/latest/download/tabrunner-latest.crx`        | Signed CRX — published, **never linked** (below) |

The versioned artifacts (`tabrunner-<version>.crx`, `tabrunner-<version>-chrome.zip`) sit on the
same release for the permanent record; the site links only the `latest` aliases and the release
page, so shipping a new version requires no site deploy.

The Chrome Web Store upload is a **third, unlinked artifact** — `tabrunner-<version>-store.zip`,
built locally by `bun run zip:store`. It is the same build with the manifest `key` removed, since
the store rejects an upload that declares one. Never offer it as a download: without the key an
unpacked install lands on a per-machine id.

## Install instructions to present (until the store listing is approved)

**The zip, loaded unpacked, is the only install the site offers:**

1. Download and unzip.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select the unzipped folder.

**Do not link the CRX.** Chrome rejects any sideloaded CRX that carries no Web Store publisher
proof (`CRX_REQUIRED_PROOF_MISSING`), so drag-and-drop install cannot work — the asset is
published for the record, not for humans. Store approval does not change this: a GitHub-hosted
CRX stays unusable, so the flip when the listing lands is **zip → store link**, not zip → CRX.
Until then the store link is plain text, not a dead button.

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
