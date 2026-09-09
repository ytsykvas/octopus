import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { RemoteRepository, RepositoryList } from '@core/github.js'
import type { Project } from '@core/store.js'

import type { Result } from '../../../preload/index.js'
import { stubDialogElement } from '../test/dialog.js'
import { RepositoryPicker } from './RepositoryPicker.js'

type PickerProps = React.ComponentProps<typeof RepositoryPicker>

function repository(overrides: Partial<RemoteRepository> = {}): RemoteRepository {
  return {
    name: 'planner',
    nameWithOwner: 'ytsykvas/planner',
    owner: { login: 'ytsykvas' },
    description: 'Weekly planning',
    isPrivate: false,
    updatedAt: '2026-08-01T00:00:00.000Z',
    defaultBranchRef: { name: 'main' },
    ...overrides
  }
}

/** What a finished clone comes back as. */
function cloned(): Project {
  return {
    id: 'planner',
    name: 'planner',
    repoPath: '/Users/someone/code/planner',
    baseBranch: 'origin/main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'default',
    trustRepoScripts: false,
    disabledSkillDefaults: [],
    color: 'blue'
  }
}

/** A call the test answers when it chooses, standing in for slow IPC. */
function pending<T>(): { promise: Promise<T>; settle: (value: T) => void } {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((capture) => {
    resolve = capture
  })

  return {
    promise,
    settle: (value) => {
      resolve?.(value)
    }
  }
}

function offer(...repositories: readonly RemoteRepository[]): void {
  vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
    ok: true,
    value: { repositories: [...repositories], capped: false, organisations: [] }
  })
}

/** The same, plus the organisations the account belongs to. */
function offerBelonging(
  organisations: readonly string[],
  ...repositories: readonly RemoteRepository[]
): void {
  vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
    ok: true,
    value: { repositories: [...repositories], capped: false, organisations: [...organisations] }
  })
}

/** The same, from a walk that stopped at the limit. */
function offerCapped(...repositories: readonly RemoteRepository[]): void {
  vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
    ok: true,
    value: { repositories: [...repositories], capped: true, organisations: [] }
  })
}

/** One repository's row, found by the only thing that tells rows apart. */
function rowFor(nameWithOwner: string): HTMLElement {
  const row = screen
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(nameWithOwner) !== null)

  if (row === undefined) throw new Error(`No row for ${nameWithOwner}`)
  return row
}

/** The Add button of one row — every row's button carries the same label. */
function addButtonFor(nameWithOwner: string): HTMLElement {
  return within(rowFor(nameWithOwner)).getByRole('button')
}

async function renderPicker(overrides: Partial<PickerProps> = {}): Promise<PickerProps> {
  const props: PickerProps = {
    onPicked: vi.fn(),
    onCancel: vi.fn(),
    cloneDirectory: '',
    onCloneDirectoryChange: vi.fn(),
    onOpenSettings: vi.fn(),
    seesOrganisations: true,
    ...overrides
  }

  render(<RepositoryPicker {...props} />)
  await screen.findByRole('dialog')
  return props
}

beforeAll(stubDialogElement)

