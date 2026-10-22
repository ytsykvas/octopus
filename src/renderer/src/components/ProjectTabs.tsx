import { CloudDownload, FolderOpen, Pencil, Puzzle, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { initials } from '@core/initials.js'
import type { Project } from '@core/store.js'

import type { Mark } from '../attention.js'
import { DONE_TONE } from './agentStatus.js'

import { AddTile } from './AddTile.js'
import { DropdownMenu } from './DropdownMenu.js'
import { LETTERS, TILE_WASH } from './projectTint.js'
import { ProjectGlyph } from './ProjectGlyph.js'

interface ProjectTabsProps {
  readonly projects: readonly Project[]
  readonly activeProjectId: string | null
  /** What each project's agents want of the user; a project absent here wants nothing. */
  readonly marks: ReadonlyMap<string, Mark>
  readonly onSelect: (projectId: string) => void
  readonly onEdit: (projectId: string) => void
  readonly onRemove: (projectId: string) => void
  /** Every project id in the order the user dragged them into. */
  readonly onReorder: (orderedIds: readonly string[]) => void
  readonly onAddFromDisk: () => void
  readonly onAddFromGitHub: () => void
  readonly busy: boolean
  /** Whether the plugins window is open, which the foot's tile shows. */
  readonly pluginsOpen: boolean
  /** An installed plugin reports that it would not load. */
  readonly pluginTrouble: boolean
  readonly onOpenPlugins: () => void
}

/**
 * Projects as a vertical tab strip, in the manner of browser tabs.
 *
 * Switching project and moving around inside one used to be the same list,
 * where a click both selected and folded. Splitting them means the strip
 * answers "which project" and the sidebar answers "which workspace", and
 * neither has to grow past the height of the window.
 *
 * A tab is a colour and either two letters or an icon. The letters collide
 * readily — two repositories starting the same way give the same pair — which
 * is why an icon can be chosen instead, and why the full name is a hover away
 * either way.
 */
export function ProjectTabs({
  projects,
  activeProjectId,
  marks,
  onSelect,
  onEdit,
  onRemove,
  onReorder,
  onAddFromDisk,
  onAddFromGitHub,
  busy,
  pluginsOpen,
  pluginTrouble,
  onOpenPlugins
}: ProjectTabsProps): React.JSX.Element {
  const { t } = useTranslation()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const indexOf = (id: string | null): number => projects.findIndex((project) => project.id === id)

  // Dropped on a tile, the dragged project takes that tile's place, so moving
  // down lands below it and moving up lands above it.
  const drop = (targetId: string): void => {
    const from = indexOf(draggingId)
    const to = indexOf(targetId)
    if (from !== -1 && to !== -1 && from !== to) {
      const ids = projects.map((project) => project.id)
      ids.splice(to, 0, ...ids.splice(from, 1))
      onReorder(ids)
    }
    setDraggingId(null)
    setOverId(null)
  }

  return (
    <nav className="bg-surface flex w-15 shrink-0 flex-col">
      <div className="flex flex-1 flex-col gap-1 overflow-y-auto py-2 pl-2.5">
        {projects.map((project) => (
          <ProjectTab
            key={project.id}
            project={project}
            active={project.id === activeProjectId}
            mark={marks.get(project.id) ?? null}
            dragging={project.id === draggingId}
            // Which edge the line sits on follows the direction of the move.
            dropEdge={
              project.id === overId && project.id !== draggingId
                ? indexOf(project.id) > indexOf(draggingId)
                  ? 'below'
                  : 'above'
                : null
            }
            onDragStart={() => {
              setDraggingId(project.id)
            }}
            onDragOver={() => {
              setOverId(project.id)
            }}
            onDrop={() => {
              drop(project.id)
            }}
            onDragEnd={() => {
              setDraggingId(null)
              setOverId(null)
            }}
            onSelect={() => {
              onSelect(project.id)
            }}
            onEdit={() => {
              onEdit(project.id)
            }}
            onRemove={() => {
              onRemove(project.id)
            }}
          />
        ))}

        <DropdownMenu
          align="left"
          trigger={({ onClick }) => (
            <AddTile
              title={t('sidebar.addProject')}
              disabled={busy}
              onClick={onClick}
              className="mt-1"
            />
          )}
          actions={[
            {
              id: 'disk',
              label: t('sidebar.addFromDisk'),
              description: t('sidebar.addFromDiskHint'),
              icon: <FolderOpen aria-hidden size={15} />,
              onSelect: onAddFromDisk
            },
            {
              id: 'github',
              label: t('sidebar.addFromGitHub'),
              description: t('sidebar.addFromGitHubHint'),
              icon: <CloudDownload aria-hidden size={15} />,
              onSelect: onAddFromGitHub
            }
          ]}
        />
      </div>

      {/* A foot of its own rather than the end of the list above: the list
          scrolls, and a tile at the bottom of it would ride up and down with
          the number of projects. The plugins are the agent's, not a
          project's, so they sit apart from the projects. */}
      <div className="shrink-0 py-2 pl-2.5">
        <PluginsTile open={pluginsOpen} trouble={pluginTrouble} onOpen={onOpenPlugins} />
      </div>
    </nav>
  )
}

/**
 * The way into the plugins window, the size of a project tab.
 *
 * Tinted with the accent rather than drawn in the line colour the "+" uses:
 * the "+" is an empty slot, and this is a place of its own. The piece turns a
 * few degrees under the pointer — the one motion on the rail, and gone for
 * anyone who asked for less.
 */
function PluginsTile({
  open,
  trouble,
  onOpen
}: {
  readonly open: boolean
  readonly trouble: boolean
  readonly onOpen: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onOpen}
        title={t('sidebar.plugins')}
        aria-label={t('sidebar.plugins')}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`group focus-ring text-accent bg-accent/12 hover:bg-accent/20 flex size-10 items-center justify-center rounded-[10px] transition-[background-color,box-shadow] ${
          open ? 'ring-accent/50 ring-1' : ''
        }`}
      >
        <Puzzle
          aria-hidden
          size={19}
          className="transition-transform duration-200 group-hover:-rotate-12 motion-reduce:transition-none motion-reduce:group-hover:rotate-0"
        />
      </button>

      {/* The same place and ring as a project's attention dot, so the two
          read as one signal: something here wants a look. */}
      {trouble && (
        <span
          role="img"
          aria-label={t('plugins.troubleDot')}
          className="ring-surface bg-warning pointer-events-none absolute top-[3px] left-[29px] size-2 rounded-full ring-2"
        />
      )}
    </div>
  )
}

