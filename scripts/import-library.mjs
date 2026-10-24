// Splits the Figma exports figma-library/Размер {L,S}.svg into objects of the library:
//   public/library/{L|S}/{main|bg}/{object}.svg — one object, its paths in the original drawing order,
//     moved to the origin by one `<g transform>` (the paths themselves are copied as they are);
//   public/library/palettes.json — the color schemes read from the swatches at the top of the sheet;
//   public/library/manifest.json — objects with names, synonyms, files and sizes.
// The export has no groups and no ids: ~1500 flat paths, the captions turned into outlines, and the
// paths of different objects interleaved. Objects are found by geometry, in a real browser (bounds
// need layout): the two section captions («Главные объекты», «Фоновые объекты») split the sheet;
// inside a section, shapes whose boxes overlap by more than OVERLAP join one cluster, the 10 biggest
// clusters are the objects, and the remaining small clusters join the nearest object. A speck (both
// sides under SPECK) farther than SPECK_GAP from every object is not part of the drawing — it is left
// out and listed in the report (one under the coin in every version: 40 px away in L, 23.5 px in S). Objects are named by the grid order of the sheet (4 + 4 + 2).
// Checks (exit 1 on failure): 10 objects in rows of 4, 4, 2 in each section; the main and background
// versions of an object are the same size; the box of each file fits its painted pixels; objects use
// only the colors of the scheme they are drawn in. For review in scripts/out/library/: each file
// rendered alone ({size}-{state}-{object}.png), the contact sheet (sheet.png), report.json.
// Usage: npm run import-library
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const SIZES = ['L', 'S']
const STATES = ['main', 'bg']
const OUT = 'public/library'
const REVIEW = 'scripts/out/library'
/** Boxes have to overlap by more than this on both axes to join (the book and lamp shadows overlap by 16×5). */
const OVERLAP = 10
/** A cluster at most this far from an object belongs to it. */
const ATTACH = 30
/** Clusters smaller than this on both sides are specks. */
const SPECK = 3
/** A speck this far from every object is left out. */
const SPECK_GAP = 10
/** Main and background versions may differ in size by this much. */
const MAX_STATE_DIFF = 0.03
/** A file box may be at most this much (in px of the render) wider or taller than what is painted. */
const MAX_SLACK_PX = 3

/** In the order of the sheet: left to right, top to bottom. */
const OBJECTS = [
  { id: 'book', name: 'Книга', synonyms: ['книжка', 'чтение', 'учёба', 'знания', 'дневник', 'блокнот', 'учебник'] },
  { id: 'phone', name: 'Телефон', synonyms: ['смартфон', 'мобильный', 'приложение', 'связь', 'звонок', 'мобильник', 'гаджет'] },
  { id: 'puzzle', name: 'Пазл', synonyms: ['головоломка', 'решение', 'задача', 'интеграция', 'совместимость'] },
  { id: 'coin', name: 'Монета', synonyms: ['деньги', 'оплата', 'платёж', 'безопасность', 'сбережения', 'монетка', 'монеты'] },
  { id: 'headphones', name: 'Наушники', synonyms: ['музыка', 'подкаст', 'звук', 'поддержка', 'аудио', 'гарнитура', 'наушник'] },
  { id: 'lamp', name: 'Лампа', synonyms: ['настольная лампа', 'идея', 'свет', 'рабочее место', 'лампочка', 'светильник'] },
  { id: 'flowers', name: 'Цветы в вазе', synonyms: ['цветы', 'тюльпаны', 'ваза', 'букет', 'праздник', 'подарок', 'вазочка', 'тюльпан'] },
  { id: 'wallet', name: 'Кошелёк', synonyms: ['бумажник', 'деньги', 'финансы', 'покупки', 'бюджет', 'портмоне', 'кошель'] },
  { id: 'folder', name: 'Папка', synonyms: ['документы', 'файлы', 'архив', 'бумаги', 'папочка', 'документ', 'файл'] },
  { id: 'pen', name: 'Ручка', synonyms: ['подпись', 'договор', 'письмо', 'заметки', 'авторучка', 'перо'] },
]
const ROWS = [4, 4, 2]
/** Left to right on the sheet. */
const PALETTES = [
  { id: 'lilac', name: 'Сиреневая' },
  { id: 'peach', name: 'Персиковая' },
  { id: 'mint', name: 'Мятная' },
]

