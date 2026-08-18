import { EventEmitter } from 'node:events'
import { createServer, type Server, type Socket } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { type Connect, isListening } from './ports.js'

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

describe('isListening', () => {
  // The real thing, once: the injected connect below is only worth trusting if
  // the shape it stands in for is the shape node actually has.
  it('says yes to a port something is listening on', async () => {
    server = createServer()
    await new Promise<void>((resolve) => {
      server?.listen(0, '127.0.0.1', resolve)
    })

    const address = server.address()
    const port = typeof address === 'object' && address !== null ? address.port : 0

    await expect(isListening(port)).resolves.toBe(true)
  })

  // The case this exists for: octopus assigned the port, the script bound its
  // own, and nothing is there.
  it('says no to a port nothing answers on', async () => {
    const refusing: Connect = () => {
      const socket = new EventEmitter() as EventEmitter & {
        setTimeout: () => void
        destroy: () => void
      }
      socket.setTimeout = () => undefined
      socket.destroy = () => undefined

      queueMicrotask(() => socket.emit('error', new Error('ECONNREFUSED')))
      return socket as unknown as Socket
    }

    await expect(isListening(3323, refusing)).resolves.toBe(false)
  })

  // Something accepted the connection and then said nothing. Waiting on that
  // for ever would hold the pane, so the deadline answers for it.
  it('gives up on a connection that never answers', async () => {
    const { connect, expire, destroyed } = silentSocket()

    const answer = isListening(3323, connect)
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

    const answer = isListening(3323, () => socket as unknown as Socket)
    socket.emit('error', new Error('ECONNREFUSED'))
    expire()
    socket.emit('connect')

    await expect(answer).resolves.toBe(false)
    expect(destroys).toBe(1)
  })

  it('asks loopback rather than anywhere reachable', () => {
    let seen = ''
    const record: Connect = (_port, host) => {
      seen = host
      const socket = new EventEmitter() as EventEmitter & {
        setTimeout: () => void
        destroy: () => void
      }
      socket.setTimeout = () => undefined
      socket.destroy = () => undefined
      return socket as unknown as Socket
    }

    void isListening(3323, record)
    expect(seen).toBe('127.0.0.1')
  })
})
