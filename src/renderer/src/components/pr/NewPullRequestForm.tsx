import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { DraftedPullRequest } from '@core/pullRequestDraft.js'
import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'

import { Button } from '../Button.js'

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
            setWritten(true)
          })
          return
        }

        onCreate({
          title: title.trim(),
          body,
          draft,
          // Null rather than an empty string: it is the difference between
          // "open it from what is committed" and a message nobody typed.
          commitMessage: committing ? commitMessage.trim() : null
        })
      }}
      className="flex flex-col gap-2"
    >
      {!view.pushed && (
        <p className="text-ink-faint leading-relaxed">{t('pullRequest.willPush')}</p>
      )}

      {view.dirty && (
        <div className="flex flex-col gap-1">
          {/* The label wraps the field and nothing else. Everything said about
              it sits outside, or the field's own name would be the label plus
              two paragraphs of explanation — which is what anything reading the
              form aloud would announce. */}
          <label className="flex flex-col gap-1">
            <span className="section-label">{t('pullRequest.commitMessage')}</span>
            <input
              value={commitMessage}
              onChange={(event) => {
                setCommitMessage(event.target.value)
              }}
              placeholder={t('pullRequest.commitMessagePlaceholder')}
              className="input"
            />
          </label>

          {/* Left empty, the uncommitted work stays behind — which is the
              warning this field replaced, and it is still the truth. */}
          <p className="text-ink-faint leading-relaxed">
            {t(committing ? 'pullRequest.commitHint' : 'pullRequest.dirty')}
          </p>

          {committing && exposedEnvFile !== null && (
            <p className="text-warning leading-relaxed">
              {t('pullRequest.envNotIgnored', { file: exposedEnvFile })}
            </p>
          )}
        </div>
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

      <div className="flex flex-col items-start gap-1">
        <p className="text-ink-faint leading-relaxed">
          {written ? t('pullRequest.written') : t('pullRequest.emptyHint')}
        </p>
        <Button size="sm" onClick={onEditInstructions}>
          {t('pullRequest.emptyHintSettings')}
        </Button>
      </div>

      {/* `choice` paints the box and sizes it, so it belongs on the input. On
          the label it made the label 0.875rem wide, and the words wrapped
          inside a square the size of a tick and spilled over the button. */}
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

      {/* Never disabled for an empty title any more: empty means "you write
          it", and a disabled button would be the app refusing the thing it is
          offering. Still disabled while either half is in flight. */}
      <Button type="submit" variant="accent" disabled={creating || drafting}>
        {t(
          drafting
            ? 'pullRequest.drafting'
            : creating
              ? 'pullRequest.creating'
              : untitled
                ? 'pullRequest.ask'
                : 'pullRequest.create'
        )}
      </Button>
    </form>
  )
}
