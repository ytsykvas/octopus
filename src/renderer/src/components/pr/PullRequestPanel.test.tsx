import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { PullRequest, PullRequestView } from '@core/pullRequests.js'
import type { PullRequestComment, PullRequestDetail } from '@core/pullRequestShapes.js'

import { quoteController } from '../../test/comments.js'
import { held } from '../../test/held.js'
import { octopus } from '../../test/octopus.js'
import { workspaceView } from '../../test/workspaces.js'
import { PullRequestPanel } from './PullRequestPanel.js'

const anna = workspaceView('anna')

/** A branch with commits and no pull request — the state that offers the form. */
function view(overrides: Partial<PullRequestView> = {}): PullRequestView {
  return { request: null, pushed: true, dirty: false, ahead: 2, base: 'main', ...overrides }
}

/** A pull request as `gh` reports one — all four fields, never some of them. */
function request(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 7,
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    ...overrides
  }
}

function detail(overrides: Partial<PullRequestDetail> = {}): PullRequestDetail {
  return {
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/o/p/pull/7',
    draft: false,
    checks: [],
    comments: [],
    decision: null,
    mergeable: 'mergeable',
    mergeState: 'clean',
    ...overrides
  }
}

type InlineComment = Extract<PullRequestComment, { kind: 'inline' }>

function inline(overrides: Partial<InlineComment> = {}): InlineComment {
  return {
    kind: 'inline' as const,
    id: 'PRRC_1',
    author: 'olena',
    body: 'Why the second case?',
    createdAt: '2026-08-20T11:00:00Z',
    url: 'https://github.com/o/p/pull/7#discussion_r1',
    path: 'src/core/git.ts',
    line: 42,
    quote: '@@ -1 +1 @@\n-const a = 1',
    resolved: false,
    ...overrides
  }
}

function answer(value: PullRequestView): void {
  vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({ ok: true, value })
}

function answerDetail(value: PullRequestDetail): void {
  vi.mocked(octopus().workspaces.pullRequestDetail).mockResolvedValue({ ok: true, value })
}

function renderPanel(
  overrides: {
    workspace?: typeof anna | null
    visible?: boolean
    chatId?: string | null
    envFile?: string
    quotes?: ReturnType<typeof quoteController>
  } = {}
): {
  onEditInstructions: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  onRequestChanged: ReturnType<typeof vi.fn>
  quotes: ReturnType<typeof quoteController>
} {
  const onEditInstructions = vi.fn()
  const onError = vi.fn()
  const onRequestChanged = vi.fn()
  const quotes = overrides.quotes ?? quoteController()

  render(
    <PullRequestPanel
      workspace={overrides.workspace === undefined ? anna : overrides.workspace}
      visible={overrides.visible ?? true}
      chatId={overrides.chatId === undefined ? 'chat-1' : overrides.chatId}
      quotes={quotes}
      envFile={overrides.envFile ?? '.env'}
      onRequestChanged={onRequestChanged}
      onEditInstructions={onEditInstructions}
      onError={onError}
    />
  )

  return { onEditInstructions, onError, onRequestChanged, quotes }
}

