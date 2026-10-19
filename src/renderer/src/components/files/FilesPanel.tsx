import { ChevronsDownUp, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MAX_DIRECTORY_ENTRIES,
  MAX_TREE_ENTRIES,
  type TreeNode,
  type TreeStatus
} from '@core/fileTree.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { useFileTree } from '../../hooks/useFileTree.js'
import { DisclosureChevron } from '../Disclosure.js'
import { IconButton, Notice } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { TREE_STATUS_MARKS } from '../statusMarks.js'
import { FileIcon } from './FileIcon.js'
import { type TreeRow, visibleRows } from './treeRows.js'

/**
 * The height of a row, fixed so the tree can draw only what is on screen.
 *
 * A folder like `node_modules/.pnpm` opens onto thousands of rows, and drawing
 * every one of them is what turns a click into a pause. With one height the
 * rows in view are a slice of an array, and the space above and below them is
 * a single spacer each.
 */
export const ROW_HEIGHT = 22

/** Rows drawn beyond the edges of the view, so a fast scroll does not show gaps. */
const OVERSCAN = 20

/** The tree's own padding above the first row (`py-1`), which a scroll has to count. */
const PADDING = 4

/** Indent per level, and the gutter before the first. */
const INDENT = 12
const GUTTER = 8

interface FilesPanelProps {
  readonly workspace: WorkspaceView | null
  readonly visible: boolean
  /** The file tab in front of the centre, marked in the tree; null when a chat is. */
  readonly activePath: string | null
  /** A file was chosen: once for a preview, twice — or with Enter — to keep it open. */
  readonly onOpen: (path: string, pinned: boolean) => void
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The right pane's Files tab: the worktree as an editor's explorer draws it,
 * with git's marks.
 *
 * Kept mounted while hidden, like every tab of the pane, so which folders were
 * open and where the tree was scrolled survive a look at another tab. The
 * folders are remembered per workspace for the same reason.
 *
 * A `tree` with `aria-activedescendant` rather than a roving tabindex: the rows
 * are virtualised, so the one with focus may not exist in the DOM, and focus
 * that lives on the tree itself cannot be lost when a row is recycled.
 */
export function FilesPanel({ workspace, ...rest }: FilesPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  // Held out here so it outlives the tree below, which goes while no
  // workspace is chosen.
  const [expandedBy, setExpandedBy] = useState<Readonly<Record<string, ReadonlySet<string>>>>({})

  if (workspace === null) {
    return (
      <Placeholder compact title={t('files.noWorkspaceTitle')}>
        {t('files.noWorkspaceBody')}
      </Placeholder>
    )
  }

  const id = workspace.id
  return (
    <WorkspaceTree
      // Keyed, so another workspace's tree starts at the top with nothing
      // focused, rather than inheriting a scroll offset from a longer one.
      key={id}
      {...rest}
      workspaceId={id}
      expanded={expandedBy[id] ?? NONE}
      onExpanded={(change) => {
        setExpandedBy((current) => ({ ...current, [id]: change(current[id] ?? NONE) }))
      }}
    />
  )
}

interface WorkspaceTreeProps extends Omit<FilesPanelProps, 'workspace'> {
  readonly workspaceId: string
  readonly expanded: ReadonlySet<string>
  /** A change rather than a value, so two toggles in one frame both land. */
  readonly onExpanded: (change: (current: ReadonlySet<string>) => ReadonlySet<string>) => void
}

function WorkspaceTree({
  workspaceId,
  visible,
  activePath,
  onOpen,
  expanded,
  onExpanded
}: WorkspaceTreeProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const tree = useFileTree(workspaceId, visible, expanded)

  const [focus, setFocus] = useState<string | null>(null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  // A scroller mounted afresh — after a notice stood in for it — starts at the
  // top, and the slice drawn has to start there with it.
  const attach = useCallback((element: HTMLDivElement | null) => {
    scroller.current = element
    if (element !== null) setScrollTop(element.scrollTop)
  }, [])
  const [height, setHeight] = useState(0)

  // Measured when the tab is shown and when the window resizes — the only two
  // things that change how tall the pane is. A hidden element measures zero.
  useEffect(() => {
    const measure = (): void => {
      setHeight(scroller.current?.clientHeight ?? 0)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('resize', measure)
    }
  }, [visible, tree.index])

  const rows = useMemo(
    () => (tree.index === null ? [] : visibleRows(tree.index, expanded, tree.listings)),
    [tree.index, expanded, tree.listings]
  )

  const toggle = (node: TreeNode): void => {
    const opening = !expanded.has(node.path)
    // An ignored folder's contents, or a submodule's, come from disk, asked for
    // the first time it is opened; after that a refresh keeps them current.
    if (opening && node.childrenFromDisk && !tree.listings.has(node.path))
      tree.openFolder(node.path)

    onExpanded((current) => {
      const next = new Set(current)
      if (opening) next.add(node.path)
      else next.delete(node.path)
      return next
    })
  }

  /** Scrolls just far enough to show a row, as a list moved by keys does. */
  const reveal = (position: number): void => {
    const element = scroller.current
    /* v8 ignore next */
    if (!element) return
    const top = PADDING + position * ROW_HEIGHT
    const next =
      top < element.scrollTop
        ? top - PADDING
        : top + ROW_HEIGHT > element.scrollTop + height
          ? top + ROW_HEIGHT + PADDING - height
          : element.scrollTop
    element.scrollTop = next
    setScrollTop(next)
  }

  const nodeRows = rows.flatMap((row, position) => (row.type === 'node' ? [{ row, position }] : []))
  type Located = (typeof nodeRows)[number]

  /*
   * The focused row, or the nearest folder above it still drawn: collapsing a
   * folder hides the row inside it that had focus, and focus then sits on the
   * folder — where an editor's tree puts it — rather than starting over.
   */
  const located = ((): Located | undefined => {
    for (let path = focus; path !== null;) {
      const at = path
      const found = nodeRows.find(({ row }) => row.node.path === at)
      if (found !== undefined) return found
      path = at.includes('/') ? at.slice(0, at.lastIndexOf('/')) : null
    }
    return undefined
  })()
  const focused = located?.row.node.path ?? null

  const move = ({ row, position }: Located): void => {
    setFocus(row.node.path)
    reveal(position)
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const at = located === undefined ? -1 : nodeRows.indexOf(located)
    const current = located?.row
    // A slice of one rather than an index, which the type admits may miss:
    // the clamp keeps it in range whenever there are rows, and none is none.
    const step = (offset: number): void => {
      const index = Math.min(nodeRows.length - 1, Math.max(0, at + offset))
      for (const target of nodeRows.slice(index, index + 1)) move(target)
    }

    switch (event.key) {
      case 'ArrowDown':
        step(at === -1 ? 0 : 1)
        break
      case 'ArrowUp':
        step(at === -1 ? 0 : -1)
        break
      case 'Home':
        step(-nodeRows.length)
        break
      case 'End':
        step(nodeRows.length)
        break
      case 'ArrowRight':
        if (current?.node.kind !== 'directory') return
        if (!current.expanded) toggle(current.node)
        else step(1)
        break
      case 'ArrowLeft': {
        if (current === undefined) return
        if (current.expanded) {
          toggle(current.node)
          break
        }
        // The nearest row above at a shallower level is the parent; at the top
        // level there is none.
        const parent = nodeRows.slice(0, at).findLast(({ row }) => row.level < current.level)
        if (parent !== undefined) move(parent)
        break
      }
      case 'Enter':
      case ' ':
        if (current === undefined) return
        if (current.node.kind === 'directory') toggle(current.node)
        else onOpen(current.node.path, event.key === 'Enter')
        break
      default:
        return
    }
    event.preventDefault()
  }

  if (tree.error !== null) return <Notice tone="danger">{tree.error}</Notice>
  if (tree.index === null) return <Notice>{t('files.loading')}</Notice>

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t('files.collapseAll')}
            onClick={() => {
              onExpanded(() => NONE)
            }}
          >
            <ChevronsDownUp aria-hidden size={13} />
          </IconButton>
          <IconButton label={t('files.refresh')} onClick={tree.refresh}>
            <RefreshCw aria-hidden size={13} />
          </IconButton>
        </div>
      </div>

      {tree.truncated && (
        <p className="text-ink-faint border-line shrink-0 border-b px-3 py-1.5 text-[11px]">
          {t('files.truncated', { limit: MAX_TREE_ENTRIES.toLocaleString(i18n.language) })}
        </p>
      )}

      {rows.length === 0 ? (
        <Placeholder compact title={t('files.emptyTitle')}>
          {t('files.emptyBody')}
        </Placeholder>
      ) : (
        <div
          ref={attach}
          role="tree"
          aria-label={t('files.tree')}
          tabIndex={0}
          aria-activedescendant={focused === null ? undefined : rowId(focused)}
          onKeyDown={onKeyDown}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop)
          }}
          className="group/tree min-h-0 flex-1 overflow-auto py-1 outline-none"
        >
          <div style={{ height: first * ROW_HEIGHT }} aria-hidden />
          {rows.slice(first, last).map((row) =>
            row.type === 'note' ? (
              <Note key={row.key} row={row} />
            ) : (
              <Row
                key={row.node.path}
                row={row}
                status={
                  row.node.kind === 'file'
                    ? tree.statuses[row.node.path]
                    : // A submodule git reports as changed is a status of its own.
                      (tree.folders[row.node.path] ?? tree.statuses[row.node.path])
                }
                active={row.node.path === activePath}
                focused={row.node.path === focused}
                onClick={() => {
                  setFocus(row.node.path)
                  if (row.node.kind === 'directory') toggle(row.node)
                  else onOpen(row.node.path, false)
                }}
                onDoubleClick={() => {
                  if (row.node.kind === 'file') onOpen(row.node.path, true)
                }}
              />
            )
          )}
          <div style={{ height: (rows.length - last) * ROW_HEIGHT }} aria-hidden />
        </div>
      )}
    </div>
  )
}

