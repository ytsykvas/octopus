import { GitPullRequest } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { shortBranchName } from '@core/branches.js'
import type { InstructionKind } from '@core/instructions.js'
import type { MergeMethod, PullRequest, PullRequestDraft } from '@core/pullRequests.js'
import type { PullRequestComment } from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Failure } from '../../../../preload/index.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { usePullRequest } from '../../hooks/usePullRequest.js'
import { usePullRequestDetail } from '../../hooks/usePullRequestDetail.js'
import { type PullRequestQuoteController, toQuote } from '../../hooks/usePullRequestQuotes.js'
import { Button } from '../Button.js'
import { ChecksList } from './ChecksList.js'
import { CommentList } from './CommentList.js'
import { NewPullRequestForm } from './NewPullRequestForm.js'
import { PullRequestActions } from './PullRequestActions.js'
import { PullRequestSummary } from './PullRequestSummary.js'

interface PullRequestPanelProps {
  readonly workspace: WorkspaceView | null
  /** False while another tab is showing; `gh` is not asked behind one. */
  readonly visible: boolean
  /**
   * The conversation a prompt would go to, or null when there is none yet.
   *
   * Null disables the buttons rather than opening a conversation: one created by
   * a press meant for something else is a surprise, and this pane is not where
   * conversations are started.
   */
  readonly chatId: string | null
  /** Where a remark from the review goes when the reader wants to ask about it. */
  readonly quotes: PullRequestQuoteController
  /** The project's env file, for the warning beside the commit field. */
  readonly envFile: string
  /** Opens the project's own instructions, which are what would be sent. */
  readonly onEditInstructions: () => void
  /** Says what went wrong where the window already says such things. */
  readonly onError: (message: string) => void
}

/**
 * The branch, the request it became, and everything either side of one.
 *
 * The one place in the app that reaches GitHub for something other than
 * cloning. It says what it is about to do before doing it — committing,
 * pushing and merging all touch something outside this window, and a button
 * that does that silently is a button people learn to distrust.
 */
