import { query } from '../database/connection'
import logger from '../utils/logger'
import { askKlipAgentClaude, isAnthropicConfigured } from './klipAgentAi.service'

/**
 * Memory for the KLIP Agent AI, split into two kinds on purpose:
 *
 *  - Episodic (agent_ai_memory): what was asked and answered, numbers included. Useful for
 *    recognising a repeat question and for continuity, but its figures decay the moment SAP posts
 *    a GR or a formula is corrected. Never replayed as fact.
 *  - Durable lessons (agent_ai_lessons): short, number-free guidance about HOW to answer — units,
 *    what a term means here, and corrections the user already made. Safe to replay forever, and
 *    the part that actually makes the agent improve.
 *
 * Anything that would put a figure into a lesson is a bug, not a feature.
 */

export type LessonKind = 'preference' | 'definition' | 'correction'

export type AgentLesson = {
  id: string
  kind: LessonKind
  lesson: string
  /** Attribution only — who taught it. Lessons apply team-wide regardless. */
  learnedFromUserId: string | null
}

const MAX_LESSONS = 25
/** Lessons are replayed verbatim into the prompt, so keep them short and bounded. */
const MAX_LESSON_CHARS = 300

/**
 * Load every active lesson, newest first.
 *
 * Team-wide by design: a lesson is an operating standard for the whole logistics and commercial
 * team, so one person teaching the agent something benefits everyone rather than each colleague
 * having to re-teach it. Retire a bad lesson with is_active = false.
 */
export async function loadLessons(): Promise<AgentLesson[]> {
  const res = await query(
    `
    SELECT id, kind, lesson, learned_from_user_id
    FROM agent_ai_lessons
    WHERE is_active = true
    ORDER BY updated_at DESC
    LIMIT ${MAX_LESSONS}
    `,
  )
  return (res.rows || []).map((r: any) => ({
    id: String(r.id),
    kind: r.kind as LessonKind,
    lesson: String(r.lesson),
    learnedFromUserId: r.learned_from_user_id ? String(r.learned_from_user_id) : null,
  }))
}

/**
 * Insert or refresh a lesson. Uniqueness is team-wide on (kind, text), so a second person
 * teaching the same thing touches the existing row instead of creating a near-duplicate.
 * `userId` records who taught it; it does not limit who it applies to.
 */
export async function recordLesson(args: {
  userId?: string | null
  kind: LessonKind
  lesson: string
  sourceMemoryId?: string | null
}): Promise<string | null> {
  const lesson = String(args.lesson || '').trim().replace(/\s+/g, ' ')
  if (!lesson) return null
  if (lesson.length > MAX_LESSON_CHARS) {
    logger.warn('Rejecting over-long agent lesson', { length: lesson.length })
    return null
  }

  const res = await query(
    `
    INSERT INTO agent_ai_lessons (learned_from_user_id, kind, lesson, source_memory_id)
    VALUES ($1::uuid, $2, $3, $4::uuid)
    ON CONFLICT (kind, lower(btrim(lesson)))
    DO UPDATE SET is_active = true, updated_at = CURRENT_TIMESTAMP
    RETURNING id
    `,
    [args.userId || null, args.kind, lesson, args.sourceMemoryId || null],
  )
  return res.rows?.[0]?.id || null
}

/** Count a lesson as used, so lessons that never fire can be found and retired. */
export async function markLessonsApplied(lessonIds: string[]): Promise<void> {
  if (lessonIds.length === 0) return
  try {
    await query(
      `
      UPDATE agent_ai_lessons
      SET times_applied = times_applied + 1, last_applied_at = CURRENT_TIMESTAMP
      WHERE id = ANY($1::uuid[])
      `,
      [lessonIds],
    )
  } catch (err) {
    // Usage stats are not worth failing an answer over.
    logger.warn('Failed to mark agent lessons applied', err)
  }
}

/**
 * Preferences the user states in passing, captured without an LLM call so they stick immediately.
 *
 * Deliberately narrow: only patterns whose intent is unambiguous. A wrong guess here is worse
 * than no lesson, because it silently reshapes every later answer.
 */
export function detectStatedPreferences(question: string): Array<{ kind: LessonKind; lesson: string }> {
  const q = String(question || '')
  const out: Array<{ kind: LessonKind; lesson: string }> = []

  // No unit preference is captured here on purpose. MT is a standing rule enforced in code
  // (resolveQtyUnit), not a lesson: lessons are team-wide, so one person saying "kg instead of mt"
  // would otherwise switch the whole team off MT. An explicit Kg request is honoured for that
  // single answer instead.

  if (/\b(be brief|keep it short|too long|shorter|concise|straight to the point|straightforward)\b/i.test(q)) {
    out.push({
      kind: 'preference',
      lesson: 'Keep answers short and lead with the direct answer. This user considers long answers a problem, not thoroughness.',
    })
  }

  return out
}

