/**
 * One process at a time may own the data root.
 *
 * Two copies of octopus both open `~/.octopus/state.json`, both hold it in
 * memory and both write it whole, so the last writer wins and whatever the
 * other did is not merged or refused but simply absent next time. `commit`
 * serialising writes and `writeJsonFile` renaming into place make a write
 * orderly and untearable **within one process**; neither is exclusive across
 * two.
 *
 * Electron's own single-instance lock covers most of that and is keyed on its
 * **userData** directory, which is not the same scope: two builds resolving
 * that name differently each take their own lock and both start. What they
 * actually share is `~/.octopus`, so that is what this is keyed on. It is also
 * the layer a CLI or a daemon would get for free, having no Electron and
 * therefore no lock at all.
 *
 * **A socket rather than a pid file**, and the difference is the whole design:
 * a pid file left by a crash locks the user out of their own data until they
 * find and delete it, and a pid can be reused by something else entirely. A
 * socket cannot be stale in a way that refuses anybody — if the name is taken,
 * *connect* to it. A live holder accepts; a dead one's socket refuses the
 * connection, and is then removed and relinked. Nothing has to decide whether
 * a process is alive by looking at a number.
 *
 * Bound under a private name and published by `link`: Node unlinks a socket's
 * name when its server closes, whoever owns that name by then. The rest is in
 * docs/data/ownership.md.
 *
 * **Outside the data root**, named after it. What is locked is the root, and
 * the lock is not part of what it locks — a file inside would travel with a
 * copied directory and be one more thing `state.json`'s readers have to ignore.
 * `os.tmpdir()` is also cleared on reboot, which is exactly right for something
 * that should never outlive the process holding it.
 */

import { createHash, randomBytes } from 'node:crypto'
import { connect, createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { link, stat, unlink } from 'node:fs/promises'

import { describeError } from './persist.js'

/** A claim on the data root, held until it is given back. */
export interface DataLock {
  /** Where the claim lives, for a message that has to name it. */
  readonly path: string
  readonly release: () => Promise<void>
}

/** The socket could not be bound, which is not the same as somebody holding the root. */
export class DataLockError extends Error {
  override readonly name = 'DataLockError'

  constructor(reason: string) {
    super(`Could not lock the data root: ${reason}`)
  }
}

// A rival that also found the socket dead has one `await` between its probe and its unlink.
const TAKEOVER_SETTLE_MS = 50

/**
 * The socket for a data root.
 *
 * Hashed rather than spelled out: a path may be longer than a socket name may
 * be — macOS stops at 104 characters — and it may contain a separator, which a
 * filename may not.
 */
export function lockPathFor(root: string, dir: string = tmpdir()): string {
  return nameFor(root, dir, 'sock')
}

function nameFor(root: string, dir: string, ending: string): string {
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 16)
  return join(dir, `octopus-${digest}.${ending}`)
}

/**
 * Claims the data root, or answers `null` because somebody else holds it.
 *
 * `null` rather than throwing: another copy already running is an ordinary
 * thing for a user to do, and the caller's job is to say so and stop rather
 * than to report an error. A socket that cannot be bound at all throws a
 * {@link DataLockError}.
 */
export async function claimDataRoot(
  root: string,
  dir: string = tmpdir(),
  settle: () => Promise<void> = afterRivals
): Promise<DataLock | null> {
  const path = lockPathFor(root, dir)
  const own = nameFor(root, dir, randomBytes(4).toString('hex'))
  const server = await bind(own)

  if (await publish(own, path)) return held(server, path)

  // Taken. Whether it is taken by anything still listening is the question.
  if (await answers(path)) return giveUp(server)

  // Stale: the holder is gone and left the socket behind. Removing it is safe
  // precisely because nothing answered on it.
  await unlink(path).catch(ignore)
  if (!(await publish(own, path))) return giveUp(server)

  await settle()
  return (await stillOurs(own, path)) ? held(server, path) : giveUp(server)
}

function held(server: Server, path: string): DataLock {
  let released: Promise<void> | undefined

  return {
    path,
    // The shared name goes while the server still answers on it, so nobody can have retaken it.
    release: () =>
      (released ??= unlink(path)
        .catch(ignore)
        .then(() => {
          server.close()
        }))
  }
}

// `close` removes the private name at once; its callback waits for every connected peer.
function giveUp(server: Server): null {
  server.close()
  return null
}

async function publish(own: string, path: string): Promise<boolean> {
  return link(own, path).then(
    () => true,
    () => false
  )
}

async function stillOurs(own: string, path: string): Promise<boolean> {
  const shared = await stat(path).catch(() => null)
  return shared?.ino === (await stat(own)).ino
}

async function afterRivals(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, TAKEOVER_SETTLE_MS)
  })
}

function ignore(): undefined {
  return undefined
}

/** Binds a name nobody else uses, so any failure is one to report rather than a holder. */
async function bind(path: string): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer()

    server.once('error', (error) => {
      reject(new DataLockError(describeError(error)))
    })
    server.listen(path, () => {
      // Nothing is ever sent over it. The socket exists to be **held**, and a
      // connection to it is a question about whether anybody is.
      server.unref()
      resolve(server)
    })
  })
}

/**
 * Whether anybody is listening on a socket that already exists.
 *
 * No timeout, and that is not an omission. A connection to a unix socket is
 * settled by the kernel: it is accepted from the listen backlog, or refused at
 * once because nothing is bound — a holder whose event loop is wedged still has
 * its socket accepted, because accepting is not something its code does. There
 * is nothing to wait for, so a deadline here would be a branch that cannot be
 * reached and a claim nothing tests.
 */
async function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path)
    const settle = (answer: boolean): void => {
      socket.destroy()
      resolve(answer)
    }

    socket.once('connect', () => {
      settle(true)
    })
    socket.once('error', () => {
      settle(false)
    })
  })
}