describe('RepositoryPicker', () => {
  it('says it is loading until the account answers', async () => {
    const listing = pending<Result<RepositoryList>>()
    vi.mocked(window.octopus.projects.listRemote).mockReturnValue(listing.promise)
    await renderPicker()

    expect(screen.getByText('Loading…')).toBeInTheDocument()

    listing.settle({
      ok: true,
      value: { repositories: [repository()], capped: false, organisations: [] }
    })

    expect(await screen.findByText('ytsykvas/planner')).toBeInTheDocument()
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('lists the repositories the account offers', async () => {
    offer(
      repository(),
      repository({
        name: 'ledger',
        nameWithOwner: 'ytsykvas/ledger',
        description: 'Double-entry bookkeeping'
      })
    )
    await renderPicker()

    expect(await screen.findByText('ytsykvas/planner')).toBeInTheDocument()
    expect(screen.getByText('ytsykvas/ledger')).toBeInTheDocument()
    expect(screen.getByText('Weekly planning')).toBeInTheDocument()
  })

  /*
   * The reason organisations reached this dialog at all.
   *
   * With a work organisation in it the list is several times longer, and its
   * own name is the only thing anybody scans for.
   */
  it('puts each repository under a heading naming its owner', async () => {
    offer(
      repository(),
      repository({
        name: 'planner',
        nameWithOwner: 'Hylab-Media/planner',
        owner: { login: 'Hylab-Media' }
      })
    )
    await renderPicker()

    await screen.findByText('ytsykvas/planner')

    const work = screen.getByRole('region', { name: 'Hylab-Media' })
    expect(within(work).getByText('Hylab-Media/planner')).toBeInTheDocument()
    expect(within(work).queryByText('ytsykvas/planner')).not.toBeInTheDocument()
  })

  // Core decides the order; the picker groups in the order it was handed, so
  // one question has one answer rather than two that can drift.
  it('keeps the order the account was given, its own owner first', async () => {
    offer(
      repository(),
      repository({
        name: 'esl',
        nameWithOwner: 'Hylab-Media/esl',
        owner: { login: 'Hylab-Media' }
      })
    )
    await renderPicker()

    await screen.findByText('ytsykvas/planner')

    // Level 3: the dialog's own title is a heading too, and it is not a group.
    const headings = screen.getAllByRole('heading', { level: 3 }).map((item) => item.textContent)
    expect(headings).toEqual(['ytsykvas', 'Hylab-Media'])
  })

  it('drops a group the search empties', async () => {
    offer(
      repository(),
      repository({
        name: 'esl',
        nameWithOwner: 'Hylab-Media/esl',
        owner: { login: 'Hylab-Media' }
      })
    )
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.type(screen.getByRole('searchbox'), 'Hylab')

    expect(screen.getByRole('region', { name: 'Hylab-Media' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'ytsykvas' })).not.toBeInTheDocument()
  })

  it('marks a private repository as private', async () => {
    offer(repository({ isPrivate: true }))
    await renderPicker()

    await screen.findByText('ytsykvas/planner')
    expect(within(rowFor('ytsykvas/planner')).getByText('Private')).toBeInTheDocument()
  })

  it('says the account has no repositories when the list comes back empty', async () => {
    offer()
    await renderPicker()

    expect(await screen.findByText('No repositories found.')).toBeInTheDocument()
  })

  it('narrows the list to what is typed', async () => {
    offer(repository(), repository({ name: 'ledger', nameWithOwner: 'ytsykvas/ledger' }))
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.type(screen.getByRole('searchbox'), 'ledg')

    expect(screen.getByText('ytsykvas/ledger')).toBeInTheDocument()
    expect(screen.queryByText('ytsykvas/planner')).not.toBeInTheDocument()
  })

  // The name is rarely what someone remembers about a repository.
  it('searches the description as well as the name', async () => {
    offer(
      repository(),
      repository({
        name: 'ledger',
        nameWithOwner: 'ytsykvas/ledger',
        description: 'Double-entry bookkeeping'
      })
    )
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.type(screen.getByRole('searchbox'), 'bookkeeping')

    expect(screen.getByText('ytsykvas/ledger')).toBeInTheDocument()
    expect(screen.queryByText('ytsykvas/planner')).not.toBeInTheDocument()
  })

  it('says nothing matches the query it found nothing for', async () => {
    offer(repository())
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.type(screen.getByRole('searchbox'), 'ledger')

    expect(screen.getByText('Nothing matches “ledger”.')).toBeInTheDocument()
  })

  it('clones the repository whose button is pressed', async () => {
    const chosen = repository()
    offer(chosen, repository({ name: 'ledger', nameWithOwner: 'ytsykvas/ledger' }))
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({
      ok: true,
      value: cloned()
    })
    const user = userEvent.setup()
    const props = await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))

    expect(window.octopus.projects.addFromGitHub).toHaveBeenCalledExactlyOnceWith(chosen)
    await waitFor(() => {
      expect(props.onPicked).toHaveBeenCalledTimes(1)
    })
  })

  // Cloning asks where to put the repository when no destination is set, and
  // backing out of that question is a change of mind, not a failure.
  it('treats a cancelled destination prompt as nothing having happened', async () => {
    offer(repository())
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({ ok: true, value: null })
    const user = userEvent.setup()
    const props = await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))

    await waitFor(() => {
      expect(addButtonFor('ytsykvas/planner')).toBeEnabled()
    })
    expect(props.onPicked).not.toHaveBeenCalled()
    expect(screen.queryByText(/Could not/)).not.toBeInTheDocument()
  })

  it('explains why a clone failed, leaving the list open', async () => {
    offer(repository())
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({
      ok: false,
      error: 'git exited with 128',
      code: 'cloneFailed',
      params: { repository: 'ytsykvas/planner' }
    })
    const user = userEvent.setup()
    const props = await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))

    expect(await screen.findByText('Could not clone ytsykvas/planner.')).toBeInTheDocument()
    expect(props.onPicked).not.toHaveBeenCalled()
  })

  // A clone fails for reasons that go away — no network, a destination that was
  // not writable. The complaint has to go with them, or it contradicts the
  // clone that has just worked.
  it('drops the failure once a later clone works', async () => {
    offer(repository())
    vi.mocked(window.octopus.projects.addFromGitHub)
      .mockResolvedValueOnce({
        ok: false,
        error: 'git exited with 128',
        code: 'cloneFailed',
        params: { repository: 'ytsykvas/planner' }
      })
      .mockResolvedValue({ ok: true, value: cloned() })
    const user = userEvent.setup()
    const props = await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))
    expect(await screen.findByText('Could not clone ytsykvas/planner.')).toBeInTheDocument()

    await user.click(addButtonFor('ytsykvas/planner'))

    await waitFor(() => {
      expect(props.onPicked).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('Could not clone ytsykvas/planner.')).not.toBeInTheDocument()
  })

  it('explains why the repositories could not be read', async () => {
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: false,
      error: 'gh is not signed in',
      code: 'notConnected'
    })
    await renderPicker()

    expect(
      await screen.findByText('Could not reach GitHub. Check the account in Settings.')
    ).toBeInTheDocument()
    expect(screen.queryByText('No repositories found.')).not.toBeInTheDocument()
  })

  // Telling someone the account is in Settings while giving them no way there
  // is how this modal used to end.
  it('offers the way to Settings when the account is the problem', async () => {
    vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
      ok: false,
      error: 'gh is not signed in',
      code: 'notConnected'
    })
    const user = userEvent.setup()
    const props = await renderPicker()
    await screen.findByText('Could not reach GitHub. Check the account in Settings.')

    await user.click(screen.getByRole('button', { name: 'Connect GitHub…' }))

    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  // Signing in again fixes nothing about a clone that failed, so pointing at
  // Settings would only cost the user a detour.
  it('keeps Settings out of a failure that has nothing to do with the account', async () => {
    offer(repository())
    vi.mocked(window.octopus.projects.addFromGitHub).mockResolvedValue({
      ok: false,
      error: 'git exited with 128',
      code: 'cloneFailed',
      params: { repository: 'ytsykvas/planner' }
    })
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))
    await screen.findByText('Could not clone ytsykvas/planner.')

    expect(screen.queryByRole('button', { name: 'Connect GitHub…' })).not.toBeInTheDocument()
  })

  // Cloning takes a while, and a second one started meanwhile would race the
  // first for the same destination directory.
  it('names the repository being cloned and blocks a second clone meanwhile', async () => {
    offer(repository(), repository({ name: 'ledger', nameWithOwner: 'ytsykvas/ledger' }))
    const clone = pending<Result<Project | null>>()
    vi.mocked(window.octopus.projects.addFromGitHub).mockReturnValue(clone.promise)
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.click(addButtonFor('ytsykvas/planner'))

    expect(addButtonFor('ytsykvas/planner')).toHaveAccessibleName('Cloning planner…')
    expect(addButtonFor('ytsykvas/ledger')).toBeDisabled()

    clone.settle({ ok: true, value: null })
    await waitFor(() => {
      expect(addButtonFor('ytsykvas/ledger')).toBeEnabled()
    })
  })

  it('says the destination has not been chosen yet', async () => {
    offer(repository())
    await renderPicker()

    expect(screen.getByText('You will be asked where to clone.')).toBeInTheDocument()
  })

  it('shows the destination clones will land in', async () => {
    offer(repository())
    await renderPicker({ cloneDirectory: '/Users/someone/code' })

    expect(screen.getByText('/Users/someone/code')).toBeInTheDocument()
  })

  it('reports the destination chosen in the picker', async () => {
    offer(repository())
    vi.mocked(window.octopus.dialog.pickDirectory).mockResolvedValue({
      ok: true,
      value: '/Users/someone/code'
    })
    const user = userEvent.setup()
    const props = await renderPicker()

    await user.click(screen.getByRole('button', { name: 'Change…' }))

    await waitFor(() => {
      expect(props.onCloneDirectoryChange).toHaveBeenCalledExactlyOnceWith('/Users/someone/code')
    })
  })

  it('keeps the destination when the directory picker is cancelled', async () => {
    offer(repository())
    const user = userEvent.setup()
    const props = await renderPicker({ cloneDirectory: '/Users/someone/code' })

    await user.click(screen.getByRole('button', { name: 'Change…' }))

    await waitFor(() => {
      expect(window.octopus.dialog.pickDirectory).toHaveBeenCalledTimes(1)
    })
    expect(props.onCloneDirectoryChange).not.toHaveBeenCalled()
    expect(screen.getByText('/Users/someone/code')).toBeInTheDocument()
  })

  it('cancels without adding anything', async () => {
    offer(repository())
    const user = userEvent.setup()
    const props = await renderPicker()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(window.octopus.projects.addFromGitHub).not.toHaveBeenCalled()
  })

  // A description is optional on GitHub, and most personal repositories have
  // none. Searching has to keep working past them rather than stopping at the
  // first repository that never wrote one.
  it('searches on past a repository with no description', async () => {
    offer(
      repository(),
      repository({ name: 'ledger', nameWithOwner: 'ytsykvas/ledger', description: null })
    )
    const user = userEvent.setup()
    await renderPicker()
    await screen.findByText('ytsykvas/planner')

    await user.type(screen.getByRole('searchbox'), 'planning')

    expect(screen.getByText('ytsykvas/planner')).toBeInTheDocument()
    expect(screen.queryByText('ytsykvas/ledger')).not.toBeInTheDocument()
  })

  // `gh` can take a while, and the dialog is cancellable throughout. A listing
  // that lands afterwards belongs to a dialog that is no longer on screen.
  it('drops a listing that arrives after the dialog has been closed', async () => {
    const listing = pending<Result<RepositoryList>>()
    vi.mocked(window.octopus.projects.listRemote).mockReturnValue(listing.promise)
    const { unmount } = render(
      <RepositoryPicker
        onPicked={vi.fn()}
        onCancel={vi.fn()}
        cloneDirectory=""
        onCloneDirectoryChange={vi.fn()}
        onOpenSettings={vi.fn()}
        seesOrganisations={true}
      />
    )
    await screen.findByRole('dialog')

    unmount()
    listing.settle({
      ok: true,
      value: { repositories: [repository()], capped: false, organisations: [] }
    })
    await listing.promise

    expect(screen.queryByText('ytsykvas/planner')).not.toBeInTheDocument()
  })
  /*
   * Both notes answer "why is my repository not here", and both are only worth
   * saying when they are true — a standing apology under every list would be
   * noise, and a wrong one sends the reader after a problem they do not have.
   * So each is tested with its negative beside it.
   */
  describe('why the list may be short', () => {
    const CAP = /as many repositories as it was asked for/
    const ORG = /cannot see organisations/
    const SILENT = /none of its repositories are listed/

    it('says so when GitHub answered with as much as it was asked for', async () => {
      offerCapped(repository())
      await renderPicker()
      await screen.findByText('ytsykvas/planner')

      expect(screen.getByText(CAP)).toBeInTheDocument()
    })

    it('says nothing about a cap on a list GitHub finished', async () => {
      offer(repository())
      await renderPicker()
      await screen.findByText('ytsykvas/planner')

      expect(screen.queryByText(CAP)).not.toBeInTheDocument()
    })

    it('names the missing scope and the command that grants it', async () => {
      offer(repository())
      await renderPicker({ seesOrganisations: false })
      await screen.findByText('ytsykvas/planner')

      expect(screen.getByText(ORG)).toBeInTheDocument()
      expect(screen.getByText('gh auth refresh -s read:org')).toBeInTheDocument()
    })

    it('says nothing about scopes when the token has the one it needs', async () => {
      offer(repository())
      await renderPicker({ seesOrganisations: true })
      await screen.findByText('ytsykvas/planner')

      expect(screen.queryByText(ORG)).not.toBeInTheDocument()
    })

    // The case the whole `boolean | null` exists for: not being told is not
    // the same as being told no, and only one of them is worth a sentence.
    it('says nothing about scopes when it was never told what they are', async () => {
      offer(repository())
      await renderPicker({ seesOrganisations: null })
      await screen.findByText('ytsykvas/planner')

      expect(screen.queryByText(ORG)).not.toBeInTheDocument()
    })

    /*
     * The one thing that can be said about a quiet organisation without
     * guessing at a cause. SAML withholding one from a token that holds
     * `read:org` looks exactly like an organisation with nothing to push to —
     * and the reader knows which of the two theirs is, while the list simply
     * looked complete.
     */
    it('names an organisation that put nothing in the list', async () => {
      offerBelonging(['Hylab'], repository())
      await renderPicker({ seesOrganisations: true })
      await screen.findByText('ytsykvas/planner')

      expect(screen.getByText(SILENT)).toBeInTheDocument()
      expect(screen.getByText(/Hylab/)).toBeInTheDocument()
    })

    // An organisation with repositories in the list is not quiet, and a line
    // about it would be a standing apology under a list that is complete.
    it('says nothing about an organisation that is represented', async () => {
      offerBelonging(
        ['Hylab'],
        repository({ nameWithOwner: 'Hylab/planner', owner: { login: 'Hylab' } })
      )
      await renderPicker({ seesOrganisations: true })
      await screen.findByText('Hylab/planner')

      expect(screen.queryByText(SILENT)).not.toBeInTheDocument()
    })

    // Which is every account that belongs to none — the case a condition
    // guessed from what is absent would have fired on.
    it('says nothing where the account belongs to no organisation', async () => {
      offer(repository())
      await renderPicker({ seesOrganisations: true })
      await screen.findByText('ytsykvas/planner')

      expect(screen.queryByText(SILENT)).not.toBeInTheDocument()
    })

    /* An organisation may have plenty past the ceiling, so "none of its
       repositories are listed" is not a claim this can support — and the line
       above already says the list is partial. */
    it('says nothing about a quiet organisation while the walk was capped', async () => {
      vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
        ok: true,
        value: { repositories: [repository()], capped: true, organisations: ['Hylab'] }
      })
      await renderPicker({ seesOrganisations: true })
      await screen.findByText('ytsykvas/planner')

      expect(screen.getByText(CAP)).toBeInTheDocument()
      expect(screen.queryByText(SILENT)).not.toBeInTheDocument()
    })

    // A failed listing already carries its own explanation, and a second one
    // under it would be a guess about a list that was never fetched.
    it('says neither while the listing itself has failed', async () => {
      vi.mocked(window.octopus.projects.listRemote).mockResolvedValue({
        ok: false,
        error: 'gh is not signed in',
        code: 'notConnected'
      })
      await renderPicker({ seesOrganisations: false })
      await screen.findByRole('button', { name: 'Connect GitHub…' })

      expect(screen.queryByText(ORG)).not.toBeInTheDocument()
      expect(screen.queryByText(CAP)).not.toBeInTheDocument()
    })
  })
})
