import type { IconKey } from "../presets";
import { PRESETS } from "../presets";

/**
 * Simplified brand marks — 24×24 viewBox, white glyph on a brand-color tile.
 * Recognizable at 16–20px, not pixel-perfect logo reproductions.
 */

function OpenAiMark() {
  // Six-petal knot
  return (
    <g stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <line key={deg} x1="12" y1="5" x2="12" y2="10" transform={`rotate(${deg} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="3.5" fill="none" />
    </g>
  );
}

function AnthropicMark() {
  // Sunburst asterisk with uneven rays
  return (
    <g stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="5.5" y1="7.5" x2="18.5" y2="16.5" />
      <line x1="18.5" y1="7.5" x2="5.5" y2="16.5" />
      <line x1="4" y1="12" x2="9" y2="12" />
      <line x1="15" y1="12" x2="20" y2="12" />
    </g>
  );
}

function DeepSeekMark() {
  // Simplified whale
  return (
    <path
      fill="#fff"
      d="M4 13c0-3.6 3.4-6 7.5-6 3.4 0 5.9 1.7 6.9 4.2.4 1 .3 2.1-.3 2.9l-1 1.1c-.6.7-1.6 1-2.5.7l-1.9-.7c-1.5-.5-3.1-.2-4.3.8l-1.3 1.1c-.9.8-2.1.5-2.7-.5A6.6 6.6 0 0 1 4 13Zm13.7-2.4 2.5-2.1c.3-.3.8-.1.9.3l.6 3c.1.5-.3 1-.8 1h-2.6c-.5 0-.8-.6-.6-1.1v-1.1Z"
    />
  );
}

function KimiMark() {
  // Crescent moon (Moonshot)
  return (
    <path
      fill="#FACC15"
      d="M19.5 14.5A8.5 8.5 0 0 1 9.5 4.6a.6.6 0 0 0-.8-.7 9.5 9.5 0 1 0 11.5 11.5.6.6 0 0 0-.7-.9Z"
    />
  );
}

function ZaiMark() {
  return (
    <path
      d="M6 6h12l-8.5 9H18"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function QwenMark() {
  // Cloud
  return (
    <path
      fill="#fff"
      d="M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5 4.24 4.24 0 0 1 17.5 17l-.5.5H7Z"
    />
  );
}

function GeminiMark() {
  // Four-point sparkle
  return (
    <path
      fill="#fff"
      d="M12 3c.7 4.8 4.2 8.3 9 9-4.8.7-8.3 4.2-9 9-.7-4.8-4.2-8.3-9-9 4.8-.7 8.3-4.2 9-9Z"
    />
  );
}

function GroqMark() {
  return (
    <text x="12" y="17" textAnchor="middle" fontSize="14" fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">
      G
    </text>
  );
}

function OpenRouterMark() {
  // Two looped arrows
  return (
    <g fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 9a7 7 0 0 1 12-2" />
      <path d="M17 4v3h-3" />
      <path d="M19 15a7 7 0 0 1-12 2" />
      <path d="M7 20v-3h3" />
    </g>
  );
}

function OllamaMark() {
  // Llama head silhouette
  return (
    <g fill="#fff">
      <rect x="7" y="8" width="10" height="11" rx="4.5" />
      <rect x="7.5" y="4" width="3" height="7" rx="1.5" />
      <rect x="13.5" y="4" width="3" height="7" rx="1.5" />
    </g>
  );
}

function MistralMark() {
  return (
    <path
      d="M5 19V6l7 6 7-6v13"
      fill="none"
      stroke="#fff"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

function XaiMark() {
  return (
    <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </g>
  );
}

const MARKS: Record<IconKey, () => React.JSX.Element> = {
  openai: OpenAiMark,
  anthropic: AnthropicMark,
  deepseek: DeepSeekMark,
  kimi: KimiMark,
  zai: ZaiMark,
  qwen: QwenMark,
  gemini: GeminiMark,
  groq: GroqMark,
  openrouter: OpenRouterMark,
  ollama: OllamaMark,
  mistral: MistralMark,
  xai: XaiMark,
};

export function ProviderIcon({
  icon,
  size = 20,
  color,
}: {
  icon: IconKey;
  size?: number;
  color?: string;
}) {
  const Mark = MARKS[icon];
  const bg = color ?? PRESETS.find((p) => p.icon === icon)?.color ?? "#525252";
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-md"
      style={{ width: size, height: size, backgroundColor: bg }}
      aria-hidden
    >
      <svg width={size * 0.72} height={size * 0.72} viewBox="0 0 24 24">
        <Mark />
      </svg>
    </span>
  );
}
