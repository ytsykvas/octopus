import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AttachmentError,
  clearAttachments,
  discardUnnamedPastes,
  MAX_PASTE_BYTES,
  measureAttachments,
  pastesIn,
  writePastedImage
} from './attachments.js'
import { attachmentsDir } from './paths.js'

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

describe('how much has accumulated', () => {
  it('is nothing before anything has been pasted', async () => {
    await expect(measureAttachments(dir)).resolves.toEqual({ files: 0, bytes: 0 })
  })

  it('counts the files and adds up their sizes', async () => {
    await writePastedImage('image/png', PNG, NOW, dir)
    await writePastedImage('image/png', new Uint8Array(100), NOW, dir)

    await expect(measureAttachments(dir)).resolves.toEqual({ files: 2, bytes: PNG.length + 100 })
  })

  // Only what is directly inside: everything octopus writes here is one flat
  // file, and a directory somebody else put here is theirs.
  it('does not go into a directory somebody put here', async () => {
    await mkdir(join(attachmentsDir(dir), 'mine'), { recursive: true })
    await writeFile(join(attachmentsDir(dir), 'mine', 'kept.png'), new Uint8Array(500))

    await expect(measureAttachments(dir)).resolves.toEqual({ files: 0, bytes: 0 })
  })
})

describe('emptying it', () => {
  it('takes the files away and answers with what is left', async () => {
    await writePastedImage('image/png', PNG, NOW, dir)

    await expect(clearAttachments(dir)).resolves.toEqual({ files: 0, bytes: 0 })
    await expect(readdir(attachmentsDir(dir))).resolves.toEqual([])
  })

  /*
   * The directory is handed to every session as a working-directory root, and
   * one passed at session start that then disappears is the trap `ensureStore`
   * exists to avoid. So this empties it rather than removing it.
   */
  it('leaves the directory itself, which a session is holding', async () => {
    await writePastedImage('image/png', PNG, NOW, dir)

    await clearAttachments(dir)

    await expect(readdir(attachmentsDir(dir))).resolves.toEqual([])
  })

  it('leaves a directory somebody put here alone', async () => {
    await writePastedImage('image/png', PNG, NOW, dir)
    await mkdir(join(attachmentsDir(dir), 'mine'), { recursive: true })
    await writeFile(join(attachmentsDir(dir), 'mine', 'kept.png'), PNG)

    await clearAttachments(dir)

    await expect(readdir(attachmentsDir(dir))).resolves.toEqual(['mine'])
    await expect(readFile(join(attachmentsDir(dir), 'mine', 'kept.png'))).resolves.toHaveLength(4)
  })

  it('is untroubled by a directory that was never made', async () => {
    await expect(clearAttachments(dir)).resolves.toEqual({ files: 0, bytes: 0 })
  })
})

describe('the pastes a conversation named', () => {
  // A transcript is JSON lines, and a path in a message is a string in them.
  const transcript = async (name: string, text: string): Promise<string> => {
    const file = join(dir, name)
    await writeFile(file, `${JSON.stringify({ role: 'user', text })}\n`, 'utf8')
    return file
  }

  it('finds every pasted image a transcript names, by its file name', async () => {
    const first = await writePastedImage('image/png', PNG, NOW, dir)
    const second = await writePastedImage('image/webp', PNG, NOW, dir)
    const file = await transcript('a.jsonl', `look at ${first}\nand ${second}`)

    await expect(pastesIn([file])).resolves.toEqual(new Set([basename(first), basename(second)]))
  })

  // A conversation removed before its transcript was ever written is ordinary.
  it('reads a missing transcript as naming nothing', async () => {
    await expect(pastesIn([join(dir, 'never.jsonl')])).resolves.toEqual(new Set())
  })

  // The name decides what is deleted, so only the shape octopus writes counts.
  it('takes nothing that is not a name octopus writes', async () => {
    const file = await transcript(
      'a.jsonl',
      'paste-../../secrets.png and paste-x.png and notes.png'
    )

    await expect(pastesIn([file])).resolves.toEqual(new Set())
  })
})

describe('discarding the pastes nobody names any more', () => {
  it('deletes the ones no kept transcript names, and keeps the rest', async () => {
    const gone = await writePastedImage('image/png', PNG, NOW, dir)
    const shared = await writePastedImage('image/png', PNG, NOW, dir)
    const kept = join(dir, 'kept.jsonl')
    await writeFile(kept, `${JSON.stringify({ text: `still about ${shared}` })}\n`, 'utf8')

    await discardUnnamedPastes(new Set([basename(gone), basename(shared)]), [kept], dir)

    await expect(readFile(gone)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(shared)).resolves.toBeDefined()
  })

  // Only files octopus wrote: anything else in the folder is somebody's.
  it('touches nothing in the folder but the pastes it was given', async () => {
    const other = join(attachmentsDir(dir), 'k8s-backup')
    await mkdir(other, { recursive: true })
    const paste = await writePastedImage('image/png', PNG, NOW, dir)

    await discardUnnamedPastes(new Set(), [], dir)

    await expect(readdir(attachmentsDir(dir))).resolves.toEqual(
      expect.arrayContaining(['k8s-backup', basename(paste)])
    )
  })
})

describe('a paste that cannot be deleted', () => {
  // Best-effort, like the transcripts: one that will not go holds up no other.
  it('is passed over, and the rest still go', async () => {
    const stuck = 'paste-2026-09-06T11-02-03-456Z-0000.png'
    await mkdir(join(attachmentsDir(dir), stuck), { recursive: true })
    const gone = await writePastedImage('image/png', PNG, NOW, dir)

    await expect(
      discardUnnamedPastes(new Set([stuck, basename(gone)]), [], dir)
    ).resolves.toBeUndefined()
    await expect(readFile(gone)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
