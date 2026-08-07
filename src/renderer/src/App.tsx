import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

import { RightPanel } from './components/RightPanel.js'
import { Sidebar } from './components/Sidebar.js'
import { useErrorMessage } from './hooks/useErrorMessage.js'

/**
 * Three-pane layout modelled on Conductor (§10.8 docs/PROJECT.md):
 * workspaces on the left, agent chat in the middle, diff and terminal on
 * the right.
 */
export function App(): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

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

  // Initial load. Aborting protects against writing state into an unmounted
  // component if the window closes mid-request.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.maestro.projects.list()
      if (controller.signal.aborted) return

      if (result.ok) {
        setProjects(result.value)
      } else {
        setError(describeFailure(result))
      }
    })()

    return () => {
      controller.abort()
    }
  }, [describeFailure])

  const refresh = useCallback(async () => {
    const result = await window.maestro.projects.list()
    if (result.ok) {
      setProjects(result.value)
      setError(null)
    } else {
      setError(describeFailure(result))
    }
  }, [describeFailure])

  const addProject = useCallback(async () => {
    setBusy(true)
    try {
      const result = await window.maestro.projects.add()
      if (!result.ok) {
        setError(describeFailure(result))
        return
      }
      // null means the dialog was cancelled — not an error.
      if (result.value) {
        setSelectedProjectId(result.value.id)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }, [refresh, describeFailure])

  const removeProject = useCallback(
    async (projectId: string) => {
      const result = await window.maestro.projects.remove(projectId)
      if (!result.ok) {
        setError(describeFailure(result))
        return
      }
      setSelectedProjectId((current) => (current === projectId ? null : current))
      await refresh()
    },
    [refresh, describeFailure]
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
        <header className="titlebar-drag border-line flex h-11 shrink-0 items-center gap-3 border-b px-4">
          <span className="truncate font-medium">{selectedProject?.name ?? t('app.name')}</span>
          {selectedProject && (
            <span className="text-ink-faint truncate font-mono text-[11px]">
              {selectedProject.repoPath}
            </span>
          )}

          {!rightPanelOpen && (
            <button
              type="button"
              onClick={() => {
                setRightPanelOpen(true)
              }}
              className="text-ink-faint hover:text-ink focus-ring ml-auto rounded px-2 transition-colors"
              title={t('panel.expand')}
            >
              ←
            </button>
          )}
        </header>

        <div className="flex-1 overflow-auto p-6">
          {error !== null && (
            <div className="bg-danger-bg text-danger border-danger/25 mb-5 rounded-[var(--radius-control)] border px-3 py-2">
              {error}
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
  const { t } = useTranslation()

  if (!hasProjects) {
    return (
      <Placeholder title={t('center.noProjectsTitle')}>{t('center.noProjectsBody')}</Placeholder>
    )
  }

  if (!project) {
    return (
      <Placeholder title={t('center.noSelectionTitle')}>{t('center.noSelectionBody')}</Placeholder>
    )
  }

  return (
    <Placeholder title={project.name}>
      {t('center.projectBody', { branch: project.baseBranch })}
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
    <div className="panel mx-auto flex min-h-56 max-w-lg flex-col items-center justify-center p-10 text-center">
      <p className="mb-2 text-[15px] font-semibold">{title}</p>
      <p className="text-ink-soft leading-relaxed">{children}</p>
    </div>
  )
}
