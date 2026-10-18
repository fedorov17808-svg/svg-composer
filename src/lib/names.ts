/** "Гофер · 12": what the source is about and its number; a repeat gets "· 12 (2)". */
export function defaultName(sourceId: string, title: string | undefined, taken: string[]) {
  const subject = !title || /гофер/i.test(title) ? 'Гофер' : (title.match(/[А-ЯЁа-яё-]+/)?.[0] ?? 'Элемент')
  return uniqueName(`${subject} · ${sourceId.slice(1)}`, taken)
}

/** `base`, or "base (2)", "base (3)"… if taken. */
export function uniqueName(base: string, taken: string[]) {
  let name = base
  for (let n = 2; taken.includes(name); n++) name = `${base} (${n})`
  return name
}
