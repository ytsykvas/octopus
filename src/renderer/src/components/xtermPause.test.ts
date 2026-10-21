import { Terminal as XTerm } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { holdSelectionWhilePaused } from './xtermPause.js'

/*
 * The real xterm, as five other suites run it. jsdom has no
 * IntersectionObserver, so xterm never pauses on its own here; this one hands
 * xterm a stand-in and says when its screen leaves and comes back, which is
 * exactly how the app's window says it.
 */
let seen: ((entries: { isIntersecting: boolean }[]) => void) | null = null

class FakeIntersectionObserver {
  constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
    seen = callback
  }
  observe(): void {
    // The callback above is all the tests drive.
  }
  disconnect(): void {
    // Nothing is watched for real.
  }
}

const opened: XTerm[] = []

function openTerminal(): XTerm {
  const host = document.createElement('div')
  document.body.append(host)
  const term = new XTerm({ cols: 40, rows: 4 })
  term.open(host)
  opened.push(term)
  return term
}

/** Says whether the screen is on view, as xterm's observer would be told. */
function onScreen(visible: boolean): void {
  seen?.([{ isIntersecting: visible }])
}

/** Writes, and waits for the frame xterm draws on. */
async function written(term: XTerm, text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    term.write(text, resolve)
  })
  await frame()
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })

const rows = (term: XTerm): string =>
  term.element?.querySelector('.xterm-rows')?.textContent.replace(/\s+/g, ' ').trim() ?? ''

const drawnSelection = (term: XTerm): number =>
  term.element?.querySelectorAll('.xterm-selection div').length ?? 0

/** The render service, reached the way the guard reaches it. */
function serviceOf(term: XTerm): object {
  return (term as unknown as { _core: { _renderService: object } })._core._renderService
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
})

afterEach(() => {
  for (const term of opened.splice(0)) term.dispose()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
  seen = null
})

describe('a paused terminal', () => {
  /*
   * The bug: every line that scrolls asks for the selection to be drawn, and
   * the answer redrew every row of a terminal nobody could see — a hidden dev
   * server's log kept a fifth of a core busy.
   */
  it('draws nothing while it logs, and catches up when it is seen again', async () => {
    const term = openTerminal()
    expect(holdSelectionWhilePaused(term)).toBe(true)
    await written(term, 'first\r\n')
    onScreen(false)

    await written(term, 'a\r\nb\r\nc\r\nd\r\ne\r\nthe last line')
    expect(rows(term)).not.toContain('the last line')

    onScreen(true)
    await frame()
    expect(rows(term)).toContain('the last line')
  })

  // Kept, not dropped: xterm's resume draws the selection from what was stored.
  it('keeps a selection made while hidden for when it is shown', async () => {
    const term = openTerminal()
    holdSelectionWhilePaused(term)
    await written(term, 'some words to select')
    onScreen(false)

    term.select(0, 0, 4)
    await frame()
    expect(drawnSelection(term)).toBe(0)

    onScreen(true)
    await frame()
    expect(drawnSelection(term)).toBeGreaterThan(0)
  })

  it('draws a selection at once while it is on screen', async () => {
    const term = openTerminal()
    holdSelectionWhilePaused(term)
    await written(term, 'some words to select')

    term.select(0, 0, 4)
    await frame()

    expect(drawnSelection(term)).toBeGreaterThan(0)
  })
})

/*
 * It reaches into xterm's internals, so anything missing leaves the terminal
 * as it was. Each part is checked; an xterm that moved one of them is slower
 * here, never broken.
 */
describe('a terminal whose internals are not the ones it knows', () => {
  it('leaves one that has not been opened alone', () => {
    expect(holdSelectionWhilePaused(new XTerm())).toBe(false)
  })

  it('leaves an object with no core alone', () => {
    expect(holdSelectionWhilePaused({} as XTerm)).toBe(false)
  })

  it('leaves a core that is not an object alone', () => {
    expect(holdSelectionWhilePaused({ _core: null } as unknown as XTerm)).toBe(false)
  })

  it('leaves a render service that is not an object alone', () => {
    expect(holdSelectionWhilePaused({ _core: { _renderService: 7 } } as unknown as XTerm)).toBe(
      false
    )
  })

  it.each([
    '_isPaused',
    '_needsFullRefresh',
    '_needsSelectionRefresh',
    '_selectionState',
    'handleSelectionChanged'
  ])('leaves it alone when %s is missing', (field) => {
    const term = openTerminal()
    const service = serviceOf(term)
    Object.defineProperty(service, field, { value: undefined, configurable: true })
    const before = (service as { handleSelectionChanged?: unknown }).handleSelectionChanged

    expect(holdSelectionWhilePaused(term)).toBe(false)
    expect((service as { handleSelectionChanged?: unknown }).handleSelectionChanged).toBe(before)
  })

  it('leaves it alone when the selection state is not an object', () => {
    const term = openTerminal()
    Object.defineProperty(serviceOf(term), '_selectionState', { value: null, configurable: true })

    expect(holdSelectionWhilePaused(term)).toBe(false)
  })
})
