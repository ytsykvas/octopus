import { describe, expect, it, type Mock, vi } from 'vitest'

import { guardNavigation, type NavigableContents, type NavigationEvent } from './navigation.js'

type Listener = (event: NavigationEvent) => void
type Navigation = 'will-navigate' | 'will-redirect'

const APP = 'file:///Applications/Octopus.app/Contents/Resources/app.asar/out/renderer/index.html'

/**
 * Contents that keep what was subscribed, so a test can fire it. Cast because
 * Electron types `on` as one overload per event, and one function that records
 * them all is the whole of what this needs.
 */
function fakeContents(): NavigableContents & { readonly listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>()
  const on = (event: Navigation, listener: Listener): unknown => listeners.set(event, listener)
  return { listeners, on: on as unknown as NavigableContents['on'] }
}

/** Fires one navigation at the guarded contents and returns what it could cancel with. */
function attempt(
  contents: ReturnType<typeof fakeContents>,
  name: Navigation,
  url: string
): Mock<() => void> {
  const preventDefault = vi.fn<() => void>()
  contents.listeners.get(name)?.({ url, preventDefault })
  return preventDefault
}

describe('guardNavigation', () => {
  it('stops the window going to a web page', () => {
    const contents = fakeContents()
    guardNavigation(contents, APP)

    expect(attempt(contents, 'will-navigate', 'https://attacker.example/')).toHaveBeenCalled()
  })

  // A server can send the window on after the navigation began, so the
  // redirect is asked the same question.
  it('stops a redirect to another file', () => {
    const contents = fakeContents()
    guardNavigation(contents, APP)

    expect(attempt(contents, 'will-redirect', 'file:///tmp/x.html')).toHaveBeenCalled()
  })

  // A change of hash never reaches `will-navigate`; loading the document again
  // with another query does.
  it('lets the window load its own document again', () => {
    const contents = fakeContents()
    guardNavigation(contents, APP)

    expect(attempt(contents, 'will-navigate', `${APP}?t=1`)).not.toHaveBeenCalled()
  })

  it('lets a redirect back to its own document through', () => {
    const contents = fakeContents()
    guardNavigation(contents, APP)

    expect(attempt(contents, 'will-redirect', APP)).not.toHaveBeenCalled()
  })

  it('listens for both ways of leaving and nothing else', () => {
    const contents = fakeContents()
    guardNavigation(contents, APP)

    expect([...contents.listeners.keys()].sort()).toEqual(['will-navigate', 'will-redirect'])
  })
})
