import {
  CloudDownload,
  FolderOpen,
  GitBranch,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Settings as SettingsIcon
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DEFAULT_EFFORT } from '@core/chats.js'
import type { Config } from '@core/config.js'
import type { ThemeName } from '@core/types.js'

import { Button } from './components/Button.js'
import { Chat } from './components/chat/Chat.js'
import { RepositoryPicker } from './components/RepositoryPicker.js'
import { Placeholder } from './components/Placeholder.js'
import { ProjectSettings, type SectionId as ProjectSection } from './components/ProjectSettings.js'
import { ProjectTabs } from './components/ProjectTabs.js'
import { RightPanel } from './components/RightPanel.js'
import { type SectionId, Settings } from './components/Settings.js'
import { Sidebar } from './components/Sidebar.js'
import { useConfirm } from './hooks/useConfirm.js'
import { useErrorMessage } from './hooks/useErrorMessage.js'
import { useDiffComments } from './hooks/useDiffComments.js'
import { type ChatTab, useChatTabs } from './hooks/useChatTabs.js'
import { useProjects } from './hooks/useProjects.js'
import { useWorkspaces } from './hooks/useWorkspaces.js'

/**
 * The project strip's width, `w-14` in `ProjectTabs`.
 *
 * Stated twice, which is once too many — but the right pane has to reserve the
 * left column's room and cannot read a Tailwind class. The strip is the one
 * part of that column whose width is not already a number here.
 */
const TAB_STRIP_WIDTH = 56

