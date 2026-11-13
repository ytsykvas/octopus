import { connect, createServer } from 'node:net'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { claimDataRoot, type DataLock, DataLockError, lockPathFor } from './dataLock.js'

let dir: string
const held: DataLock[] = []

const claim = async (root: string): Promise<DataLock | null> => {
  const lock = await claimDataRoot(root, dir)
  if (lock) held.push(lock)
  return lock
}

afterEach(async () => {
  await Promise.all(held.splice(0).map((lock) => lock.release()))
  await rm(dir, { recursive: true, force: true })
})

// A directory of its own per test, so two tests never contend for one socket.
const root = async (): Promise<string> => {
  dir = await mkdtemp(join(tmpdir(), 'octopus-lock-'))
  return join(dir, 'data')
}

describe('claiming the data root', () => {
  it('is granted when nobody holds it', async () => {
    const lock = await claim(await root())

    expect(lock).not.toBeNull()
    expect(existsSync(lock?.path ?? '')).toBe(true)
  })

  /*
   * The whole point. Two copies both write `state.json` whole, so the last
   * writer wins and whatever the other did is simply absent next time.
   */
  it('is refused while somebody else holds it', async () => {
    const path = await root()
    await claim(path)

    await expect(claimDataRoot(path, dir)).resolves.toBeNull()
  })

  it('is granted again once it has been given back', async () => {
    const path = await root()
    const first = await claimDataRoot(path, dir)
    await first?.release()

    const second = await claim(path)
    expect(second).not.toBeNull()
  })

  // Two roots are two claims: octopus pointed at a temporary directory must not
  // be refused because the real one is open.
  it('keeps two roots apart', async () => {
    const base = await root()
    await claim(base)

    await expect(claim(`${base}-other`)).resolves.not.toBeNull()
  })

  /*
   * A pid file left by a crash locks the user out of their own data until they
   * find and delete it. A socket cannot: nothing answers on it, so it is
   * removed and relinked.
   */
  it('takes a socket left behind by a process that is gone', async () => {
    const path = await root()
    // A file where the socket goes, with nothing listening — which is what a
    // crash leaves.
    await writeFile(lockPathFor(path, dir), '', 'utf8')

    await expect(claim(path)).resolves.not.toBeNull()
  })

  /* Taking a root from a process that may yet write to it is the one outcome
     worth avoiding, so a listener that accepts is enough to be refused. */
  it('is refused by anything still listening, whatever it is', async () => {
    const path = await root()
    const squatter = createServer()
    await new Promise<void>((resolve) => {
      squatter.listen(lockPathFor(path, dir), resolve)
    })

    try {
      await expect(claimDataRoot(path, dir)).resolves.toBeNull()
    } finally {
      await new Promise<void>((resolve) => {
        squatter.close(() => {
          resolve()
        })
      })
    }
  })

  /*
   * Something that is not a socket sitting where the socket goes: it cannot be
   * linked over, nothing answers on it, and it cannot be removed either. Refusing is
   * the only safe answer — the alternative is starting a second copy over a
   * root this one could not claim.
   */
  it('is refused when the path cannot be taken at all', async () => {
    const path = await root()
    await mkdir(lockPathFor(path, dir), { recursive: true })

    await expect(claimDataRoot(path, dir)).resolves.toBeNull()
  })

  it('leaves nothing behind when it is given back', async () => {
    const path = await root()
    const lock = await claimDataRoot(path, dir)
    await lock?.release()

    expect(existsSync(lock?.path ?? '')).toBe(false)
  })

  // Waiting for the server to close would wait for every peer still connected.
  it('gives the root back while somebody is still connected to it', async () => {
    const path = await root()
    const lock = await claimDataRoot(path, dir)
    const peer = connect(lock?.path ?? '')

    try {
      await once(peer, 'connect')
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
      await lock?.release()

      expect(existsSync(lock?.path ?? '')).toBe(false)
    } finally {
      peer.destroy()
    }
  })

  it('lives in the system temporary directory by default', async () => {
    const path = await root()

    const lock = await claimDataRoot(path)
    if (lock) held.push(lock)

    expect(lock?.path).toBe(lockPathFor(path))
  })

  it('takes its private name away too when it is given back', async () => {
    const path = await root()
    const lock = await claimDataRoot(path, dir)
    await lock?.release()

    expect(await readdir(dir)).toEqual([])
  })

  it('leaves nothing of its own behind when it is refused', async () => {
    const path = await root()
    await claim(path)
    const before = await readdir(dir)

    await claimDataRoot(path, dir)

    expect(await readdir(dir)).toEqual(before)
  })

  it('gives the root back once, however often it is released', async () => {
    const path = await root()
    const first = await claimDataRoot(path, dir)
    await first?.release()
    const second = await claim(path)

    await first?.release()

    expect(existsSync(second?.path ?? '')).toBe(true)
    await expect(claimDataRoot(path, dir)).resolves.toBeNull()
  })

  // Settling is where a rival that also found the socket dead relinks it over ours.
  it('refuses a takeover another claimant won meanwhile', async () => {
    const path = await root()
    const shared = lockPathFor(path, dir)
    await writeFile(shared, '', 'utf8')
    let rival: DataLock | null = null

    const lock = await claimDataRoot(path, dir, async () => {
      await unlink(shared)
      rival = await claim(path)
    })
    if (lock) held.push(lock)

    expect(lock).toBeNull()
    expect(rival).not.toBeNull()
    expect(existsSync(shared)).toBe(true)
    await expect(claimDataRoot(path, dir)).resolves.toBeNull()
  })

  it('gives up when the socket it retook was removed while it settled', async () => {
    const path = await root()
    const shared = lockPathFor(path, dir)
    await writeFile(shared, '', 'utf8')

    const lock = await claimDataRoot(path, dir, () => unlink(shared))
    if (lock) held.push(lock)

    expect(lock).toBeNull()
  })

  it('reports a socket that cannot be bound for another reason', async () => {
    await root()
    const missing = join(dir, 'missing')

    const claiming = claimDataRoot('/data', missing)

    await expect(claiming).rejects.toThrow(DataLockError)
    await expect(claiming).rejects.toThrow(missing)
  })
})

describe('where a claim lives', () => {
  /*
   * Hashed rather than spelled out: a data root may be longer than a socket
   * name may be — macOS stops at 104 characters — and it contains separators,
   * which a filename may not.
   */
  it('is a short name whatever the root is called', async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-lock-'))
    const deep = `/${'a'.repeat(300)}/octopus`

    const path = lockPathFor(deep, dir)

    expect(path.length).toBeLessThan(104)
    expect(path.startsWith(dir)).toBe(true)
  })

  it('is the same name for the same root, and a different one otherwise', async () => {
    dir = await mkdtemp(join(tmpdir(), 'octopus-lock-'))

    expect(lockPathFor('/a', dir)).toBe(lockPathFor('/a', dir))
    expect(lockPathFor('/a', dir)).not.toBe(lockPathFor('/b', dir))
  })
})
