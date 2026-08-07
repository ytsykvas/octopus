import { useCallback, useEffect, useState } from 'react'

import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

import { Button } from './components/Button.js'
import { ProjectList } from './components/ProjectList.js'

export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeName>('light')
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    void window.maestro.theme.get().then((value) => {
      if (!controller.signal.aborted) setTheme(value)
    })

    const unsubscribe = window.maestro.theme.onChange(setTheme)

    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Початкове завантаження. Скасування рятує від запису стану в уже
  // розмонтований компонент, якщо вікно закриють під час запиту.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.maestro.projects.list()
      if (controller.signal.aborted) return

      if (result.ok) {
        setProjects(result.value)
      } else {
        setError(result.error)
      }
    })()

    return () => {
      controller.abort()
    }
  }, [])

  const refresh = useCallback(async () => {
    const result = await window.maestro.projects.list()
    if (result.ok) {
      setProjects(result.value)
      setError(null)
    } else {
      setError(result.error)
    }
  }, [])

  const addProject = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.maestro.projects.add()
      if (!result.ok) {
        setError(result.error)
        return
      }
      // null означає, що діалог скасували — це не помилка.
      if (result.value) {
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const removeProject = useCallback(
    async (projectId: string) => {
      const result = await window.maestro.projects.remove(projectId)
      if (result.ok) {
        await refresh()
      } else {
        setError(result.error)
      }
    },
    [refresh]
  )

  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      <header className="titlebar-drag flex h-14 shrink-0 items-center justify-between px-5 pl-24">
        <span className="brutal-label text-sm">maestro</span>
        <Button onClick={() => void addProject()} disabled={busy} tone="success">
          {busy ? 'відкрито діалог…' : '+ проєкт'}
        </Button>
      </header>

      <main className="flex-1 overflow-auto px-8 pb-8">
        {error !== null && (
          <div className="brutal-surface bg-danger text-on-danger mb-6 p-4">
            <p className="brutal-label mb-1 text-xs">не вдалося</p>
            <p className="text-sm">{error}</p>
          </div>
        )}

        <ProjectList projects={projects} onRemove={(id) => void removeProject(id)} />
      </main>
    </div>
  )
}
