# tabrunner.app — Website Brief

Contract between this repo (`tabrunner`, the extension) and the `tabrunner-site` repo (the
marketing/download site, a sibling directory `../tabrunner-site`). The site is static, deploys on
its own cadence, and must **never hardcode a version number** — everything versioned comes from
the GitHub Releases URLs below.

## Download contract

Every pushed `v*` tag builds and attaches four files to the GitHub Release
(`.github/workflows/release.yml`):

| URL (stable — hotlink these)                                                                                    | What                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `https://github.com/gusnips/tabrunner/releases/latest/download/tabrunner-latest.crx`                            | Signed CRX, primary install until store approval |
| `https://github.com/gusnips/tabrunner/releases/latest/download/tabrunner-latest-chrome.zip`                     | The exact zip uploaded to the Chrome Web Store   |
| `https://github.com/gusnips/tabrunner/releases/latest`                                                          | Release notes + versioned artifacts              |

The versioned artifacts (`tabrunner-<version>.crx`, `tabrunner-<version>-chrome.zip`) sit on the
same release for the permanent record; the site links only the `latest` aliases and the release
page, so shipping a new version requires no site deploy.

## Install instructions to present (until the store listing is approved)

Once approved, the primary CTA flips to the Chrome Web Store listing; keep these as an
"advanced/sideload" section.

**CRX (recommended):**

1. Download the `.crx`.
2. Open `chrome://extensions` and enable **Developer mode** (top-right toggle).
3. Drag the downloaded `.crx` onto that page and confirm.

Caveats the site must state plainly:

- Chrome shows "this extension is not from the Chrome Web Store" — expected for a self-signed CRX.
- The CRX's extension ID differs from the future store item's (different signing key), so the
  store version will install as a **separate** extension; users should remove the sideloaded one
  after migrating. Browser-stored settings don't carry over.
- No auto-update: new versions are manual re-installs from the site (this is why the download
  links are `latest` aliases — the instructions never change).

**Zip (fallback):**

1. Download and unzip.
2. `chrome://extensions` → Developer mode → **Load unpacked** → select the unzipped folder.

## Content sources in this repo

- Product copy and permission justifications: `docs/store-listing.md` (written for a CWS reviewer;
  adapt tone for a landing page).
- What it is / how the MCP bridge works: `README.md`, `docs/mcp.md`.
- Screenshots: `docs/screenshots/`.
- Social image: `docs/og.png`.
- Brand mark is generated from `src/shared/logo.ts` (`bun run icons`) — never hand-edit the PNGs.
  If the site needs other sizes, regenerate from the source, don't upscale.
- Brand color: `brand-*` purple scale in `src/lib/theme.css`.

## Hard requirements

- Chromium-only (Chrome, Brave, Edge, Arc…) — `chrome.debugger` has no Firefox/Safari equivalent;
  say so rather than offering dead download buttons for other browsers.
- Link the privacy doc (`PRIVACY.md`) — an agent that drives your logged-in browser must answer
  the data question up front.
