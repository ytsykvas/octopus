import { ArrowUpFromLine, GitMerge, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'
import type { MergeMethod } from '@core/pullRequests.js'
import type { PullRequestDetail } from '@core/pullRequestShapes.js'

import { Button } from '../Button.js'
import { CommitMessageField } from './CommitMessageField.js'
import { DropdownMenu } from '../DropdownMenu.js'
import { MERGE_METHODS } from './mergeMethods.js'
import type { Attention, GitHubNote, RequestStatus } from './requestStatus.js'

/**
 * The prompts drawn as a row, with their labels.
 *
 * `resolveConflicts` is not here: it appears only against a conflict, beside
 * the sentence saying there is one, where it reads as the answer to that rather
 * than as one more thing one might do.
 */
const PROMPTS: Partial<
  Record<
    InstructionKind,
    | 'pullRequest.fixChecks'
    | 'pullRequest.addressReview'
    | 'pullRequest.doReview'
    | 'pullRequest.multiAgentReview'
  >
> = {
  fixChecks: 'pullRequest.fixChecks',
  addressReview: 'pullRequest.addressReview',
  review: 'pullRequest.doReview',
  multiAgentReview: 'pullRequest.multiAgentReview'
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

interface PullRequestActionsProps {
  readonly detail: PullRequestDetail
  /** What the pane has decided about the request, read once for every part of it. */
  readonly status: RequestStatus
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
   *
   * An empty message is not a commit without one: it folds the work into the
   * last commit instead, which keeps the description that commit already has.
   */
  readonly onCommitAndPush: (message: string) => void
  /**
   * Commits this branch has that the base does not.
   *
   * Zero means HEAD is the base's own commit, so there is nothing of this
   * branch's to amend and an empty message cannot be pressed.
   */
  readonly ahead: number
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
  status,
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
  ahead,
  committing,
  onPush,
  pushing,
  onRemoveWorkspace
}: PullRequestActionsProps): React.JSX.Element {
  const { t } = useTranslation()

  /* Not stored and not defaulted. There is no title and no drafted text to fall
     back to here, unlike the form that opens a request — so an empty field is
     read as "amend", which keeps the last commit's own description, rather than
     as a commit under a sentence nobody chose. */
  const [message, setMessage] = useState('')
  const amending = message.trim() === ''
  const cannotAmend = amending && ahead === 0

  const { open } = status
  const unpushed = status.attention.find(
    (item): item is Extract<Attention, { kind: 'unpushed' }> => item.kind === 'unpushed'
  )

  return (
    <div className="flex flex-col gap-2">
      {/* The same condition as the button below, so the warning is there for
          exactly the press it is about — and gone with it when there is
          nothing to commit or the request is no longer open. */}
      {dirty && open && exposedEnvFile !== null && (
        <p className="text-warning leading-relaxed">
          {t('pullRequest.envNotIgnoredPush', { file: exposedEnvFile })}
        </p>
      )}
      {status.attention.map((item) => (
        <AttentionNote key={item.kind} item={item} base={base} />
      ))}

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
            // Amending a branch with no commit of its own would rewrite the
            // base's commit instead.
            disabled={committing || cannotAmend}
            /* And it says why. A control that is simply grey is a control the
               reader has to guess at — the prepared-message buttons above take
               the same trouble when there is no conversation to send into. */
            {...(cannotAmend ? { title: t('pullRequest.amendNeedsCommit') } : {})}
          >
            <Upload aria-hidden size={12} />
            {t(
              committing
                ? 'pullRequest.committing'
                : amending
                  ? 'pullRequest.amendAndPush'
                  : 'pullRequest.commitAndPush'
            )}
          </Button>
        )}

        {/* Beside it rather than instead of it: the two answer different
            states, and a branch can be in both at once — something committed
            and not sent, something else not committed at all. */}
        {unpushed !== undefined && (
          <Button size="sm" onClick={onPush} disabled={pushing}>
            <ArrowUpFromLine aria-hidden size={12} />
            {t(pushing ? 'pullRequest.pushing' : 'pullRequest.push')}
          </Button>
        )}

        {status.offered.map((kind) => {
          const labelKey = PROMPTS[kind]
          return (
            labelKey !== undefined && (
              <PromptButton
                key={kind}
                kind={kind}
                label={t(labelKey)}
                onPrompt={onPrompt}
                sending={sending}
              />
            )
          )
        })}

        {status.offered.includes('resolveConflicts') && (
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

          <Button size="sm" variant="destructive" onClick={onRemoveWorkspace}>
            <Trash2 aria-hidden size={13} />
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
                disabled={merging || !status.canMerge}
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
 * One line about the request, in the colour of what it means.
 *
 * Uncommitted work says nothing here: the commit field below is what says it.
 */
function AttentionNote({
  item,
  base
}: {
  readonly item: Attention
  readonly base: string
}): React.JSX.Element | null {
  const { t } = useTranslation()

  switch (item.kind) {
    case 'uncommitted':
      return null
    case 'conflict':
      return (
        <p className="text-warning leading-relaxed">{t('pullRequest.conflicting', { base })}</p>
      )
    case 'githubNote':
      return <p className="text-ink-faint leading-relaxed">{t(NOTES[item.note], { base })}</p>
    case 'draft':
      return <p className="text-ink-faint leading-relaxed">{t('pullRequest.mergeDraft')}</p>
    /* Not a refusal GitHub would make — it merges over a check nobody marked
       required — so this says outright that the app is the one refusing, and
       the button is disabled to match. */
    case 'failed':
      return (
        <p className="text-danger leading-relaxed">
          {t('pullRequest.mergeChecksFailed', { count: item.count })}
        </p>
      )
    case 'running':
      return (
        <p className="text-ink-faint leading-relaxed">
          {t('pullRequest.mergeChecksRunning', { count: item.count })}
        </p>
      )
    case 'unpushed':
      return (
        <p className="text-ink-faint leading-relaxed">
          {t('pullRequest.unpushed', { count: item.count })}
        </p>
      )
    /* Said rather than left blank. A pushed branch with no count and no
       button, and nothing accounting for either, reads as the pane having
       given up — and the remedy is one command away. */
    case 'unpushedUnknown':
      return <p className="text-ink-faint leading-relaxed">{t('pullRequest.unpushedUnknown')}</p>
  }
}
