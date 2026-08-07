import { useCallback, useEffect, useState } from 'react'

import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

import { RightPanel } from './components/RightPanel.js'
import { Sidebar } from './components/Sidebar.js'

/**
 * Розмітка з трьох панелей за взірцем Conductor (§10.8 docs/PROJECT.md):
 * ліворуч воркспейси, по центру чат, праворуч дифф і термінал.
 */
export function App(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeName>('light')
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

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
        setSelectedProjectId(result.value.id)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [refresh])

  const removeProject = useCallback(
    async (projectId: string) => {
      const result = await window.maestro.projects.remove(projectId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelectedProjectId((current) => (current === projectId ? null : current))
      await refresh()
    },
    [refresh]
  )

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  return (
    <div className="bg-canvas text-ink flex h-full">
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onAddProject={() => void addProject()}
        onRemoveProject={(id) => void removeProject(id)}
        busy={busy}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="titlebar-drag border-outline flex h-14 shrink-0 items-center gap-3 border-b-[3px] px-5">
          <span className="brutal-label truncate text-sm">
            {selectedProject?.name ?? 'maestro'}
          </span>

          {!rightPanelOpen && (
            <button
              type="button"
              onClick={() => {
                setRightPanelOpen(true)
              }}
              className="brutal-label text-ink-soft hover:text-ink ml-auto text-[0.65rem]"
            >
              показати панель ‹
            </button>
          )}
        </header>

        <div className="flex-1 overflow-auto p-6">
          {error !== null && (
            <div className="brutal-surface bg-danger text-on-danger mb-6 p-4">
              <p className="brutal-label mb-1 text-xs">не вдалося</p>
              <p className="text-sm">{error}</p>
            </div>
          )}

          <CenterPane project={selectedProject} hasProjects={projects.length > 0} />
        </div>
      </main>

      {rightPanelOpen && (
        <RightPanel
          onCollapse={() => {
            setRightPanelOpen(false)
          }}
        />
      )}
    </div>
  )
}

function CenterPane({
  project,
  hasProjects
}: {
  project: Project | null
  hasProjects: boolean
}): React.JSX.Element {
  if (!hasProjects) {
    return (
      <Placeholder title="почніть з репозиторію">
        Додайте проєкт у лівій панелі. Далі в ньому створюватимуться воркспейси — кожен з власною
        гілкою, текою й сесією агента.
      </Placeholder>
    )
  }

  if (!project) {
    return <Placeholder title="виберіть проєкт">Проєкт зі списку ліворуч.</Placeholder>
  }

  return (
    <Placeholder title={project.name}>
      Базова гілка <code className="font-mono">{project.baseBranch}</code>. Тут буде чат з агентом,
      щойно з’являться воркспейси.
    </Placeholder>
  )
}

function Placeholder({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="brutal-surface flex min-h-64 flex-col items-center justify-center p-12 text-center">
      <p className="brutal-label mb-3 text-xl">{title}</p>
      <p className="text-ink-soft max-w-md leading-relaxed">{children}</p>
    </div>
  )
}
