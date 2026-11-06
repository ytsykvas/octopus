import { describe, expect, it } from 'vitest'

import { isAppDocument } from './appNavigation.js'

const PACKAGED =
  'file:///Applications/Octopus.app/Contents/Resources/app.asar/out/renderer/index.html'
const DEV = 'http://localhost:5173/'

describe('isAppDocument', () => {
  it('takes the packaged document as itself', () => {
    expect(isAppDocument(PACKAGED, PACKAGED)).toBe(true)
  })

  // Query and hash are the document's own state, not another document.
  it('takes the packaged document with a hash or a query', () => {
    expect(isAppDocument(`${PACKAGED}#x`, PACKAGED)).toBe(true)
    expect(isAppDocument(`${PACKAGED}?a=1`, PACKAGED)).toBe(true)
  })

  // `loadFile` and `pathToFileURL` escape a space in the app's folder
  // differently, and the same folder must not read as two.
  it('takes the same path however a space in it is escaped', () => {
    const escaped = 'file:///Users/me/My%20Apps/out/renderer/index.html'
    const plain = 'file:///Users/me/My Apps/out/renderer/index.html'

    expect(isAppDocument(escaped, plain)).toBe(true)
    expect(isAppDocument(plain, escaped)).toBe(true)
  })

  // Node's `pathToFileURL` escapes `[`, `]` and `|`, which Chromium leaves as
  // they are, so the URL loaded and the one navigated to can spell one path two
  // ways.
  it('takes the same path however a bracket in it is escaped', () => {
    expect(
      isAppDocument(
        'file:///Users/me/a[b]/out/renderer/index.html',
        'file:///Users/me/a%5Bb%5D/out/renderer/index.html'
      )
    ).toBe(true)
  })

  it('refuses another file beside the document', () => {
    expect(
      isAppDocument(
        'file:///Applications/Octopus.app/Contents/Resources/app.asar/out/renderer/coverage/index.html',
        PACKAGED
      )
    ).toBe(false)
  })

  it('refuses a file dropped from anywhere else', () => {
    expect(isAppDocument('file:///tmp/evil.html', PACKAGED)).toBe(false)
  })

  it('refuses a web page, packaged or in development', () => {
    expect(isAppDocument('https://attacker.example/', PACKAGED)).toBe(false)
    expect(isAppDocument('https://attacker.example/', DEV)).toBe(false)
  })

  it('takes any path on the dev server', () => {
    expect(isAppDocument('http://localhost:5173/src/x?t=1', DEV)).toBe(true)
  })

  // Another port or another name for the same host is another origin, and
  // could be anything listening there.
  it('refuses another port or another name for the dev server', () => {
    expect(isAppDocument('http://localhost:5174/', DEV)).toBe(false)
    expect(isAppDocument('http://127.0.0.1:5173/', DEV)).toBe(false)
  })

  // A blob URL reports the origin it was made in, and is still not the page.
  it('refuses a blob made on the dev server', () => {
    expect(isAppDocument('blob:http://localhost:5173/x', DEV)).toBe(false)
  })

  it('refuses a file while the document comes from the dev server', () => {
    expect(isAppDocument('file:///tmp/evil.html', DEV)).toBe(false)
  })

  it('refuses what is not an address', () => {
    expect(isAppDocument('not a url', PACKAGED)).toBe(false)
    expect(isAppDocument(PACKAGED, 'not a url')).toBe(false)
  })

  // `decodeURIComponent` throws on a lone `%E0`; a decision about a URL the
  // window was sent to must not throw instead of answering.
  it('refuses a path that cannot be decoded', () => {
    const broken = 'file:///x/%E0/index.html'

    expect(isAppDocument(broken, broken)).toBe(false)
  })

  it('refuses everything when the document has a scheme it does not know', () => {
    expect(isAppDocument('data:text/html,x', 'data:text/html,x')).toBe(false)
  })
})
