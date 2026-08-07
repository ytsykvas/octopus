import { PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Config } from '@core/config.js'
import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

import { RepositoryPicker } from './components/RepositoryPicker.js'
import { RightPanel } from './components/RightPanel.js'
import { Settings } from './components/Settings.js'
import { Sidebar } from './components/Sidebar.js'
import { useConfirm } from './hooks/useConfirm.js'
import { useErrorMessage } from './hooks/useErrorMessage.js'
import { useWorkspaces } from './hooks/useWorkspaces.js'

/**
 * Three-pane layout modelled on Conductor (§10.8 docs/PROJECT.md):
 * workspaces on the left, agent chat in the middle, diff and terminal on
 * the right.
 */
export function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const describeFailure = useErrorMessage()
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [theme, setTheme] = useState<ThemeName>('light')
  const [config, setConfig] = useState<Config | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [projects, setProjects] = useState<readonly Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [pickingRepository, setPickingRepository] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)

  const workspaces = useWorkspaces(projects, confirm, setError)

  useEffect(() => {
    const controller = new AbortController()

    void window.octopus.theme.get().then((value) => {
      if (!controller.signal.aborted) setTheme(value)
    })

    const unsubscribe = window.octopus.theme.onChange(setTheme)

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
      const result = await window.octopus.projects.list()
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

  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.config.get()
      if (controller.signal.aborted) return
      if (result.ok) setConfig(result.value)
    })()

    return () => {
      controller.abort()
    }
  }, [])

  // The native menu owns ⌘, on macOS; the renderer just reacts to it.
  useEffect(
    () =>
      window.octopus.settings.onOpen(() => {
        setSettingsOpen(true)
      }),
    []
  )

  // The language lives in the config, so it survives restarts.
  useEffect(() => {
    if (config && i18n.language !== config.language) {
      void i18n.changeLanguage(config.language)
    }
  }, [config, i18n])

  const updateConfig = useCallback(
    async (patch: Partial<Config>) => {
      const result = await window.octopus.config.update(patch)
      if (result.ok) {
        setConfig(result.value)
      } else {
        setError(describeFailure(result))
      }
    },
    [describeFailure]
  )

  const refresh = useCallback(async () => {
    const result = await window.octopus.projects.list()
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
      const result = await window.octopus.projects.add()
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

  const renameProject = useCallback(
    async (projectId: string, name: string) => {
      const result = await window.octopus.projects.rename(projectId, name)
      if (result.ok) {
        await refresh()
      } else {
        setError(describeFailure(result))
      }
    },
    [refresh, describeFailure]
  )

  const removeProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((item) => item.id === projectId)
      if (!project) return

      // Removing is one click away from a hover state, so it asks first.
      const confirmed = await confirm({
        title: t('sidebar.removeTitle'),
        message: t('sidebar.removeMessage', { name: project.name }),
        detail: t('sidebar.removeDetail'),
        confirmLabel: t('sidebar.removeConfirm'),
        cancelLabel: t('sidebar.removeCancel'),
        destructive: true
      })

      if (!confirmed.confirmed) return

      const result = await window.octopus.projects.remove(projectId)
      if (!result.ok) {
        setError(describeFailure(result))
        return
      }
      setSelectedProjectId((current) => (current === projectId ? null : current))
      await refresh()
      await workspaces.refresh()
    },
    [projects, refresh, describeFailure, confirm, workspaces, t]
  )

  // ⌘⇧N creates a workspace in the selected project; ⌘1–⌘9 jump between
  // them (§10.8).
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.metaKey) return

      if (event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (selectedProjectId !== null) void workspaces.create(selectedProjectId)
        return
      }

      const digit = Number.parseInt(event.key, 10)
      if (!Number.isNaN(digit) && digit >= 1 && digit <= 9) {
        const target = workspaces.flat[digit - 1]
        if (target) {
          event.preventDefault()
          setSelectedWorkspaceId(target.id)
          setSelectedProjectId(target.projectId)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedProjectId, workspaces])

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null

  if (settingsOpen && config) {
    return (
      <Settings
        config={config}
        onChange={updateConfig}
        onClose={() => {
          setSettingsOpen(false)
        }}
      />
    )
  }

  return (
    <div className="bg-canvas text-ink flex h-full">
      <Sidebar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onSelectProject={setSelectedProjectId}
        onAddFromDisk={() => void addProject()}
        onAddFromGitHub={() => {
          setPickingRepository(true)
        }}
        onRemoveProject={(id) => void removeProject(id)}
        onRenameProject={(id, name) => void renameProject(id, name)}
        workspaces={workspaces.byProject}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={setSelectedWorkspaceId}
        onCreateWorkspace={(id) => void workspaces.create(id)}
        onRenameWorkspace={(id, name) => void workspaces.rename(id, name)}
        onRemoveWorkspace={(id) => void workspaces.remove(id)}
        editingWorkspaceId={workspaces.editingId}
        onEditingWorkspaceChange={workspaces.setEditingId}
        onOpenSettings={() => {
          setSettingsOpen(true)
        }}
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
              className="text-ink-faint hover:text-ink focus-ring ml-auto rounded p-1 transition-colors"
              title={t('panel.expand')}
            >
              <PanelRightOpen aria-hidden size={14} />
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

      {confirmDialog}

      {pickingRepository && (
        <RepositoryPicker
          cloneDirectory={config?.cloneDirectory ?? ''}
          onCloneDirectoryChange={(cloneDirectory) => void updateConfig({ cloneDirectory })}
          onPicked={() => {
            setPickingRepository(false)
            void refresh()
          }}
          onCancel={() => {
            setPickingRepository(false)
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
