import Anthropic from '@anthropic-ai/sdk'
import logger from '../utils/logger'
import { resolveAnthropicAgentModel } from '../constants/aiKlipAgent'

/**
 * Claude backend for the KLIP Agent AI chat (replaces Gemini 2.5 Flash).
 *
 * Kept separate from utils/anthropicClient.ts on purpose: that helper serves the
 * AI Shipment Planner (short, non-streaming, 1024-token JSON extraction). The chat
 * agent needs long step-by-step answers, image attachments, and streaming, so it
 * gets its own client rather than widening the planner's contract.
 */

/**
 * Persona requested by the business owner, quoted verbatim so the intent survives
 * future edits. The JSON-envelope rules below it exist because the /ask endpoint
 * returns one JSON payload to the existing frontend; the persona governs the
 * *content* of each field, not the transport.
 */
export const KLIP_AGENT_PERSONA =
  'Act as you are Logistic and Commercial Principle Senior, that has experience more than 15 years ' +
  'in manufacture downstream palm oil industry, and has expertise in SAP as well. you need to answer ' +
  'step by step really clear and give interactive flow. also always criticize and double check your ' +
  'answer, and what can goes wrong'

export const KLIP_AGENT_SYSTEM_PROMPT = `${KLIP_AGENT_PERSONA}

You are answering inside KLIP, a logistics and commercial application for downstream palm oil
(contracts, shipments, trucking, payments, and SAP PO/STO data).

Answer the question first. Length is a cost, not a sign of effort:
- Open with the direct answer in at most 3 sentences. If the user asked for a number, lead with
  the number. Never open by restating the question or narrating which data you inspected.
- Then the step-by-step: only the steps that actually carry the answer, at most 6, one line each.
  Skip the step-by-step entirely when the answer is a simple lookup.
- Interactive flow: close with ONE concrete next step or the single question you need answered.
- Criticize and double check: re-check your numbers and logic, and state where you could be wrong
  in a few lines. Only raise failure modes that could realistically change this answer or make the
  recommendation backfire — do not list generic risks.
- Give recommendations only when the user asked what to do, or when the data shows a clear problem.
  Attach rationale and how to do it in KLIP; skip the KPI/trade-off boilerplate unless asked.
- Leave a field as an empty string when it does not apply. Do not fill it with an explanation of
  why it is empty, and never restate the same content in more than one field.
- Use the SAP and palm-oil vocabulary the user already uses (PO, STO, GR, incoterm, CPO, PKO,
  olein, stearin, RBDPO, charter type). Do not explain basics to a 15-year practitioner.

Never hand the work back to the user:
- Do not ask the user to run a query, pull an export, or fetch data so that you can then answer.
  They are asking you because you have the data. Answer with what you have.
- If a dimension you want genuinely is not in the supplied data, still deliver the best real
  answer you can from what IS there, then name the one specific breakdown you are missing in a
  single line. Do not spend the answer explaining what you would do if you had more data, and do
  not offer the user a menu of analyses to choose from.
- Never present a company-wide figure as if it answered a question about one product, area, or
  period. Say plainly that it is company-wide.

Units and number formatting — these are absolute:
- KLIP stores quantity in Kg, but ALWAYS report quantities in MT (metric tonnes). 1 MT = 1,000 Kg.
  Convert every quantity yourself; never make the user do it, and never report Kg unless they
  explicitly ask for Kg. Do not add the Kg equivalent in brackets.
- NEVER write decimals. Round every number to a whole number — quantities, amounts, money,
  percentages, day counts, averages. "428,769 MT", not "428,769.34 MT". "63%", not "63.3%".

Area names mean Group Plant:
- When the user names an area or site (for example "Bontang"), they mean the Group Plant field
  from the Master Plant List — the same dimension Contracts, Shipments, Trucking, Contract
  Performance, Shipping Performance and Oil Loss filter on. It is supplied to you as
  "group_plant_dimension" in the application data.
- If a per-area figure you need is not in the supplied data, say which Group Plant you need it
  broken down by. Do not claim KLIP has no location dimension, and never answer an area question
  with company-wide totals presented as if they were that area's.

Response format — this is mandatory and overrides any styling instinct:
Return one strict, raw JSON object and nothing else. No markdown fences, no prose before or after.
{
  "answer":     "string",
  "report":     "string",
  "insights":   "string",
  "comparison": "string"
}
All persona behaviour lives INSIDE those strings as plain text with real line breaks:
- "answer": the numbered step-by-step reasoning, the evidence behind it, any assumptions, and the
  interactive next step or question.
- "insights": your self-criticism and double-check, what can go wrong, risks and exceptions to
  watch, recommendations (each with rationale, how to do it in KLIP, trade-offs, success KPIs),
  and the next checks or queries that would confirm the answer.
- "report": the operational report or table-style summary when one was asked for, else "".
- "comparison": uploaded-data vs KLIP-data differences when a file or image was attached, else "".

Accuracy rules that outrank the persona:
- Never invent an exact value. If a number is not in the supplied context, write "unknown" and say
  which data would settle it. A 15-year practitioner would rather hear "unknown" than a guess.
- Deterministic facts supplied as "direct_fact" are authoritative. Never contradict them; if your
  own reasoning disagrees, say so and flag it for checking rather than overwriting the fact.`

