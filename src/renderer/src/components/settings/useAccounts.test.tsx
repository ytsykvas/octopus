import { act, renderHook, type RenderHookResult, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'

import type { Result } from '../../../../preload/index.js'
import { octopus } from '../../test/octopus.js'
import { type AccountsController, useAccounts } from './useAccounts.js'

const signedIn = (): AccountsStatus => ({
  claude: {
    connected: true,
    email: 'someone@example.com',
    authMethod: 'oauth',
    subscriptionType: 'max',
    orgName: 'Acme'
  },
  github: { connected: true, login: 'octo', name: 'Octo Cat' }
})

const signedOut = (): AccountsStatus => ({
  claude: {
    connected: false,
    email: null,
    authMethod: null,
    subscriptionType: null,
    orgName: null
  },
  github: { connected: false, login: null, name: null }
})

/** A promise the test settles by hand, so it can look at the state while it is pending. */
const deferred = <T,>(): { promise: Promise<T>; settle: (value: T) => void } => {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return {
    promise,
    settle: (value) => {
      resolve(value)
    }
  }
}

/** Lets every promise already queued run before the assertion that follows. */
const settled = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** Answers the bridge gives to successive status reads; the last one repeats. */
const statusIs = (...answers: Result<AccountsStatus>[]): void => {
  const status = vi.mocked(octopus().accounts.status)
  for (const answer of answers.slice(0, -1)) status.mockResolvedValueOnce(answer)
  status.mockResolvedValue(answers.at(-1)!)
}

const ok = (value: AccountsStatus): Result<AccountsStatus> => ({ ok: true, value })

/** A hook that has already settled the status it reads on mount. */
async function mounted(
  status: Result<AccountsStatus>[] = [ok(signedIn())]
): Promise<RenderHookResult<AccountsController, undefined>> {
  statusIs(...status)
  const rendered = renderHook(() => useAccounts())
  await waitFor(() => {
    expect(octopus().accounts.status).toHaveBeenCalled()
  })
  await act(settled)
  return rendered
}

describe('useAccounts', () => {
  it('reports what the tools say about both accounts as soon as it is shown', async () => {
    const { result } = await mounted()

    expect(result.current.status).toEqual(signedIn())
    expect(result.current.error).toBeNull()
    expect(result.current.session).toBeNull()
  })

  // The CLIs may be missing entirely; the screen then knows nothing rather
  // than claiming both accounts are signed out.
  it('knows nothing when the status cannot be read at all', async () => {
    const { result } = await mounted([{ ok: false, error: 'claude: command not found' }])

    expect(result.current.status).toBeNull()
  })

  // Closing settings mid-request must not write into a hook that is gone.
  it('ignores a status that arrives after it has been unmounted', async () => {
    const pending = deferred<Result<AccountsStatus>>()
    vi.mocked(octopus().accounts.status).mockReturnValue(pending.promise)

    const { result, unmount } = renderHook(() => useAccounts())
    unmount()
    pending.settle(ok(signedIn()))
    await pending.promise

    expect(result.current.status).toBeNull()
  })

  it('picks up a sign-in made outside the app when refreshed', async () => {
    const { result } = await mounted([ok(signedOut()), ok(signedIn())])

    await act(() => result.current.refresh())

    expect(result.current.status).toEqual(signedIn())
  })

  it('keeps the last known status when a refresh fails', async () => {
    const { result } = await mounted([ok(signedIn()), { ok: false, error: 'gh: not found' }])

    await act(() => result.current.refresh())

    expect(result.current.status).toEqual(signedIn())
  })

  // The Refresh button is disabled off this flag, so it has to be true only
  // for as long as the request is in flight.
  it('says it is checking until the refresh comes back', async () => {
    const { result } = await mounted()
    const pending = deferred<Result<AccountsStatus>>()
    vi.mocked(octopus().accounts.status).mockReturnValue(pending.promise)

    let refreshing!: Promise<void>
    act(() => {
      refreshing = result.current.refresh()
    })
    expect(result.current.checking).toBe(true)

    await act(async () => {
      pending.settle(ok(signedIn()))
      await refreshing
    })

    expect(result.current.checking).toBe(false)
  })

  it('starts a session with the command that signs in to the service', async () => {
    const { result } = await mounted()

    act(() => {
      result.current.signIn('claude', 'Claude')
    })

    expect(result.current.session).toEqual({
      kind: 'claude',
      label: 'Claude',
      command: ['claude', 'auth', 'login']
    })
  })

  // A finished sign-in is exactly the moment the old status is wrong.
  it('re-reads the status when the session ends', async () => {
    const { result } = await mounted([ok(signedOut()), ok(signedIn())])
    act(() => {
      result.current.signIn('claude', 'Claude')
    })

    act(() => {
      result.current.endSession()
    })

    expect(result.current.session).toBeNull()
    await waitFor(() => {
      expect(result.current.status).toEqual(signedIn())
    })
  })

  it('signs out of Claude and reports the account as gone afterwards', async () => {
    const { result } = await mounted([ok(signedIn()), ok(signedOut())])

    await act(() => result.current.signOut('claude', 'Claude'))

    expect(octopus().accounts.signOut).toHaveBeenCalledExactlyOnceWith('claude', null)
    expect(result.current.status).toEqual(signedOut())
    expect(result.current.error).toBeNull()
  })

  // gh keeps several accounts at once, so it has to be told which one to drop.
  it('names the GitHub login when signing out of GitHub', async () => {
    const { result } = await mounted()

    await act(() => result.current.signOut('github', 'GitHub'))

    expect(octopus().accounts.signOut).toHaveBeenCalledExactlyOnceWith('github', 'octo')
  })

  it('signs out of GitHub without a login when no status has been read', async () => {
    const { result } = await mounted([{ ok: false, error: 'gh: command not found' }])

    await act(() => result.current.signOut('github', 'GitHub'))

    expect(octopus().accounts.signOut).toHaveBeenCalledExactlyOnceWith('github', null)
  })

  it('says which account is being signed out while it is happening', async () => {
    const { result } = await mounted()
    const pending = deferred<Result<boolean>>()
    vi.mocked(octopus().accounts.signOut).mockReturnValue(pending.promise)

    let signingOut!: Promise<void>
    act(() => {
      signingOut = result.current.signOut('claude', 'Claude')
    })
    expect(result.current.signingOut).toBe('claude')

    await act(async () => {
      pending.settle({ ok: true, value: true })
      await signingOut
    })

    expect(result.current.signingOut).toBeNull()
  })

  // The CLI reports a refusal in its result rather than by failing, and the
  // user has to be told either way.
  it('explains a sign-out the tool declined to perform', async () => {
    const { result } = await mounted()
    vi.mocked(octopus().accounts.signOut).mockResolvedValue({ ok: true, value: false })

    await act(() => result.current.signOut('claude', 'Claude'))

    expect(result.current.error).toBe('Could not sign out of Claude.')
  })

  it('explains a sign-out that could not be run', async () => {
    const { result } = await mounted()
    vi.mocked(octopus().accounts.signOut).mockResolvedValue({
      ok: false,
      error: 'claude: command not found'
    })

    await act(() => result.current.signOut('github', 'GitHub'))

    expect(result.current.error).toBe('Could not sign out of GitHub.')
  })

  it('re-reads the status even after a sign-out that failed', async () => {
    const { result } = await mounted()
    vi.mocked(octopus().accounts.signOut).mockResolvedValue({ ok: true, value: false })

    await act(() => result.current.signOut('claude', 'Claude'))

    expect(octopus().accounts.status).toHaveBeenCalledTimes(2)
  })

  // A failure from an earlier attempt says nothing about the sign-in now
  // starting, and leaving it on screen would read as its result.
  it('drops an earlier failure when a sign-in starts', async () => {
    const { result } = await mounted()
    vi.mocked(octopus().accounts.signOut).mockResolvedValue({ ok: true, value: false })
    await act(() => result.current.signOut('claude', 'Claude'))

    act(() => {
      result.current.signIn('claude', 'Claude')
    })

    expect(result.current.error).toBeNull()
  })

  it('drops an earlier failure when another sign-out starts', async () => {
    const { result } = await mounted()
    vi.mocked(octopus().accounts.signOut).mockResolvedValueOnce({ ok: true, value: false })
    await act(() => result.current.signOut('claude', 'Claude'))

    await act(() => result.current.signOut('claude', 'Claude'))

    expect(result.current.error).toBeNull()
  })
})
