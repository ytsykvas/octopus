import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { WorkspaceView } from '@core/workspaces.js'

import { Terminal } from './Terminal.js'

interface WorkspaceTerminalsProps {
  readonly workspaces: readonly WorkspaceView[]
  /** Workspace whose terminal is on screen; null when none is selected. */
  readonly activeId: string | null
  /**
   * Whether the terminal tab is the one being shown.
   *
   * A session starts when its tab is looked at, and outlives the tab being
   * hidden. Without the distinction, switching workspace while reading the
   * diff would spawn shells nobody asked for.
   */
  readonly visible: boolean
}

/**
 * One live terminal per workspace.
 *
 * A terminal is mounted the first time its workspace is opened and then stays
 * mounted — switching workspace or tab hides it rather than closing it.
 * `Terminal` ties its session to mounting, so unmounting would kill whatever is
 * running: a dev server, a watch, a half-typed command.
 *
 * The cost is deliberate: every workspace visited this session holds a shell
 * until the app quits. That is what buys the state being there on return.
 */
export function WorkspaceTerminals({
  workspaces,
  activeId,
  visible
}: WorkspaceTerminalsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [openedIds, setOpenedIds] = useState<readonly string[]>([])
  const [lastActiveId, setLastActiveId] = useState<string | null>(null)

  // Adjusted during render rather than in an effect. React supports this for
  // state derived from a prop, and it matters here: an effect would run after
  // the paint, so opening a workspace would show an empty pane for one frame
  // before its terminal appeared.
  if (visible && activeId !== lastActiveId) {
    setLastActiveId(activeId)
    if (activeId !== null && !openedIds.includes(activeId)) {
      setOpenedIds([...openedIds, activeId])
    }
  }

  // A workspace that is gone takes its terminal with it: dropping it here
  // unmounts the component, whose cleanup kills the session. Missing ones go
  // too — their directory no longer exists, so the shell has nowhere to be.
  const opened = openedIds
    .map((id) => workspaces.find((workspace) => workspace.id === id))
    .filter(
      (workspace): workspace is WorkspaceView => workspace !== undefined && !workspace.missing
    )

  return (
    <div className="relative flex-1">
      {/* Shown over the terminals rather than instead of them. Returning a
          different element here would unmount every session — and clicking the
          already-active project clears the selection, so a stray click used to
          kill a dev server. */}
      {activeId === null && (
        <p className="text-ink-faint p-4 leading-relaxed">{t('panel.terminalPlaceholder')}</p>
      )}

      {opened.map((workspace) => (
        <div
          key={workspace.id}
          // Hidden with `visibility`, never `display: none`: a display-hidden
          // element measures zero, so FitAddon would size the terminal to no
          // columns at all and the session would come back mangled.
          className={`absolute inset-0 ${workspace.id === activeId ? '' : 'invisible'}`}
        >
          <Terminal cwd={workspace.path} />
        </div>
      ))}
    </div>
  )
}
