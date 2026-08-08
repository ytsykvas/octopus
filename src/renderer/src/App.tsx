import { PanelRightOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Config } from '@core/config.js'
import type { Project } from '@core/store.js'
import type { ThemeName } from '@core/types.js'

import { RepositoryPicker } from './components/RepositoryPicker.js'
import { ProjectSettings } from './components/ProjectSettings.js'
import { RightPanel } from './components/RightPanel.js'
import { Settings } from './components/Settings.js'
import { Sidebar } from './components/Sidebar.js'
import { useConfirm } from './hooks/useConfirm.js'
import { useErrorMessage } from './hooks/useErrorMessage.js'
import { useProjects } from './hooks/useProjects.js'
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
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  const [pickingRepository, setPickingRepository] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)

  const projects = useProjects(confirm, setError)
  const workspaces = useWorkspaces(projects.all, confirm, setError)

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

  /**
   * Removes a project and clears anything pointing at it.
   *
   * The selection and the workspace list are this component's business, so
   * they are settled here rather than inside the hook.
   */
  const removeProject = useCallback(
    async (projectId: string) => {
      const count = (workspaces.byProject.get(projectId) ?? []).length
      if (!(await projects.remove(projectId, count))) return

      setSelectedProjectId((current) => (current === projectId ? null : current))
      setSelectedWorkspaceId(null)
      await workspaces.refresh()
    },
    [projects, workspaces]
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

  const selectedProject = projects.all.find((project) => project.id === selectedProjectId) ?? null
  const editingProject = projects.all.find((project) => project.id === editingProjectId) ?? null

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
        projects={projects.all}
        selectedProjectId={selectedProjectId}
        onSelectProject={(id) => {
          setSelectedProjectId(id)
          setSelectedWorkspaceId(null)
        }}
        onAddFromDisk={() => {
          void (async () => {
            const added = await projects.addFromDisk()
            if (added) setSelectedProjectId(added.id)
          })()
        }}
        onAddFromGitHub={() => {
          setPickingRepository(true)
        }}
        onEditProject={setEditingProjectId}
        onRemoveProject={(id) => void removeProject(id)}
        workspaces={workspaces.byProject}
        selectedWorkspaceId={selectedWorkspaceId}
        onSelectWorkspace={(id) => {
          setSelectedWorkspaceId(id)
          const owner = workspaces.flat.find((item) => item.id === id)
          if (owner) setSelectedProjectId(owner.projectId)
        }}
        onCreateWorkspace={(id) => void workspaces.create(id)}
        onRenameWorkspace={(id, name) => void workspaces.rename(id, name)}
        onRemoveWorkspace={(id) => void workspaces.remove(id)}
        editingWorkspaceId={workspaces.editingId}
        onEditingWorkspaceChange={workspaces.setEditingId}
        onOpenSettings={() => {
          setSettingsOpen(true)
        }}
        busy={projects.busy}
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

          <CenterPane project={selectedProject} hasProjects={projects.all.length > 0} />
        </div>
      </main>

      {rightPanelOpen && (
        <RightPanel
          workspaces={workspaces.flat}
          activeWorkspaceId={selectedWorkspaceId}
          width={config?.rightPanelWidth ?? 360}
          onWidthChange={(rightPanelWidth) => void updateConfig({ rightPanelWidth })}
          onCollapse={() => {
            setRightPanelOpen(false)
          }}
        />
      )}

      {editingProject && (
        <ProjectSettings
          project={editingProject}
          onUpdate={(patch) => projects.update(editingProject.id, patch)}
          onRemove={() => {
            void (async () => {
              // Closing first keeps the confirmation from appearing behind the
              // dialog that raised it.
              setEditingProjectId(null)
              await removeProject(editingProject.id)
            })()
          }}
          onClose={() => {
            setEditingProjectId(null)
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
            void projects.refresh()
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
