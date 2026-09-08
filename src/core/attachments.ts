/**
 * Files a message carries a path to.
 *
 * The whole of an attachment here is its **path**: a file dragged onto the
 * composer or chosen from disk is never copied, and the message says where it
 * is. §4 asks that nothing implicit reach the agent, and a path the sender can
 * read back in their own message is the plainest form that takes — the same
 * reasoning that has a diff note go out as text rather than as anything hidden.
 *
 * So there is one thing to store and only one. A pasted image has no path,
 * because a clipboard carries a picture rather than a file, and this is where
 * it becomes one.
 */

import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { CodedError } from './codedError.js'
import { attachmentsDir } from './paths.js'

/** Machine-readable reason a paste was refused; the renderer localises it. */
export type AttachmentErrorCode = 'attachmentTooLarge' | 'attachmentType'

export class AttachmentError extends CodedError<AttachmentErrorCode> {
  override readonly name = 'AttachmentError'
}

/**
 * What a pasted image may weigh.
 *
 * A screenshot of a 6K display is a few megabytes; past this it is a
 * photograph or a mistake, and the agent pays for reading it either way.
 */
export const MAX_PASTE_BYTES = 12 * 1024 * 1024

/**
 * The image types a paste is accepted in, and the extension each is written as.
 *
 * An allowlist because this string decides a filename. Anything else is
 * refused rather than written under a name derived from what was sent.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp'
}

/**
 * Writes a pasted image and answers with its path.
 *
 * The name carries the moment rather than anything from the clipboard: there is
 * no name to take, and a counter would need state that outlives a paste. Two
 * pastes in the same millisecond are the one case the suffix covers.
 */
export async function writePastedImage(
  type: string,
  bytes: Uint8Array,
  now: Date,
  root?: string
): Promise<string> {
  const extension = EXTENSIONS[type]
  if (extension === undefined) {
    throw new AttachmentError('attachmentType', { type }, `octopus cannot attach a ${type}.`)
  }

  if (bytes.byteLength > MAX_PASTE_BYTES) {
    throw new AttachmentError(
      'attachmentTooLarge',
      { limit: String(Math.round(MAX_PASTE_BYTES / (1024 * 1024))) },
      'The pasted image is too large to attach.'
    )
  }

  const dir = attachmentsDir(root)
  await mkdir(dir, { recursive: true })

  const stamp = now.toISOString().replaceAll(/[:.]/gu, '-')
  const path = join(dir, `paste-${stamp}-${suffix()}.${extension}`)
  await writeFile(path, bytes)

  return path
}

/** Four hex characters, which is all two pastes in one millisecond need. */
function suffix(): string {
  return Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, '0')
}

/** What the directory holds, for a settings row that makes the disk visible. */
export interface AttachmentStore {
  readonly files: number
  readonly bytes: number
}

/**
 * How much has accumulated, measured rather than counted as it goes.
 *
 * Nothing here is written down: a screenshot pasted a year ago and one pasted
 * this morning are the same kind of file, and a tally kept alongside would be a
 * second answer that goes wrong the first time somebody empties the folder from
 * Finder. The directory holds tens of files, so reading it is free.
 *
 * Never throws. There is no directory until the first paste, and a settings row
 * that failed to draw because nobody has pasted anything would be absurd.
 */
export async function measureAttachments(root?: string): Promise<AttachmentStore> {
  const dir = attachmentsDir(root)

  try {
    const listing = await readdir(dir, { withFileTypes: true })

    let files = 0
    let bytes = 0

    for (const entry of listing) {
      if (!entry.isFile()) continue

      files += 1
      bytes += (await stat(join(dir, entry.name))).size
    }

    return { files, bytes }
  } catch {
    /*
     * One catch over the whole read, and it answers with nothing.
     *
     * The ordinary case is a directory that does not exist yet — there is none
     * until the first paste. The other is a read that fails halfway, and "none"
     * is the right answer there too: this is a size on a settings row, and a
     * number arrived at by counting some of the files would be worse than a row
     * that says nothing and is right again the next time it is opened.
     */
    return { files: 0, bytes: 0 }
  }
}

/**
 * Empties it, leaving the directory itself.
 *
 * The directory is handed to every session as a working-directory root, and a
 * root passed at session start that then disappears is the trap `ensureStore`
 * exists to avoid — so this removes what is in it and not the thing itself.
 *
 * **Files directly inside, and nothing else.** Everything octopus writes here
 * is one flat file; a directory somebody else put here is theirs, and a button
 * in Settings that recursed into it would be deleting more than it offered to.
 */
export async function clearAttachments(root?: string): Promise<AttachmentStore> {
  const dir = attachmentsDir(root)

  let listing
  try {
    listing = await readdir(dir, { withFileTypes: true })
  } catch {
    return { files: 0, bytes: 0 }
  }

  for (const entry of listing) {
    if (entry.isFile()) await rm(join(dir, entry.name), { force: true })
  }

  return measureAttachments(root)
}
