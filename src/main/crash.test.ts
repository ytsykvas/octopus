import type { RenderProcessGoneDetails } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import {
  type CrashableContents,
  reportLoadFailure,
  reportRejection,
  watchRendererCrash
} from './crash.js'

type Reason = RenderProcessGoneDetails['reason']
type GoneListener = (event: unknown, details: RenderProcessGoneDetails) => void

interface Crashable {
  readonly order: string[]
  gone: (reason: Reason) => void
  ended: () => void
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

/** A watched window whose recovery steps land in `order`; `ended` settles the disposal. */
function crashable(answer: boolean): Crashable {
  const order: string[] = []
  let listener: GoneListener | undefined
  let ended: () => void = () => undefined
  const on = (_event: 'render-process-gone', next: GoneListener): void => {
    listener = next
  }
  // Cast as in navigation.test.ts: Electron types `on` as one overload per event.
  const contents: CrashableContents = {
    on: on as unknown as CrashableContents['on'],
    reload: () => {
      order.push('reload')
    }
  }

  watchRendererCrash(contents, {
    dispose: () => {
      order.push('dispose')
      return new Promise<void>((resolve) => {
        ended = resolve
      })
    },
    askReload: (reason) => {
      order.push(`ask ${reason}`)
      return Promise.resolve(answer)
    },
    close: () => {
      order.push('close')
    }
  })

  return {
    order,
    gone: (reason) => {
      listener?.({}, { reason, exitCode: 9 })
    },
    ended: () => {
      ended()
    }
  }
}

describe('watchRendererCrash', () => {
  it('ends the window’s sessions and waits for them before offering a reload', async () => {
    const window = crashable(true)

    window.gone('killed')
    await flush()
    expect(window.order).toEqual(['dispose'])

    window.ended()
    await flush()
    expect(window.order).toEqual(['dispose', 'ask killed', 'reload'])
  })

  it('closes the window when the user declines the reload', async () => {
    const window = crashable(false)

    window.gone('crashed')
    window.ended()
    await flush()

    expect(window.order).toEqual(['dispose', 'ask crashed', 'close'])
  })

  // Close, destroy and quit raise no `render-process-gone` at all, so no reason means "on purpose".
  it.each<Reason>(['clean-exit', 'abnormal-exit', 'oom', 'launch-failed'])(
    'treats %s as a renderer that is gone',
    async (reason) => {
      const window = crashable(true)

      window.gone(reason)
      window.ended()
      await flush()

      expect(window.order).toEqual(['dispose', `ask ${reason}`, 'reload'])
    }
  )
})

describe('reportRejection', () => {
  it('shows the reason of a rejection nobody handled', () => {
    const showError = vi.fn<(title: string, content: string) => void>()

    reportRejection(showError)(new Error('the list could not be written'))

    expect(showError).toHaveBeenCalledWith(
      'octopus hit an unexpected error',
      'the list could not be written'
    )
  })
})

describe('reportLoadFailure', () => {
  const loadError = (code: string): Error =>
    Object.assign(new Error(`${code} loading 'http://localhost:5173/'`), { code })

  it.each(['ERR_ABORTED', 'ERR_FAILED'])(
    'stays quiet when %s says a reload or a crash interrupted the load',
    (code) => {
      const showError = vi.fn<(title: string, content: string) => void>()

      reportLoadFailure(showError)(loadError(code))

      expect(showError).not.toHaveBeenCalled()
    }
  )

  it('shows any other reason the window could not load', () => {
    const showError = vi.fn<(title: string, content: string) => void>()

    reportLoadFailure(showError)(loadError('ERR_CONNECTION_REFUSED'))

    expect(showError).toHaveBeenCalledWith(
      'octopus could not load its window',
      "ERR_CONNECTION_REFUSED loading 'http://localhost:5173/'"
    )
  })

  it('shows a failure that carries no code', () => {
    const showError = vi.fn<(title: string, content: string) => void>()

    reportLoadFailure(showError)('the page is gone')

    expect(showError).toHaveBeenCalledWith('octopus could not load its window', 'the page is gone')
  })
})
