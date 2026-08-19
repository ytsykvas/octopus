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

import { BLOCK } from './scriptEnv.js'

/** Loopback only: a workspace's dev server is not somebody else's to reach. */
const HOST = '127.0.0.1'

/**
 * Where the blocks live.
 *
 * Small and named, so it can be reasoned about and firewalled, and twenty
 * workspaces serving at once is far past what anybody runs. It starts at 3100
 * rather than 3000 deliberately: 3000 is what an unconfigured framework binds,
 * and a pool meant to coexist with that must not begin by fighting it.
 */
export const POOL_START = 3100
export const POOL_BLOCKS = 20

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

/**
 * The lowest block nothing is using, or null when they are all spoken for.
 *
 * Two kinds of "in use", and both matter. A port another workspace holds is
 * ours to know about; a port some other application is holding is not, and it
 * is the one that used to get handed out anyway — the workspace then failed the
 * moment its server bound, blaming itself.
 *
 * The probe is a parameter so the caller decides what asking costs, and so a
 * test never opens a socket.
 */
export async function firstFreeBlock(
  claimed: readonly number[] = [],
  answers: (port: number) => Promise<boolean> = (port) => isListening(port)
): Promise<number | null> {
  const taken = new Set(claimed)

  for (let index = 0; index < POOL_BLOCKS; index++) {
    const port = POOL_START + index * BLOCK
    if (taken.has(port)) continue
    if (!(await answers(port))) return port
  }

  return null
}

/**
 * The port a workspace should serve on now, which is usually the one it had.
 *
 * Asked on the way into a run, and only while nothing of this workspace is
 * alive — which is what makes the answer knowable. With nothing of ours
 * running, anything answering on that port belongs to somebody else, and there
 * is no ownership to establish.
 *
 * A pool with nothing free in it answers with the port it was given. Everything
 * else about the workspace works, and a server that cannot bind says so in the
 * script's own words rather than in an invented failure of ours.
 */
export async function settlePort(
  current: number,
  claimedByOthers: readonly number[],
  answers: (port: number) => Promise<boolean> = (port) => isListening(port)
): Promise<number> {
  if (!(await answers(current))) return current

  return (await firstFreeBlock(claimedByOthers, answers)) ?? current
}
