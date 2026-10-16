// Normalizes raw-svg/*.svg with SVGO and writes public/sources/ + manifest.json.
// Groups and ids are kept (no collapseGroups/cleanupIds) so elements stay selectable;
// styles from <style>/class/style="" become presentation attributes; every id gets
// a per-file prefix (s01_, s02_, ...) with url(#...) and href references updated.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { optimize } from 'svgo'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rawDir = path.join(root, 'raw-svg')
const outDir = path.join(root, 'public', 'sources')

// Russian titles for the UI, keyed by raw file name (see CREDITS.md for origins).
const TITLES = {
  '01': 'Гоферы и растущий график',
  '02': 'HEY! Гоферы за ограждением',
  '03': 'Гофер у магазина',
  '04': 'Гофер и календарь',
  '05': 'Указатели Good code / Bugs & errors',
  '06': 'Гоферы, гонг и доска го',
  '07': 'Гофер со смартфоном и метками',
  '08': 'Розовый гофер и копилка',
  '09': 'Гофер в миске с лапшой',
  '10': 'Гофер-мудрец с посохом',
  '11': 'Гофер у пагоды',
  '12': 'Гофер с фонарём',
  '13': 'Гофер с пандой',
  '14': 'Гофер-рыбак и карп',
  '15': 'Гофер в VR-шлеме и лес',
  '16': 'Видеозвонок двух гоферов',
  '17': 'Гофер и бомба',
  '18': 'Йети и гофер',
  '19': 'Гофер-снеговик',
  '20': 'Гоферы у ёлки',
}

// Collects structure stats from the optimized tree (runs as the last plugin).
function statsPlugin(stats) {
  return {
    name: 'collectStats',
    fn: () => {
      let depth = 0
      return {
        element: {
          enter(node) {
            if (node.name === 'svg') stats.viewBox = node.attributes.viewBox
            if (node.name === 'image') stats.images++
            if (node.name === 'style') stats.styles++
            if (node.attributes.class) stats.classes++
            if (node.attributes.style) stats.styleAttrs++
            if (node.name === 'g') {
              stats.groups++
              depth++
              stats.maxDepth = Math.max(stats.maxDepth, depth)
            }
          },
          exit(node) {
            if (node.name === 'g') depth--
          },
        },
      }
    },
  }
}

// Drops Affinity Designer leftovers (serif:id attributes, xmlns:serif).
const removeSerifPlugin = {
  name: 'removeSerifAttrs',
  fn: () => ({
    element: {
      enter(node) {
        for (const name of Object.keys(node.attributes)) {
          if (name.startsWith('serif:') || name === 'xmlns:serif') delete node.attributes[name]
        }
      },
    },
  }),
}

function svgoConfig(prefix, stats) {
  return {
    multipass: false,
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            collapseGroups: false,
            cleanupIds: false,
            mergePaths: false,
            moveGroupAttrsToElems: false,
            inlineStyles: { onlyMatchedOnce: false, removeMatchedSelectors: true },
          },
        },
      },
      removeSerifPlugin,
      'convertStyleToAttrs',
      'removeDimensions',
      { name: 'prefixIds', params: { prefix, delim: '_', prefixClassNames: false } },
      statsPlugin(stats),
    ],
  }
}

async function main() {
  const files = (await fs.readdir(rawDir)).filter((f) => /^\d{2}\.svg$/.test(f)).sort()
  if (files.length === 0) throw new Error(`No NN.svg files in ${rawDir}`)

  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })

  const manifest = []
  const report = []
  for (const file of files) {
    const num = file.slice(0, 2)
    const id = `s${num}`
    const input = await fs.readFile(path.join(rawDir, file), 'utf8')
    const stats = { groups: 0, maxDepth: 0, images: 0, styles: 0, classes: 0, styleAttrs: 0 }
    const { data } = optimize(input, { path: file, ...svgoConfig(id, stats) })

    if (!stats.viewBox) throw new Error(`${file}: missing viewBox`)
    const problems = []
    if (stats.groups < 5 || stats.maxDepth < 2) problems.push('flat structure')
    if (stats.images) problems.push(`${stats.images} raster <image>`)
    if (stats.styles || stats.classes || stats.styleAttrs) problems.push('styles not inlined')

    await fs.writeFile(path.join(outDir, `${id}.svg`), data)
    manifest.push({
      id,
      title: TITLES[num] ?? `Иллюстрация ${num}`,
      file: `sources/${id}.svg`,
      viewBox: stats.viewBox,
    })
    report.push({
      file,
      out: `${id}.svg`,
      groups: stats.groups,
      depth: stats.maxDepth,
      kb: Math.round(data.length / 1024),
      problems: problems.join(', ') || 'ok',
    })
  }

  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.table(report)

  const bad = report.filter((r) => r.problems !== 'ok')
  if (bad.length) {
    console.error(`\n${bad.length} file(s) need replacement: ${bad.map((r) => r.file).join(', ')}`)
    process.exitCode = 1
  } else {
    console.log(`\n${report.length} sources written to public/sources/`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
