import { AlertTriangle, GitPullRequest, Info, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DraftedPullRequest } from '@core/pullRequestDraft.js'
import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'

import { Button } from '../Button.js'
import { CommitMessageField } from './CommitMessageField.js'
import { PaneFooter } from './PullRequestFooter.js'

interface NewPullRequestFormProps {
  readonly view: PullRequestView
  readonly creating: boolean
  readonly onCreate: (draft: PullRequestDraft) => void
  /** True while the agent is writing, which the button says instead of guessing. */
  readonly drafting: boolean
  /** Asks the agent for a title and a description. Null when it could not. */
  readonly onDraft: () => Promise<DraftedPullRequest | null>
  /** Why drafting or opening failed. Shown here, so the form survives it. */
  readonly actionError: string | null
  /** Opens the project's instructions, which is where the wording is decided. */
  readonly onEditInstructions: () => void
  /**
   * The env file, named only when git does not ignore it.
   *
   * octopus writes this workspace's variables into that file, so committing
   * everything would put them in the request and pushing would publish them.
   * Null is the ordinary case and says nothing.
   */
  readonly exposedEnvFile: string | null
}

/**
 * The form that turns a branch into a pull request.
 *
 * It says what it is about to do before doing it — committing and pushing both
 * happen to things outside this window, and a button that does them silently is
 * one people learn to distrust.
 */
export function NewPullRequestForm({
  view,
  creating,
  onCreate,
  drafting,
  onDraft,
  actionError,
  onEditInstructions,
  exposedEnvFile
}: NewPullRequestFormProps): React.JSX.Element {
  const { t } = useTranslation()

  const [commitMessage, setCommitMessage] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)
  /** Whether what is in the fields was written by the agent rather than typed. */
  const [written, setWritten] = useState(false)

  const committing = commitMessage.trim() !== ''
  const untitled = title.trim() === ''

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()

        /*
         * An empty title is a request, not a mistake.
         *
         * It fills the fields and stops there rather than opening: a pull
         * request is outside this window and hard to take back, and text
         * nobody has read is not something to publish under their name. The
         * second press is the one that opens it.
         */
        if (untitled) {
          void onDraft().then((written_) => {
            if (written_ === null) return
            setTitle(written_.title)
            setBody(written_.body)
            /* Into the field, like the title and the description. It used to
               be kept out of sight and committed under on the next press, so
               the one text that stays in the history for good was the one
               nobody read. A message typed before the answer arrived is the
               person's own and stays — read from the state as it is now, not
               as it was when the button was pressed. */
            const drafted = written_.commitMessage
            if (drafted !== null) {
              setCommitMessage((typed) => (typed.trim() === '' ? drafted : typed))
            }
            setWritten(true)
          })
          return
        }

        onCreate({
          title: title.trim(),
          body,
          draft,
          /*
           * Uncommitted work is committed, not left behind.
           *
           * It used to be left behind whenever this field was empty, which
           * made an empty field the difference between a pull request and a
           * refusal — the branch had nothing on it, and gh said so after the
           * agent had already written the description.
           *
           * The field — typed, or filled in by the agent's draft — else the
           * title. The title is a last resort and never empty by here: an
           * empty one drafts rather than opens. Null only when there is
           * nothing to commit, which git would refuse anyway.
           */
          commitMessage: view.dirty ? (committing ? commitMessage.trim() : title.trim()) : null
        })
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 pb-3">
        {/* Said before the button rather than after it fails. Pushing is a
            thing that happens to somebody else's machine. */}
        {!view.pushed && <Callout tone="info">{t('pullRequest.willPush')}</Callout>}

        {/* Not gated on the field below. Pressing the button commits whether
            or not a message was typed, so a warning that waited for one was
            hidden on exactly the path the hint describes. Dirty is the whole
            condition, and an env file git does not ignore is itself an
            uncommitted change — so it is true whenever this can bite. */}
        {view.dirty && exposedEnvFile !== null && (
          <Callout tone="warning">
            {t('pullRequest.envNotIgnored', { file: exposedEnvFile })}
          </Callout>
        )}

        {/* Left empty, the commit still happens — under the title, or under
            what the agent writes into this field. */}
        {view.dirty && (
          <CommitMessageField
            value={commitMessage}
            onChange={setCommitMessage}
            hint={t(committing ? 'pullRequest.commitHint' : 'pullRequest.dirty')}
          />
        )}

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('pullRequest.title')}</span>
          <input
            value={title}
            onChange={(event) => {
              setTitle(event.target.value)
            }}
            placeholder={t('pullRequest.titlePlaceholder')}
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="section-label">{t('pullRequest.body')}</span>
          <textarea
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
            }}
            placeholder={t('pullRequest.bodyPlaceholder')}
            rows={6}
            className="input h-auto resize-none py-1 leading-relaxed"
          />
        </label>

        {/* Said where the empty fields are, not in a tooltip: this is the one
            behaviour of the form that is not visible from looking at it. */}
        {actionError !== null && <p className="text-danger leading-relaxed">{actionError}</p>}

        <p className="text-ink-faint text-[11px] leading-relaxed">
          {written && <Sparkles aria-hidden size={11} className="mr-1 inline align-[-1px]" />}
          {written ? t('pullRequest.written') : t('pullRequest.emptyHint')}{' '}
          <button
            type="button"
            onClick={onEditInstructions}
            className="focus-ring hover:text-ink rounded-[var(--radius-control)] underline"
          >
            {t('pullRequest.emptyHintSettings')}
          </button>
        </p>
      </div>

      <PaneFooter>
        <div className="flex items-center gap-2">
          {/* `choice` paints the box and sizes it, so it belongs on the input.
              On the label it made the label 0.875rem wide, and the words
              wrapped inside a square the size of a tick and spilled over the
              button. */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft}
              onChange={(event) => {
                setDraft(event.target.checked)
              }}
              className="choice focus-ring"
            />
            <span>{t('pullRequest.draft')}</span>
          </label>

          <span className="flex-1" />

          {/* Never disabled for an empty title: empty means "you write it", and
              a disabled button would be the app refusing the thing it is
              offering. Still disabled while either half is in flight. Handing
              the writing to the agent is a different act from opening the
              request, so it looks like one: the composer's ring. */}
          {untitled && !drafting && !creating ? (
            <Button type="submit" size="sm" variant="agent">
              <Sparkles aria-hidden size={12} />
              {t('pullRequest.ask')}
            </Button>
          ) : (
            <Button type="submit" size="sm" variant="success" disabled={creating || drafting}>
              <GitPullRequest aria-hidden size={12} />
              {t(
                drafting
                  ? 'pullRequest.drafting'
                  : creating
                    ? 'pullRequest.creating'
                    : 'pullRequest.create'
              )}
            </Button>
          )}
        </div>
      </PaneFooter>
    </form>
  )
}

/**
 * A sentence the reader should see before pressing: something that will happen
 * (`info`) or something that could go wrong (`warning`), on its paired ground.
 */
function Callout({
  tone,
  children
}: {
  readonly tone: 'info' | 'warning'
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <p
      className={`text-ink flex items-start gap-2 rounded-[var(--radius-control)] px-2.5 py-2 leading-snug ${
        tone === 'info' ? 'bg-info-bg' : 'bg-warning-bg'
      }`}
    >
      <span
        className={`flex h-[1lh] shrink-0 items-center ${tone === 'info' ? 'text-info' : 'text-warning'}`}
      >
        {tone === 'info' ? <Info aria-hidden size={13} /> : <AlertTriangle aria-hidden size={13} />}
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  )
}
