import {
  AlertTriangle,
  ArrowUpFromLine,
  Check,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Info,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '../Button.js'
import type { Attention, GitHubNote, RequestStatus } from './requestStatus.js'

type Tone = 'danger' | 'warning' | 'accent' | 'success' | 'muted'

/** A status colour on its own paired ground — never the colour as a fill. */
const TONES: Record<Tone, { readonly text: string; readonly badge: string }> = {
  danger: { text: 'text-danger', badge: 'bg-danger-bg text-danger' },
  warning: { text: 'text-warning', badge: 'bg-warning-bg text-warning' },
  accent: { text: 'text-accent', badge: 'bg-accent-bg text-accent' },
  success: { text: 'text-success', badge: 'bg-success-bg text-success' },
  muted: { text: 'text-ink-faint', badge: 'bg-muted text-ink-soft' }
}

/** GitHub's reasons, in the pane's words. */
const NOTES: Record<
  GitHubNote,
  'pullRequest.mergeBlocked' | 'pullRequest.mergeBehind' | 'pullRequest.mergeUnstable'
> = {
  blocked: 'pullRequest.mergeBlocked',
  behind: 'pullRequest.mergeBehind',
  unstable: 'pullRequest.mergeUnstable'
}

interface Line {
  readonly tone: Tone
  readonly mark: React.ReactNode
  readonly text: string
}

/**
 * One thing wanting attention, as a mark, a colour and a sentence.
 *
 * The one place each kind is put into words, because two parts of the pane say
 * them: the Merge view lists them all, and the footer says the first.
 */
function useAttentionLine(): (item: Attention, base: string) => Line {
  const { t } = useTranslation()

  return (item, base) => {
    switch (item.kind) {
      case 'uncommitted':
        return {
          tone: 'warning',
          mark: <GitCommitHorizontal aria-hidden size={12} />,
          text: t('pullRequest.uncommitted')
        }
      case 'unpushed':
        return {
          tone: 'accent',
          mark: <ArrowUpFromLine aria-hidden size={12} />,
          text: t('pullRequest.unpushed', { count: item.count })
        }
      /* Said rather than left blank. A pushed branch with no count and no
         button, and nothing accounting for either, reads as the pane having
         given up — and the remedy is one command away. */
      case 'unpushedUnknown':
        return {
          tone: 'muted',
          mark: <ArrowUpFromLine aria-hidden size={12} />,
          text: t('pullRequest.unpushedUnknown')
        }
      /* Not a refusal GitHub would make — it merges over a check nobody marked
         required — so this says outright that the app is the one refusing. */
      case 'failed':
        return {
          tone: 'danger',
          mark: <X aria-hidden size={12} />,
          text: t('pullRequest.mergeChecksFailed', { count: item.count })
        }
      case 'running':
        return {
          tone: 'accent',
          mark: <span aria-hidden className="agent-arc" />,
          text: t('pullRequest.mergeChecksRunning', { count: item.count })
        }
      case 'conflict':
        return {
          tone: 'warning',
          mark: <AlertTriangle aria-hidden size={12} />,
          text: t('pullRequest.conflicting', { base })
        }
      case 'draft':
        return {
          tone: 'muted',
          mark: <GitPullRequestDraft aria-hidden size={12} />,
          text: t('pullRequest.mergeDraft')
        }
      case 'githubNote':
        return {
          tone: 'muted',
          mark: <Info aria-hidden size={12} />,
          text: t(NOTES[item.note], { base })
        }
    }
  }
}

/**
 * The footer's one line: the most pressing thing, or that nothing is.
 *
 * A request with nothing wanting attention is ready to merge — `attention`
 * holds every reason `canMerge` would refuse — so that is what an empty list
 * says.
 */
export function AttentionLine({
  item,
  base
}: {
  readonly item: Attention | undefined
  readonly base: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const lineOf = useAttentionLine()

  const line: Line =
    item === undefined
      ? {
          tone: 'success',
          mark: <Check aria-hidden size={12} />,
          text: t('pullRequest.readyToMerge', { base })
        }
      : lineOf(item, base)

  return (
    <p className="text-ink-soft flex items-start gap-1.5 text-[12px] leading-snug">
      <span className={`flex h-[1lh] shrink-0 items-center ${TONES[line.tone].text}`}>
        {line.mark}
      </span>
      <span className="min-w-0">{line.text}</span>
    </p>
  )
}

/**
 * Whether the request can be merged, said one condition to a row.
 *
 * What is wrong and what is fine side by side: "no conflicts" is worth a row
 * of its own, because a list of only problems reads, once they are fixed, as a
 * list that has stopped being drawn.
 */
export function MergeConditions({
  number,
  status,
  base,
  onClose,
  closing,
  merging
}: {
  readonly number: number
  readonly status: RequestStatus
  readonly base: string
  /** Closes the request without merging it. */
  readonly onClose: () => void
  readonly closing: boolean
  readonly merging: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const lineOf = useAttentionLine()

  if (!status.open) {
    const merged = status.state === 'merged'
    return (
      <div className="workspace-card flex items-start gap-2.5 p-3">
        <Badge tone={merged ? 'danger' : 'muted'}>
          {merged ? (
            <GitMerge aria-hidden size={12} />
          ) : (
            <GitPullRequestClosed aria-hidden size={12} />
          )}
        </Badge>
        <p className="text-ink-soft leading-relaxed">
          {/* What the footer's removal is offered for — see the footer. */}
          {merged ? t('pullRequest.mergedDone') : t('pullRequest.stateClosed', { number })}
        </p>
      </div>
    )
  }

  const rows: Line[] = status.attention.map((item) => lineOf(item, base))
  // A repository that runs nothing, or whose every job was skipped, has nothing
  // that passed to report here; the Checks view says what it has, once.
  if (!status.waiting && status.passed > 0) {
    rows.push({
      tone: 'success',
      mark: <Check aria-hidden size={12} />,
      text: t('pullRequest.checksPassedAll')
    })
  }
  if (!status.conflicting) {
    rows.push({
      tone: 'success',
      mark: <Check aria-hidden size={12} />,
      text: t('pullRequest.noConflicts', { base })
    })
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <ul className="workspace-card divide-line w-full divide-y">
        {rows.map((row) => (
          <li key={row.text} className="flex items-start gap-2.5 px-3 py-2">
            <Badge tone={row.tone}>{row.mark}</Badge>
            <span className="min-w-0 leading-relaxed">{row.text}</span>
          </li>
        ))}
      </ul>

      {/* `danger` rather than `destructive`: the merge in the footer is the
          press that should win the eye. Nothing asks twice — merging does not
          either, and closing is the more reversible of the two, since GitHub
          reopens. */}
      <Button size="sm" variant="danger" onClick={onClose} disabled={closing || merging}>
        {t(closing ? 'pullRequest.closing' : 'pullRequest.closePullRequest')}
      </Button>
    </div>
  )
}

function Badge({
  tone,
  children
}: {
  readonly tone: Tone
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <span
      className={`flex size-5 shrink-0 items-center justify-center rounded-full ${TONES[tone].badge}`}
    >
      {children}
    </span>
  )
}