describe('the pull request tab', () => {
  it('asks for a workspace before anything else', () => {
    renderPanel({ workspace: null })

    expect(
      screen.getByText('Select a workspace to open a pull request for it.')
    ).toBeInTheDocument()
    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
  })

  /*
   * The one rule that matters more here than on the diff: this leaves the
   * machine. A hidden tab reading on every workspace opened would be a network
   * call each time, for a pane nobody is looking at.
   */
  it('asks GitHub nothing while another tab is showing', () => {
    renderPanel({ visible: false })

    expect(octopus().workspaces.pullRequest).not.toHaveBeenCalled()
    expect(octopus().workspaces.pullRequestDetail).not.toHaveBeenCalled()
  })

  /*
   * The instruction is the project's, and it is edited where it lives. A second
   * editor here would be a second place for the two to disagree.
   */
  /* A branch that cannot be described at all is a different failure from one
     whose checks are missing: this one blanks the pane, because there is
     nothing left on it that is true. */
  it('says nothing about a branch GitHub could not be asked about', async () => {
    vi.mocked(octopus().workspaces.pullRequest).mockResolvedValue({
      ok: false,
      error: 'gh: not logged in',
      code: 'notConnected'
    })
    renderPanel()

    expect(await screen.findByText(/Could not reach GitHub/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument()
  })

  // The answer belongs to a pane that is no longer there.
  it('drops what git says about the env file after the tab has gone', async () => {
    const gate = held<{ ok: true; value: boolean }>()
    vi.mocked(octopus().projects.isEnvIgnored).mockReturnValue(gate.promise)
    answer(view({ dirty: true }))

    const { unmount } = render(
      <PullRequestPanel
        workspace={anna}
        visible
        chatId="chat-1"
        quotes={quoteController()}
        envFile=".env"
        onRequestChanged={vi.fn()}
        onEditInstructions={vi.fn()}
        onError={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(octopus().projects.isEnvIgnored).toHaveBeenCalled()
    })
    unmount()

    gate.resolve({ ok: true, value: false })
    await waitFor(() => {
      expect(screen.queryByText(/\.env/)).not.toBeInTheDocument()
    })
  })

  it('sends the reader to the project instructions rather than editing them here', async () => {
    const user = userEvent.setup()
    answer(view())
    const { onEditInstructions } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Instructions for a new PR' }))

    expect(onEditInstructions).toHaveBeenCalledOnce()
  })

  it('says nothing can be opened from a branch with nothing on it', async () => {
    answer(view({ ahead: 0, dirty: false }))
    renderPanel()

    expect(await screen.findByText(/no commits that main does not/)).toBeInTheDocument()
  })

  /*
   * Uncommitted work used to be the end of the road here — the pane said so and
   * left the reader to the terminal. The field is what makes the same workspace
   * one press from a request.
   */
  it('offers to commit when the work is not committed yet', async () => {
    const user = userEvent.setup()
    answer(view({ ahead: 0, dirty: true }))
    renderPanel()

    await user.type(await screen.findByLabelText('Commit message'), 'Add the thing')
    await user.type(screen.getByLabelText('Title'), 'Add the thing')
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(octopus().workspaces.createPullRequest).toHaveBeenCalledWith(anna.id, {
      title: 'Add the thing',
      body: '',
      draft: false,
      commitMessage: 'Add the thing'
    })
  })

  // Null rather than an empty string: the difference between "open it from what
  // is committed" and a message nobody typed, which git refuses.
  it('opens from what is already committed when the field is left alone', async () => {
    const user = userEvent.setup()
    answer(view({ dirty: true }))
    renderPanel()

    await user.type(await screen.findByLabelText('Title'), 'Rename the thing')
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(octopus().workspaces.createPullRequest).toHaveBeenCalledWith(
      anna.id,
      expect.objectContaining({ commitMessage: null })
    )
  })

  it('carries the description and the draft flag it was given', async () => {
    const user = userEvent.setup()
    answer(view())
    renderPanel()

    await user.type(await screen.findByLabelText('Title'), 'Rename the thing')
    await user.type(screen.getByLabelText('Description'), 'Because it was wrong.')
    await user.click(screen.getByLabelText('Open as a draft'))
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(octopus().workspaces.createPullRequest).toHaveBeenCalledWith(anna.id, {
      title: 'Rename the thing',
      body: 'Because it was wrong.',
      draft: true,
      commitMessage: null
    })
  })

  /*
   * A class assertion, which is normally the wrong thing to write — it tests a
   * look rather than what a person can do.
   *
   * It earns its place here because the class is what makes this control exist:
   * `.choice` is `appearance: none` plus the box and the tick painted by hand,
   * and it was written for the input. Put on the label instead, it sized the
   * label at 0.875rem and the words wrapped inside a square the size of a tick,
   * overlapping the button below.
   *
   * Nothing else catches that. jsdom computes no layout, so the checkbox stayed
   * reachable by its accessible name throughout — the test above passed against
   * the broken form.
   */
  it('paints the checkbox on the input, where the class is defined', async () => {
    answer(view())
    renderPanel()

    const checkbox = await screen.findByLabelText('Open as a draft')
    expect(checkbox).toHaveClass('choice')
    expect(checkbox.closest('label')).not.toHaveClass('choice')
  })

  // Said before the button rather than after it fails: pushing happens to
  // somebody else's machine and should not be a surprise.
  it('says it will push a branch that is not on GitHub yet', async () => {
    answer(view({ pushed: false }))
    renderPanel()

    expect(await screen.findByText(/not on GitHub yet/)).toBeInTheDocument()
  })

  /* The pane says what GitHub refused rather than leaving the form looking as
     though the press did nothing. */
  it('says why the request could not be opened', async () => {
    const user = userEvent.setup()
    answer(view())
    vi.mocked(octopus().workspaces.createPullRequest).mockResolvedValue({
      ok: false,
      error: 'push failed',
      code: 'pushFailed',
      params: { branch: 'octopus/anna' }
    })
    renderPanel()

    await user.type(await screen.findByLabelText('Title'), 'Rename the thing')
    await user.click(screen.getByRole('button', { name: 'Open pull request' }))

    expect(await screen.findByText(/octopus\/anna/)).toBeInTheDocument()
  })

  it('does not offer to commit where there is nothing uncommitted', async () => {
    answer(view({ dirty: false }))
    renderPanel()

    await screen.findByLabelText('Title')
    expect(screen.queryByLabelText('Commit message')).not.toBeInTheDocument()
  })

  /*
   * octopus writes this workspace's variables into that file. A project whose
   * `.gitignore` does not cover it would have the app commit its own
   * credentials and then push them — said beside the field rather than found
   * out on GitHub.
   */
  it('warns before committing an env file git does not ignore', async () => {
    const user = userEvent.setup()
    answer(view({ dirty: true }))
    vi.mocked(octopus().projects.isEnvIgnored).mockResolvedValue({ ok: true, value: false })
    renderPanel({ envFile: '.env.local' })

    await user.type(await screen.findByLabelText('Commit message'), 'Add the thing')

    expect(await screen.findByText(/\.env\.local/)).toBeInTheDocument()
  })

  it('says nothing about the env file where git ignores it', async () => {
    const user = userEvent.setup()
    answer(view({ dirty: true }))
    renderPanel({ envFile: '.env.local' })

    await user.type(await screen.findByLabelText('Commit message'), 'Add the thing')

    expect(screen.queryByText(/\.env\.local/)).not.toBeInTheDocument()
  })
})

describe('a pull request that exists', () => {
  it('reads GitHub again when asked', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Read GitHub again' }))

    await waitFor(() => {
      expect(octopus().workspaces.pullRequest).toHaveBeenCalledTimes(2)
    })
    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
  })

  it('names it, and reads what GitHub has made of it', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ decision: 'approved' }))
    renderPanel()

    expect(await screen.findByText('Pull request #7 is open.')).toBeInTheDocument()
    // Awaited rather than read: the summary and the detail come back on two
    // channels, so the number is on screen a tick before the verdict is.
    expect(await screen.findByText('Approved')).toBeInTheDocument()
    expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledWith(anna.id, 7)
  })

  it('draws each check with the word for its state, not only a colour', async () => {
    answer(view({ request: request() }))
    answerDetail(
      detail({
        checks: [
          {
            name: 'lint',
            workflow: 'Lint',
            state: 'failed',
            url: 'https://github.com/o/p/runs/1',
            startedAt: '2026-08-20T11:00:00Z',
            completedAt: null
          },
          {
            name: 'build',
            workflow: null,
            state: 'pending',
            url: null,
            startedAt: null,
            completedAt: null
          }
        ]
      })
    )
    renderPanel()

    expect(await screen.findByText('lint')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()
  })

  it('says so where the repository runs no checks', async () => {
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    expect(
      await screen.findByText('This repository runs nothing on a pull request.')
    ).toBeInTheDocument()
  })

  it('marks a draft and says a draft cannot be merged', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ draft: true }))
    renderPanel()

    expect(await screen.findByText('Draft')).toBeInTheDocument()
    expect(screen.getByText(/draft cannot be merged/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()
  })

  /*
   * `mergeable` answers whether the trees conflict and `mergeStateStatus`
   * whether the merge would go through — GitHub answers `MERGEABLE` beside
   * `BLOCKED` whenever a required review is missing, and the pane has to say
   * which of the two is in the way.
   */
  it('says why GitHub is holding a mergeable request back', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ mergeable: 'mergeable', mergeState: 'blocked' }))
    const { quotes } = renderPanel()

    expect(await screen.findByText(/required review or check is missing/)).toBeInTheDocument()
    expect(quotes.add).not.toHaveBeenCalled()
  })

  it('says when the base has moved on', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ mergeState: 'behind' }))
    renderPanel()

    expect(await screen.findByText(/main has moved on/)).toBeInTheDocument()
  })

  /* Mergeable and worth a word: nothing is stopping the merge, but a check has
     not passed and pressing it anyway should be a decision rather than a slip. */
  it('says when a check has not passed without standing in the way', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ mergeState: 'unstable' }))
    renderPanel()

    expect(await screen.findByText(/check has not passed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeEnabled()
  })

  it('keeps a settled thread apart from an open one', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ comments: [inline({ resolved: true })] }))
    renderPanel()

    expect(await screen.findByText('resolved')).toBeInTheDocument()
  })

  // GitHub models a deleted account as no author at all, and the remark is
  // still worth reading.
  it('names a deleted account rather than leaving the line blank', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ comments: [inline({ author: null })] }))
    renderPanel()

    expect(await screen.findByText('a deleted account')).toBeInTheDocument()
  })

  it('shows a remark with its author, its place and the lines it is about', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ comments: [inline()] }))
    renderPanel()

    expect(await screen.findByText('olena')).toBeInTheDocument()
    expect(screen.getByText('git.ts:42')).toBeInTheDocument()
    expect(screen.getByText(/const a = 1/)).toBeInTheDocument()
  })

  /*
   * Attaches rather than sends: the reader has a question about the remark, and
   * the question is the point.
   */
  it('puts a remark in the composer rather than sending it', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail({ comments: [inline()] }))
    const { quotes } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Add to chat' }))

    expect(quotes.add).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'inline:PRRC_1',
        reference: '#7',
        author: 'olena',
        place: 'src/core/git.ts:42'
      })
    )
    expect(octopus().chats.send).not.toHaveBeenCalled()
  })

  it('does not offer the same remark twice', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ comments: [inline()] }))
    renderPanel({
      quotes: quoteController({
        pending: [
          {
            key: 'inline:PRRC_1',
            reference: '#7',
            author: 'olena',
            place: 'src/core/git.ts:42',
            quote: null,
            body: 'Why the second case?'
          }
        ]
      })
    })

    expect(await screen.findByRole('button', { name: 'Add to chat' })).toBeDisabled()
  })

  /*
   * The detail failing is not the branch failing. The number, the title and the
   * link are still worth having, so the pane says what is missing rather than
   * blanking.
   */
  it('keeps the request on screen when its checks could not be read', async () => {
    answer(view({ request: request() }))
    vi.mocked(octopus().workspaces.pullRequestDetail).mockResolvedValue({
      ok: false,
      error: 'gh: not logged in',
      code: 'notConnected'
    })
    renderPanel()

    expect(await screen.findByText('Pull request #7 is open.')).toBeInTheDocument()
    expect(await screen.findByText(/Could not reach GitHub/)).toBeInTheDocument()
  })
})

