import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PullRequestDraft, PullRequestView } from '@core/pullRequests.js'

import { Button } from '../Button.js'

interface NewPullRequestFormProps {
  readonly view: PullRequestView
  readonly creating: boolean
  readonly onCreate: (draft: PullRequestDraft) => void
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
  exposedEnvFile
}: NewPullRequestFormProps): React.JSX.Element {
  const { t } = useTranslation()

  const [commitMessage, setCommitMessage] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)

  const committing = commitMessage.trim() !== ''

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
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

      <label className="choice flex items-center gap-2">
        <input
          type="checkbox"
          checked={draft}
          onChange={(event) => {
            setDraft(event.target.checked)
          }}
        />
        {t('pullRequest.draft')}
      </label>

      <Button
        type="submit"
        variant="accent"
        // An empty title is a pull request nobody can find later, and `gh`
        // refuses it anyway — better said here than by a failed command.
        disabled={title.trim() === '' || creating}
      >
        {t(creating ? 'pullRequest.creating' : 'pullRequest.create')}
      </Button>
    </form>
  )
}
