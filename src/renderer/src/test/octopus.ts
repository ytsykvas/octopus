import { vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'
import type { Config } from '@core/config.js'
import type { Workspace } from '@core/store.js'

import type { OctopusApi } from '../../../preload/index.js'

type Api = OctopusApi

/**
 * A stand-in for the preload bridge.
 *
 * Typed as the real `OctopusApi`, so a channel added to preload without a
 * counterpart here is a compile error rather than a test that quietly exercises
 * a bridge the application no longer has.
 *
 * Every method is a spy, so a test can assert what the UI asked for, and every
 * one resolves successfully by default — a test that cares about failure says
 * so, and the rest are not obliged to describe a working application.
 */
export function installOctopusStub(): Api {
  const ok = <T>(value: T): Promise<{ ok: true; value: T }> => Promise.resolve({ ok: true, value })
  /** Subscriptions return their unsubscribe function, which components call. */
  const subscription = (): (() => void) => vi.fn()

  const api: Api = {
    theme: {
      get: vi.fn(() => Promise.resolve('light' as const)),
      onChange: vi.fn(subscription)
    },
    config: {
      get: vi.fn(() => ok(defaultConfig())),
      update: vi.fn((patch) => ok({ ...defaultConfig(), ...patch }))
    },
    accounts: {
      status: vi.fn(() => ok(disconnectedAccounts())),
      signInCommand: vi.fn((kind: string) =>
        kind === 'claude' ? ['claude', 'auth', 'login'] : ['gh', 'auth', 'login']
      ),
      signOut: vi.fn(() => ok(true))
    },
    terminal: {
      create: vi.fn(() => ok('term-1')),
      write: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(subscription),
      onExit: vi.fn(subscription)
    },
    workspaces: {
      list: vi.fn(() => ok([])),
      create: vi.fn(() => ok(workspaceFixture())),
      rename: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      hasChanges: vi.fn(() => ok(false))
    },
    dialog: {
      pickDirectory: vi.fn(() => ok(null))
    },
    settings: {
      onOpen: vi.fn(subscription)
    },
    projects: {
      list: vi.fn(() => ok([])),
      add: vi.fn(() => ok(null)),
      update: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      listRemote: vi.fn(() => ok([])),
      addFromGitHub: vi.fn(() => ok(null)),
      branches: vi.fn(() => ok(['origin/main'])),
      readScript: vi.fn(() => ok('#!/bin/sh\n')),
      saveScript: vi.fn(() => ok(undefined)),
      scriptPaths: vi.fn(() => ok({ setup: null, run: null })),
      readInstruction: vi.fn(() => ok('# Pull request descriptions\n')),
      saveInstruction: vi.fn(() => ok(undefined))
    }
  }

  Object.defineProperty(window, 'octopus', { value: api, writable: true, configurable: true })
  return api
}

/** The stub's own `window.octopus`, typed, for assertions inside a test. */
export function octopus(): Api {
  return window.octopus
}

function defaultConfig(): Config {
  return {
    version: 1 as const,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none' as const,
    theme: 'system' as const,
    language: 'en' as const,
    rightPanelWidth: 360,
    sidebarWidth: 240,
    deviceId: '00000000-0000-4000-8000-000000000000',
    installedAt: '2026-08-08T00:00:00.000Z'
  }
}

/**
 * Both services signed out.
 *
 * The shape matters: the account sections read through `status.claude` and
 * `status.github` without guarding either, so a placeholder that is not a whole
 * account throws on render rather than showing a disconnected card. Exported so
 * a test about one service can spread this and replace only that half, instead
 * of restating an account it does not care about.
 */
export function disconnectedAccounts(): AccountsStatus {
  return {
    claude: {
      connected: false,
      email: null,
      authMethod: null,
      subscriptionType: null,
      orgName: null
    },
    github: { connected: false, login: null, name: null }
  }
}

function workspaceFixture(): Workspace {
  return {
    id: 'planner/anna',
    projectId: 'planner',
    name: 'anna',
    branch: 'ytsykvas/anna',
    path: '/tmp/planner/anna',
    status: 'idle' as const,
    sessionId: null,
    port: 3100,
    createdAt: '2026-08-08T00:00:00.000Z',
    ownerId: null
  }
}
