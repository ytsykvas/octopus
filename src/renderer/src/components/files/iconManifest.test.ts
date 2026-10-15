import { describe, expect, it } from 'vitest'

import { loadIconManifest } from './iconManifest.js'

describe('loadIconManifest', () => {
  it('reads the manifest kept in vendor/', async () => {
    const manifest = await loadIconManifest()

    expect(manifest.fileExtensions.ts).toBe('typescript')
    expect(manifest.folderNames.src).toBe('folder_src')
  })

  it('refuses when the copy is not there', async () => {
    await expect(loadIconManifest({})).rejects.toThrow(/not in vendor/)
  })

  // Somebody else's file: a reshaped one is refused rather than half-read.
  it('refuses a manifest whose shape has changed', async () => {
    await expect(
      loadIconManifest({ 'x.json': () => Promise.resolve({ default: { file: 1 } }) })
    ).rejects.toThrow()
  })
})
