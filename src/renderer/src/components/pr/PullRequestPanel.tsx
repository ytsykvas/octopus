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
  /**
   * Tells the window the branch's request has changed.
   *
   * The list marks every branch of the project from one read, and that read has
   * a minute on its clock — long enough that merging here would leave the row
   * beside the pane still saying the request was open.
   */
  readonly onRequestChanged: () => void
  /** Opens the project's own instructions, which are what would be sent. */
  readonly onEditInstructions: () => void
  /** Says what went wrong where the window already says such things. */
  readonly onError: (message: string) => void
  /**
   * Removes a workspace, asking first — offered once its request is merged.
   *
   * By id rather than closed over the workspace above, so the caller needs no
   * guard for the case where there is none: this pane returns early without
   * one, and a check nothing can reach is a claim nothing tests.
   */
  readonly onRemoveWorkspace: (workspaceId: string) => void
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
  onRequestChanged,
  onEditInstructions,
  onError,
  onRemoveWorkspace
}: PullRequestPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const describeFailure = useErrorMessage()

  const workspaceId = workspace?.id ?? null
  const { view, loading, error, creating, create, drafting, actionError, draft, refresh } =
    usePullRequest(workspaceId, visible)
  const request = view?.request ?? null
  const detail = usePullRequestDetail(workspaceId, request?.number ?? null, visible)

  /** Which prepared message is in flight, so its own button says so. */
  const [sending, setSending] = useState<InstructionKind | null>(null)
  const [merging, setMerging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)

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
  }, [visible, workspace, envFile])

  if (!workspace) return <Notice>{t('pullRequest.noWorkspace')}</Notice>
  if (error !== null) return <Notice tone="danger">{error}</Notice>
  if (loading || !view) return <Notice>{t('pullRequest.loading')}</Notice>

  const report = (failure: Failure): void => {
    onError(describeFailure(failure))
  }

  /* The checks that went red, which is what the fix prompt is about. Empty
     where the detail could not be read — which is also where the button that
     sends it is not drawn. */
  const failed = (detail.detail?.checks ?? []).filter((check) => check.state === 'failed')

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

      /* Which checks failed, named for the one prompt that is about them. Not
         appended to the others: the list reads as a list of things to put right
         only under the prose that says so, and under "review it" it would be a
         paragraph nothing had asked for. */
      const failures =
        kind === 'fixChecks'
          ? t('pullRequest.failedChecks', {
              list: failed
                .map((check) =>
                  check.url === null
                    ? t('pullRequest.failedCheckNoLink', { name: check.name })
                    : t('pullRequest.failedCheck', { name: check.name, url: check.url })
                )
                .join('\n')
            })
          : ''

      const sent = await window.octopus.chats.send(
        conversation,
        [instruction.value.trim(), context, failures].filter((part) => part !== '').join('\n\n')
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
      onRequestChanged()
    })()
  }

  /*
   * Closing, which is the other way a request ends.
   *
   * The same shape as merging above, and for the same reason: reading again is
   * what the pane believes, not what the call answered.
   */
  const close = (number: number): void => {
    setClosing(true)
    void (async () => {
      const result = await window.octopus.workspaces.closePullRequest(workspace.id, number)
      setClosing(false)
      if (!result.ok) report(result)

      refresh()
      detail.refresh()
      onRequestChanged()
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

  /*
   * Sends what is committed and nothing else.
   *
   * The same shape as the two above: read again either way, because what the
   * pane believes is the fresh reading rather than what the call answered. The
   * request's detail too — pushing is what starts the checks again.
   */
  const push = (): void => {
    setPushing(true)
    void (async () => {
      const result = await window.octopus.workspaces.push(workspace.id)
      setPushing(false)
      if (!result.ok) report(result)

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
            onCreate={(request: PullRequestDraft) => void create(request)}
            drafting={drafting}
            onDraft={draft}
            actionError={actionError}
            onEditInstructions={onEditInstructions}
            exposedEnvFile={envIgnored ? null : envFile}
          />
        )
      ) : (
        <>
          <PullRequestSummary
            request={request}
            detail={detail.detail}
            readAt={detail.readAt}
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
                  onReply={async (threadId, body) => {
                    const result = await window.octopus.workspaces.replyToReviewThread(
                      workspace.id,
                      threadId,
                      body
                    )
                    if (!result.ok) {
                      report(result)
                      return false
                    }
                    // Read again rather than adding the reply to what is on
                    // screen: GitHub decides what a comment ends up looking
                    // like, and a pane that draws its own guess is a pane that
                    // can disagree with the request it is showing.
                    detail.refresh()
                    return true
                  }}
                  onSetResolved={async (threadId, resolved) => {
                    const result = await window.octopus.workspaces.setReviewThreadResolved(
                      workspace.id,
                      threadId,
                      resolved
                    )
                    if (!result.ok) report(result)
                    else detail.refresh()
                  }}
                />

                {/* A truncation nobody wrote down is one somebody eventually
                    debugs. Three ceilings sit behind this and none is worth
                    raising — past them the pane needs a search box rather than
                    a longer page — so what is owed is saying that what is here
                    is not all there is. Only when a read came back full, or the
                    line would be an apology on every request. */}
                {detail.detail.capped && (
                  <p className="text-ink-faint mt-2 leading-relaxed">{t('pullRequest.capped')}</p>
                )}
              </Section>

              <PullRequestActions
                detail={detail.detail}
                base={view.base}
                dirty={view.dirty}
                exposedEnvFile={envIgnored ? null : envFile}
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
                onClose={() => {
                  close(request.number)
                }}
                closing={closing}
                onCommitAndPush={() => {
                  commitAndPush(t('pullRequest.answerCommit'))
                }}
                committing={committing}
                onPush={push}
                pushing={pushing}
                unpushedCommits={view.unpushedCommits}
                onRemoveWorkspace={() => {
                  onRemoveWorkspace(workspace.id)
                }}
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