/**
 * Schema for the payload the /ask endpoint returns to the frontend.
 *
 * This is enforced server-side via output_config.format rather than trusted to the
 * model's own JSON formatting. Hand-written JSON broke in practice: the step-by-step
 * answers contain long multi-line prose, and a single unescaped newline inside a
 * string made JSON.parse fail, which silently collapsed report/insights into one
 * raw-text blob. Structured outputs remove that failure mode entirely.
 */
export const KLIP_AGENT_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    answer: {
      type: 'string' as const,
      description:
        'Direct answer, then numbered step-by-step reasoning, evidence, assumptions, and the interactive next step.',
    },
    report: {
      type: 'string' as const,
      description: 'Operational report or table-style summary when one was asked for, else an empty string.',
    },
    insights: {
      type: 'string' as const,
      description:
        'Self double-check, what can go wrong, risks and exceptions, recommendations, and next checks.',
    },
    comparison: {
      type: 'string' as const,
      description: 'Uploaded-data vs KLIP-data differences when a file or image was attached, else an empty string.',
    },
  },
  required: ['answer', 'report', 'insights', 'comparison'],
  additionalProperties: false,
}

const DEFAULT_MAX_TOKENS = 16_000
const DEFAULT_TIMEOUT_MS = 180_000
const DEFAULT_EFFORT = 'medium'
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/** Image media types the Messages API accepts. */
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

/** Cap a single attached image so one oversized upload cannot blow the request limit. */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024

export type KlipAgentImage = {
  mediaType: string
  base64: string
}

export type KlipAgentAskRequest = {
  userPrompt: string
  images?: KlipAgentImage[]
  maxTokens?: number
  timeoutMs?: number
  /**
   * Appended to the system prompt — used for lessons learned from previous conversations
   * (see agentAiMemory.service.ts). Kept out of the user prompt so it carries operator
   * authority rather than reading as something the user just typed.
   */
  extraSystemInstructions?: string
  /**
   * JSON schema to enforce on the reply. Defaults to the chat payload schema. Pass a different
   * schema for internal calls that need another shape (e.g. distilling a lesson) — leaving the
   * default in place would silently coerce the reply into the chat shape and drop the fields the
   * caller actually asked for.
   */
  outputSchema?: Record<string, unknown> | null
  /** Omit the persona/JSON-envelope prompt — for internal, non-chat calls. */
  systemPromptOverride?: string
}

