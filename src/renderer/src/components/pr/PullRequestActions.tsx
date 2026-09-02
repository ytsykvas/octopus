import { GitMerge, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'
import type { MergeMethod } from '@core/pullRequests.js'
import type { MergeState, PullRequestDetail } from '@core/pullRequestShapes.js'

import { Button } from '../Button.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { MERGE_METHODS } from './mergeMethods.js'

/**
 * The prompts the pane can send, the conditional ones first.
 *
 * A word per row rather than a flag per condition: two booleans would allow a
 * row that is both, which is a state nothing here means, and a third condition
 * would make it three flags and eight states for four rows.
 *
 * `resolveConflicts` is not here: it appears only against a conflict, beside
 * the sentence saying there is one, where it reads as the answer to that rather
 * than as one more thing one might do.
 */
const PROMPTS: readonly {
  readonly kind: InstructionKind
  readonly labelKey:
    | 'pullRequest.fixChecks'
    | 'pullRequest.addressReview'
    | 'pullRequest.doReview'
    | 'pullRequest.multiAgentReview'
  /** What has to be true of the request before this one is worth offering. */
  readonly when: 'always' | 'failed' | 'reviewed'
}[] = [
  { kind: 'fixChecks', labelKey: 'pullRequest.fixChecks', when: 'failed' },
  { kind: 'addressReview', labelKey: 'pullRequest.addressReview', when: 'reviewed' },
  { kind: 'review', labelKey: 'pullRequest.doReview', when: 'always' },
  { kind: 'multiAgentReview', labelKey: 'pullRequest.multiAgentReview', when: 'always' }
]

/**
 * Why GitHub would not merge, where it is worth saying.
 *
 * `clean`, `hasHooks` and `unknown` say nothing: the first two are fine and the
 * third is a state GitHub is still working out, which a sentence about would
 * turn into a problem the reader cannot act on.
 */
const MERGE_NOTES: Partial<
  Record<
    MergeState,
    'pullRequest.mergeBlocked' | 'pullRequest.mergeBehind' | 'pullRequest.mergeUnstable'
  >
> = {
  blocked: 'pullRequest.mergeBlocked',
  behind: 'pullRequest.mergeBehind',
  unstable: 'pullRequest.mergeUnstable'
}

interface PullRequestActionsProps {
  readonly detail: PullRequestDetail
  readonly base: string
  /** Uncommitted work here, which is what makes committing worth offering. */
  readonly dirty: boolean
  /**
   * The env file, named only when git does not ignore it.
   *
   * octopus writes this workspace's variables into that file, so committing
   * everything would put them in the request and pushing would publish them.
   * Null is the ordinary case and says nothing.
   */
  readonly exposedEnvFile: string | null
  /**
   * Sends the project's instruction for a kind as a message in the chat, or
   * null where there is no conversation to send it to.
   *
   * Null rather than a flag beside a handler that could not run: the guard
   * inside would be one nothing can reach, and a check nothing reaches is a
   * claim nothing tests.
   */
  readonly onPrompt: ((kind: InstructionKind) => void) | null
  /** Which prompt is in flight, so its button says so rather than the row. */
  readonly sending: InstructionKind | null
  readonly onMerge: (method: MergeMethod) => void
  readonly merging: boolean
  /** Closes the request without merging it. */
  readonly onClose: () => void
  readonly closing: boolean
  readonly onCommitAndPush: () => void
  readonly committing: boolean
}

/**
 * Everything the pane can do about a request that exists.
 *
 * Each prompt sends the project's own instruction as an ordinary
 * message in the conversation — visible in the log, editable before it is ever
 * pressed, and nothing the app has written itself (§4).
 */
export function PullRequestActions({
  detail,
  base,
  dirty,
  exposedEnvFile,
  onPrompt,
  sending,
  onMerge,
  merging,
  onClose,
  closing,
  onCommitAndPush,
  committing
}: PullRequestActionsProps): React.JSX.Element {
  const { t } = useTranslation()

  const conflicting = detail.mergeable === 'conflicting'
  const note = MERGE_NOTES[detail.mergeState]

  /* Looked up rather than tested at each row: a table keyed by the same word the
     row carries cannot disagree with it, and there is no chain of conditions for
     a fourth case to be left out of. */
  const offered: Record<'always' | 'failed' | 'reviewed', boolean> = {
    always: true,
    failed: detail.checks.some((check) => check.state === 'failed'),
    reviewed: detail.decision === 'changesRequested' || hasRemarks(detail)
  }

  /* A request that is merged or closed has nothing left to do to it. The
     prompts would still run, but "review it" on a merged branch is a reading of
     history rather than of a change, and the button implies otherwise. */
  const open = detail.state === 'open'

  return (
    <div className="flex flex-col gap-2">
      {conflicting && (
        <p className="text-warning leading-relaxed">{t('pullRequest.conflicting', { base })}</p>
      )}
      {/* The same condition as the button below, so the warning is there for
          exactly the press it is about — and gone with it when there is
          nothing to commit or the request is no longer open. */}
      {dirty && open && exposedEnvFile !== null && (
        <p className="text-warning leading-relaxed">
          {t('pullRequest.envNotIgnoredPush', { file: exposedEnvFile })}
        </p>
      )}
      {!conflicting && note !== undefined && (
        <p className="text-ink-faint leading-relaxed">{t(note, { base })}</p>
      )}
      {detail.draft && (
        <p className="text-ink-faint leading-relaxed">{t('pullRequest.mergeDraft')}</p>
      )}

      <div className="flex flex-wrap gap-1">
        {dirty && open && (
          <Button size="sm" onClick={onCommitAndPush} disabled={committing}>
            <Upload aria-hidden size={12} />
            {t(committing ? 'pullRequest.creating' : 'pullRequest.commitAndPush')}
          </Button>
        )}

        {open &&
          PROMPTS.filter((prompt) => offered[prompt.when]).map((prompt) => (
            <PromptButton
              key={prompt.kind}
              kind={prompt.kind}
              label={t(prompt.labelKey)}
              onPrompt={onPrompt}
              sending={sending}
            />
          ))}

        {conflicting && open && (
          <PromptButton
            kind="resolveConflicts"
            label={t('pullRequest.resolveConflicts')}
            onPrompt={onPrompt}
            sending={sending}
            variant="accent"
          />
        )}
      </div>

      {open && (
        <div className="flex items-center gap-2">
          <DropdownMenu
            align="left"
            actions={MERGE_METHODS.map(({ method, labelKey }) => ({
              id: method,
              label: t(labelKey),
              onSelect: () => {
                onMerge(method)
              }
            }))}
            trigger={({ onClick, open: shown }) => (
              <Button
                size="sm"
                variant="accent"
                onClick={onClick}
                aria-expanded={shown}
                className="flex-1"
                // A conflict and a draft are both refusals GitHub would make
                // anyway; saying so here saves a round trip that ends in an
                // error the pane would then have to explain.
                disabled={merging || conflicting || detail.draft}
              >
                <GitMerge aria-hidden size={12} />
                {t(merging ? 'pullRequest.merging' : 'pullRequest.merge')}
              </Button>
            )}
          />

          {/* `danger` rather than `destructive`: two filled buttons side by side
              compete for the eye, and merging is the one that should win it.
              Nothing asks twice — merging does not either, and closing is the
              more reversible of the two, since GitHub reopens. */}
          <Button size="sm" variant="danger" onClick={onClose} disabled={closing || merging}>
            {t(closing ? 'pullRequest.closing' : 'pullRequest.close')}
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * One prepared message, as a button.
 *
 * Drawn twice rather than once with a guard inside the handler: without a
 * conversation there is nothing to send into, so the press cannot do anything —
 * and a branch nothing can reach is a claim nothing tests.
 */
function PromptButton({
  kind,
  label,
  onPrompt,
  sending,
  variant = 'quiet'
}: {
  readonly kind: InstructionKind
  readonly label: string
  readonly onPrompt: ((kind: InstructionKind) => void) | null
  readonly sending: InstructionKind | null
  readonly variant?: 'quiet' | 'accent'
}): React.JSX.Element {
  const { t } = useTranslation()

  if (onPrompt === null) {
    return (
      <Button size="sm" disabled title={t('pullRequest.noConversation')}>
        {label}
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => {
        onPrompt(kind)
      }}
      disabled={sending !== null}
    >
      {sending === kind ? t('pullRequest.sending') : label}
    </Button>
  )
}

/**
 * Whether anybody has reviewed this.
 *
 * Not `decision === 'changesRequested'` alone, which is what the button was
 * nearly gated on: on a repository with no required reviewers GitHub sends an
 * empty decision essentially always, so that alone would hide the button on
 * exactly the projects this app is for. A resolved thread does not count —
 * somebody has already dealt with it.
 */
function hasRemarks(detail: PullRequestDetail): boolean {
  return detail.comments.some(
    (comment) => comment.kind === 'review' || (comment.kind === 'inline' && !comment.resolved)
  )
}
