import { describe, expect, it, type Mock, vi } from 'vitest'

import { openInBrowser } from './externalLinks.js'

type Open = (url: string) => Promise<void>

/** A system browser that takes every link it is given. */
function fakeOpen(): Mock<Open> {
  return vi.fn<Open>().mockResolvedValue(undefined)
}

describe('openInBrowser', () => {
  it('hands a web page to the system browser and opens no window of its own', () => {
    const open = fakeOpen()
    const url = 'https://github.com/o/p/pull/1'

    expect(openInBrowser(open)({ url })).toEqual({ action: 'deny' })
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith(url)
  })

  // The reason this exists: a check's link is written by a third party, and
  // LaunchServices would run the script it points at.
  it.each(['file:///tmp/x.command', 'smb://host/share', 'vscode://file/x'])(
    'does not hand the system %s, and still opens no window',
    (url) => {
      const open = fakeOpen()

      expect(openInBrowser(open)({ url })).toEqual({ action: 'deny' })
      expect(open).not.toHaveBeenCalled()
    }
  )

  // `openExternal` rejects when nothing will take the link, and nobody waits on it.
  it('swallows a refusal from the system rather than leaving it unhandled', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      // A plain function rather than `vi.fn`: a mock subscribes to the promise it
      // returns, to record how it settled, and that alone would handle the rejection.
      const opened: string[] = []
      const open: Open = (url) => {
        opened.push(url)
        return Promise.reject(new Error('no handler'))
      }

      openInBrowser(open)({ url: 'https://example.com/' })
      // Node reports an unhandled rejection once the microtasks drain, before the next macrotask.
      await new Promise<void>((resolve) => setImmediate(resolve))

      expect(opened).toEqual(['https://example.com/'])
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
