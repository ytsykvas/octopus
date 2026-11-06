import { describe, expect, it } from 'vitest'

import { isExternalUrl } from './externalUrls.js'

describe('isExternalUrl', () => {
  it.each([
    'https://github.com/o/p/pull/1',
    'http://localhost:3222',
    // A CI server on an intranet links over plain http, and a browser opens it no worse.
    'http://ci.internal:8080/job/1'
  ])('takes %s for a web page', (url) => {
    expect(isExternalUrl(url)).toBe(true)
  })

  // Each of these reaches LaunchServices, which starts whatever is registered for it.
  it.each([
    'file:///Users/me/repo/run.command',
    'smb://host/share',
    'javascript:alert(1)',
    'vscode://file/x',
    'data:text/html,x',
    'mailto:a@b.c'
  ])('refuses %s', (url) => {
    expect(isExternalUrl(url)).toBe(false)
  })

  // `https://github.com@evil.example/` reads as GitHub and goes elsewhere.
  it('refuses a link with credentials in it', () => {
    expect(isExternalUrl('https://user:pass@example.com/')).toBe(false)
    expect(isExternalUrl('https://github.com@evil.example/')).toBe(false)
    // A password with no user name still carries a secret into the browser's history.
    expect(isExternalUrl('https://:secret@example.com/')).toBe(false)
  })

  it('refuses what is not a URL at all', () => {
    expect(isExternalUrl('')).toBe(false)
    expect(isExternalUrl('not a url')).toBe(false)
  })
})