describe('what the tab can do about a request', () => {
  it('sends the project instruction and names the request beneath it', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Review it' }))

    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(anna.id, 'review')
    const sent = vi.mocked(octopus().chats.send).mock.calls[0]?.[1] ?? ''
    expect(sent).toContain('Describe what changed and why.')
    expect(sent).toContain('#7')
    expect(sent).toContain(anna.branch)
    expect(sent).toContain('main')
  })

  it('has a button for each of the reviews it can ask for', async () => {
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Review it' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Multi-agent review' })).toBeInTheDocument()
  })

  /*
   * On a repository with no required reviewers GitHub sends an empty decision
   * essentially always, so the button cannot be gated on `changesRequested`
   * alone — it would never appear on exactly the projects this app is for.
   */
  it('offers to answer the review once anybody has said anything', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ decision: null, comments: [inline()] }))
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Address the review' })).toBeInTheDocument()
  })

  it('does not offer to answer a review nobody has left', async () => {
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    await screen.findByRole('button', { name: 'Review it' })
    expect(screen.queryByRole('button', { name: 'Address the review' })).not.toBeInTheDocument()
  })

  it('will not send a prepared message without a conversation to send it to', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ mergeable: 'conflicting' }))
    renderPanel({ chatId: null })

    const button = await screen.findByRole('button', { name: 'Review it' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Open a conversation in this workspace first.')
    // Including the one that appears against a conflict, which is drawn apart
    // from the others and would otherwise be the one that stayed pressable.
    expect(screen.getByRole('button', { name: 'Resolve the conflicts' })).toBeDisabled()
  })

  // The verdict is the whole of a bare approval, and the list has to draw one
  // that carries no words at all.
  it('shows a review that is a verdict and nothing else', async () => {
    answer(view({ request: request() }))
    answerDetail(
      detail({
        comments: [
          {
            kind: 'review',
            id: 'PRR_1',
            author: 'olena',
            body: '',
            createdAt: '2026-08-20T11:00:00Z',
            url: null,
            verdict: 'approved'
          }
        ]
      })
    )
    renderPanel()

    expect(await screen.findByText('approved')).toBeInTheDocument()
  })

  it('says why when the instruction could not be read', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    vi.mocked(octopus().workspaces.instruction).mockResolvedValue({
      ok: false,
      error: 'EACCES: permission denied'
    })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Review it' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('EACCES'))
    })
    expect(octopus().chats.send).not.toHaveBeenCalled()
  })

  it('says why when the message could not be sent', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    vi.mocked(octopus().chats.send).mockResolvedValue({ ok: false, error: 'no such chat' })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Review it' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('no such chat'))
    })
  })

  it('offers to resolve a conflict instead of merging through one', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail({ mergeable: 'conflicting', mergeState: 'dirty' }))
    renderPanel()

    expect(await screen.findByText('This branch conflicts with main.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Merge' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Resolve the conflicts' }))

    expect(octopus().workspaces.instruction).toHaveBeenCalledWith(anna.id, 'resolveConflicts')
  })

  /*
   * GitHub computes mergeability asynchronously, so the first read after every
   * push says it does not know. Refusing to merge on that refuses a request
   * that is perfectly mergeable.
   */
  it('still offers to merge while GitHub is working out whether it can', async () => {
    answer(view({ request: request() }))
    answerDetail(detail({ mergeable: 'unknown', mergeState: 'unknown' }))
    renderPanel()

    expect(await screen.findByRole('button', { name: 'Merge' })).toBeEnabled()
    expect(screen.queryByText(/conflicts with/)).not.toBeInTheDocument()
  })

  it('merges by the method that was chosen, and reads the state again', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Merge' }))
    await user.click(screen.getByRole('menuitem', { name: 'Squash and merge' }))

    expect(octopus().workspaces.mergePullRequest).toHaveBeenCalledWith(anna.id, 7, 'squash')
    // `gh` enables auto-merge rather than merging when a required check has not
    // passed, so success is not proof of a merge.
    await waitFor(() => {
      expect(octopus().workspaces.pullRequestDetail).toHaveBeenCalledTimes(2)
    })
  })

  it('says why GitHub would not merge', async () => {
    const user = userEvent.setup()
    answer(view({ request: request() }))
    answerDetail(detail())
    vi.mocked(octopus().workspaces.mergePullRequest).mockResolvedValue({
      ok: false,
      error: 'not mergeable',
      code: 'mergeFailed',
      params: { number: '7' }
    })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Merge' }))
    await user.click(screen.getByRole('menuitem', { name: 'Merge commit' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('7'))
    })
  })

  /*
   * Without this the loop does not close: the agent answers the review, and the
   * only way to get that answer onto the request is the terminal.
   */
  it('commits and pushes an answer to the review', async () => {
    const user = userEvent.setup()
    answer(view({ request: request(), dirty: true }))
    answerDetail(detail())
    renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Commit and push' }))

    expect(octopus().workspaces.commitAndPush).toHaveBeenCalledWith(anna.id, expect.any(String))
  })

  it('says why the commit did not land', async () => {
    const user = userEvent.setup()
    answer(view({ request: request(), dirty: true }))
    answerDetail(detail())
    vi.mocked(octopus().workspaces.commitAndPush).mockResolvedValue({
      ok: false,
      error: 'nothing to commit',
      code: 'nothingToCommit'
    })
    const { onError } = renderPanel()

    await user.click(await screen.findByRole('button', { name: 'Commit and push' }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('nothing here to commit'))
    })
  })

  it('does not offer to commit where there is nothing to commit', async () => {
    answer(view({ request: request(), dirty: false }))
    answerDetail(detail())
    renderPanel()

    await screen.findByRole('button', { name: 'Review it' })
    expect(screen.queryByRole('button', { name: 'Commit and push' })).not.toBeInTheDocument()
  })

  // A merged request has nothing left to do to it, and "review it" on one is a
  // reading of history rather than of a change.
  it('offers nothing to do to a request that has been merged', async () => {
    answer(view({ request: request({ state: 'merged' }) }))
    answerDetail(detail({ state: 'merged' }))
    renderPanel()

    expect(await screen.findByText('Pull request #7 was merged.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Merge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review it' })).not.toBeInTheDocument()
  })
})
