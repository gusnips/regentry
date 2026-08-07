/**
 * Split a provider error line into a human summary and a raw JSON detail blob.
 * Adapters throw `Anthropic API error 400: {"error":{...}}` — the JSON is for
 * debugging, not for the chat bubble, so the UI tucks it behind a disclosure.
 */
export function splitErrorDetail(message: string): { summary: string; detail?: string } {
  const start = message.indexOf("{");
  if (start === -1) return { summary: message };

  const candidate = message.slice(start).trim();
  try {
    JSON.parse(candidate);
  } catch {
    return { summary: message };
  }

  const summary = message.slice(0, start).replace(/[:\s]+$/, "");
  return summary ? { summary, detail: candidate } : { summary: message };
}