/** Render lessons as an instruction block appended to the system prompt. */
export function renderLessonsForPrompt(lessons: AgentLesson[]): string {
  if (lessons.length === 0) return ''
  const group = (kind: LessonKind, heading: string) => {
    const items = lessons.filter((l) => l.kind === kind)
    return items.length > 0 ? `${heading}\n${items.map((l) => `- ${l.lesson}`).join('\n')}` : ''
  }
  const blocks = [
    group('correction', 'Corrections already made by users — do not repeat these mistakes:'),
    group('preference', 'How this user wants answers shaped:'),
    group('definition', 'What these terms mean in KLIP:'),
  ].filter(Boolean)

  return `\n\nLearned from previous conversations in KLIP. Treat these as standing instructions.\nThey describe HOW to answer; they never contain figures, so they cannot go stale:\n\n${blocks.join('\n\n')}`
}

/** Shape of the distillation reply — deliberately not the chat payload shape. */
const LESSON_OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    kind: { type: 'string' as const, enum: ['preference', 'correction'] },
    lesson: {
      type: 'string' as const,
      description: 'One reusable imperative instruction with no figures. Empty string if the feedback is too vague.',
    },
  },
  required: ['kind', 'lesson'],
  additionalProperties: false,
}

/**
 * Turn a thumbs-down (or written feedback) into one reusable lesson.
 *
 * Fire-and-forget: feedback must be saved whether or not this succeeds, and it must never make
 * the user wait. Numbers are explicitly banned from the output because a lesson outlives them.
 */
export async function distillLessonFromFeedback(args: {
  userId?: string | null
  memoryId: string
  question: string
  answer: string
  feedback: string
  rating: number | null
}): Promise<void> {
  if (!isAnthropicConfigured()) return
  const negative = args.rating != null && args.rating <= 2
  if (!negative && !args.feedback.trim()) return

  const prompt = `A user gave feedback on a KLIP logistics AI answer. Write ONE reusable instruction that would prevent the problem next time.

Question asked:
${args.question.slice(0, 1500)}

Answer given (truncated):
${args.answer.slice(0, 3000)}

User rating: ${args.rating ?? 'none'} out of 5
User feedback: ${args.feedback.trim() || '(none given, but the answer was rated poor)'}

Rules for the instruction you write:
- One imperative sentence, under 250 characters, addressed to the assistant.
- It must be reusable across future questions, not about this specific answer.
- It must contain NO figures, quantities, dates, product names or place names, because it will be
  replayed for months after the underlying data has changed.
- If the feedback is too vague to draw a durable lesson from, return an empty "lesson".

Return JSON only: {"kind": "preference" | "correction", "lesson": "string"}`

  try {
    const res = await askKlipAgentClaude({
      userPrompt: prompt,
      maxTokens: 2000,
      // This call is not a chat answer: it needs its own schema and no persona, otherwise the
      // reply is coerced into the chat envelope and the lesson is silently lost.
      systemPromptOverride:
        'You distil one reusable instruction from user feedback on an AI answer. Reply with JSON only.',
      outputSchema: LESSON_OUTPUT_SCHEMA,
    })
    const match = res.text.match(/\{[\s\S]*\}/)
    if (!match) {
      logger.warn('Lesson distillation returned no JSON object', { text: res.text.slice(0, 200) })
      return
    }
    const parsed = JSON.parse(match[0]) as { kind?: string; lesson?: string }
    const lesson = String(parsed.lesson || '').trim()
    if (!lesson) {
      logger.info('Feedback too vague to draw a durable lesson from', { memoryId: args.memoryId })
      return
    }
    if (/\d/.test(lesson)) {
      // A figure slipped in — the whole point is that lessons outlive the data.
      logger.warn('Discarding distilled lesson containing digits', { lesson })
      return
    }
    const kind: LessonKind = parsed.kind === 'preference' ? 'preference' : 'correction'
    await recordLesson({ userId: args.userId, kind, lesson, sourceMemoryId: args.memoryId })
    logger.info('Learned lesson from Agent AI feedback', { kind, lesson })
  } catch (err) {
    logger.warn('Failed to distil lesson from Agent AI feedback', err)
  }
}
