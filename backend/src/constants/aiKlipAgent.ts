export const AI_KLIP_AGENT = {
  SHIPMENT_PLANNER: 'AI Klip Agent — Shipment Planner',
  CHAT: 'AI Klip Agent — Chat',
} as const;

export type AiKlipAgentName = (typeof AI_KLIP_AGENT)[keyof typeof AI_KLIP_AGENT];

/** Model for the AI Shipment Planner (ANTHROPIC_MODEL). */
export function resolveAnthropicApiKeyName(): string {
  const model = process.env.ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6';
  return `Anthropic (${model})`;
}

/**
 * Model for the KLIP Agent AI chat. Deliberately a separate variable from
 * ANTHROPIC_MODEL so tuning the chat agent cannot silently change the
 * Shipment Planner's model (and vice versa).
 */
export function resolveAnthropicAgentModel(): string {
  return process.env.ANTHROPIC_AGENT_MODEL?.trim() || 'claude-sonnet-5';
}

export function resolveAnthropicAgentApiKeyName(): string {
  return `Anthropic (${resolveAnthropicAgentModel()})`;
}

/** Still used by the Dashboard "AI Insight" feature, which remains on Gemini. */
export function resolveGeminiApiKeyName(): string {
  return 'Google Gemini (gemini-2.5-flash)';
}

export function truncateActivityText(value: string, max = 500): string {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}
