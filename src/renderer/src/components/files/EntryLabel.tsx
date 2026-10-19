import { useTranslation } from 'react-i18next'

import type { TreeNode, TreeStatus } from '@core/fileTree.js'

import { TREE_STATUS_MARKS } from '../statusMarks.js'

interface EntryLabelProps {
  readonly node: TreeNode
  readonly status: TreeStatus | undefined
  /** Drawn between the name and the mark — the filter's folder; the name then keeps its width. */
  readonly detail?: React.ReactNode
}

/**
 * An entry's name and git's mark on it, the same in the tree and in the
 * filter's list.
 *
 * One place, because the two had already drifted: a deleted file lost its
 * strike-through among the matches. The mark is for the eye and is hidden from
 * a reader, who hears the words after the name instead.
 */
export function EntryLabel({ node, status, detail }: EntryLabelProps): React.JSX.Element {
  const { t } = useTranslation()
  const mark = status === undefined ? null : TREE_STATUS_MARKS[status]
  const directory = node.kind === 'directory'

  const tone = node.ignored ? 'text-ink-faint' : (mark?.tone ?? 'text-ink-soft')
  const width = detail === undefined ? 'min-w-0 flex-1 truncate' : 'shrink-0'

  return (
    <>
      <span
        className={`${width} ${tone} ${status === 'deleted' && !directory ? 'line-through' : ''}`}
      >
        {node.name}
      </span>
      {detail}
      {mark !== null && !directory && (
        <span aria-hidden className={`shrink-0 font-mono text-[11px] ${mark.tone}`}>
          {mark.letter}
        </span>
      )}
      {mark !== null && directory && (
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full bg-current ${mark.tone}`} />
      )}
      <span className="sr-only">
        {mark !== null && (directory ? `, ${t('files.changesInside')}` : `, ${t(mark.label)}`)}
        {node.ignored && `, ${t('files.ignored')}`}
      </span>
    </>
  )
}
