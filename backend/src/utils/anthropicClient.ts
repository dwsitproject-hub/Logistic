import logger from './logger';

const DEFAULT_MODEL = 'claude-sonnet-4-6';
const DEFAULT_TIMEOUT_MS = 25_000;

export const KLIP_LOGISTICS_SYSTEM_PROMPT =
  'You are an internal Logistics AI Agent for Klip Application. Analyze the provided historical Klip shipment segments and SAP data. Charter type (CIF, V/C, or T/C) is not available in SAP imports — infer it from Klip shipment charter_type patterns in the segments when possible. Return the single most likely parameters. Your response must be a strict, raw JSON object only, with no markdown formatting, no conversational filler, and no prose.';

export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = String(raw ?? '').trim();
  if (!cleaned) return null;

  const tryParse = (text: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(text) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(cleaned);
  if (direct) return direct;

  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) {
    const fromFence = tryParse(fence[1].trim());
    if (fromFence) return fromFence;
  }

  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    if (cleaned[i] === '{') depth += 1;
    else if (cleaned[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return tryParse(cleaned.slice(start, i + 1));
      }
    }
  }
  return null;
}

export type ClaudeJsonRequest = {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  timeoutMs?: number;
};

export async function callClaudeForJson(
  request: ClaudeJsonRequest,
): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }

  const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: request.maxTokens ?? 1024,
        system: request.systemPrompt ?? KLIP_LOGISTICS_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: request.userPrompt }],
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.error('Anthropic API error', { status: response.status, errText: errText.slice(0, 500) });
      throw new Error(`Anthropic API request failed (${response.status})`);
    }

    const body = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = (body.content ?? [])
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
      .trim();

    const parsed = extractJsonObject(text);
    if (!parsed) {
      throw new Error('Claude response did not contain valid JSON');
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Anthropic API request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizePatternKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase();
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
