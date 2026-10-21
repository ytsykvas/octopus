import { ChevronsDownUp, Copy, LocateFixed, Paperclip, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  MAX_DIRECTORY_ENTRIES,
  MAX_TREE_ENTRIES,
  type TreeIndex,
  type TreeNode,
  type TreeStatus
} from '@core/fileTree.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { type CopyState, useCopy } from '../../hooks/useCopy.js'
import { useFileFilter } from '../../hooks/useFileFilter.js'
import { useFileTree } from '../../hooks/useFileTree.js'
import { DisclosureChevron } from '../Disclosure.js'
import { DropdownMenu, type MenuAction } from '../DropdownMenu.js'
import { IconButton, Notice } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { FileIcon } from './FileIcon.js'
import { EntryLabel } from './EntryLabel.js'
import { FilterResults, matchId } from './FilterResults.js'
import { revealPath, type TreeRow, visibleRows } from './treeRows.js'

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
  /** A row's absolute path, for the conversation in front to carry as an attachment. */
  readonly onAttach: (path: string) => void
}

const NONE: ReadonlySet<string> = new Set()

/**
 * Where to scroll for a row to be in view, moving no further than that — as a
 * list moved by keys does.
 */
function scrollFor(position: number, current: number, height: number): number {
  const top = PADDING + position * ROW_HEIGHT
  if (top < current) return top - PADDING
  if (top + ROW_HEIGHT > current + height) return top + ROW_HEIGHT + PADDING - height
  return current
}

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
      root={workspace.path}
      expanded={expandedBy[id] ?? NONE}
      onExpanded={(change) => {
        setExpandedBy((current) => ({ ...current, [id]: change(current[id] ?? NONE) }))
      }}
    />
  )
}

interface WorkspaceTreeProps extends Omit<FilesPanelProps, 'workspace'> {
  readonly workspaceId: string
  /** The worktree, which a workspace-relative path is relative to. */
  readonly root: string
  readonly expanded: ReadonlySet<string>
  /** A change rather than a value, so two toggles in one frame both land. */
  readonly onExpanded: (change: (current: ReadonlySet<string>) => ReadonlySet<string>) => void
}

