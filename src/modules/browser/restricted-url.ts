/**
 * URLs Chrome forbids extensions from touching — injection rejects on them, so
 * a run aimed at one must be refused before any work is claimed rather than
 * dying on the first snapshot. Matches the schemes snapshot.ts already maps to
 * errors.restrictedPage, checked proactively.
 */
export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  return (
    /^(chrome|chrome-untrusted|chrome-extension|devtools|about|edge|view-source):/i.test(url) ||
    // Both Web Store hostnames: the legacy path-scoped one and the domain it
    // moved to — Chrome blocks extensions on either.
    /^https?:\/\/chrome\.google\.com\/webstore/i.test(url) ||
    /^https?:\/\/chromewebstore\.google\.com/i.test(url)
  );
}