/** The schema's own default, for the render before the config has been read. */
const DEFAULT_SIDEBAR_WIDTH = 240

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
  /** Which section that dialog opens on, for the callers that know. */
  const [editingProjectSection, setEditingProjectSection] = useState<ProjectSection>('general')
  const [scriptPaths, setScriptPaths] = useState<{ setup: string | null; run: string | null }>({
    setup: null,
    run: null
  })

  const projects = useProjects(confirm, setError)
  const workspaces = useWorkspaces(projects.all, confirm, setError)
  // Held here because the diff writes the notes and the composer sends them,
  // and the two panes are siblings that know nothing of each other.
  const diffComments = useDiffComments(selectedWorkspaceId)

  /*
   * The selected workspace's conversations.
   *
   * Here rather than in the chat pane, for the same reason the drafts are: the
   * keyboard listener below owns ⌥1–⌥3, and turning a digit into a tab needs
   * the list. It also hands the list to `useWorkspaces`, so a row can draw a
   * dot per conversation without asking git anything.
   */
  const setWorkspaceChats = workspaces.setChats
  const publishChats = useCallback(
    (workspaceId: string, tabs: readonly ChatTab[]) => {
      // A tab with no record yet is left out: the row draws the conversations
      // that exist, and one nobody has spoken to is not yet one of them.
      setWorkspaceChats(
        workspaceId,
        tabs.flatMap((tab) =>
          tab.id === null
            ? []
            : [
                {
                  id: tab.id,
                  agent: tab.agent,
                  title: tab.title,
                  status: tab.status,
                  started: tab.started
                }
              ]
        )
      )
    },
    [setWorkspaceChats]
  )

  const chatTabs = useChatTabs(selectedWorkspaceId, confirm, publishChats, setError)

  /*
   * The conversation a prompt from the right pane would go to.
   *
   * Null until the first tab has a record — a tab exists before its chat does,
   * and the pull request pane disables its button rather than creating one.
   */
  const activeChatId = chatTabs.tabs.find((tab) => tab.key === chatTabs.activeKey)?.id ?? null

  /*
   * A half-written prompt, kept per conversation.
   *
   * Here rather than in the chat, which unmounts the moment the selection is
   * cleared — clicking the open project does exactly that, and losing the text
   * to a stray click is the complaint this answers. Deliberately not persisted,
   * for the reason the review notes are not: a draft is about a workspace whose
   * files are on the point of changing.
   *
   * Keyed by workspace *and* tab, since a workspace now holds up to three
   * conversations and a sentence typed for one of them is not for the others.
   * The tab's key rather than its chat id: the id appears on the first message,
   * and a draft filed under the old key would be lost at exactly that moment.
   *
   * Written once per switch, not per keystroke: `Composer` hands its text up on
   * the way out.
   */
  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(new Map())
  const keepDraft = useCallback((workspaceId: string, tabKey: string, text: string) => {
    setDrafts((current) => new Map(current).set(`${workspaceId}#${tabKey}`, text))
  }, [])

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
      // GitHub alone: `accounts.status()` also runs `claude auth status`, which
      // this click has no use for and which it then waited on.
      const result = await window.octopus.accounts.github()
      // A failed check and a signed-out account are one case here. `gh` missing,
      // `gh` signed out and a reply that does not parse all arrive as
      // `connected: false`, and Settings is where every one of them is fixed.
      if (result.ok && result.value.connected) setPickingRepository(true)
      else setSettingsSection('git')
    } finally {
      setCheckingGitHub(false)
    }
  }, [])

  // ⌘⇧N creates a workspace, ⌘⇧D opens the changes, ⌘T opens a conversation.
  // ⌘1–⌘9 switch project, as they do between tabs everywhere else; ⌃1–⌃9 move
  // within the current project's workspaces, and ⌥1–⌥3 between the selected
  // workspace's conversations.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey && !event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        if (chatTabs.canCreate) void chatTabs.create()
        return
      }

      /*
       * Read from `code` rather than `key`, unlike every branch below it.
       *
       * On macOS ⌥ rewrites the character: Option-1 arrives as `¡`, Option-2 as
       * `™`, Option-3 as `£`. `Number.parseInt` on those is `NaN`, so the digit
       * check further down returns before this could ever run — and `code` is
       * the physical key, which is also what makes this work on a layout where
       * the digits are somewhere else.
       */
      if (event.altKey && !event.metaKey && !event.ctrlKey) {
        const position = ['Digit1', 'Digit2', 'Digit3'].indexOf(event.code)
        const tab = position === -1 ? undefined : chatTabs.tabs[position]
        if (tab) {
          event.preventDefault()
          chatTabs.select(tab.key)
        }
        return
      }

      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        if (selectedProjectId !== null) void workspaces.create(selectedProjectId)
        return
      }

      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        // Unfolds as well as selects. A shortcut for the changes that does
        // nothing while the pane is folded away does nothing in the one place
        // it would save the most. It does not fold the pane shut again either:
        // this names a tab, not a pane.
        setRightPanelOpen(true)
        void updateConfig({ rightPanelTab: 'diff' })
        return
      }

      // The twin of the one above, and the shortcut §10.8 has listed since
      // before there was a tab to give it. A listed shortcut that does nothing
      // is read once, tried once, and takes the rest of the table with it.
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault()
        setRightPanelOpen(true)
        void updateConfig({ rightPanelTab: 'pullRequest' })
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
  }, [selectedProjectId, workspaces, projects, updateConfig, chatTabs])

  const selectedProject = projects.all.find((project) => project.id === selectedProjectId) ?? null
  const projectWorkspaces = selectedProject
    ? (workspaces.byProject.get(selectedProject.id) ?? [])
    : []
  const selectedWorkspace =
    workspaces.flat.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const editingProject = projects.all.find((project) => project.id === editingProjectId) ?? null

  // Read once and used twice: the list draws itself this wide, and the right
  // pane reserves it when working out how wide it may grow. Two reads of the
  // same config field would be one refactor away from disagreeing, and the
  // disagreement would show up as a centre pane with nowhere to go.
  const sidebarWidth = config?.sidebarWidth ?? DEFAULT_SIDEBAR_WIDTH

  // Read twice: the right pane hands it to the scripts, and the hint they
  // draw when there is none sends the user to edit that same project.
  const openProjectId = selectedProject?.id ?? null

  // What a conversation with no record of its own starts with. Read here
  // rather than in the chat: this is where the config lives, and the composer's
  // footer has to name what the record will actually be created with. The
  // schema's own defaults stand in until the file has been read.
  const defaultWorkingMode = config?.workingMode ?? 'default'
  const defaultEffort = config?.effort ?? DEFAULT_EFFORT
  const defaultModel = config?.model ?? null
  const defaultPlanModel = config?.planModel ?? null

  return (
    <div className="bg-canvas text-ink flex h-full flex-col">
      {/* One strip across the window rather than one per pane. The traffic
          lights sit at its left, and nothing behind them belongs to a project:
          a pane's colour reaching up here made the window look like it started
          in the wrong place. */}
      <header className="titlebar-drag border-line flex h-11 shrink-0 items-center gap-3 border-b pr-3 pl-[5.5rem]">
        <span className="shrink-0 truncate font-medium">
          {selectedProject?.name ?? t('app.name')}
        </span>
        {selectedProject && (
          <span className="text-ink-faint min-w-0 truncate font-mono text-[11px]">
            {selectedProject.repoPath}
          </span>
        )}

        {/* The branch, beside the path it is a branch of.
            It used to sit in the chat's own header, which was a whole 36px row
            carrying one short string — and it was answering a question about
            the window rather than about the conversation: where the work lands.
            Here it reads as one line with the project and its directory, and
            the row it left is the tab strip's. */}
        {selectedWorkspace && (
          <span className="text-ink-soft flex min-w-0 shrink-0 items-center gap-1.5">
            <GitBranch aria-hidden size={12} className="shrink-0" />
            <span className="truncate font-mono text-[11px]">{selectedWorkspace.branch}</span>
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
                workspaces={projectWorkspaces}
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
                width={sidebarWidth}
                onWidthChange={(next) => void updateConfig({ sidebarWidth: next })}
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
          ) : !selectedWorkspace ? (
            /* Decided here rather than inside the chat, because the way out of
               this state is to make a workspace — and the chat has no business
               knowing how. It used to render its own text with no action at
               all, which read as an instruction to pick from a list that was
               empty. */
            <WorkspacePane
              hasWorkspaces={projectWorkspaces.length > 0}
              onCreate={() => void workspaces.create(selectedProject.id)}
            />
          ) : (
            <Chat
              /* Keyed, so switching workspace builds the panes fresh rather
                 than handing one workspace's conversation to another's tab
                 keys — which is what lets everything inside drop the "is this
                 still on screen" checks a shared instance needed. */
              key={selectedWorkspace.id}
              workspace={selectedWorkspace}
              tabs={chatTabs}
              draftOf={(tabKey) => drafts.get(`${selectedWorkspace.id}#${tabKey}`) ?? ''}
              onDraftLeave={(tabKey, text) => {
                keepDraft(selectedWorkspace.id, tabKey, text)
              }}
              color={selectedProject.color}
              comments={diffComments}
              defaultWorkingMode={defaultWorkingMode}
              defaultEffort={defaultEffort}
              defaultModel={defaultModel}
              defaultPlanModel={defaultPlanModel}
            />
          )}
        </main>

        {rightPanelOpen && (
          <RightPanel
            workspaces={workspaces.flat}
            activeWorkspaceId={selectedWorkspaceId}
            color={selectedProject?.color ?? null}
            projectId={openProjectId}
            scriptPaths={scriptPaths}
            // No guard: the scripts belong to the open project, so the hint
            // that calls this exists only while there is one. With none, this
            // is asked to edit nothing, which is what closing means.
            onEditScripts={() => {
              setEditingProjectId(openProjectId)
              setEditingProjectSection('scripts')
            }}
            onEditFiles={() => {
              setEditingProjectId(openProjectId)
              setEditingProjectSection('files')
            }}
            // The instruction the pull request tab would send is the project's,
            // so the tab opens the place it is written rather than carrying a
            // second editor of its own.
            onEditInstructions={() => {
              setEditingProjectId(openProjectId)
              setEditingProjectSection('instructions')
            }}
            chatId={activeChatId}
            width={config?.rightPanelWidth ?? 360}
            onWidthChange={(rightPanelWidth) => void updateConfig({ rightPanelWidth })}
            diffView={config?.diffView ?? 'unified'}
            onDiffView={(diffView) => void updateConfig({ diffView })}
            tab={config?.rightPanelTab ?? 'diff'}
            onTab={(rightPanelTab) => void updateConfig({ rightPanelTab })}
            comments={diffComments}
            onError={setError}
            // The room the pane must leave alone. Folded away, the list takes
            // none of it — and the pane may have that room too.
            rootPath={selectedProject?.repoPath ?? ''}
            leftWidth={TAB_STRIP_WIDTH + (sidebarOpen ? sidebarWidth : 0)}
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
          initialSection={editingProjectSection}
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
interface WorkspacePaneProps {
  /** Whether there is anything to select, or only something to create. */
  readonly hasWorkspaces: boolean
  readonly onCreate: () => void
}

/**
 * A project is open and the centre still has nothing to show.
 *
 * Two situations wearing one face until now: a project whose workspaces exist
 * but none is selected, and a project that has none at all. The second was told
 * to "select a workspace" from a list with nothing in it, and offered no way to
 * make one — the button that does lives in the sidebar's project header, which
 * is exactly where someone who has just added a repository is not looking.
 */
function WorkspacePane({ hasWorkspaces, onCreate }: WorkspacePaneProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Placeholder
      title={hasWorkspaces ? t('center.noWorkspaceTitle') : t('center.firstWorkspaceTitle')}
      actions={
        // Accent only when there is nothing to choose instead: with workspaces
        // in the sidebar, picking one is the likelier intent and a filled
        // button here would compete with the list.
        <Button variant={hasWorkspaces ? 'quiet' : 'accent'} onClick={onCreate}>
          <Plus aria-hidden size={13} />
          {t('workspaces.create')}
        </Button>
      }
    >
      {hasWorkspaces ? t('center.noWorkspaceBody') : t('center.firstWorkspaceBody')}
    </Placeholder>
  )
}

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
