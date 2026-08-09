# Provider wire contracts

The load-bearing details of talking to each provider shape. Read this when a task touches
`src/modules/providers/` adapters, streaming, tool results, or model lists.

- **Anthropic rejects consecutive same-role messages.** Tool results go back as ONE user
  message with N `tool_result` blocks; OpenAI expands to N separate `role: "tool"`
  messages. The shared `ChatMessage` shape is `role: "tool_results"` + `toolResults[]`;
  each adapter serializes its own way (`buildOpenAIBody` / `buildAnthropicBody` —
  exported, unit-tested).
- **Auth headers:** Anthropic reads `x-api-key`; coding-plan proxies (Kimi, Z.ai,
  QwenCloud) read `Authorization: Bearer`. The Anthropic adapter sends both.
- **Usage:** OpenAI via `stream_options: {include_usage: true}`; Anthropic via
  `message_start`/`message_delta`. Both adapters emit `{type:"usage"}` deltas.
- **No sampling params.** Never send temperature/topP — provider defaults always apply.
  The one knob we expose is `reasoningEffort` (`none|low|medium|high|max`, optional):
  verbatim `reasoning_effort` on OpenAI-shape; `thinking: {type:"adaptive"}` +
  `output_config: {effort}` on Anthropic-shape (`none` = adaptive only, Anthropic has no
  off switch). Unsupported levels come back as a clean provider 400, surfaced in chat — we
  never sniff model names.
- **Images are data URLs everywhere inside TabRunner**, split per wire format at the
  adapter edge. Anthropic nests image blocks inside the `tool_result` itself; an
  OpenAI-shape `role:"tool"` message is text-only, so that adapter trails a `user` message
  carrying the images. The agent loop keeps only the newest `MAX_ATTACHED_IMAGES`
  screenshots attached (every image is re-sent on every later turn); a user's own
  attachment is never pruned. Screenshots are JPEG q80 from `Page.captureScreenshot` and
  are stripped before storage — user attachments persist.
- **A run's own request body is bounded, not just its images.** Every tool result is
  re-sent on every later turn and a page snapshot is the biggest thing a run makes:
  untrimmed, twenty steps of a real page is already ~1MB of body, so a long run dies on a
  context-length 400 mid-task — the exact dead end the step budget's checkpoint exists to
  prevent. `pruneResultText` is `pruneImages`'s text sibling: newest results keep their
  payload, older ones keep their id (the wire needs one result per call) and a line
  telling the model to re-fetch. This is what makes a 500-step `MAX_STEPS` safe; the two
  must move together.
- **The ChatGPT subscription provider is a `responses` shape** (`responses.ts`), streaming
  the Codex backend's `POST {base}/responses` — it exposes no chat-completions surface.
  Auth is a Bearer access token PLUS the `ChatGPT-Account-Id` header (extracted from the
  JWT at sign-in as `OAuthCredential.chatgptAccountId`; re-extracted on refresh, so it
  never goes stale). Reasoning (`reasoning_summary_text`/`reasoning_text` deltas) is
  displayed but NEVER replayed — the backend requires it blanked. Tool results with
  screenshots use the codex-rs content-array form (`output: [{input_text, input_image}]`);
  text-only results stay a plain string. `reasoningEffort` maps to `reasoning: {effort}`
  (`none` omits the knob — codex models have no off switch).
- **Stream retry** happens in place (agent loop) with full-jitter backoff, only while
  nothing has been emitted yet — the UI never sees replayed tokens.
- **Stop is not an error.** User abort is normal control flow: the loop ends with `done`,
  never a red bubble. The `done` event carries the model's final summary — on tool-only
  final turns it IS the answer, so the panel renders it when no text was streamed.
- **Model lists are live, presets are fallback.** `listModels` (`models.ts`) reads
  `GET {base}/v1/models` (Anthropic-shape) or `GET {base}/models` (OpenAI-shape, non-chat
  ids filtered). `ProviderConfig.model` is optional — absent means auto, resolved at run
  start by `resolveProviderModel`: persisted choice → newest listed (by `created`) →
  preset's first → clear error. QwenCloud has no list route; that's why presets keep model
  ids at all. The ChatGPT backend (responses shape) has NO list route either —
  `listModels` short-circuits to `[]`, so the preset models ARE the picker's list.
  Endpoints that ship a human label (Anthropic `display_name`, OpenRouter `name`) get it
  in `ModelInfo.name` and the picker shows it; the id stays the value on the wire and in
  the tooltip. Model and effort are per-task choices in the side-panel header selects,
  persisted per provider — never asked for at provider-setup time (the key doesn't exist
  yet, so the list can't be fetched there). The "Auto" option renders the model it
  currently resolves to, tagged with an `Auto` chip.