const hex = (color) => (color === 'white' ? '#FFFFFF' : color === 'black' ? '#000000' : color?.toUpperCase())
const round = (v) => +v.toFixed(2)
const box = (members) => {
  const x = Math.min(...members.map((e) => e.x))
  const y = Math.min(...members.map((e) => e.y))
  return { x, y, w: Math.max(...members.map((e) => e.x + e.w)) - x, h: Math.max(...members.map((e) => e.y + e.h)) - y }
}
const overlap = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > OVERLAP && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > OVERLAP
const gap = (a, b) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h))

/** Every top-level element of the sheet: its markup and its box in sheet units, stroke included. */
async function readSheet(page, file) {
  await page.setContent(`<body style="margin:0">${readFileSync(file, 'utf8')}</body>`)
  return page.evaluate(() => {
    const svg = document.querySelector('svg')
    const vb = svg.viewBox.baseVal
    const elements = [...svg.children].filter((el) => el.localName !== 'defs').map((el, order) => {
      const b = el.getBBox()
      const m = el.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix()
      const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m))
      const half = el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none' ? +(el.getAttribute('stroke-width') ?? 1) / 2 : 0
      const x = Math.min(...corners.map((p) => p.x)) - half
      const y = Math.min(...corners.map((p) => p.y)) - half
      return {
        order,
        tag: el.localName,
        markup: el.outerHTML,
        fill: el.getAttribute('fill'),
        stroke: el.getAttribute('stroke'),
        x,
        y,
        w: Math.max(...corners.map((p) => p.x)) + half - x,
        h: Math.max(...corners.map((p) => p.y)) + half - y,
      }
    })
    return { width: vb.width, height: vb.height, elements }
  })
}

/** Background and object colors of each scheme, top to bottom, from the swatch columns. */
function readPalettes(swatches) {
  const columns = []
  for (const s of [...swatches].sort((a, b) => a.x - b.x)) {
    const column = columns.find((c) => Math.abs(c[0].x - s.x) < 1)
    if (column) column.push(s)
    else columns.push([s])
  }
  if (columns.length !== PALETTES.length * 2 || columns.some((c) => c.length !== 4)) {
    throw new Error(`образцы палитр: ожидалось ${PALETTES.length * 2} столбцов по 4, найдено ${columns.map((c) => c.length).join(', ')}`)
  }
  const colors = (column) => column.sort((a, b) => a.y - b.y).map((s) => hex(s.fill))
  return PALETTES.map((p, i) => ({ ...p, background: colors(columns[2 * i]), objects: colors(columns[2 * i + 1]) }))
}

/** The 10 objects of a section in the grid order, and the specks left out. */
function splitSection(elements, where) {
  const parent = elements.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) if (overlap(elements[i], elements[j])) parent[find(i)] = find(j)
  }
  const byRoot = new Map()
  elements.forEach((e, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), e]))
  const clusters = [...byRoot.values()].map((members) => ({ members, ...box(members) })).sort((a, b) => b.w * b.h - a.w * a.h)

  const objects = clusters.slice(0, OBJECTS.length)
  const smallest = objects.at(-1)
  const next = clusters[OBJECTS.length]
  if (!smallest || (next && next.w * next.h > 0.05 * smallest.w * smallest.h)) {
    throw new Error(`${where}: не выделяются ${OBJECTS.length} объектов (${clusters.length} кластеров, ${OBJECTS.length + 1}-й не мелкий)`)
  }
  const specks = []
  for (const c of clusters.slice(OBJECTS.length)) {
    const nearest = objects.reduce((best, o) => (gap(c, o) < gap(c, best) ? o : best))
    if (c.w < SPECK && c.h < SPECK && gap(c, nearest) > SPECK_GAP) specks.push(...c.members)
    else if (gap(c, nearest) <= ATTACH) nearest.members.push(...c.members)
    else throw new Error(`${where}: кусок ${round(c.w)}×${round(c.h)} в (${round(c.x)}, ${round(c.y)}) не прилегает ни к одному объекту`)
  }
  for (const o of objects) {
    o.members.sort((a, b) => a.order - b.order)
    Object.assign(o, box(o.members))
  }

  // Rows: objects whose vertical spans overlap by more than half the smaller one.
  const rows = []
  for (const o of [...objects].sort((a, b) => a.y - b.y)) {
    const row = rows.find((r) => r.some((p) => Math.min(o.y + o.h, p.y + p.h) - Math.max(o.y, p.y) > Math.min(o.h, p.h) / 2))
    if (row) row.push(o)
    else rows.push([o])
  }
  if (rows.map((r) => r.length).join() !== ROWS.join()) {
    throw new Error(`${where}: ожидались ряды ${ROWS.join('+')}, найдено ${rows.map((r) => r.length).join('+')}`)
  }
  return { objects: rows.flatMap((r) => r.sort((a, b) => a.x - b.x)), specks }
}

