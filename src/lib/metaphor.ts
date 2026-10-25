import { MAX_MAIN } from './autoLayout'
import { normalizeName } from './objectNames'

/** What the matcher needs from a library object: names, synonyms and tags of meaning. */
export interface MeaningObject {
  id: string
  name: string
  synonyms: string[]
  tags: string[]
}

/** Why an object was picked: the word of the phrase and what it matched («монета — финансы»). */
export interface Reason {
  objectId: string
  /** Short, for a chip: «финансы», «финансовая грамотность». */
  text: string
}

export interface Pick {
  objectIds: string[]
  reasons: Reason[]
  /** Who picked: the local matcher or Claude (through /api/metaphor). */
  source: 'local' | 'ai'
}

/** At most this many objects for a phrase: up to MAX_MAIN main ones and one in the background. */
export const MAX_PICK = MAX_MAIN + 1

/** Endings of Russian nouns and adjectives, longest first; what is left is compared as a stem. */
const ENDINGS = [
  'иями', 'ями', 'ами', 'ией', 'иях', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ость', 'ости', 'остью',
  'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ой', 'ей', 'ий', 'ый', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ов', 'ев',
  'ия', 'ию', 'ии', 'ья', 'ье', 'ью', 'а', 'я', 'о', 'е', 'ы', 'и', 'у', 'ю', 'ь', 'й',
].sort((a, b) => b.length - a.length)

/** «Финансовая» → «финансов», «учёбы» → «учеб»: a simple stem, never shorter than 3 letters. */
export function stem(word: string): string {
  const w = normalizeName(word)
  for (const ending of ENDINGS) {
    if (w.endsWith(ending) && w.length - ending.length >= 3) return w.slice(0, -ending.length)
  }
  return w
}

/** Words of a phrase, as stems; prepositions and other short words are dropped. */
export const stems = (text: string) =>
  normalizeName(text)
    .split(/[^a-zа-я0-9]+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stem)

const STOP_WORDS = new Set(['без', 'для', 'как', 'или', 'под', 'над', 'при', 'про', 'что', 'это', 'наш', 'ваш', 'мой', 'свой', 'все', 'всё'])

/** Two stems are the same word if equal, or one starts the other and is at least 5 letters («финанс» / «финансов»). */
const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)))

/** All words of `phrase` (as stems) occur in the text stems. */
const contains = (text: string[], phrase: string[]) => phrase.length > 0 && phrase.every((p) => text.some((t) => sameWord(t, p)))

/**
 * Common metaphors and the objects that show them; checked before single words. A phrase matches
 * when all its words occur in the text in any form («финансовой грамотности», «грамотность в финансах»).
 */
export const METAPHORS: { phrase: string; objects: string[] }[] = [
  { phrase: 'финансовая грамотность', objects: ['coin', 'book', 'wallet'] },
  { phrase: 'удалённая работа', objects: ['phone', 'headphones', 'folder'] },
  { phrase: 'работа из дома', objects: ['phone', 'headphones', 'lamp'] },
  { phrase: 'без стресса', objects: ['headphones', 'flowers'] },
  { phrase: 'командная работа', objects: ['puzzle', 'folder', 'phone'] },
  { phrase: 'команда', objects: ['puzzle', 'phone'] },
  { phrase: 'идея', objects: ['lamp', 'pen', 'puzzle'] },
  { phrase: 'стартап', objects: ['lamp', 'puzzle', 'coin'] },
  { phrase: 'экзамен', objects: ['book', 'lamp', 'pen'] },
  { phrase: 'учёба', objects: ['book', 'lamp', 'pen'] },
  { phrase: 'обучение', objects: ['book', 'headphones', 'lamp'] },
  { phrase: 'онлайн-курс', objects: ['phone', 'headphones', 'book'] },
  { phrase: 'онлайн покупки', objects: ['phone', 'wallet', 'coin'] },
  { phrase: 'кешбэк', objects: ['wallet', 'coin', 'phone'] },
  { phrase: 'инвестиции', objects: ['coin', 'folder', 'phone'] },
  { phrase: 'накопления', objects: ['coin', 'wallet'] },
  { phrase: 'договор', objects: ['pen', 'folder'] },
  { phrase: 'сделка', objects: ['pen', 'folder', 'coin'] },
  { phrase: 'бухгалтерия', objects: ['folder', 'coin', 'pen'] },
  { phrase: 'тайм-менеджмент', objects: ['folder', 'pen', 'phone'] },
  { phrase: 'праздник', objects: ['flowers', 'wallet'] },
  { phrase: 'подарок', objects: ['flowers', 'wallet'] },
  { phrase: 'весна', objects: ['flowers', 'headphones'] },
  { phrase: 'уютный дом', objects: ['flowers', 'lamp', 'book'] },
  { phrase: 'подкаст', objects: ['headphones', 'phone'] },
  { phrase: 'музыка', objects: ['headphones', 'phone'] },
  { phrase: 'стратегия', objects: ['puzzle', 'folder', 'lamp'] },
  { phrase: 'безопасность', objects: ['coin', 'phone'] },
  { phrase: 'порядок', objects: ['folder', 'pen'] },
  { phrase: 'весеннее настроение', objects: ['flowers', 'headphones'] },
]

