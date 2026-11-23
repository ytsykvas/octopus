import { GitMerge } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { WORKSPACE_MOODS, workspaceMood } from '../agentStatus.js'
import { RequestMark } from '../RequestMark.js'
import { StatusMark } from '../WorkspaceRow.js'
import type { CardMark } from './boardRuns.js'

export function CardMarks({ mark }: { readonly mark: CardMark }): React.JSX.Element {
  const { t } = useTranslation()
  switch (mark.kind) {
    case 'live': {
      const mood = workspaceMood(mark.workspace)
      return (
        <span className="flex items-center gap-1">
          <StatusMark workspace={mark.workspace} />
          <span className={WORKSPACE_MOODS[mood].text}>{t(WORKSPACE_MOODS[mood].line)}</span>
          <RequestMark request={mark.request} />
        </span>
      )
    }
    case 'elsewhere':
      return <span>{t('board.marks.elsewhere', { machine: mark.machine })}</span>
    case 'merged':
      return (
        <span className="text-success flex items-center gap-1">
          <GitMerge aria-hidden size={11} />
          {t('board.marks.merged')}
        </span>
      )
    case 'removed':
      return <span>{t('board.marks.removed')}</span>
  }
}
