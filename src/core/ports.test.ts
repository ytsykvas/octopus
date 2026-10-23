import { EventEmitter } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import {
  answersAt,
  type Connect,
  firstFreeBlock,
  isListening,
  POOL_BLOCKS,
  POOL_START,
  settlePort
} from './ports.js'
import { BLOCK, blockPorts } from './scriptEnv.js'

/**
 * A socket that goes nowhere, so the timeout can be driven rather than waited
 * for. `setTimeout` on a real socket is the kernel's business; here it is a
 * method a test calls when it wants the deadline to have passed.
 */
function silentSocket(): { connect: Connect; expire: () => void; destroyed: () => boolean } {
  const socket = new EventEmitter() as EventEmitter & {
    setTimeout: (ms: number, handler: () => void) => void
    destroy: () => void
  }
  let expire: () => void = () => undefined
  let destroyed = false

  socket.setTimeout = (_ms, handler) => {
    expire = handler
  }
  socket.destroy = () => {
    destroyed = true
  }

  return {
    connect: () => socket as unknown as Socket,
    expire: () => {
      expire()
    },
    destroyed: () => destroyed
  }
}

let server: Server | null = null

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server?.close(resolve))
    server = null
  }
})

/** A socket that emits one event on the next tick, and records the host it was asked for. */
function answering(event: (host: string) => 'connect' | 'error', seen: string[] = []): Connect {
  return (_port, host) => {
    seen.push(host)
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: () => void
      destroy: () => void
    }
    socket.setTimeout = () => undefined
    socket.destroy = () => undefined

    queueMicrotask(() => socket.emit(event(host), new Error('ECONNREFUSED')))
    return socket as unknown as Socket
  }
}

/** Listens on a free port of `host` and answers with it. */
async function serveOn(host: string): Promise<number> {
  server = createServer()
  await new Promise<void>((resolve) => {
    server?.listen(0, host, resolve)
  })

  const address = server.address()
  return typeof address === 'object' && address !== null ? address.port : 0
}

describe('isListening', () => {
  // The real thing: the injected connect below is only worth trusting if the
  // shape it stands in for is the shape node actually has.
  it('says yes to a port something is listening on', async () => {
    await expect(isListening(await serveOn('127.0.0.1'))).resolves.toBe(true)
  })

  // `localhost` resolved to the other family: up in the browser, and the
  // probe of 127.0.0.1 alone called it silent.
  it('says yes to a server on ::1 alone', async () => {
    await expect(isListening(await serveOn('::1'))).resolves.toBe(true)
  })

  it('says yes when only ::1 answers', async () => {
    const onlySix = answering((host) => (host === '::1' ? 'connect' : 'error'))

    await expect(isListening(3323, onlySix)).resolves.toBe(true)
  })

  // The case this exists for: octopus assigned the port, the script bound its
  // own, and nothing is there.
  it('says no when neither address answers', async () => {
    await expect(
      isListening(
        3323,
        answering(() => 'error')
      )
    ).resolves.toBe(false)
  })

  it('asks both loopback addresses and nothing else', async () => {
    const seen: string[] = []
    await isListening(
      3323,
      answering(() => 'error', seen)
    )

    expect(seen).toEqual(['127.0.0.1', '::1'])
  })
})

describe('answersAt', () => {
  it('says no to an address nothing answers on', async () => {
    await expect(
      answersAt(
        3323,
        '127.0.0.1',
        answering(() => 'error')
      )
    ).resolves.toBe(false)
  })

  // Something accepted the connection and then said nothing. Waiting on that
  // for ever would hold the pane, so the deadline answers for it.
  it('gives up on a connection that never answers', async () => {
    const { connect, expire, destroyed } = silentSocket()

    const answer = answersAt(3323, '127.0.0.1', connect)
    expire()

    await expect(answer).resolves.toBe(false)
    expect(destroyed()).toBe(true)
  })

  // A socket can refuse and then time out, and the teardown must stay one path.
  it('answers once however many ways it ends', async () => {
    const socket = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, handler: () => void) => void
      destroy: () => void
    }
    let expire: () => void = () => undefined
    let destroys = 0

    socket.setTimeout = (_ms, handler) => {
      expire = handler
    }
    socket.destroy = () => {
      destroys += 1
    }

    const answer = answersAt(3323, '127.0.0.1', () => socket as unknown as Socket)
    socket.emit('error', new Error('ECONNREFUSED'))
    expire()
    socket.emit('connect')

    await expect(answer).resolves.toBe(false)
    expect(destroys).toBe(1)
  })
})

