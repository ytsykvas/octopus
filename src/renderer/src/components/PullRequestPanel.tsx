import { ExternalLink, GitPullRequest } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import type { PullRequestState } from '@core/pullRequests.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Failure } from '../../../preload/index.js'
import { useErrorMessage } from '../hooks/useErrorMessage.js'
import { usePullRequest } from '../hooks/usePullRequest.js'
import { Button } from './Button.js'

interface PullRequestPanelProps {
  readonly workspace: WorkspaceView | null
  /** False while another tab is showing; `gh` is not asked behind one. */
  readonly visible: boolean
  /**
   * The conversation the prompt would go to, or null when there is none yet.
   *
   * Null disables the button rather than opening a conversation: one created by
   * a press meant for something else is a surprise, and this pane is not where
   * conversations are started.
   */
  readonly chatId: string | null
  /** Opens the project's own instructions, which are what would be sent. */
  readonly onEditInstructions: () => void
  /** Says what went wrong where the window already says such things. */
  readonly onError: (message: string) => void
}

const STATE_LABELS: Record<
  PullRequestState,
  'pullRequest.stateOpen' | 'pullRequest.stateMerged' | 'pullRequest.stateClosed'
> = {
  open: 'pullRequest.stateOpen',
  merged: 'pullRequest.stateMerged',
  closed: 'pullRequest.stateClosed'
}

/**
 * The branch, and what it would take to get it reviewed.
 *
 * The one place in the app that reaches GitHub for something other than
 * cloning. It says what it is about to do before doing it — pushing a branch
 * touches somebody else's machine, and a button that does that silently is a
 * button people learn to distrust.
 */
export function PullRequestPanel({
  workspace,
  visible,
  chatId,
  onEditInstructions,
  onError
}: PullRequestPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()
  const { view, loading, error, creating, create } = usePullRequest(workspace?.id ?? null, visible)

  /*
   * The instruction this workspace would send, read when the tab draws.
   *
   * Emptying a project's is a decision — it says the project adds nothing — and
   * `effectiveInstruction` answers with that empty string. Sent, it fails
   * validation as a message, and the reader gets a zod complaint about a
   * message in a pane they were using to talk about instructions. Reading it
   * here turns a failed press into a state the button can explain first.
   */
  const [instruction, setInstruction] = useState<string | null>(null)

  useEffect(() => {
    if (!visible || !workspace) return

    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.workspaces.instruction(workspace.id, 'pullRequest')
      if (controller.signal.aborted) return

      // A read that failed stays null — unknown, not empty. The press then goes
      // ahead and reports the real reason rather than this one guessing at it.
      setInstruction(result.ok ? result.value : null)
    })()

    return () => {
      controller.abort()
    }
  }, [visible, workspace])

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState(false)

  if (!workspace) return <Notice>{t('pullRequest.noWorkspace')}</Notice>
  if (error !== null) return <Notice tone="danger">{error}</Notice>
  if (loading || !view) return <Notice>{t('pullRequest.loading')}</Notice>

  /*
   * What the ask button can do, or why it cannot.
   *
   * Two reasons now, and each is a state somebody chose rather than a failure:
   * no conversation to send into, and a project that says it adds nothing. The
   * conversation rides along so the enabled branch needs no second check for
   * something already decided here.
   */
  const ask =
    chatId === null
      ? { ready: false as const, reason: 'pullRequest.noConversation' as const }
      : instruction !== null && instruction.trim() === ''
        ? { ready: false as const, reason: 'pullRequest.noInstruction' as const }
        : { ready: true as const, chatId }

  const existing = view.request

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <p className="text-ink-faint mb-3 flex items-center gap-2 font-mono text-[11px]">
        <GitPullRequest aria-hidden size={12} className="shrink-0" />
        <span className="truncate" title={workspace.branch}>
          {shortBranchName(workspace.branch)}
        </span>
      </p>

      {/* Two things about the description, before the form that carries it.
          The instruction is the project's own, edited where it lives rather
          than in a second editor here that could disagree with it; asking is a
          message in the conversation, sent on the press, because §4 leaves no
          room for the app prompting the agent behind the reader's back. */}
      <div className="mb-3 flex flex-wrap gap-1">
        <Button variant="quiet" onClick={onEditInstructions}>
          {t('pullRequest.editInstructions')}
        </Button>
        {/* Drawn twice rather than once with a guard inside the handler: the
            button is disabled without a conversation, so that guard could never
            be false, and a check nothing can reach is a claim nothing tests. */}
        {!ask.ready ? (
          <Button variant="quiet" disabled title={t(ask.reason)}>
            {t('pullRequest.ask')}
          </Button>
        ) : (
          <Button
            variant="quiet"
            onClick={() => {
              void (async () => {
                const failure = await askForDescription(workspace.id, ask.chatId)
                if (failure !== null) onError(describeFailure(failure))
              })()
            }}
          >
            {t('pullRequest.ask')}
          </Button>
        )}
      </div>

      {existing ? (
        <div className="flex flex-col items-start gap-2">
          {/* The number rather than the word "open": it is what identifies the
              request to anyone who goes looking for it, here or on GitHub. */}
          <p className="text-ink leading-relaxed">
            {t(STATE_LABELS[existing.state], { number: existing.number })}
          </p>
          <p className="text-ink-soft leading-relaxed">{existing.title}</p>
          <a
            href={existing.url}
            target="_blank"
            rel="noreferrer"
            className="focus-ring text-accent inline-flex items-center gap-1 rounded-[var(--radius-control)]"
          >
            <ExternalLink aria-hidden size={12} />
            {t('pullRequest.open')}
          </a>
        </div>
      ) : view.ahead === 0 ? (
        <Notice>{t('pullRequest.nothingToOpen', { base: '' })}</Notice>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void create({ title: title.trim(), body, draft })
          }}
          className="flex flex-col gap-2"
        >
          {/* Both said before the button, not after it fails. One is about
              somebody else's machine and the other is about work that will not
              travel; neither should be found out afterwards. */}
          {!view.pushed && (
            <p className="text-ink-faint leading-relaxed">{t('pullRequest.willPush')}</p>
          )}
          {view.dirty && <p className="text-warning leading-relaxed">{t('pullRequest.dirty')}</p>}

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
      )}
    </div>
  )
}

/**
 * Sends the instruction that applies here to the conversation.
 *
 * Read at the moment of asking rather than held: it is edited in another window
 * and a copy taken when the tab opened would be the one before the edit.
 *
 * Answers with whichever step failed, or null. Both can: the file may be
 * unreadable and the conversation may have gone since the pane last drew it,
 * and a press that quietly did neither is worse than one that says so (§13).
 */
async function askForDescription(workspaceId: string, chatId: string): Promise<Failure | null> {
  const instruction = await window.octopus.workspaces.instruction(workspaceId, 'pullRequest')
  if (!instruction.ok) return instruction

  const sent = await window.octopus.chats.send(chatId, instruction.value)
  return sent.ok ? null : sent
}

function Notice({
  children,
  tone = 'soft'
}: {
  readonly children: React.ReactNode
  readonly tone?: 'soft' | 'danger'
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <p className={`leading-relaxed ${tone === 'danger' ? 'text-danger' : 'text-ink-faint'}`}>
        {children}
      </p>
    </div>
  )
}
