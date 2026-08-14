import { describe, expect, it, type Mock, vi } from 'vitest'

import { focusExisting, type FocusableWindow } from './windows.js'

interface FakeWindow extends FocusableWindow {
  readonly restore: Mock<() => void>
  readonly focus: Mock<() => void>
}

/** A window that records what was asked of it, and can start minimised. */
function fakeWindow(minimized = false): FakeWindow {
  return {
    isMinimized: () => minimized,
    restore: vi.fn<() => void>(),
    focus: vi.fn<() => void>()
  }
}

describe('focusExisting', () => {
  it('raises the window that is already open', () => {
    const window = fakeWindow()

    focusExisting([window])

    expect(window.focus).toHaveBeenCalled()
    expect(window.restore).not.toHaveBeenCalled()
  })

  // A minimised window ignores `focus`, so without this the second launch would
  // quit and nothing at all would happen on screen.
  it('restores a minimised window before focusing it', () => {
    const window = fakeWindow(true)

    focusExisting([window])

    expect(window.restore).toHaveBeenCalled()
    expect(window.focus).toHaveBeenCalled()
  })

  // On macOS the application outlives its last window, so this is an ordinary
  // state rather than an impossible one.
  it('does nothing when no window is open', () => {
    expect(() => {
      focusExisting([])
    }).not.toThrow()
  })

  it('raises the first window when several are open', () => {
    const first = fakeWindow()
    const second = fakeWindow()

    focusExisting([first, second])

    expect(first.focus).toHaveBeenCalled()
    expect(second.focus).not.toHaveBeenCalled()
  })
})
