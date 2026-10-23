import { AlertTriangle, ArrowUpFromLine, Trash2, Upload } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { MergeMethod } from '@core/pullRequests.js'

import { Button } from '../Button.js'
import { AgentMenu } from './AgentMenu.js'
import { CommitMessageField } from './CommitMessageField.js'
import { AttentionLine, FooterLine } from './MergeConditions.js'
import { MergeMenu } from './MergeMenu.js'
import type { PromptKind, RequestStatus } from './requestStatus.js'

interface PullRequestFooterProps {
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
  /** Sends a prepared message, or null where there is no conversation. */
  readonly onPrompt: ((kind: PromptKind) => void) | null
  /** A prepared message on its way, which the menu's trigger says. */
  readonly sending: boolean
  readonly onEditInstructions: () => void
  readonly onMerge: (method: MergeMethod) => void
  readonly merging: boolean
  /**
   * Commits everything here under the message given, and pushes.
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
  /** Sends what is already committed, without committing anything else. */
  readonly onPush: () => void
  readonly pushing: boolean
  /**
   * Removes the workspace, asking first — the sidebar's own flow.
   *
   * Offered off the request's **state** rather than off the press that merged
   * it, which is what makes it appear for a merge done from the header or in a
   * browser as well.
   */
  readonly onRemoveWorkspace: () => void
}

/**
 * The next step, pinned under the views.
 *
 * At most three rows — the one line saying what matters most, the commit
 * message while there is work to commit, and the buttons — so it never eats the
 * pane it sits under. The line and the press sit together because the line is
 * what the press is about.
 *
 * Green is the press that finishes something: committing and pushing, pushing,
 * merging. Merging stays beside the push rather than waiting behind it — the
 * two answer different states, and the request on GitHub can be ready while
 * this checkout has more to send.
 */
export function PullRequestFooter({
  status,
  base,
  dirty,
  exposedEnvFile,
  onPrompt,
  sending,
  onEditInstructions,
  onMerge,
  merging,
  onCommitAndPush,
  ahead,
  committing,
  onPush,
  pushing,
  onRemoveWorkspace
}: PullRequestFooterProps): React.JSX.Element | null {
  const { t } = useTranslation()

  /* Not stored and not defaulted. There is no title and no drafted text to fall
     back to here, unlike the form that opens a request — so an empty field is
     read as "amend", which keeps the last commit's own description, rather than
     as a commit under a sentence nobody chose. */
  const [message, setMessage] = useState('')
  const amending = message.trim() === ''
  const cannotAmend = amending && ahead === 0

  /* A merge is somebody else's repository changing; removing a directory is
     this machine's work disappearing. So this offers rather than acts, and the
     flow behind it is the sidebar's, which asks about uncommitted work and
     about the branch. */
  if (status.state === 'merged') {
    return (
      <PaneFooter>
        <Button variant="destructive" className="w-full" onClick={onRemoveWorkspace}>
          <Trash2 aria-hidden size={13} />
          {t('pullRequest.removeWorkspace')}
        </Button>
      </PaneFooter>
    )
  }
  // A closed request has nothing left to press; the header links to GitHub,
  // which is where one is reopened.
  if (status.state !== 'open') return null

  /* Committing pushes too, so a push of its own is offered only where there is
     nothing to commit. */
  const pushable = !dirty && status.attention.some((item) => item.kind === 'unpushed')

  /* An empty field amends, and where the last commit is already on GitHub the
     amended one replaces it there. That is the one consequence of this press
     worth a line of its own rather than a tooltip: it rewrites history somebody
     else may have fetched. With commits still waiting, the last one is local
     and amending it changes nothing anybody has seen. */
  const replacing =
    dirty &&
    amending &&
    ahead > 0 &&
    !status.attention.some((item) => item.kind === 'unpushed' || item.kind === 'unpushedUnknown')

  return (
    <PaneFooter>
      {/* The env warning takes the line rather than adding a block: it is the
          most important thing to say about this press, and it is there for
          exactly the press it is about. */}
      {dirty && exposedEnvFile !== null ? (
        <Warning>{t('pullRequest.envNotIgnoredPush', { file: exposedEnvFile })}</Warning>
      ) : replacing ? (
        <Warning>{t('pullRequest.amendReplaces')}</Warning>
      ) : (
        <AttentionLine item={status.attention[0]} base={base} />
      )}

      {/* The field and the press it is for share a row: an empty field
          amends, and the label beside it is what says so. */}
      {dirty && (
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <CommitMessageField value={message} onChange={setMessage} />
          </div>

          <Button
            variant="success"
            className="shrink-0"
            onClick={() => {
              onCommitAndPush(message.trim())
            }}
            // Amending a branch with no commit of its own would rewrite the
            // base's commit instead — and it says why, rather than only greying.
            disabled={committing || cannotAmend}
            title={t(
              cannotAmend ? 'pullRequest.amendNeedsCommit' : 'pullRequest.commitAndPushHint'
            )}
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
        </div>
      )}

      <div className="flex items-center gap-2">
        <AgentMenu
          offered={status.offered}
          onPrompt={onPrompt}
          sending={sending}
          onEditInstructions={onEditInstructions}
        />

        <span className="flex-1" />

        {pushable && (
          <Button size="sm" variant="success" onClick={onPush} disabled={pushing}>
            <ArrowUpFromLine aria-hidden size={12} />
            {t(pushing ? 'pullRequest.pushing' : 'pullRequest.push')}
          </Button>
        )}

        {/* The finishing press only when it is the next one: beside a commit
            or a push it stays quiet, so one green button says what comes
            first. */}
        <MergeMenu
          variant={dirty || pushable ? 'quiet' : 'success'}
          onMerge={onMerge}
          merging={merging}
          disabled={!status.canMerge}
        />
      </div>
    </PaneFooter>
  )
}

/** The footer's line when it is a warning about the press below it. */
function Warning({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <FooterLine tone="warning" mark={<AlertTriangle aria-hidden size={12} />}>
      {children}
    </FooterLine>
  )
}

/**
 * The strip along the bottom of the pane, under whatever scrolls above it.
 *
 * Shared with the form that opens a request and with the branch that has
 * nothing to open, so the press that moves the branch on is in the same place
 * in every state.
 */
export function PaneFooter({
  children
}: {
  readonly children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      role="region"
      aria-label={t('pullRequest.nextStep')}
      className="border-line bg-surface flex shrink-0 flex-col gap-2 border-t px-3 py-2.5"
    >
      {children}
    </div>
  )
}
