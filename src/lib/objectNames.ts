/** What the name parser needs from a library object: its id, Russian name and synonyms. */
export interface NamedObject {
  id: string
  name: string
  synonyms: string[]
}

/** "  Наушники  " → "наушники", ё → е: case, spaces and ё do not matter. */
export const normalizeName = (text: string) => text.toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim()

/** Edit distance (insert, delete, replace, swap of neighbours), capped: anything above `max` is `max + 1`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const rows = [...Array(a.length + 1)].map((_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) rows[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let d = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, rows[i - 2][j - 2] + 1)
      rows[i][j] = d
    }
  }
  return Math.min(rows[a.length][b.length], max + 1)
}

/** Typos allowed for a word of this length: none in short words, where they would match anything. */
const allowedTypos = (length: number) => (length <= 3 ? 0 : length <= 6 ? 1 : 2)

export interface NameMatch {
  /** The text as typed. */
  text: string
  /** The object it names, or null. */
  objectId: string | null
  /** For an unknown name: the closest object, as a hint. */
  suggestion?: string
}

/**
 * The object a name refers to: the name or a synonym exactly, then one with another ending
 * («ручкой», «наушниками»), else the closest one within a few typos («нашуники», «лмапа»). On a
 * tie the earlier object of the library wins (`деньги` → the coin, before the wallet).
 */
export function matchName(text: string, objects: NamedObject[]): NameMatch {
  const word = normalizeName(text)
  let best: { id: string; distance: number } | null = null
  for (const object of objects) {
    for (const name of [object.name, ...object.synonyms].map(normalizeName)) {
      // A word ending: «ручкой», «наушниками» start with the stem of the name.
      const stem = name.length > 4 ? name.slice(0, -1) : name
      const distance = word === name ? 0 : word.startsWith(stem) && word.length - stem.length <= 3 ? 0.5 : editDistance(word, name)
      if (!best || distance < best.distance) best = { id: object.id, distance }
    }
  }
  if (best && best.distance <= allowedTypos(word.length)) return { text, objectId: best.id }
  return { text, objectId: null, ...(best && best.distance <= 3 ? { suggestion: best.id } : {}) }
}

/** "наушники, лампа и книга" → one match per name, in order; repeats of an object are dropped. */
export function parseNames(input: string, objects: NamedObject[]): NameMatch[] {
  const seen = new Set<string>()
  return input
    .split(/[,;\n]+|\s+и\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => matchName(part, objects))
    .filter((m) => {
      if (!m.objectId) return true
      if (seen.has(m.objectId)) return false
      seen.add(m.objectId)
      return true
    })
}
