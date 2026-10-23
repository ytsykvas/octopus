import { GitCommitHorizontal, GitPullRequest, RotateCw, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { InstructionKind } from '@core/instructions.js'
import type { MergeMethod, PullRequest, PullRequestDraft } from '@core/pullRequests.js'
import {
  type PullRequestComment,
  type RerunScope,
  summariseChecks
} from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

import type { Failure } from '../../../../preload/index.js'
import { useErrorMessage } from '../../hooks/useErrorMessage.js'
import { usePullRequest } from '../../hooks/usePullRequest.js'
import { usePullRequestDetail } from '../../hooks/usePullRequestDetail.js'
import { type PullRequestQuoteController, toQuote } from '../../hooks/usePullRequestQuotes.js'
import { Button } from '../Button.js'
import { Notice } from '../paneControls.js'
import { Placeholder } from '../Placeholder.js'
import { ChecksList } from './ChecksList.js'
import { CommentList } from './CommentList.js'
import { MergeConditions } from './MergeConditions.js'
import { NewPullRequestForm } from './NewPullRequestForm.js'
import { PaneFooter, PullRequestFooter } from './PullRequestFooter.js'
import { PullRequestHeader } from './PullRequestHeader.js'
import { type RequestView, requestStatus } from './requestStatus.js'
import { StatusTiles } from './StatusTiles.js'

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
  /**
   * A prompt is on its way to the conversation, so it comes to the front of the
   * centre — a turn started behind an open file could raise no dialog at all.
   */
  readonly onConversation: () => void
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
  onRemoveWorkspace,
  onConversation
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
  const [rerunning, setRerunning] = useState<RerunScope | null>(null)
  const [committing, setCommitting] = useState(false)
  const [pushing, setPushing] = useState(false)
  /** The view the reader picked, and for which request — see `shown` below. */
  const [chosen, setChosen] = useState<{ number: number; view: RequestView } | null>(null)

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

  /*
   * Tell the list when the checks change under it.
   *
   * The list reads the whole project on its own clock, so a run finishing was
   * on this tab for as long as it took that clock to come round, while the row
   * kept spinning. The first reading is not a change — there is nothing to
   * compare it with — and a different request resets `detail` to null, which
   * starts the comparison over.
   */
  const checksSummary = detail.detail === null ? null : summariseChecks(detail.detail.checks)
  const shownChecks = useRef(checksSummary)

  useEffect(() => {
    const before = shownChecks.current
    shownChecks.current = checksSummary
    if (before !== null && checksSummary !== null && before !== checksSummary) onRequestChanged()
  }, [checksSummary, onRequestChanged])

  if (!workspace) {
    return (
      <Placeholder compact title={t('pullRequest.noWorkspaceTitle')}>
        {t('pullRequest.noWorkspaceBody')}
      </Placeholder>
    )
  }
  if (error !== null) {
    return (
      <Notice tone="danger">
        {error}
        <span className="mt-2 block">
          <Button size="sm" onClick={refresh}>
            <RotateCw aria-hidden size={11} />
            {t('pullRequest.tryAgain')}
          </Button>
        </span>
      </Notice>
    )
  }
  if (loading || !view) {
    return (
      <Notice>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="agent-arc" />
          {t('pullRequest.loading')}
        </span>
      </Notice>
    )
  }

  const report = (failure: Failure): void => {
    onError(describeFailure(failure))
  }

  /* Read once for every part of the pane, beside the detail it is read from, so
     no part can be drawn from one without the other. */
  const read =
    detail.detail === null
      ? null
      : {
          detail: detail.detail,
          status: requestStatus(detail.detail, {
            dirty: view.dirty,
            unpushedCommits: view.unpushedCommits
          })
        }

  /* The checks that went red, which is what the fix prompt is about. Empty
     where the detail could not be read — which is also where the button that
     sends it is not drawn. */
  const failed = read?.status.failedChecks ?? []

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
    onConversation()
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

      // Named so the app can push once a prompt that changes the branch is done.
      const sent = await window.octopus.chats.send(
        conversation,
        [instruction.value.trim(), context, failures].filter((part) => part !== '').join('\n\n'),
        { instruction: kind }
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

  /*
   * Restarts CI, the same shape as closing: the fresh reading is what the pane
   * believes, and the list's mark goes back to spinning along with the rows.
   */
  const rerun = (number: number, scope: RerunScope): void => {
    setRerunning(scope)
    void (async () => {
      const result = await window.octopus.workspaces.rerunChecks(workspace.id, number, scope)
      setRerunning(null)
      if (!result.ok) report(result)

      detail.refresh()
      onRequestChanged()
    })()
  }

  const commitAndPush = (message: string): void => {
    setCommitting(true)
    void (async () => {
      // An empty message is the field left blank on purpose: fold into the last commit.
      const result =
        message === ''
          ? await window.octopus.workspaces.amendAndPush(workspace.id)
          : await window.octopus.workspaces.commitAndPush(workspace.id, message)
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
  const exposedEnvFile = envIgnored ? null : envFile

  const header = (
    <PullRequestHeader
      request={request}
      detail={detail.detail}
      readAt={detail.readAt}
      onRefresh={() => {
        refresh()
        detail.refresh()
      }}
      branch={workspace.branch}
      base={view.base}
    />
  )

  if (request === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}

        {view.ahead === 0 && !view.dirty ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto p-6 text-center">
              <span className="bg-muted text-ink-soft flex size-9 items-center justify-center rounded-full">
                <GitCommitHorizontal aria-hidden size={16} />
              </span>
              {/* The instruction is the project's own, edited where it lives
                  rather than in a second editor here that could disagree. */}
              <Button size="sm" onClick={onEditInstructions}>
                <SlidersHorizontal aria-hidden size={12} />
                {t('pullRequest.editInstructions')}
              </Button>
            </div>

            <PaneFooter>
              <div className="flex items-center gap-2">
                <p className="text-ink-faint min-w-0 flex-1 text-[12px] leading-snug">
                  {t('pullRequest.nothingToOpen', { base: view.base })}
                </p>
                <Button size="sm" variant="success" disabled>
                  <GitPullRequest aria-hidden size={12} />
                  {t('pullRequest.create')}
                </Button>
              </div>
            </PaneFooter>
          </>
        ) : (
          <NewPullRequestForm
            view={view}
            creating={creating}
            onCreate={(request: PullRequestDraft) => void create(request)}
            drafting={drafting}
            onDraft={draft}
            actionError={actionError}
            onEditInstructions={onEditInstructions}
            exposedEnvFile={exposedEnvFile}
          />
        )}
      </div>
    )
  }

  /* The view the reader picked holds for as long as the request is the same
     one; until then, and for the next request, the pane shows the one that
     answers the question the request is asking. Derived rather than reset in
     an effect, so there is no frame in which a new request shows the old
     choice. */
  const shown: RequestView =
    chosen?.number === request.number ? chosen.view : (read?.status.recommendedView ?? 'merge')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}

      {/* The detail failing is not the branch failing: the number, the title
          and the link above are still worth having, so this says what is
          missing rather than blanking the pane. */}
      {detail.error !== null && (
        <p className="text-danger px-3 pb-3 leading-relaxed">{detail.error}</p>
      )}

      {read !== null && (
        <>
          <StatusTiles
            detail={read.detail}
            status={read.status}
            view={shown}
            onView={(next) => {
              setChosen({ number: request.number, view: next })
            }}
          />

          {/* All three stay mounted and only the shown one is drawn: a reply
              half typed under a thread must survive a look at the checks. */}
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
            <div
              role="region"
              aria-label={t('pullRequest.checks')}
              hidden={shown !== 'checks'}
              className="space-y-2"
            >
              <ChecksList checks={read.detail.checks} />

              {/* Only while something is red: restarting a green suite is a
                  thing nobody reaches for, and two buttons on every request
                  would be noise beside the one moment they matter. */}
              {failed.length > 0 && (
                <div className="flex gap-1">
                  {RERUNS.map(({ scope, labelKey, titleKey }) => (
                    <Button
                      key={scope}
                      size="sm"
                      title={t(titleKey)}
                      disabled={rerunning !== null}
                      onClick={() => {
                        rerun(request.number, scope)
                      }}
                    >
                      <RotateCw
                        aria-hidden
                        size={11}
                        className={rerunning === scope ? 'animate-spin' : ''}
                      />
                      {t(labelKey)}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            <div
              role="region"
              aria-label={t('pullRequest.review')}
              hidden={shown !== 'review'}
              className="space-y-2"
            >
              <CommentList
                comments={read.detail.comments}
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
                  raising — past them the pane needs a search box rather than a
                  longer page — so what is owed is saying that what is here is
                  not all there is. Only when a read came back full, or the
                  line would be an apology on every request. */}
              {read.detail.capped && (
                <p className="text-ink-faint leading-relaxed">{t('pullRequest.capped')}</p>
              )}
            </div>

            <div role="region" aria-label={t('pullRequest.merge')} hidden={shown !== 'merge'}>
              <MergeConditions
                number={request.number}
                status={read.status}
                base={view.base}
                onClose={() => {
                  close(request.number)
                }}
                closing={closing}
                merging={merging}
              />
            </div>
          </div>

          <PullRequestFooter
            status={read.status}
            base={view.base}
            dirty={view.dirty}
            exposedEnvFile={exposedEnvFile}
            /* Null rather than a disabled flag beside a handler that could not
               run: the guard would be one nothing can reach, and a check
               nothing reaches is a claim nothing tests. */
            onPrompt={
              chatId === null
                ? null
                : (kind: InstructionKind) => {
                    prompt(kind, request, chatId)
                  }
            }
            sending={sending}
            onEditInstructions={onEditInstructions}
            onMerge={(method: MergeMethod) => {
              merge(request.number, method)
            }}
            merging={merging}
            onCommitAndPush={commitAndPush}
            ahead={view.ahead}
            committing={committing}
            onPush={push}
            pushing={pushing}
            onRemoveWorkspace={() => {
              onRemoveWorkspace(workspace.id)
            }}
          />
        </>
      )}
    </div>
  )
}

/** The two re-runs, in the order they are drawn. */
const RERUNS: readonly {
  readonly scope: RerunScope
  readonly labelKey: 'pullRequest.rerunFailed' | 'pullRequest.rerunAll'
  readonly titleKey: 'pullRequest.rerunFailedTitle' | 'pullRequest.rerunAllTitle'
}[] = [
  {
    scope: 'failed',
    labelKey: 'pullRequest.rerunFailed',
    titleKey: 'pullRequest.rerunFailedTitle'
  },
  { scope: 'all', labelKey: 'pullRequest.rerunAll', titleKey: 'pullRequest.rerunAllTitle' }
]