describe('blockPorts', () => {
  // A stack is often more than one process, and the second had nowhere to go
  // but a number nothing was holding for it.
  it('is ten consecutive ports, the workspace\u2019s own first', () => {
    expect(blockPorts(3100)).toEqual([3100, 3101, 3102, 3103, 3104, 3105, 3106, 3107, 3108, 3109])
    expect(blockPorts(3100)).toHaveLength(BLOCK)
  })
})

describe('firstFreeBlock', () => {
  /** Nothing is listening anywhere, which is the ordinary machine. */
  const quiet = (): Promise<boolean> => Promise.resolve(false)

  it('starts at the bottom of the pool', async () => {
    await expect(firstFreeBlock([], quiet)).resolves.toBe(POOL_START)
  })

  it('skips a block another workspace holds', async () => {
    await expect(firstFreeBlock([POOL_START], quiet)).resolves.toBe(POOL_START + BLOCK)
  })

  /*
   * The check the old scheme never made. A port another application is holding
   * is not in our records, and handing it out anyway is what made a server fail
   * as it bound — blaming itself for somebody else's port.
   */
  it('skips a block something outside octopus is answering on', async () => {
    const busyFirst = (port: number): Promise<boolean> => Promise.resolve(port === POOL_START)

    await expect(firstFreeBlock([], busyFirst)).resolves.toBe(POOL_START + BLOCK)
  })

  it('asks only about the first port of each block', async () => {
    const asked: number[] = []
    await firstFreeBlock([], (port) => {
      asked.push(port)
      return Promise.resolve(false)
    })

    expect(asked).toEqual([POOL_START])
  })

  // The caller decides what to do about it; there is nothing sensible to invent
  // here.
  it('answers with nothing when every block is spoken for', async () => {
    const claimed = Array.from({ length: POOL_BLOCKS }, (_, index) => POOL_START + index * BLOCK)

    await expect(firstFreeBlock(claimed, quiet)).resolves.toBeNull()
  })

  it('leaves the pool where it says it is', async () => {
    const claimed = Array.from({ length: POOL_BLOCKS - 1 }, (_, i) => POOL_START + i * BLOCK)
    const last = await firstFreeBlock(claimed, quiet)

    expect(last).toBe(POOL_START + (POOL_BLOCKS - 1) * BLOCK)
  })
})

describe('settlePort', () => {
  const quiet = (): Promise<boolean> => Promise.resolve(false)

  it('keeps the port when nothing is answering on it', async () => {
    await expect(settlePort(3323, [], quiet)).resolves.toBe(3323)
  })

  // The whole point: a port free when the workspace was made can belong to
  // something else by the time anybody runs it.
  it('moves to a free block when something has taken it', async () => {
    const busy = (port: number): Promise<boolean> => Promise.resolve(port === 3323)

    await expect(settlePort(3323, [], busy)).resolves.toBe(POOL_START)
  })

  it('steps over a block another workspace holds', async () => {
    const busy = (port: number): Promise<boolean> => Promise.resolve(port === 3323)

    await expect(settlePort(3323, [POOL_START], busy)).resolves.toBe(POOL_START + BLOCK)
  })

  /*
   * Everything else about the workspace works, so taking it away over a port
   * would cost more than the clash. A server that cannot bind says so in the
   * script's own words, which is more use than an invented failure of ours.
   */
  it('keeps the taken port when the pool has nothing free either', async () => {
    const everythingBusy = (): Promise<boolean> => Promise.resolve(true)

    await expect(settlePort(3323, [], everythingBusy)).resolves.toBe(3323)
  })
})
