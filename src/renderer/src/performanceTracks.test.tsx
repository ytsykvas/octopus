/*
 * React's development build records a `performance.measure` entry for every
 * component render whose props changed, with a diff of those props attached.
 * Up to 19.2 it never removed them, and Chromium does not cap them: an idle
 * `npm run dev` window grew by about 30 MB a minute until it held gigabytes.
 * 19.3 clears each entry straight after recording it (react/react#34803).
 *
 * This is what notices a downgrade, or a React that brings the leak back.
 */

import { createRequire } from 'node:module'

import { act } from 'react'
import type * as ReactDomModule from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'

type ReactDomClient = typeof ReactDomModule

const require = createRequire(import.meta.url)
const reactDomFiles = (): string[] =>
  Object.keys(require.cache).filter((file) => file.includes('/node_modules/react-dom/'))

/*
 * React decides once, when react-dom loads, whether it can record anything:
 * it needs `console.timeStamp`, which Chromium has and Vitest's console does
 * not. Without it every render records nothing and the test would pass on the
 * leaking version too. So: give the console what Chromium gives it, then load
 * a react-dom of our own that sees it.
 */
function loadReactDomAsInChromium(): ReactDomClient {
  Object.defineProperty(console, 'timeStamp', { value: () => undefined, configurable: true })
  for (const file of reactDomFiles()) Reflect.deleteProperty(require.cache, file)
  return require('react-dom/client') as ReactDomClient
}

function Row({ reading }: { readonly reading: { readonly value: number } }): React.JSX.Element {
  return <span>{reading.value}</span>
}

afterEach(() => {
  Reflect.deleteProperty(console, 'timeStamp')
  // The next file to ask for react-dom gets an ordinary one again.
  for (const file of reactDomFiles()) Reflect.deleteProperty(require.cache, file)
  performance.clearMeasures()
})

describe('a re-render in a development build', () => {
  it('leaves no performance entries behind', () => {
    const { createRoot } = loadReactDomAsInChromium()
    const container = document.createElement('div')
    const root = createRoot(container)

    for (let value = 0; value <= 5; value += 1) {
      // A new object each time, as a poll that replaces its reading does.
      act(() => {
        root.render(<Row reading={{ value }} />)
      })
    }
    act(() => {
      root.unmount()
    })

    expect(performance.getEntriesByType('measure')).toEqual([])
  })
})
