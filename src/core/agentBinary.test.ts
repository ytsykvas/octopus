import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import type { QueryFn } from './agent.js'
import { agentBinary, unpackedAgentBinary, withAgentBinary } from './agentBinary.js'

const RESOURCES = join('/', 'Applications', 'Octopus.app', 'Contents', 'Resources')
const PACKAGE = join('node_modules', '@anthropic-ai', 'claude-agent-sdk-darwin-arm64', 'claude')

describe('unpackedAgentBinary', () => {
  // What the SDK resolves in the packaged app: a path into the archive, which
  // `spawn` cannot start (`spawn ENOTDIR`).
  it('moves a binary inside the archive to the unpacked copy beside it', () => {
    const resolve = vi.fn(() => join(RESOURCES, 'app.asar', PACKAGE))

    expect(unpackedAgentBinary(resolve, 'darwin', 'arm64')).toBe(
      join(RESOURCES, 'app.asar.unpacked', PACKAGE)
    )
    expect(resolve).toHaveBeenCalledExactlyOnceWith(
      '@anthropic-ai/claude-agent-sdk-darwin-arm64/claude'
    )
  })

  // `npm run dev` and the tests: the SDK's own answer runs as it is.
  it('leaves a binary outside any archive to the SDK', () => {
    expect(unpackedAgentBinary(() => join('/', 'repo', PACKAGE), 'darwin', 'arm64')).toBeNull()
  })

  // Already unpacked is not inside the archive, and must not gain a second
  // `.unpacked`.
  it('leaves an already unpacked binary alone', () => {
    const path = join(RESOURCES, 'app.asar.unpacked', PACKAGE)

    expect(unpackedAgentBinary(() => path, 'darwin', 'arm64')).toBeNull()
  })

  // No platform package at all is the SDK's error to report, with its own
  // advice about reinstalling.
  it('says nothing when the platform package cannot be found', () => {
    const resolve = (): string => {
      throw new Error('Cannot find module')
    }

    expect(unpackedAgentBinary(resolve, 'darwin', 'arm64')).toBeNull()
  })

  it('looks up the package of the machine it runs on by default', () => {
    const resolve = vi.fn(() => join('/', 'repo', PACKAGE))

    unpackedAgentBinary(resolve)

    expect(resolve).toHaveBeenCalledWith(
      `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`
    )
  })

  // The real lookup, here in the repository: outside a package, so nothing to
  // correct — and no throw from the default resolver.
  it('finds nothing to correct in a checkout', () => {
    expect(unpackedAgentBinary()).toBeNull()
  })
})

describe('agentBinary', () => {
  // Run directly rather than through the SDK, so it has to be the startable
  // copy in a package and the package's own file everywhere else.
  it('answers with the unpacked copy in a package', () => {
    expect(agentBinary(() => join(RESOURCES, 'app.asar', PACKAGE), 'darwin', 'arm64')).toBe(
      join(RESOURCES, 'app.asar.unpacked', PACKAGE)
    )
  })

  it('answers with the package\u2019s own file in a checkout', () => {
    expect(agentBinary(() => join('/', 'repo', PACKAGE), 'darwin', 'arm64')).toBe(
      join('/', 'repo', PACKAGE)
    )
  })

  it('has no answer when the platform package cannot be found', () => {
    const resolve = (): string => {
      throw new Error('Cannot find module')
    }

    expect(agentBinary(resolve, 'darwin', 'arm64')).toBeNull()
  })

  it('finds the real binary here by default', () => {
    expect(agentBinary()).toMatch(/claude-agent-sdk-.*claude$/)
  })
})

describe('withAgentBinary', () => {
  const params = { prompt: [] as unknown as AsyncIterable<never>, options: { cwd: '/w' } }

  it('hands the binary to every query', () => {
    const query = vi.fn()
    withAgentBinary(query, '/unpacked/claude')(params)

    expect(query).toHaveBeenCalledExactlyOnceWith({
      prompt: params.prompt,
      options: { cwd: '/w', pathToClaudeCodeExecutable: '/unpacked/claude' }
    })
  })

  it('keeps a binary the caller chose', () => {
    const query = vi.fn()
    withAgentBinary(
      query,
      '/unpacked/claude'
    )({
      prompt: params.prompt,
      options: { pathToClaudeCodeExecutable: '/chosen/claude' }
    })

    expect(query).toHaveBeenCalledExactlyOnceWith({
      prompt: params.prompt,
      options: { pathToClaudeCodeExecutable: '/chosen/claude' }
    })
  })

  it('is the query itself when there is nothing to correct', () => {
    const query = vi.fn() as unknown as QueryFn

    expect(withAgentBinary(query, null)).toBe(query)
  })
})
