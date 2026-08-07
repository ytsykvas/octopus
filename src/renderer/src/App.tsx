import { useEffect, useState } from 'react'

import type { ThemeName } from '@core/types.js'

/**
 * Тимчасовий UI етапу 1.
 *
 * Його єдине завдання — довести, що каркас працює: IPC живий, тема
 * підхоплюється з системи, токени дизайн-системи застосовуються.
 * Лейаут ще не обрано (§17), тож цей екран буде замінений цілком.
 */
export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeName>('light')

  useEffect(() => {
    void window.maestro.theme.get().then(setTheme)
    return window.maestro.theme.onChange(setTheme)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <header className="titlebar-drag flex h-14 shrink-0 items-center justify-end px-5">
        <span className="brutal-label text-ink-soft text-xs">
          тема: {theme === 'dark' ? 'темна' : 'світла'}
        </span>
      </header>

      <main className="flex flex-1 items-center justify-center p-10">
        <section className="brutal-surface w-full max-w-xl p-8">
          <h1 className="brutal-label mb-3 text-3xl">maestro</h1>
          <p className="mb-7 leading-relaxed">
            Каркас працює. Далі — менеджер worktree та інтеграція з Agent SDK.
          </p>

          <div className="flex flex-wrap gap-3">
            <Badge tone="success">idle</Badge>
            <Badge tone="info">running</Badge>
            <Badge tone="warning">waiting</Badge>
            <Badge tone="danger">error</Badge>
          </div>
        </section>
      </main>
    </div>
  )
}

const TONE_CLASSES = {
  success: 'bg-success text-on-success',
  info: 'bg-info text-on-info',
  warning: 'bg-warning text-on-warning',
  danger: 'bg-danger text-on-danger'
} as const

function Badge({
  tone,
  children
}: {
  tone: keyof typeof TONE_CLASSES
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={`brutal-label brutal-interactive rounded-[var(--radius-badge)] border-2 border-outline px-3 py-1.5 text-xs shadow-[var(--shadow-brutal-sm)] ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  )
}
