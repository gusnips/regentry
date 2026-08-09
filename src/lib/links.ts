/**
 * The project's public URLs — the repo is the source of truth for code, docs,
 * issues and the license. Anything user-visible that links out points here.
 */
export const LINKS = {
  repo: "https://github.com/gusnips/tabrunner",
  issues: "https://github.com/gusnips/tabrunner/issues",
  license: "https://github.com/gusnips/tabrunner/blob/main/LICENSE",
  mcpDocs: "https://github.com/gusnips/tabrunner/blob/main/docs/mcp.md",
  // The single-file daemon bundle the Release workflow attaches — a stable
  // alias, so Settings → MCP never hardcodes a version.
  mcpDaemon: "https://github.com/gusnips/tabrunner/releases/latest/download/tabrunner-latest-mcp.js",
  site: "https://tabrunner.app",
} as const;
