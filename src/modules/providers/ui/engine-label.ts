/**
 * The trigger's one-line answer to "what runs the next task". Auto names its
 * resolution so it never reads as a pinned choice; effort rides only when the
 * user set one ("default" = the knob is never sent, and stays unsaid).
 */
export function engineLabel(opts: {
  auto: boolean;
  modelName?: string;
  autoText: string;
  effortLabel?: string;
}): string {
  const base = opts.auto
    ? opts.modelName
      ? `${opts.autoText} · ${opts.modelName}`
      : opts.autoText
    : (opts.modelName ?? "");
  return opts.effortLabel ? `${base} · ${opts.effortLabel}` : base;
}
