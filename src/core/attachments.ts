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

import { mkdir, writeFile } from 'node:fs/promises'
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
