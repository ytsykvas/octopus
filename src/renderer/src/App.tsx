import {
  CloudDownload,
  FolderOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings as SettingsIcon
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { Config } from '@core/config.js'
import type { ThemeName } from '@core/types.js'

import { Button } from './components/Button.js'
import { Chat } from './components/chat/Chat.js'
import { RepositoryPicker } from './components/RepositoryPicker.js'
import { Placeholder } from './components/Placeholder.js'
import { ProjectSettings } from './components/ProjectSettings.js'
import { ProjectTabs } from './components/ProjectTabs.js'
import { RightPanel } from './components/RightPanel.js'
import { type SectionId, Settings } from './components/Settings.js'
import { Sidebar } from './components/Sidebar.js'
import { useConfirm } from './hooks/useConfirm.js'
import { useErrorMessage } from './hooks/useErrorMessage.js'
import { useProjects } from './hooks/useProjects.js'
import { useWorkspaces } from './hooks/useWorkspaces.js'

/**
 * Window layout (§10.8 docs/PROJECT.md): a project tab strip, then the active
 * project's workspaces, the agent chat, and diff and terminal on the right.
 */
export function App(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const describeFailure = useErrorMessage()
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [theme, setTheme] = useState<ThemeName>('light')
  const [config, setConfig] = useState<Config | null>(null)
  // The section, not a boolean: "connect GitHub" has to land on Git, and a
  // dialog that opens on Appearance instead has sent the user nowhere useful.
  // `null` is closed.
  const [settingsSection, setSettingsSection] = useState<SectionId | null>(null)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rightPanelOpen, setRightPanelOpen] = useState(true)
  // Not persisted, matching the right pane: which panes are folded away is a
  // preference for the current session rather than a setting.
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [pickingRepository, setPickingRepository] = useState(false)
  // Every control that reaches the check is disabled while it runs, which is
  // also what stops a second one starting: React flushes a click's state update
  // before the next click is delivered, so the button is already dead by then.
  const [checkingGitHub, setCheckingGitHub] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [scriptPaths, setScriptPaths] = useState<{ setup: string | null; run: string | null }>({
    setup: null,
    run: null
  })

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
        setSettingsSection('general')
      }),
    []
  )

  // The language lives in the config, so it survives restarts.
  useEffect(() => {
    if (config && i18n.language !== config.language) {
      void i18n.changeLanguage(config.language)
    }
  }, [config, i18n])

  // Re-read whenever the project changes or its settings close, since that is
  // where a script gets written for the first time.
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      if (selectedProjectId === null) {
        setScriptPaths({ setup: null, run: null })
        return
      }

      const result = await window.octopus.projects.scriptPaths(selectedProjectId)
      if (controller.signal.aborted) return
      if (result.ok) setScriptPaths(result.value)
    })()

    return () => {
      controller.abort()
    }
  }, [selectedProjectId, editingProjectId])

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

  /**
   * Adds a project from a directory on this machine, and opens it.
   *
   * Lifted out of the tab strip's menu so the empty centre pane can offer the
   * same two ways in. One implementation, or the two entry points drift.
   */
  const addFromDisk = useCallback(async () => {
    const added = await projects.addFromDisk()
    if (added) setSelectedProjectId(added.id)
  }, [projects])

  /**
   * Adds a project from GitHub, or sends the user to connect an account first.
   *
   * Checked on the click rather than held in state: the account can be
   * connected in Settings a moment from now, and a cached answer would be
   * confidently wrong exactly when the user has just fixed the problem.
   */
  const addFromGitHub = useCallback(async () => {
    setCheckingGitHub(true)

    try {
      const result = await window.octopus.accounts.status()
      // A failed check and a signed-out account are one case here. `gh` missing,
      // `gh` signed out and a reply that does not parse all arrive as
      // `connected: false`, and Settings is where every one of them is fixed.
      if (result.ok && result.value.github.connected) setPickingRepository(true)
      else setSettingsSection('git')
    } finally {
      setCheckingGitHub(false)
    }
  }, [])

  // ⌘⇧N creates a workspace. ⌘1–⌘9 switch project, as they do between tabs
  // everywhere else; ⌃1–⌃9 move within the current project's workspaces.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (selectedProjectId !== null) void workspaces.create(selectedProjectId)
        return
      }

      const digit = Number.parseInt(event.key, 10)
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return

      if (event.metaKey) {
        const project = projects.all[digit - 1]
        if (project) {
          event.preventDefault()
          setSelectedProjectId(project.id)
          setSelectedWorkspaceId(null)
        }
        return
      }

      if (event.ctrlKey && selectedProjectId !== null) {
        const target = (workspaces.byProject.get(selectedProjectId) ?? [])[digit - 1]
        if (target) {
          event.preventDefault()
          setSelectedWorkspaceId(target.id)
        }
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [selectedProjectId, workspaces, projects])

  const selectedProject = projects.all.find((project) => project.id === selectedProjectId) ?? null
  const editingProject = projects.all.find((project) => project.id === editingProjectId) ?? null

  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      {/* One strip across the window rather than one per pane. The traffic
          lights sit at its left, and nothing behind them belongs to a project:
          a pane's colour reaching up here made the window look like it started
          in the wrong place. */}
      <header className="titlebar-drag border-line flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[5.5rem]">
        <span className="truncate font-medium">{selectedProject?.name ?? t('app.name')}</span>
        {selectedProject && (
          <span className="text-ink-faint truncate font-mono text-[11px]">
            {selectedProject.repoPath}
          </span>
        )}

        {/* One control in one place, rather than a collapse inside the pane and
            an expand out here: the button that folds something away should be
            the button that brings it back, or the second one has to be hunted
            for in a pane that is no longer on screen. */}
        <button
          type="button"
          onClick={() => {
            setRightPanelOpen((open) => !open)
          }}
          className="text-ink-faint hover:text-ink focus-ring ml-auto rounded p-1 transition-colors"
          title={rightPanelOpen ? t('panel.collapse') : t('panel.expand')}
          aria-label={rightPanelOpen ? t('panel.collapse') : t('panel.expand')}
        >
          {rightPanelOpen ? (
            <PanelRightClose aria-hidden size={14} />
          ) : (
            <PanelRightOpen aria-hidden size={14} />
          )}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Tabs and workspaces are one column, so Settings can sit in the corner
          of the window rather than inset by the width of the tab strip. */}
        <div className="flex min-h-0 shrink-0 flex-col">
          <div className="flex min-h-0 flex-1">
            <ProjectTabs
              projects={projects.all}
              activeProjectId={selectedProjectId}
              onSelect={(id) => {
                setSelectedProjectId(id)
                setSelectedWorkspaceId(null)
                // Picking a project is asking to see it, and folded away there is
                // nothing to see — so the list comes back rather than the click
                // appearing to do nothing.
                setSidebarOpen(true)
              }}
              onEdit={setEditingProjectId}
              onRemove={(id) => void removeProject(id)}
              onAddFromDisk={() => void addFromDisk()}
              onAddFromGitHub={() => void addFromGitHub()}
              busy={projects.busy || checkingGitHub}
              sidebarOpen={sidebarOpen}
              onToggleSidebar={() => {
                setSidebarOpen((open) => !open)
              }}
            />

            {sidebarOpen && (
              <Sidebar
                project={selectedProject}
                workspaces={
                  selectedProject ? (workspaces.byProject.get(selectedProject.id) ?? []) : []
                }
                selectedWorkspaceId={selectedWorkspaceId}
                onSelectWorkspace={setSelectedWorkspaceId}
                onCreateWorkspace={() => {
                  // The button that calls this lives in the project header,
                  // which only renders with a project — the guard is for the
                  // type, and no interaction reaches its other branch.
                  /* v8 ignore next */
                  if (selectedProject) void workspaces.create(selectedProject.id)
                }}
                onRenameWorkspace={(id, name) => void workspaces.rename(id, name)}
                onRemoveWorkspace={(id) => void workspaces.remove(id)}
                editingWorkspaceId={workspaces.editingId}
                onEditingWorkspaceChange={workspaces.setEditingId}
                width={config?.sidebarWidth ?? 240}
                onWidthChange={(sidebarWidth) => void updateConfig({ sidebarWidth })}
              />
            )}
          </div>

          {/* Folding the list away moved to the foot of the tab strip, which is
              the part of this column that stays put. What is left here is the
              one thing that belongs to the window rather than to a project. */}
          <div className="border-line bg-surface border-t border-r p-2">
            <button
              type="button"
              onClick={() => {
                setSettingsSection('general')
              }}
              title={t('sidebar.settings')}
              className="row focus-ring text-ink-soft hover:text-ink flex w-full items-center gap-2 px-2 py-1.5"
            >
              <SettingsIcon aria-hidden size={14} />
              {/* Folded, the column is only as wide as the tab strip, so the
                  label goes and the title carries the meaning. */}
              {sidebarOpen && t('sidebar.settings')}
            </button>
          </div>
        </div>

        <main className="flex min-w-0 flex-1 flex-col">
          {error !== null && (
            <div className="bg-danger-bg text-danger border-danger/25 m-6 mb-0 rounded-[var(--radius-control)] border px-3 py-2">
              {error}
            </div>
          )}

          {/* The chat needs the full height of the pane — a padded, scrolling
              wrapper around it would give it two scrollbars, one of which
              would carry the composer off the bottom of the window. */}
          {projects.all.length === 0 || !selectedProject ? (
            // No padded wrapper: the placeholder brings its own frame and
            // centres itself, so one here would centre it inside a box already
            // inset from the pane and leave it sitting low.
            <CenterPane
              hasProjects={projects.all.length > 0}
              busy={projects.busy || checkingGitHub}
              checkingGitHub={checkingGitHub}
              onAddFromDisk={() => void addFromDisk()}
              onAddFromGitHub={() => void addFromGitHub()}
            />
          ) : (
            <Chat
              workspace={
                workspaces.flat.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
              }
              color={selectedProject.color}
            />
          )}
        </main>

        {rightPanelOpen && (
          <RightPanel
            workspaces={workspaces.flat}
            activeWorkspaceId={selectedWorkspaceId}
            color={selectedProject?.color ?? null}
            scriptPaths={scriptPaths}
            onEditScripts={() => {
              if (selectedProject) setEditingProjectId(selectedProject.id)
            }}
            width={config?.rightPanelWidth ?? 360}
            onWidthChange={(rightPanelWidth) => void updateConfig({ rightPanelWidth })}
          />
        )}
      </div>

      {settingsSection !== null && config && (
        <Settings
          config={config}
          onChange={updateConfig}
          initialSection={settingsSection}
          onClose={() => {
            setSettingsSection(null)
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
          onOpenSettings={() => {
            // Closed first: both are native dialogs, and opening the second on
            // top of the first stacks two modal layers over each other.
            setPickingRepository(false)
            setSettingsSection('git')
          }}
        />
      )}
    </div>
  )
}

