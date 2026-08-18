/**
 * Whether anything is listening where we said it would be.
 *
 * octopus assigns a workspace a port, hands it to `run.sh` as `$OCTOPUS_PORT`
 * and offers a link to it — and none of that obliges the script to use it. A
 * `run.sh` of `rails s` binds the framework's own default instead, so the link
 * opens on nothing and the pane looks broken rather than the script.
 *
 * Asking is the only way to tell. It is a fact about the machine, not about our
 * state, which is why it is read on demand rather than remembered.
 */

import { createConnection, type Socket } from 'node:net'

/** Loopback only: a workspace's dev server is not somebody else's to reach. */
const HOST = '127.0.0.1'

/**
 * How long to wait for an answer.
 *
 * A refusal on loopback is immediate; this is for the case where something
 * accepts the connection and then says nothing, which must not hold the pane.
 */
const TIMEOUT_MS = 1_000

/** How a connection is opened, injected so a test never touches the network. */
export type Connect = (port: number, host: string) => Socket

export async function isListening(
  port: number,
  connect: Connect = (target, host) => createConnection({ port: target, host })
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(port, HOST)

    /*
     * Answered once, however it ends.
     *
     * A socket can refuse and then time out, or connect and then error on the
     * way down; resolving twice is harmless to a promise but the destroy is
     * not, and this keeps the teardown to one path.
     */
    let settled = false
    const finish = (listening: boolean): void => {
      if (settled) return
      settled = true

      socket.destroy()
      resolve(listening)
    }

    socket.setTimeout(TIMEOUT_MS, () => {
      finish(false)
    })
    socket.once('connect', () => {
      finish(true)
    })
    socket.once('error', () => {
      finish(false)
    })
  })
}