/** A row's id for `aria-activedescendant`. Paths are unique; the prefix keeps them apart from the rest of the page. */
function rowId(path: string): string {
  return `file-tree-${encodeURIComponent(path)}`
}

const NOTES = {
  loading: 'files.loadingFolder',
  failed: 'files.folderFailed',
  truncated: 'files.folderTruncated'
} as const

function Note({ row }: { readonly row: Extract<TreeRow, { type: 'note' }> }): React.JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <div
      role="none"
      style={{ height: ROW_HEIGHT, paddingLeft: GUTTER + (row.level - 1) * INDENT + 18 }}
      className={`flex items-center text-[11px] ${row.note === 'failed' ? 'text-danger' : 'text-ink-faint'}`}
    >
      {t(NOTES[row.note], { limit: MAX_DIRECTORY_ENTRIES.toLocaleString(i18n.language) })}
    </div>
  )
}

interface RowProps {
  readonly row: Extract<TreeRow, { type: 'node' }>
  readonly status: TreeStatus | undefined
  readonly active: boolean
  readonly focused: boolean
  readonly onClick: () => void
  readonly onDoubleClick: () => void
}

function Row({
  row,
  status,
  active,
  focused,
  onClick,
  onDoubleClick
}: RowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { node, level, expanded } = row
  const mark = status === undefined ? null : TREE_STATUS_MARKS[status]
  const directory = node.kind === 'directory'

  const tone = node.ignored ? 'text-ink-faint' : (mark?.tone ?? 'text-ink-soft')

  return (
    <div
      id={rowId(node.path)}
      role="treeitem"
      aria-level={level}
      aria-setsize={row.setSize}
      aria-posinset={row.position}
      aria-selected={active}
      {...(directory && { 'aria-expanded': expanded })}
      title={node.path}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{ height: ROW_HEIGHT, paddingLeft: GUTTER + (level - 1) * INDENT }}
      className={`row relative flex cursor-default items-center gap-1 pr-3 text-[12px] select-none ${
        active ? 'row-selected' : ''
      } ${focused ? 'group-focus-visible/tree:outline-accent group-focus-visible/tree:outline group-focus-visible/tree:-outline-offset-1' : ''}`}
    >
      {directory ? (
        <DisclosureChevron open={expanded} size={14} className="text-ink-faint" />
      ) : (
        <span aria-hidden className="w-3.5 shrink-0" />
      )}
      <FileIcon name={node.name} path={node.path} kind={node.kind} expanded={expanded} />
      <span
        className={`min-w-0 flex-1 truncate ${tone} ${status === 'deleted' && !directory ? 'line-through' : ''}`}
      >
        {node.name}
      </span>
      {mark !== null && !directory && (
        <span aria-hidden className={`shrink-0 font-mono text-[11px] ${mark.tone}`}>
          {t(mark.letter)}
        </span>
      )}
      {mark !== null && directory && (
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full bg-current ${mark.tone}`} />
      )}
      {/* The marks above are for the eye; this is what a reader hears. */}
      <span className="sr-only">
        {mark !== null && (directory ? `, ${t('files.changesInside')}` : `, ${t(mark.label)}`)}
        {node.ignored && `, ${t('files.ignored')}`}
      </span>
    </div>
  )
}
