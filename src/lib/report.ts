import { i18n } from "@/i18n";
import { LINKS } from "./links";
import { truncate } from "./logger";

/**
 * The provider facts a bug report needs, structurally satisfied by
 * `ProviderConfig` — declared here so `lib/` never imports a module.
 */
export interface ReportProvider {
  name: string;
  shape: string;
  /** Absent = auto; the endpoint picks the model, which is itself a fact worth reporting. */
  model?: string;
  baseUrl: string;
}

/** Room for a provider body without risking GitHub's ~8 KB URL ceiling. */
const ERROR_LIMIT = 800;
const TITLE_LIMIT = 90;

/**
 * A pre-filled "new issue" URL — the product's only feedback path, and the one
 * that keeps the no-telemetry promise intact: nothing is collected, nothing is
 * sent. The body is assembled locally, GitHub renders it in an editable form,
 * and it exists only if the user presses Submit there.
 *
 * That review step is what licenses carrying the environment at all, and it is
 * why every filled-in fact sits on its own labeled line — a user on a private
 * gateway can see `Endpoint` and delete it before submitting.
 *
 * Deliberately absent: the API key, the conversation, and anything read off a
 * page. The endpoint's HOST only, never the path — a custom gateway is the
 * usual reason a provider bug won't reproduce, so it earns its line, but the
 * path can carry a tenant or a token.
 *
 * English on purpose: the headings are the repo's language, not the UI's. Only
 * the control that opens this is translated — a pt-BR user writes their report
 * in whatever language they like, into an English skeleton the maintainer reads.
 */
export function newIssueUrl(opts: { provider?: ReportProvider; error?: string } = {}): string {
  const { provider, error } = opts;
  const lines = ["### What happened", "", "", "### What you expected", "", ""];

  if (error) {
    lines.push("### Error", "", "```text", truncate(error, ERROR_LIMIT), "```", "");
  }

  lines.push(
    // HTML comments are invisible in GitHub's preview but plain to read in the
    // textarea the user lands in — exactly where the notice belongs.
    "<!-- Filled in by TabRunner. Nothing has been sent anywhere; edit or delete any of it. -->",
    "### Environment",
    "",
    `- TabRunner ${chrome.runtime.getManifest().version} · UI language \`${i18n.language}\``,
    `- \`${navigator.userAgent}\``,
    provider
      ? `- Provider: ${provider.name} (\`${provider.shape}\`) · model \`${provider.model ?? "auto"}\``
      : "- Provider: none configured",
  );
  if (provider) lines.push(`- Endpoint: \`${hostOf(provider.baseUrl)}\``);

  const url = new URL(`${LINKS.repo}/issues/new`);
  url.searchParams.set("body", lines.join("\n"));
  // Only the error path names the issue: it has the one sentence that belongs
  // in a title. A report opened from the menu is titled by the person filing it.
  if (error) url.searchParams.set("title", truncate(firstLine(error), TITLE_LIMIT));
  return url.toString();
}

/** Host alone, and never a throw — a malformed base URL must not cost the user the button. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return truncate(baseUrl, 60);
  }
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? text;
  return line.trim();
}
