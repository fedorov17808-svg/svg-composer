# Прогресс

План — в [PLAN.md](PLAN.md). Работаем по одному этапу; после каждого — build, commit, обновление этого файла.

## Текущий статус
- **Этап 2 (исходники) — завершён.**
- **Следующий: этап 3 (просмотр исходника и выделение)** — открыть исходник в рабочей области
  (инлайн-SVG, не `<img>`), подсветка ближайшей `<g>` при наведении, клик фиксирует,
  кнопки/стрелки «уровень выше/ниже», Shift+клик — несколько элементов.

## Сделано

### Этап 1 — каркас
- Vite 8 + React 19 + TypeScript 6 + Zustand 5 в корне репозитория; `git init`.
- Layout из трёх зон (`src/App.tsx`): `LeftPanel` (вкладки «Исходники»/«Библиотека», состояние в
  `src/store/ui.ts`), `Workspace`, `RightPanel` («Слои», «Свойства»). Пустые состояния-подсказки.

### Этап 2 — исходники
- Набор: **Free Gophers Pack** (Maria Letta, CC0), подробности и соответствие файлов — в `CREDITS.md`.
  Отклонены как плоские (без `<g>`): Flowbite Illustrations, GLPI illustrations, GitLab SVGs, Open Doodles.
- `raw-svg/01.svg … 20.svg` — оригиналы без изменений.
- `scripts/prepare-svg.mjs` (`npm run prepare-svg`) → `public/sources/s01.svg … s20.svg` + `manifest.json`
  (`id`, `title`, `file`, `viewBox`):
  - SVGO preset-default без `collapseGroups`, `cleanupIds`, `mergePaths`, `moveGroupAttrsToElems`;
  - `inlineStyles` + `convertStyleToAttrs` — стили и классы → presentation-атрибуты;
  - удаление `serif:*` (Affinity Designer), `removeDimensions`;
  - `prefixIds` → `s01_…` с обновлением `url(#…)`/`href`;
  - встроенная проверка: ≥5 групп и глубина ≥2, нет `<image>`, не осталось `style`/`class`, иначе exit 1.
- Вкладка «Исходники»: сетка превью 2×10 из `manifest.json` (`src/store/sources.ts`, `src/components/SourcesGrid.tsx`).
- Проверено: число групп до/после SVGO совпадает; все ссылки `url(#)`/`href` разрешаются, id уникальны и
  с префиксом; попиксельное сравнение рендера raw vs normalized в Chrome — различие 0,016% (сглаживание);
  `npm run build` и `npm run lint` без ошибок; скриншот приложения показывает сетку.

| Файл | Групп `<g>` | Глубина |
| --- | --- | --- |
| 01 | 14 | 6 |
| 02 | 14 | 5 |
| 03 | 14 | 7 |
| 04 | 82 | 7 |
| 05 | 55 | 6 |
| 06 | 124 | 8 |
| 07 | 40 | 6 |
| 08 | 47 | 7 |
| 09 | 78 | 7 |
| 10 | 44 | 8 |
| 11 | 71 | 7 |
| 12 | 65 | 7 |
| 13 | 51 | 8 |
| 14 | 68 | 8 |
| 15 | 68 | 8 |
| 16 | 91 | 10 |
| 17 | 39 | 7 |
| 18 | 81 | 6 |
| 19 | 44 | 7 |
| 20 | 87 | 9 |

## Заметки для следующих этапов
- На корневом `<svg>` исходников висят наследуемые атрибуты (`fill-rule`, `clip-rule`, `stroke-linecap`,
  `stroke-linejoin`, `stroke-miterlimit`) — при извлечении (этап 4) переносить их на компонент.
- В каждом исходнике сначала идут служебные обёртки `<g transform>` и прозрачный фон
  `<path d="M0 0h600v600H0z" fill="none"/>` — при выделении (этап 3) их стоит пропускать.
- Запуск: `npm install`, `npm run dev` → http://localhost:5173. `.claude/` исключён из git.