export function PullRequestPanel({
  workspace,
  visible,
  chatId,
  quotes,
  envFile,
  onEditInstructions,
  onError
}: PullRequestPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const workspaceId = workspace?.id ?? null
  const { view, loading, error, creating, create, refresh } = usePullRequest(workspaceId, visible)
  const request = view?.request ?? null
  const detail = usePullRequestDetail(workspaceId, request?.number ?? null, visible)

  /** Which prepared message is in flight, so its own button says so. */
  const [sending, setSending] = useState<InstructionKind | null>(null)
  const [merging, setMerging] = useState(false)
  const [committing, setCommitting] = useState(false)

  /*
   * Whether git ignores the file octopus writes this workspace's variables into.
   *
   * Read because the commit field stages everything: a project whose
   * `.gitignore` does not cover that file would have octopus commit its own
   * credentials and then push them. Unknown counts as ignored — the warning is
   * worth saying when it is true, not worth guessing at.
   */
  const [envIgnored, setEnvIgnored] = useState(true)

  useEffect(() => {
    if (!visible || !workspace) return

    const controller = new AbortController()

    void (async () => {
      const result = await window.octopus.projects.isEnvIgnored(workspace.projectId)
      if (controller.signal.aborted) return
      setEnvIgnored(!result.ok || result.value)
    })()

    return () => {
      controller.abort()
    }
  }, [visible, workspace])

  if (!workspace) return <Notice>{t('pullRequest.noWorkspace')}</Notice>
  if (error !== null) return <Notice tone="danger">{error}</Notice>
  if (loading || !view) return <Notice>{t('pullRequest.loading')}</Notice>

  const report = (failure: Failure): void => {
    onError(describeFailure(failure))
  }

  /**
   * Sends the instruction that applies here, with a line naming the request.
   *
   * Read at the moment of pressing rather than held: it is edited in another
   * window, and a copy taken when the tab opened would be the one before the
   * edit. Both steps can fail, and a press that quietly did neither is worse
   * than one that says so (§13).
   */
  const prompt = (kind: InstructionKind, open: PullRequest, conversation: string): void => {
    setSending(kind)
    void (async () => {
      const instruction = await window.octopus.workspaces.instruction(workspace.id, kind)
      if (!instruction.ok) {
        setSending(null)
        report(instruction)
        return
      }

      // The context goes below the instruction and inside the same message, so
      // the whole of what the agent was told is one thing the reader can see in
      // the log (§4).
      const context = t('pullRequest.context', {
        number: open.number,
        branch: workspace.branch,
        base: view.base,
        url: open.url
      })

      const sent = await window.octopus.chats.send(
        conversation,
        [instruction.value.trim(), context].filter((part) => part !== '').join('\n\n')
      )
      setSending(null)
      if (!sent.ok) report(sent)
    })()
  }

  const merge = (number: number, method: MergeMethod): void => {
    setMerging(true)
    void (async () => {
      const result = await window.octopus.workspaces.mergePullRequest(workspace.id, number, method)
      setMerging(false)
      if (!result.ok) report(result)

      // Read again either way. `gh` enables auto-merge instead of merging when
      // required checks have not passed, so success is not proof of a merge —
      // and a refusal it could not name is explained by the fresh state.
      refresh()
      detail.refresh()
    })()
  }

  const commitAndPush = (message: string): void => {
    setCommitting(true)
    void (async () => {
      const result = await window.octopus.workspaces.commitAndPush(workspace.id, message)
      setCommitting(false)
      if (!result.ok) {
        report(result)
        return
      }

      refresh()
      detail.refresh()
    })()
  }

  const attached = new Set(quotes.pending.map((quote) => quote.key))

  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <p className="text-ink-faint flex items-center gap-2 font-mono text-[11px]">
        <GitPullRequest aria-hidden size={12} className="shrink-0" />
        <span className="truncate" title={workspace.branch}>
          {shortBranchName(workspace.branch)}
        </span>
      </p>

      {/* The instruction is the project's own, edited where it lives rather than
          in a second editor here that could disagree with it. */}
      <Button variant="quiet" onClick={onEditInstructions}>
        {t('pullRequest.editInstructions')}
      </Button>

      {request === null ? (
        view.ahead === 0 && !view.dirty ? (
          <p className="text-ink-faint leading-relaxed">
            {t('pullRequest.nothingToOpen', { base: view.base })}
          </p>
        ) : (
          <NewPullRequestForm
            view={view}
            creating={creating}
            onCreate={(draft: PullRequestDraft) => void create(draft)}
            exposedEnvFile={envIgnored ? null : envFile}
          />
        )
      ) : (
        <>
          <PullRequestSummary
            request={request}
            detail={detail.detail}
            onRefresh={() => {
              refresh()
              detail.refresh()
            }}
          />

          {/* The detail failing is not the branch failing: the number, the
              title and the link above are still worth having, so this says
              what is missing rather than blanking the pane. */}
          {detail.error !== null && <p className="text-danger leading-relaxed">{detail.error}</p>}

          {detail.detail !== null && (
            <>
              <Section title={t('pullRequest.checks')}>
                <ChecksList checks={detail.detail.checks} />
              </Section>

              <Section title={t('pullRequest.review')}>
                <CommentList
                  comments={detail.detail.comments}
                  onAddToChat={(comment: PullRequestComment) => {
                    quotes.add(toQuote(comment, request.number))
                  }}
                  attached={attached}
                />
              </Section>

              <PullRequestActions
                detail={detail.detail}
                base={view.base}
                dirty={view.dirty}
                /* Null rather than a disabled flag beside a handler that could
                   not run: the guard would be one nothing can reach, and a
                   check nothing reaches is a claim nothing tests. */
                onPrompt={
                  chatId === null
                    ? null
                    : (kind: InstructionKind) => {
                        prompt(kind, request, chatId)
                      }
                }
                sending={sending}
                onMerge={(method: MergeMethod) => {
                  merge(request.number, method)
                }}
                merging={merging}
                onCommitAndPush={() => {
                  commitAndPush(t('pullRequest.answerCommit'))
                }}
                committing={committing}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Section({
  title,
  children
}: {
  readonly title: string
  readonly children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-1">
      <h2 className="section-label">{title}</h2>
      {children}
    </section>
  )
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
