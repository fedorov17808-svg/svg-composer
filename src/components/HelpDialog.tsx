import { Dialog } from './Dialog'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const STEPS = [
  ['Выделить', 'Вкладка «Исходники» → откройте картинку и щёлкните по персонажу или предмету. Рамкой — несколько деталей.'],
  ['В библиотеку', 'Справа проверьте превью, дайте название и нажмите «Добавить в библиотеку».'],
  ['Собрать и экспортировать', 'Вкладка «Библиотека» → перетащите компоненты на холст, двигайте, масштабируйте, поворачивайте. Затем «Экспорт ▾».'],
]

const KEYS: [string, string][] = [
  ['Клик / рамка', 'выделить объект / детали в исходнике'],
  ['Shift+клик', 'добавить к выделению'],
  ['↑ / ↓', 'уровень выделения в исходнике'],
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
      <p className="muted help-note">Готовые сцены — в меню «Проект ▾ → Примеры».</p>
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