/**
 * The dot's colour and words — the workspace list's own vocabulary
 * (`agentStatus.ts`), so a colour learnt in one place means the same here.
 */
const MARK_TONES: Record<Mark, string> = {
  waiting: 'bg-warning',
  error: 'bg-danger',
  done: DONE_TONE
}

const MARK_LABELS = {
  waiting: 'workspaces.statusWaiting',
  error: 'workspaces.statusError',
  done: 'sidebar.projectDone'
} as const

function ProjectTab({
  project,
  active,
  mark,
  dragging,
  dropEdge,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSelect,
  onEdit,
  onRemove
}: {
  project: Project
  active: boolean
  mark: Mark | null
  dragging: boolean
  /** The edge the dragged project would land against, when it is over this tab. */
  dropEdge: 'above' | 'below' | null
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
  onSelect: () => void
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => {
        // Without this the browser refuses the drop.
        event.preventDefault()
        onDragOver()
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      onDragEnd={onDragEnd}
      className={`relative ${dragging ? 'opacity-40' : ''}`}
      style={{ '--project-color': `var(--project-${project.color})` } as React.CSSProperties}
    >
      <DropdownMenu
        align="left"
        trigger={({ onClick }) => (
          <button
            type="button"
            onClick={onSelect}
            onContextMenu={(event) => {
              event.preventDefault()
              onClick(event)
            }}
            title={`${project.name} — ${project.baseBranch}`}
            aria-current={active ? 'true' : undefined}
            // The active tab runs to the right edge of the strip and squares
            // off there, so it reads as the sidebar reaching back rather than
            // as a button sitting next to it.
            className={`focus-ring flex h-10 items-center justify-center text-[14px] font-semibold transition-[background-color,color] ${
              active ? 'w-[50px] rounded-l-[10px]' : 'w-10 rounded-[10px]'
            }`}
            style={
              active
                ? {
                    // Matches the top of the sidebar's gradient exactly: the
                    // two surfaces meet with nothing between them.
                    backgroundColor: 'color-mix(in srgb, var(--project-color) 18%, var(--surface))',
                    color: LETTERS
                  }
                : {
                    backgroundColor: TILE_WASH,
                    color: LETTERS
                  }
            }
          >
            {/* An icon replaces the initials rather than joining them: 40px
                holds one or the other, and the initials are the fallback for a
                project nobody has picked a picture for. */}
            {project.icon ? <ProjectGlyph name={project.icon} size={19} /> : initials(project.name)}
          </button>
        )}
        actions={[
          {
            id: 'edit',
            label: t('sidebar.editProject'),
            icon: <Pencil aria-hidden size={13} />,
            onSelect: onEdit
          },
          {
            id: 'remove',
            label: t('sidebar.removeProject'),
            icon: <Trash2 aria-hidden size={13} />,
            destructive: true,
            onSelect: onRemove
          }
        ]}
      />

      {/* Inside the tile's square, not hanging off its corner: the column
          scrolls, and anything past its edge is cut. A sibling of the button
          rather than part of its name, so the tab is still called by its
          letters. The ring is the strip's own colour, cutting the dot out of
          the tile. */}
      {dropEdge !== null && (
        <span
          data-testid="drop-line"
          aria-hidden
          className={`bg-accent pointer-events-none absolute right-0 left-0 h-0.5 rounded-full ${
            dropEdge === 'above' ? '-top-[3px]' : '-bottom-[3px]'
          }`}
        />
      )}

      {mark !== null && (
        <span
          role="img"
          aria-label={t(MARK_LABELS[mark])}
          className={`ring-surface pointer-events-none absolute top-[3px] left-[29px] size-2 rounded-full ring-2 ${MARK_TONES[mark]}`}
        />
      )}
    </div>
  )
}