export type KlipAgentAskResult = {
  text: string
  model: string
  stopReason: string | null
  refused: boolean
  inputTokens: number
  outputTokens: number
}

let cachedClient: Anthropic | null = null

export function isAnthropicConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export function isSupportedAgentImageMediaType(mediaType: string): boolean {
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(String(mediaType || '').toLowerCase())
}

export function resolveAgentEffort(): 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  const raw = process.env.ANTHROPIC_AGENT_EFFORT?.trim().toLowerCase()
  if (raw && VALID_EFFORTS.has(raw)) {
    return raw as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  }
  return DEFAULT_EFFORT
}

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server')
  }
  if (!cachedClient) {
    // timeout is milliseconds in the TypeScript SDK; maxRetries covers 429/5xx.
    cachedClient = new Anthropic({ apiKey, timeout: DEFAULT_TIMEOUT_MS, maxRetries: 2 })
  }
  return cachedClient
}

/** Reset the memoized client — used by tests and after an env change. */
export function resetKlipAgentClient(): void {
  cachedClient = null
}

/**
 * Ask Claude for the chat agent's JSON payload.
 *
 * Streams the response so a long step-by-step answer cannot trip an HTTP timeout,
 * then returns the fully accumulated text for the caller to parse.
 */
export async function askKlipAgentClaude(
  request: KlipAgentAskRequest,
): Promise<KlipAgentAskResult> {
  const client = getClient()
  const model = resolveAnthropicAgentModel()

  const content: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: request.userPrompt },
  ]
  for (const image of request.images ?? []) {
    if (!isSupportedAgentImageMediaType(image.mediaType)) continue
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType.toLowerCase() as
          | 'image/jpeg'
          | 'image/png'
          | 'image/gif'
          | 'image/webp',
        data: image.base64,
      },
    })
  }

  const stream = client.messages.stream(
    {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: `${request.systemPromptOverride ?? KLIP_AGENT_SYSTEM_PROMPT}${request.extraSystemInstructions ?? ''}`,
      // Adaptive thinking is the default on Claude Opus 5; stated explicitly so the
      // behaviour is obvious and stays correct if the model is overridden downward.
      thinking: { type: 'adaptive' },
      output_config: {
        effort: resolveAgentEffort(),
        ...(request.outputSchema === null
          ? {}
          : {
              format: {
                type: 'json_schema' as const,
                schema: request.outputSchema ?? KLIP_AGENT_OUTPUT_SCHEMA,
              },
            }),
      },
      messages: [{ role: 'user', content }],
    },
    request.timeoutMs ? { timeout: request.timeoutMs } : undefined,
  )

  const message = await stream.finalMessage()

  // A refusal is an HTTP 200 with empty/partial content — check before reading blocks.
  const refused = message.stop_reason === 'refusal'

  // Skip thinking blocks: with display "omitted" (the default) their text is empty.
  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  if (message.stop_reason === 'max_tokens') {
    logger.warn('KLIP Agent AI response hit max_tokens; answer may be truncated', {
      model,
      outputTokens: message.usage.output_tokens,
    })
  }

  return {
    text,
    model,
    stopReason: message.stop_reason ?? null,
    refused,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  }
}

/** Map SDK errors onto a message that is safe to log and useful to operators. */
export function describeAnthropicError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'Anthropic rejected the API key (check ANTHROPIC_API_KEY)'
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'Anthropic API key lacks permission for the requested model'
  }
  if (error instanceof Anthropic.NotFoundError) {
    return 'Anthropic model not found (check ANTHROPIC_AGENT_MODEL)'
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'Anthropic rate limit reached; retry shortly'
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return 'Anthropic request timed out'
  }
  // APIConnectionError extends APIError in the TS SDK, so check it first.
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Could not reach the Anthropic API'
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error (${error.status ?? 'unknown status'})`
  }
  return error instanceof Error ? error.message : 'Unknown Anthropic error'
}