interface CenterPaneProps {
  readonly hasProjects: boolean
  readonly busy: boolean
  readonly checkingGitHub: boolean
  readonly onAddFromDisk: () => void
  readonly onAddFromGitHub: () => void
}

/**
 * What the centre shows before there is a project to talk to the agent about.
 *
 * It carries the same two ways in as the tab strip's menu, because this is the
 * screen a first run lands on, and telling someone where the button is while
 * having room for the button is a strange thing to do.
 */
function CenterPane({
  hasProjects,
  busy,
  checkingGitHub,
  onAddFromDisk,
  onAddFromGitHub
}: CenterPaneProps): React.JSX.Element {
  const { t } = useTranslation()

  const actions = (
    <>
      {/* Accent only on a first run, where adding is the whole task. Once
          projects exist the tabs are a click away and the likelier intent, so
          neither button competes with them. */}
      <Button variant={hasProjects ? 'quiet' : 'accent'} disabled={busy} onClick={onAddFromDisk}>
        <FolderOpen aria-hidden size={13} />
        {t('center.addFromDisk')}
      </Button>

      <Button variant="quiet" disabled={busy} onClick={onAddFromGitHub}>
        <CloudDownload aria-hidden size={13} />
        {checkingGitHub ? t('center.checkingGitHub') : t('center.addFromGitHub')}
      </Button>
    </>
  )

  if (!hasProjects) {
    return (
      <Placeholder title={t('center.noProjectsTitle')} actions={actions}>
        {t('center.noProjectsBody')}
      </Placeholder>
    )
  }

  return (
    <Placeholder title={t('center.noSelectionTitle')} actions={actions}>
      {t('center.noSelectionBody')}
    </Placeholder>
  )
}
