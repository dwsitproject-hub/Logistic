export const AI_KLIP_AGENT = {
  SHIPMENT_PLANNER: 'AI Klip Agent — Shipment Planner',
  CHAT: 'AI Klip Agent — Chat',
} as const;

export type AiKlipAgentName = (typeof AI_KLIP_AGENT)[keyof typeof AI_KLIP_AGENT];

export function resolveAnthropicApiKeyName(): string {
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6';
  return `Anthropic (${model})`;
}

export function resolveGeminiApiKeyName(): string {
  return 'Google Gemini (gemini-2.5-flash)';
}

export function truncateActivityText(value: string, max = 500): string {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
