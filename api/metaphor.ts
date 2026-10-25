// Vercel function /api/metaphor (GET: is the key set; POST: Claude reads a metaphor and names objects of the library).
// The key (ANTHROPIC_API_KEY) lives only here, on the server. Without it, or on any error, the
// answer is not 200 and the page picks objects locally (src/lib/metaphor.ts).
import Anthropic from '@anthropic-ai/sdk'
import manifest from '../public/library/manifest.json' with { type: 'json' }

/** A library object as the model sees it. */
export interface MeaningObject {
  id: string
  name: string
  synonyms: string[]
  tags: string[]
}

/** The longest phrase the function reads. */
const MAX_TEXT = 200
const MODEL = 'claude-opus-5-5'

const SYSTEM = `Ты подбираешь предметы для изометрической иллюстрации к заголовку статьи или метафоре.
Предметы можно брать только из списка ниже, по id. Выбери от 2 до 4 предметов, которые лучше всего
передают смысл, самый важный первым. Для каждого — причина: 1–3 слова по-русски, строчными, какое
значение заголовка он показывает (например «финансы», «грамотность», «удалённая работа»).`

/** JSON schema of the answer: ids only from the library, 1–4 of them. */
export function answerSchema(ids: string[]) {
  return {
    type: 'object',
    properties: {
      objects: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string', enum: ids }, reason: { type: 'string' } },
          required: ['id', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['objects'],
    additionalProperties: false,
  }
}

/** One request to Claude; returns the parsed JSON answer (the page validates it again). */
export async function askClaude(client: Anthropic, text: string, objects: MeaningObject[]): Promise<unknown> {
  const list = objects.map((o) => `${o.id}: ${o.name}; ${[...o.synonyms, ...o.tags].join(', ')}`).join('\n')
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: `${SYSTEM}\n\nПредметы:\n${list}`,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: answerSchema(objects.map((o) => o.id)) } },
    messages: [{ role: 'user', content: text }],
  })
  if (response.stop_reason !== 'end_turn') throw new Error(`stop_reason ${response.stop_reason}`)
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text in the answer')
  return JSON.parse(block.text)
}

const json = (status: number, body: unknown) => Response.json(body, { status })

/** The handler, with the key and the client passed in for tests. */
export async function handle(request: Request, key = process.env.ANTHROPIC_API_KEY, client?: Anthropic): Promise<Response> {
  // The page asks once on load whether Claude is on, so that without a key it never waits for one.
  if (request.method === 'GET') return json(200, { enabled: Boolean(key) })
  if (request.method !== 'POST') return json(405, { error: 'GET or POST only' })
  if (!key) return json(503, { error: 'ANTHROPIC_API_KEY is not set' })
  let text: unknown
  try {
    text = ((await request.json()) as { text?: unknown }).text
  } catch {
    return json(400, { error: 'bad JSON' })
  }
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return json(400, { error: `text: 1–${MAX_TEXT} characters` })
  try {
    return json(200, await askClaude(client ?? new Anthropic({ apiKey: key, timeout: 7000, maxRetries: 0 }), text.trim(), manifest as MeaningObject[]))
  } catch (err) {
    // Details stay in the server log; the page falls back to the local pick.
    console.error('metaphor:', err instanceof Error ? err.message : err)
    return json(502, { error: 'model call failed' })
  }
}

export function GET(request: Request) {
  return handle(request)
}

export function POST(request: Request) {
  return handle(request)
}
