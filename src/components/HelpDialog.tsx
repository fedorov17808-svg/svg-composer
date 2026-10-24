import { Dialog } from './Dialog'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const STEPS = [
  ['Выбрать версию', 'Слева «Библиотека объектов»: размер L или S, главный (цветной) или фоновый (монохром) вариант.'],
  ['Собрать', 'Щёлкните по объекту — он встанет в центр холста, или перетащите его на холст. Двигайте, масштабируйте, поворачивайте.'],
  ['Покрасить', 'Над холстом — цветовая схема: перекрашивает все объекты и фон. «Добавить палитру» — своя схема из 8 цветов или JSON. У выделенного объекта справа — «Главный / Фоновый» и «Вариант цвета».'],
  ['Экспортировать', 'Меню «Экспорт ▾» — SVG или PNG, в выбранной схеме.'],
]

const KEYS: [string, string][] = [
  ['Esc', 'снять выделение'],
  [`${MOD}Z / ${MOD}Shift+Z`, 'отменить / повторить'],
  [`${MOD}D`, 'дублировать объект'],
  ['Delete', 'удалить объект'],
  ['H', 'отразить по горизонтали'],
  ['Стрелки (Shift — ×10)', 'сдвинуть на 1 px'],
  [`${MOD}] / ${MOD}[`, 'выше / ниже по слоям (Shift — до конца)'],
  ['Пробел + перетаскивание', 'двигать холст'],
  ['Shift при повороте', 'шаг 15°'],
  [`${MOD}E`, 'скачать SVG'],
]

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Как собрать композицию" onClose={onClose}>
      <ol className="help-steps">
        {STEPS.map(([title, text]) => (
          <li key={title}>
            <strong>{title}.</strong> {text}
          </li>
        ))}
      </ol>
      <h3 className="help-heading">Горячие клавиши</h3>
      <dl className="help-keys">
        {KEYS.map(([key, action]) => (
          <div key={key} className="help-key">
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
