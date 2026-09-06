import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { AttachmentError, MAX_PASTE_BYTES, writePastedImage } from './attachments.js'

let dir: string
const NOW = new Date('2026-09-06T11:02:03.456Z')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-attach-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])

describe('a pasted image', () => {
  /*
   * The one attachment octopus stores, and it has no choice: a file dragged in
   * or chosen from disk keeps its own path and the message carries that, while
   * a clipboard holds a picture rather than a file.
   */
  it('writes the bytes and answers with where they landed', async () => {
    const path = await writePastedImage('image/png', PNG, NOW, dir)

    expect(path.startsWith(join(dir, 'attachments'))).toBe(true)
    await expect(readFile(path)).resolves.toEqual(Buffer.from(PNG))
  })

  it('names the file after the moment, since there is no name to take', async () => {
    const path = await writePastedImage('image/png', PNG, NOW, dir)

    expect(path).toContain('paste-2026-09-06T11-02-03-456Z')
    expect(path.endsWith('.png')).toBe(true)
  })

  it('writes each image type under its own extension', async () => {
    for (const [type, extension] of [
      ['image/jpeg', 'jpg'],
      ['image/gif', 'gif'],
      ['image/webp', 'webp']
    ]) {
      const path = await writePastedImage(String(type), PNG, NOW, dir)
      expect(path.endsWith(`.${String(extension)}`)).toBe(true)
    }
  })

  // Two pastes in the same millisecond are the one case the suffix covers, and
  // without it the second would overwrite the first.
  it('keeps two pastes of the same moment apart', async () => {
    await writePastedImage('image/png', PNG, NOW, dir)
    await writePastedImage('image/png', PNG, NOW, dir)

    await expect(readdir(join(dir, 'attachments'))).resolves.toHaveLength(2)
  })

  /* An allowlist because this string decides a filename. Anything else is
     refused rather than written under a name derived from what was sent. */
  it('refuses a type it does not write', async () => {
    await expect(writePastedImage('application/x-sh', PNG, NOW, dir)).rejects.toBeInstanceOf(
      AttachmentError
    )

    await expect(writePastedImage('image/png/../../evil', PNG, NOW, dir)).rejects.toMatchObject({
      code: 'attachmentType'
    })
  })

  /* A screenshot of a 6K display is a few megabytes; past this it is a
     photograph or a mistake, and the agent pays for reading it either way. */
  it('refuses an image past the ceiling', async () => {
    const huge = new Uint8Array(MAX_PASTE_BYTES + 1)

    await expect(writePastedImage('image/png', huge, NOW, dir)).rejects.toMatchObject({
      code: 'attachmentTooLarge'
    })
  })

  it('accepts one exactly at it', async () => {
    const limit = new Uint8Array(MAX_PASTE_BYTES)

    await expect(writePastedImage('image/png', limit, NOW, dir)).resolves.toContain('.png')
  })
})
