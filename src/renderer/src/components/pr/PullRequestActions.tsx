import { ArrowUpFromLine, GitMerge, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'
import type { MergeMethod } from '@core/pullRequests.js'
import type { MergeState, PullRequestDetail } from '@core/pullRequestShapes.js'

import { Button } from '../Button.js'
import { CommitMessageField } from './CommitMessageField.js'
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
  /**
   * Commits everything here under the message given, and pushes.
   *
   * The message rather than nothing: it used to be fixed at "Answer the
   * review", so every press produced that sentence whether or not anybody had
   * reviewed anything — and it is the only description those changes will ever
   * have.
   */
  readonly onCommitAndPush: (message: string) => void
  readonly committing: boolean
  /**
   * Sends what is already committed, without committing anything else.
   *
   * The other half of the pair above, and the one that was missing: work the
   * agent committed, or the reader committed in the terminal, had no way onto
   * the request short of the terminal.
   */
  readonly onPush: () => void
  readonly pushing: boolean
  /** Commits the remote's copy of this branch lacks; zero hides the button. */
  readonly unpushedCommits: number
  /**
   * Removes the workspace, asking first — the sidebar's own flow.
   *
   * Offered off the request's **state** rather than off the press that merged
   * it, which is what makes it appear for a merge done from the header or in a
   * browser as well. §3 draws the lifecycle as ending in an archive, and this
   * is the arrow the app was not drawing.
   */
  readonly onRemoveWorkspace: () => void
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
  committing,
  onPush,
  pushing,
  unpushedCommits,
  onRemoveWorkspace
}: PullRequestActionsProps): React.JSX.Element {
  const { t } = useTranslation()

  /* Not stored and not defaulted. There is no title and no drafted text to fall
     back to here, unlike the form that opens a request, so an empty field means
     the press cannot say what it did — which is the state this replaced. */
  const [message, setMessage] = useState('')

  const conflicting = detail.mergeable === 'conflicting'
  const note = MERGE_NOTES[detail.mergeState]

  /* Read once and used twice: it decides both whether the fix prompt is worth
     offering and whether merging is allowed at all, and two spellings of the
     same question are two things that can drift apart. */
  const failed = detail.checks.filter((check) => check.state === 'failed').length

  /* Looked up rather than tested at each row: a table keyed by the same word the
     row carries cannot disagree with it, and there is no chain of conditions for
     a fourth case to be left out of. */
  const offered: Record<'always' | 'failed' | 'reviewed', boolean> = {
    always: true,
    failed: failed > 0,
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
      {/* Not a refusal GitHub would make — it merges over a check nobody marked
          required — so this says outright that the app is the one refusing, and
          the button below is disabled to match. */}
      {failed > 0 && open && (
        <p className="text-danger leading-relaxed">
          {t('pullRequest.mergeChecksFailed', { count: failed })}
        </p>
      )}
      {unpushedCommits > 0 && open && (
        <p className="text-ink-faint leading-relaxed">
          {t('pullRequest.unpushed', { count: unpushedCommits })}
        </p>
      )}

      {dirty && open && (
        <CommitMessageField
          value={message}
          onChange={setMessage}
          hint={t('pullRequest.commitAndPushHint')}
        />
      )}

      <div className="flex flex-wrap gap-1">
        {dirty && open && (
          <Button
            size="sm"
            onClick={() => {
              onCommitAndPush(message.trim())
            }}
            // Dead until something is typed, rather than committing under a
            // sentence nobody chose. git refuses an empty message too.
            disabled={committing || message.trim() === ''}
          >
            <Upload aria-hidden size={12} />
            {t(committing ? 'pullRequest.creating' : 'pullRequest.commitAndPush')}
          </Button>
        )}

        {/* Beside it rather than instead of it: the two answer different
            states, and a branch can be in both at once — something committed
            and not sent, something else not committed at all. */}
        {unpushedCommits > 0 && open && (
          <Button size="sm" onClick={onPush} disabled={pushing}>
            <ArrowUpFromLine aria-hidden size={12} />
            {t(pushing ? 'pullRequest.pushing' : 'pullRequest.push')}
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

      {/* A merge is somebody else's repository changing; removing a directory is
          this machine's work disappearing. So this offers rather than acts, and
          the flow behind it is the sidebar's, which asks about uncommitted work
          and about the branch. */}
      {detail.state === 'merged' && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-ink-faint leading-relaxed">{t('pullRequest.mergedDone')}</p>

          <Button size="sm" variant="quiet" onClick={onRemoveWorkspace}>
            {t('pullRequest.removeWorkspace')}
          </Button>
        </div>
      )}

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
                // A conflict and a draft are refusals GitHub would make anyway;
                // saying so here saves a round trip that ends in an error the
                // pane would then have to explain.
                //
                // A red check is not that. GitHub merges over one that nobody
                // marked required, so this fourth condition is a policy octopus
                // keeps rather than a refusal it is predicting — and it is a
                // hard one: the way past it is to fix the check, or to merge in
                // the browser, where nobody can do it by reflex.
                disabled={merging || conflicting || detail.draft || failed > 0}
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
