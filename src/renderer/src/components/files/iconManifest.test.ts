import { describe, expect, it } from 'vitest'

import { loadIconManifest } from './iconManifest.js'

describe('loadIconManifest', () => {
  it('reads the installed manifest', async () => {
    const manifest = await loadIconManifest()

    expect(manifest.fileExtensions.ts).toBe('typescript')
    expect(manifest.light.fileExtensions.toml).toBe('toml_light')
  })

  it('refuses when the package is not there', async () => {
    await expect(loadIconManifest({})).rejects.toThrow(/not installed/)
  })

  // Somebody else's file: a reshaped one is refused rather than half-read.
  it('refuses a manifest whose shape has changed', async () => {
    await expect(
      loadIconManifest({ 'x.json': () => Promise.resolve({ default: { file: 1 } }) })
    ).rejects.toThrow()
  })

  it('fills in a light block that names nothing', async () => {
    const manifest = await loadIconManifest({
      'x.json': () =>
        Promise.resolve({
          default: {
            iconDefinitions: {},
            fileNames: {},
            fileExtensions: {},
            languageIds: {},
            folderNames: {},
            folderNamesExpanded: {},
            file: 'file',
            folder: 'folder',
            folderExpanded: 'folder-open',
            light: {}
          }
        })
    })

    expect(manifest.light.fileNames).toEqual({})
  })
})
