import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { rendererUrl } from './rendererSource.js'

const FILE = '/Applications/Octopus.app/Contents/Resources/app.asar/out/renderer/index.html'
const BUILT = pathToFileURL(FILE).href
const DEV = 'http://localhost:5173/'

describe('rendererUrl', () => {
  it('loads the built page in a packaged app whatever the environment says', () => {
    expect(rendererUrl({ ELECTRON_RENDERER_URL: DEV }, true, FILE)).toBe(BUILT)
  })

  it('loads the dev server outside a packaged app', () => {
    expect(rendererUrl({ ELECTRON_RENDERER_URL: DEV }, false, FILE)).toBe(DEV)
  })

  it.each([{}, { ELECTRON_RENDERER_URL: '' }])(
    'loads the built page when %j names no server',
    (env) => {
      expect(rendererUrl(env, false, FILE)).toBe(BUILT)
    }
  )
})