function WorkspaceTree({
  workspaceId,
  root,
  visible,
  activePath,
  onOpen,
  onAttach,
  expanded,
  onExpanded
}: WorkspaceTreeProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const tree = useFileTree(workspaceId, visible, expanded)
  const clipboard = useCopy()

  // `/` rather than `path.join`, which the window has no `node:path` for: the
  // root comes from `path.join` itself, so it carries no trailing separator.
  const absolute = (path: string): string => `${root}/${path}`

  const menuFor = (path: string): MenuAction[] => [
    {
      id: 'copyPath',
      label: t('files.copyPath'),
      icon: <Copy aria-hidden size={13} />,
      onSelect: () => {
        void clipboard.copy(absolute(path))
      }
    },
    {
      id: 'copyRelativePath',
      label: t('files.copyRelativePath'),
      icon: <Copy aria-hidden size={13} />,
      onSelect: () => {
        void clipboard.copy(path)
      }
    },
    {
      id: 'addToChat',
      label: t('files.addToChat'),
      icon: <Paperclip aria-hidden size={13} />,
      onSelect: () => {
        onAttach(absolute(path))
      }
    }
  ]

  const [focus, setFocus] = useState<string | null>(null)

  const filter = useFileFilter(tree.index)
  const listId = useId()

  /*
   * The file "Show the open file" is waiting to draw. Its folders are opened at
   * the click, but a folder read from disk lays its rows in only once its
   * listing arrives, so the scroll waits for the row rather than for the click.
   */
  const [revealing, setRevealing] = useState<string | null>(null)
  // The row to bring into view, as an object so asking for the same row twice
  // still moves a tree scrolled away in between.
  const [scrollRequest, setScrollRequest] = useState<{ readonly position: number } | null>(null)

  const scroller = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  // A scroller mounted afresh — after a notice stood in for it — starts at the
  // top, and the slice drawn has to start there with it.
  // Measured here too: the filter's list stands in for the tree, and a tree
  // back from under it would otherwise draw at the height it had before.
  const [height, setHeight] = useState(0)
  const attach = useCallback((element: HTMLDivElement | null) => {
    scroller.current = element
    if (element !== null) {
      setScrollTop(element.scrollTop)
      setHeight(element.clientHeight)
    }
  }, [])
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

  /*
   * A reveal ends when its row is drawn, or when it can no longer be: nothing it
   * opened is still being read, another file came to the centre, or the tab was
   * put away. Left armed, a row that turned up later — a re-read after a turn —
   * would have moved the tree long after the click.
   */
  if (revealing !== null) {
    const position = rows.findIndex((row) => row.type === 'node' && row.node.path === revealing)
    const reading =
      tree.index !== null &&
      revealPath(tree.index, revealing).fromDisk.some((folder) => {
        const status = tree.listings.get(folder)?.status
        return status === undefined || status === 'loading'
      })
    if (position !== -1) {
      setRevealing(null)
      setScrollRequest({ position })
    } else if (!reading || revealing !== activePath || !visible) {
      setRevealing(null)
    }
  }

  const showOpenFile = (path: string, index: TreeIndex): void => {
    const { open, fromDisk } = revealPath(index, path)
    for (const folder of fromDisk) if (!tree.listings.has(folder)) tree.openFolder(folder)
    onExpanded((current) => new Set([...current, ...open]))
    filter.clear()
    setFocus(path)
    setRevealing(path)
  }

  const toggle = (node: TreeNode): void => {
    setRevealing(null)
    const opening = !expanded.has(node.path)
    // The contents of a folder git names whole — ignored, a submodule, a nested
    // repository — come from disk, asked for the first time it is opened;
    // after that a refresh keeps them current.
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
    const next = scrollFor(position, element.scrollTop, height)
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
    setRevealing(null)
    const at = located === undefined ? -1 : nodeRows.indexOf(located)
    const current = located?.row

    /*
     * An editor's explorer's keys: ⌥⌘C the whole path, with ⇧ the relative one.
     * Read from `code`: ⌥ turns the `c` into `ç` on macOS, as it does the
     * digits `App` reads the same way.
     */
    if (event.metaKey && event.altKey && !event.ctrlKey && event.code === 'KeyC') {
      if (current === undefined) return
      event.preventDefault()
      void clipboard.copy(event.shiftKey ? current.node.path : absolute(current.node.path))
      return
    }
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

  // An effect rather than a write during render: the tree may only just have
  // mounted — back from under the filter — and the hooks' rules keep the DOM out
  // of render. Measured from the element as it is now, and focused, so the
  // arrows go on from the row the reveal found. After every other write to the
  // scroller, which those rules ask of an effect that writes to it too.
  useEffect(() => {
    const element = scroller.current
    if (scrollRequest === null || element === null) return
    element.scrollTop = scrollFor(scrollRequest.position, element.scrollTop, element.clientHeight)
    element.focus({ preventScroll: true })
  }, [scrollRequest])

  if (tree.error !== null) return <Notice tone="danger">{tree.error}</Notice>
  const index = tree.index
  if (index === null) return <Notice>{t('files.loading')}</Notice>

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const listed = (filter.matches?.length ?? 0) > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-line flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <input
          type="search"
          value={filter.query}
          placeholder={t('files.filter')}
          aria-label={t('files.filter')}
          role="combobox"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={filter.chosen === -1 ? undefined : matchId(listId, filter.chosen)}
          spellCheck={false}
          onChange={(event) => {
            filter.setQuery(event.target.value)
          }}
          onKeyDown={(event) => {
            filter.onKeyDown(event, onOpen)
          }}
          className="input focus-ring h-6 min-w-0 flex-1 text-[12px]"
        />
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={t('files.reveal')}
            disabled={activePath === null}
            onClick={
              activePath === null
                ? undefined
                : () => {
                    showOpenFile(activePath, index)
                  }
            }
          >
            <LocateFixed aria-hidden size={13} />
          </IconButton>
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

      <CopyOutcome state={clipboard.state} />

      {tree.truncated && (
        <p className="text-ink-faint border-line shrink-0 border-b px-3 py-1.5 text-[11px]">
          {t('files.truncated', { limit: MAX_TREE_ENTRIES.toLocaleString(i18n.language) })}
        </p>
      )}

      {filter.matches !== null ? (
        <FilterResults
          id={listId}
          query={filter.query}
          matches={filter.matches}
          capped={filter.capped}
          chosen={filter.chosen}
          activePath={activePath}
          statuses={tree.statuses}
          onChoose={filter.choose}
          onOpen={onOpen}
        />
      ) : rows.length === 0 ? (
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
            // Scrolled by hand while a reveal waited: the reader has moved on.
            setRevealing(null)
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
                menu={menuFor(row.node.path)}
                onContextMenu={() => {
                  setFocus(row.node.path)
                }}
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
  truncated: 'files.folderTruncated',
  empty: 'files.folderEmpty'
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
  /** What a right-click on the row offers. */
  readonly menu: readonly MenuAction[]
  readonly onContextMenu: () => void
  readonly onClick: () => void
  readonly onDoubleClick: () => void
}

function Row({
  row,
  status,
  active,
  focused,
  menu,
  onContextMenu,
  onClick,
  onDoubleClick
}: RowProps): React.JSX.Element {
  const { node, level, expanded } = row
  const directory = node.kind === 'directory'

  return (
    <DropdownMenu
      align="left"
      actions={menu}
      // The right button only, as on a project's tab: the left one opens.
      trigger={({ onClick: openMenu }) => (
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
          onContextMenu={(event) => {
            event.preventDefault()
            onContextMenu()
            openMenu(event)
          }}
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
          <EntryLabel node={node} status={status} />
        </div>
      )}
    />
  )
}

/**
 * What the last copy did, said in the toolbar's place under it — the menu that
 * asked has closed, and a shortcut has nothing of its own to show it on.
 *
 * Always mounted, so a reader is told when the words appear: a live region
 * that arrives with its text is one some screen readers never announce.
 */
function CopyOutcome({ state }: { readonly state: CopyState }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <p
      role="status"
      className={`shrink-0 px-3 text-[11px] ${state === 'failed' ? 'text-danger' : 'text-ink-faint'} ${
        state === 'idle' ? 'sr-only' : 'border-line border-b py-1.5'
      }`}
    >
      {state === 'done' && t('files.pathCopied')}
      {state === 'failed' && t('files.copyFailed')}
    </p>
  )
}