/** The object at the origin. No ids in the export; any that appear get the file prefix. */
function objectSvg(o, prefix) {
  const x = Math.floor(o.x * 100) / 100
  const y = Math.floor(o.y * 100) / 100
  const w = Math.ceil((o.x + o.w - x) * 100) / 100
  const h = Math.ceil((o.y + o.h - y) * 100) / 100
  let body = o.members.map((e) => e.markup).join('\n')
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])
  for (const id of ids) {
    body = body.replaceAll(`id="${id}"`, `id="${prefix}${id}"`).replaceAll(`url(#${id})`, `url(#${prefix}${id})`).replaceAll(`href="#${id}"`, `href="#${prefix}${id}"`)
  }
  // `fill="none"` comes from the root of the export: shapes without a fill must not turn black.
  const group = `<g fill="none" transform="translate(${-x} ${-y})">\n${body}\n</g>`
  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" fill="none">\n${group}\n</svg>\n`, width: w, height: h, ids: ids.length }
}

const colorsOf = (members) => new Set(members.flatMap((e) => [e.fill, e.stroke]).filter((c) => c && c !== 'none').map(hex))

const browser = await chromium.launch()
const report = { specks: [], failures: [], objects: [] }
try {
  const page = await browser.newPage()
  rmSync(OUT, { recursive: true, force: true })
  rmSync(REVIEW, { recursive: true, force: true })
  mkdirSync(REVIEW, { recursive: true })
  const files = {}
  const palettesBySize = {}

  for (const size of SIZES) {
    const sheet = await readSheet(page, `figma-library/Размер ${size}.svg`)
    // The page background and its border cover the whole sheet.
    const content = sheet.elements.filter((e) => e.w * e.h < 0.9 * sheet.width * sheet.height)
    const captions = content.filter((e) => e.fill === 'black' && e.h < 120 && e.w > 500).sort((a, b) => a.y - b.y)
    if (captions.length !== 2) throw new Error(`${size}: ожидались 2 подписи секций, найдено ${captions.length}`)
    const [mainCaption, bgCaption] = captions
    const top = content.filter((e) => e.y + e.h <= mainCaption.y)
    const swatches = top.filter((e) => e.h > 20 && e.w / e.h > 2.5 && e.w / e.h < 4)
    palettesBySize[size] = readPalettes(swatches)

    const sections = {
      main: content.filter((e) => e.y >= mainCaption.y + mainCaption.h && e.y + e.h <= bgCaption.y),
      bg: content.filter((e) => e.y >= bgCaption.y + bgCaption.h),
    }
    const used = top.length + captions.length + sections.main.length + sections.bg.length
    if (used !== content.length) throw new Error(`${size}: ${content.length - used} элементов вне секций`)

    for (const state of STATES) {
      const { objects, specks } = splitSection(sections[state], `${size}/${state}`)
      for (const s of specks) report.specks.push({ size, state, order: s.order, box: [s.x, s.y, s.w, s.h].map(round), fill: s.fill })
      objects.forEach((o, i) => {
        const id = OBJECTS[i].id
        const file = `${size}/${state}/${id}.svg`
        const out = objectSvg(o, `${size}-${state}-${id}_`)
        mkdirSync(`${OUT}/${size}/${state}`, { recursive: true })
        writeFileSync(`${OUT}/${file}`, out.svg)
        files[file] = { id, size, state, file, width: out.width, height: out.height, paths: o.members.length, colors: colorsOf(o.members), ids: out.ids, svg: out.svg }
      })
    }
  }

  // The schemes are the same on both sheets.
  if (JSON.stringify(palettesBySize.L) !== JSON.stringify(palettesBySize.S)) report.failures.push('палитры в L и S различаются')
  const palettes = palettesBySize.L
  writeFileSync(`${OUT}/palettes.json`, JSON.stringify(palettes, null, 2) + '\n')

  // Main and background of one object match in size; colors stay in one scheme.
  for (const size of SIZES) {
    for (const { id } of OBJECTS) {
      const [main, bg] = STATES.map((state) => files[`${size}/${state}/${id}.svg`])
      const diff = Math.max(Math.abs(main.width / bg.width - 1), Math.abs(main.height / bg.height - 1))
      if (diff > MAX_STATE_DIFF) report.failures.push(`${size}/${id}: главный ${main.width}×${main.height}, фоновый ${bg.width}×${bg.height}`)
    }
  }
  for (const f of Object.values(files)) {
    const scheme = palettes.find((p) => [...f.colors].every((c) => p.background.includes(c) || p.objects.includes(c)))
    f.scheme = scheme?.id ?? null
    if (!scheme) report.failures.push(`${f.file}: цвета не из одной схемы (${[...f.colors].join(' ')})`)
  }

  const manifest = OBJECTS.map((o) => ({
    ...o,
    versions: Object.fromEntries(
      SIZES.map((size) => [size, Object.fromEntries(STATES.map((state) => {
        const f = files[`${size}/${state}/${o.id}.svg`]
        return [state, { file: `library/${f.file}`, width: f.width, height: f.height }]
      }))]),
    ),
  }))
  writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n')

  // Review renders and the painted-pixel check, at 400 px by the longer side.
  const shots = []
  for (const f of Object.values(files)) {
    const scale = 400 / Math.max(f.width, f.height)
    await page.setViewportSize({ width: Math.ceil(f.width * scale), height: Math.ceil(f.height * scale) })
    await page.setContent(`<body style="margin:0">${f.svg.replace(/width="[^"]+" height="[^"]+"/, `width="${f.width * scale}" height="${f.height * scale}"`)}</body>`)
    const png = await page.locator('svg').screenshot({ path: `${REVIEW}/${f.size}-${f.state}-${f.id}.png`, omitBackground: true })
    const painted = await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, c.width, c.height)
      let [x0, y0, x1, y1] = [Infinity, Infinity, -1, -1]
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 8) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)]
      }
      return { width: c.width, height: c.height, left: x0, top: y0, right: c.width - 1 - x1, bottom: c.height - 1 - y1 }
    }, `data:image/png;base64,${png.toString('base64')}`)
    const slack = Math.max(painted.left, painted.top, painted.right, painted.bottom)
    if (slack > MAX_SLACK_PX) report.failures.push(`${f.file}: рамка больше нарисованного на ${slack}px (из ${painted.width}×${painted.height})`)
    report.objects.push({ file: f.file, size: [f.width, f.height], paths: f.paths, scheme: f.scheme, ids: f.ids, emptyEdgePx: slack })
    shots.push({ ...f, src: `data:image/png;base64,${png.toString('base64')}` })
  }

  const cell = (f) => `<figure><img src="${f.src}"><figcaption>${f.size} · ${f.state === 'main' ? 'главный' : 'фоновый'} · ${f.width}×${f.height} · ${f.paths} путей</figcaption></figure>`
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.setContent(
    `<style>body{margin:12px;font:13px sans-serif;background:#eee}h3{margin:14px 0 4px}div{display:grid;grid-template-columns:repeat(4,330px);gap:8px}
    figure{margin:0;background:#fff;outline:1px dashed #bbb}img{display:block;width:330px;height:240px;object-fit:contain;background:repeating-conic-gradient(#fafafa 0 25%,#fff 0 50%) 0 0/16px 16px}figcaption{padding:3px 6px}</style>` +
      OBJECTS.map((o) => `<h3>${o.name} (${o.id})</h3><div>${SIZES.flatMap((size) => STATES.map((state) => cell(shots.find((s) => s.size === size && s.state === state && s.id === o.id)))).join('')}</div>`).join(''),
  )
  await page.screenshot({ path: `${REVIEW}/sheet.png`, fullPage: true })

  writeFileSync(`${REVIEW}/report.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(`${OUT}: ${Object.keys(files).length} объектов, ${palettes.length} палитры`)
  for (const s of report.specks) console.log(`  отброшена точка ${s.size}/${s.state} №${s.order}: ${s.box.join(', ')} ${s.fill}`)
  for (const f of report.failures) console.log(`  ! ${f}`)
  console.log(`контактный лист: ${REVIEW}/sheet.png`)
  if (report.failures.length) process.exitCode = 1
} finally {
  await browser.close()
}