/** The object that most often comes with `id` in the table of metaphors: a pair for a lone match. */
function companion(id: string, taken: string[]): string | null {
  const counts = new Map<string, number>()
  for (const m of METAPHORS) {
    if (!m.objects.includes(id)) continue
    for (const other of m.objects) if (!taken.includes(other)) counts.set(other, (counts.get(other) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Weights: a phrase of the table, a name or synonym of the object, a tag of meaning. */
const WEIGHT = { metaphor: 3, name: 1.5, tag: 1 }

/**
 * Objects for a metaphor or a headline, without any service: the table of metaphors first, then
 * names, synonyms and tags matched word by word in any form. 2–4 objects by relevance, each with
 * the word that brought it; one match gets a companion of the same table phrase or the next best.
 * Empty when nothing in the text means anything to the library.
 */
export function pickLocal(text: string, objects: MeaningObject[]): Pick {
  const words = stems(text)
  const score = new Map<string, number>()
  // A word of the object itself explains it better than a table phrase: «монета — финансы», «книга — грамотность».
  const ownReasons = new Map<string, string>()
  const tableReasons = new Map<string, string>()
  const add = (id: string, weight: number, reason: string, reasons: Map<string, string>) => {
    score.set(id, (score.get(id) ?? 0) + weight)
    if (!reasons.has(id)) reasons.set(id, reason)
  }
  const known = new Set(objects.map((o) => o.id))
  for (const m of METAPHORS) {
    // A one-word phrase of the table counts like a tag; longer ones say more.
    if (!contains(words, stems(m.phrase))) continue
    m.objects.forEach((id, i) => known.has(id) && add(id, WEIGHT.metaphor - i * 0.4, m.phrase, tableReasons))
  }
  for (const object of objects) {
    // A word that is both a synonym and a tag («финансы» of the wallet) counts once.
    const labels = new Map<string, number>()
    for (const label of object.tags) labels.set(label.toLowerCase(), WEIGHT.tag)
    for (const label of [object.name, ...object.synonyms]) labels.set(label.toLowerCase(), WEIGHT.name)
    for (const [label, weight] of labels) if (contains(words, stems(label))) add(object.id, weight, label, ownReasons)
  }
  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1] || objects.findIndex((o) => o.id === a[0]) - objects.findIndex((o) => o.id === b[0]))
    .map(([id]) => id)
  // Weak extras (a single tag among strong table matches) are left out once there are enough.
  const top = score.get(ranked[0]) ?? 0
  const picked = ranked.filter((id, i) => i < 2 || score.get(id)! >= top * 0.3).slice(0, MAX_PICK)
  const reasons = picked.map((id) => ({ objectId: id, text: ownReasons.get(id) ?? tableReasons.get(id)! }))
  const pair = picked.length === 1 ? companion(picked[0], picked) : null
  if (pair) {
    const name = objects.find((o) => o.id === picked[0])!.name.toLowerCase()
    picked.push(pair)
    reasons.push({ objectId: pair, text: `в пару: ${name}` })
  }
  return { objectIds: picked, reasons, source: 'local' }
}

/**
 * Validates what the server (Claude) returned: only ids of the library, no repeats, 1–4 of them, a
 * short reason each. Anything else is null, and the local pick is used instead.
 */
export function parseAiPick(value: unknown, ids: string[]): Pick | null {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { objects?: unknown }).objects)) return null
  const items = (value as { objects: unknown[] }).objects
  const seen = new Set<string>()
  const reasons: Reason[] = []
  for (const item of items) {
    if (typeof item !== 'object' || item === null) return null
    const { id, reason } = item as { id?: unknown; reason?: unknown }
    if (typeof id !== 'string' || !ids.includes(id) || seen.has(id)) return null
    if (typeof reason !== 'string' || reason.trim().length === 0) return null
    seen.add(id)
    reasons.push({ objectId: id, text: reason.trim().slice(0, 40) })
  }
  if (reasons.length === 0 || reasons.length > MAX_PICK) return null
  return { objectIds: reasons.map((r) => r.objectId), reasons, source: 'ai' }
}

/** How long the page waits for /api/metaphor before it picks locally. */
const AI_TIMEOUT = 8000

/**
 * Claude through the server function when it is there and has a key; the local pick otherwise
 * (no server, no key, an error, a timeout or an answer that does not validate). Never throws.
 */
export async function pickObjects(text: string, objects: MeaningObject[], endpoint = '/api/metaphor'): Promise<Pick> {
  const local = () => pickLocal(text, objects)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(AI_TIMEOUT),
    })
    if (!res.ok) return local()
    return parseAiPick(await res.json(), objects.map((o) => o.id)) ?? local()
  } catch {
    return local()
  }
}
