/**
 * Where the agent's binary can be started from in the packaged app.
 *
 * The SDK finds its CLI with `require.resolve` on the platform package beside
 * it. In a packaged build that answer points inside `app.asar` — Electron
 * patches `fs` so the file looks present, but `spawn` is not patched, and
 * starting it fails with `spawn ENOTDIR` before the agent has said anything.
 * `electron-builder.yml` already unpacks the package next to the archive, so
 * the same file is one path segment away.
 *
 * Only that answer is changed. Outside a package — `npm run dev`, the tests —
 * the SDK's own lookup is left to stand, so this cannot pick a different binary
 * than the one the SDK would have run.
 */

import { createRequire } from 'node:module'
import { sep } from 'node:path'

import type { QueryFn } from './agent.js'

const ARCHIVE = `${sep}app.asar${sep}`
const UNPACKED = `${sep}app.asar.unpacked${sep}`

/**
 * The unpacked copy of the binary the SDK would resolve, or null when the
 * SDK's own answer is runnable as it is — or when there is no answer at all,
 * which the SDK reports better than a guess here could.
 */
export function unpackedAgentBinary(
  resolve: (id: string) => string = createRequire(import.meta.url).resolve,
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  return unpackedOf(resolveAgentBinary(resolve, platform, arch))
}

/**
 * The binary the SDK runs, as a path that can be started in every build — the
 * unpacked copy when packaged, the package's own file otherwise.
 *
 * For running the CLI directly rather than through the SDK, which `plugins.ts`
 * does: the same file the sessions run, so a plugin installed through it is
 * read by a CLI of the same version. Null when there is no platform package.
 */
export function agentBinary(
  resolve: (id: string) => string = createRequire(import.meta.url).resolve,
  platform: string = process.platform,
  arch: string = process.arch
): string | null {
  const found = resolveAgentBinary(resolve, platform, arch)

  return unpackedOf(found) ?? found
}

function unpackedOf(found: string | null): string | null {
  return found?.includes(ARCHIVE) ? found.replace(ARCHIVE, UNPACKED) : null
}

function resolveAgentBinary(
  resolve: (id: string) => string,
  platform: string,
  arch: string
): string | null {
  try {
    return resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${arch}/claude`)
  } catch {
    return null
  }
}

/**
 * The same `query`, told where the binary is when it needs telling.
 *
 * A path given by the caller wins: it was chosen on purpose, and this only
 * corrects the SDK's default.
 */
export function withAgentBinary(query: QueryFn, binary: string | null): QueryFn {
  if (binary === null) return query

  return (params) =>
    query({
      ...params,
      options: { pathToClaudeCodeExecutable: binary, ...params.options }
    })
}
