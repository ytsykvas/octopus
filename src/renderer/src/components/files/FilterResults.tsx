import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import type { TreeNode, TreeStatus } from '@core/fileTree.js'

import { Placeholder } from '../Placeholder.js'
import { EntryLabel } from './EntryLabel.js'
import { FileIcon } from './FileIcon.js'

interface FilterResultsProps {
  /** The listbox's id, which the field names in `aria-controls`; each match's is this and its place. */
  readonly id: string
  readonly query: string
  readonly matches: readonly TreeNode[]
  /** More files answered than the list holds. */
  readonly capped: boolean
  /** The match the arrows are on, which Enter opens. */
  readonly chosen: number
  readonly activePath: string | null
  readonly statuses: Readonly<Record<string, TreeStatus>>
  readonly onChoose: (path: string) => void
  readonly onOpen: (path: string, pinned: boolean) => void
}

/** A match's id, for the field's `aria-activedescendant`. */
export function matchId(list: string, place: number): string {
  return `${list}-${String(place)}`
}

/**
 * The files answering the filter, flat and best first, in place of the tree.
 *
 * Flat because the question was "where is it", and an answer folded into
 * folders makes the reader open them to find out. Each row says its folder
 * beside its name, and keeps the marks the tree would give it. The field above
 * keeps focus — it is a combobox and this its listbox — so typing never stops
 * to move into the list.
 */
export function FilterResults({
  id,
  query,
  matches,
  capped,
  chosen,
  activePath,
  statuses,
  onChoose,
  onOpen
}: FilterResultsProps): React.JSX.Element {
  const { t } = useTranslation()
  const list = useRef<HTMLDivElement | null>(null)

  // The arrows walk the whole list, two hundred long at most, and Enter opens
  // what they are on — so it has to be in view, as in every other list here.
  useEffect(() => {
    list.current?.children[chosen]?.scrollIntoView({ block: 'nearest' })
  }, [chosen, matches])

  if (matches.length === 0) {
    return (
      <Placeholder compact title={t('files.noMatchTitle')}>
        {t('files.noMatchBody', { query: query.trim() })}
      </Placeholder>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto py-1">
      <div ref={list} id={id} role="listbox" aria-label={t('files.matches')}>
        {matches.map((node, place) => (
          <div
            key={node.path}
            id={matchId(id, place)}
            role="option"
            aria-selected={place === chosen}
            title={node.path}
            // Not `onMouseEnter`: a list scrolling under a still pointer must
            // not take the choice away from the arrows.
            onMouseMove={() => {
              onChoose(node.path)
            }}
            onClick={() => {
              onOpen(node.path, false)
            }}
            onDoubleClick={() => {
              onOpen(node.path, true)
            }}
            className={`row flex h-[22px] cursor-default items-center gap-1.5 px-3 text-[12px] select-none ${
              place === chosen ? 'bg-muted' : ''
            } ${node.path === activePath ? 'row-selected' : ''}`}
          >
            <FileIcon name={node.name} path={node.path} kind="file" expanded={false} />
            <EntryLabel
              node={node}
              status={statuses[node.path]}
              detail={
                <span className="text-ink-faint min-w-0 flex-1 truncate text-[11px]">
                  {node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : ''}
                </span>
              }
            />
          </div>
        ))}
      </div>
      {capped && (
        <p className="text-ink-faint px-3 py-1.5 text-[11px]">
          {t('files.matchesCapped', { limit: matches.length })}
        </p>
      )}
    </div>
  )
}
