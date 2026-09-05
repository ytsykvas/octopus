import { vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'
import type { Chat } from '@core/chats.js'
import type { Config } from '@core/config.js'
import type { WorkspaceDiff } from '@core/diff.js'
import type { PullRequestDetail } from '@core/pullRequestShapes.js'
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
      update: vi.fn((patch) => ok({ ...defaultConfig(), ...patch })),
      onChange: vi.fn(subscription)
    },
    accounts: {
      status: vi.fn(() => ok(disconnectedAccounts())),
      github: vi.fn(() => ok(disconnectedAccounts().github)),
      signInCommand: vi.fn((kind: string) =>
        kind === 'claude' ? ['claude', 'auth', 'login'] : ['gh', 'auth', 'login']
      ),
      signOut: vi.fn(() => ok(true))
    },
    terminal: {
      create: vi.fn(() => ok('term-1')),
      write: vi.fn(),
      resize: vi.fn(),
      // Resolves, because it now answers when the session has actually gone and
      // a restart waits on that.
      dispose: vi.fn(() => Promise.resolve()),
      onData: vi.fn(subscription),
      onExit: vi.fn(subscription)
    },
    chats: {
      list: vi.fn(() => ok([])),
      open: vi.fn(() => ok(chatFixture())),
      create: vi.fn(() => ok(chatFixture())),
      fork: vi.fn(() => ok(chatFixture())),
      close: vi.fn(() => ok(undefined)),
      rename: vi.fn(() => ok(undefined)),
      history: vi.fn(() => ok([])),
      send: vi.fn(() => ok(undefined)),
      interrupt: vi.fn(() => ok(undefined)),
      setWorkingMode: vi.fn(() => ok(undefined)),
      setPlanMode: vi.fn(() => ok(undefined)),
      setEffort: vi.fn(() => ok(undefined)),
      setModel: vi.fn(() => ok(undefined)),
      setPlanModel: vi.fn(() => ok(undefined)),
      models: vi.fn(() => ok([])),
      commands: vi.fn(() => ok([])),
      pendingPermission: vi.fn(() => ok(null)),
      usage: vi.fn(() => ok({ context: null })),
      answerPermission: vi.fn(() => ok(undefined)),
      answerQuestions: vi.fn(() => ok(undefined)),
      rateLimit: vi.fn(() => ok(null)),
      subscription: vi.fn(() => ok(null)),
      refreshSubscription: vi.fn(() => ok({ kind: 'nowhereToAsk' as const })),
      onEvent: vi.fn(subscription),
      onUsageWindows: vi.fn(subscription),
      onStatus: vi.fn(subscription),
      onChanged: vi.fn(subscription)
    },
    workspaces: {
      onStatus: vi.fn(subscription),
      list: vi.fn(() => ok([])),
      create: vi.fn(() => ok(workspaceFixture())),
      rename: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      hasChanges: vi.fn(() => ok(false)),
      diff: vi.fn(() => ok(emptyDiff())),
      revertFile: vi.fn(() => ok(undefined)),
      // A branch with commits and no pull request — the state the pane offers
      // to act on, and the one most tests are about.
      pullRequest: vi.fn(() =>
        ok({ request: null, pushed: false, dirty: false, ahead: 1, base: 'main' })
      ),
      createPullRequest: vi.fn(() => ok('https://github.com/ytsykvas/octopus/pull/1')),
      draftPullRequest: vi.fn(() =>
        ok({
          title: 'Written by the agent',
          body: 'Because of this.',
          commitMessage: 'Written by the agent'
        })
      ),
      commitAndPush: vi.fn(() => ok(undefined)),
      // A request nobody has reviewed and nothing has checked, which is what
      // one looks like for the first minute of its life.
      pullRequestDetail: vi.fn(() => ok(detailFixture())),
      mergePullRequest: vi.fn(() => ok(undefined)),
      closePullRequest: vi.fn(() => ok(undefined)),
      replyToReviewThread: vi.fn(() => ok(undefined)),
      setReviewThreadResolved: vi.fn(() => ok(undefined)),
      instruction: vi.fn(() => ok('Describe what changed and why.')),
      prepare: vi.fn(() => ok({ written: [], missing: [] })),
      env: vi.fn(() => ok('')),
      trust: vi.fn(() => ok({ approved: true, files: [] })),
      scripts: vi.fn(() => ok({ approved: true, scripts: {} })),
      approveScripts: vi.fn(() => ok(undefined)),
      setEnvProfile: vi.fn(() => ok(undefined)),
      approveSettings: vi.fn(() => ok(undefined)),
      // The port answers by default: a test about a script that ignores
      // `$OCTOPUS_PORT` says so, and the rest are not about ports at all.
      serving: vi.fn(() => ok(true)),
      port: vi.fn(() => ok(3111))
    },
    files: {
      open: vi.fn(() => ok(undefined))
    },
    dialog: {
      pickDirectory: vi.fn(() => ok(null)),
      pickSkill: vi.fn(() => ok(null))
    },
    skills: {
      list: vi.fn(() => ok([])),
      read: vi.fn(() =>
        ok({
          name: 'review',
          description: '',
          folder: 'review',
          body: '',
          raw: '',
          path: '/skills/review'
        })
      ),
      save: vi.fn(() =>
        ok({ name: 'review', description: '', folder: 'review', path: '/skills/review' })
      ),
      remove: vi.fn(() => ok(undefined)),
      rename: vi.fn(() =>
        ok({ name: 'reviewer', description: '', folder: 'reviewer', path: '/skills/reviewer' })
      ),
      inspect: vi.fn(() => ok({ name: 'review', description: 'Reviews code.', text: null })),
      import: vi.fn(() =>
        ok({ name: 'review', description: '', folder: 'review', path: '/skills/review' })
      ),
      inRepository: vi.fn(() => ok([])),
      forChat: vi.fn(() => ok([])),
      forWorkspace: vi.fn(() => ok([])),
      setForChat: vi.fn(() => ok(undefined))
    },
    settings: {
      onOpen: vi.fn(subscription)
    },
    projects: {
      list: vi.fn(() => ok([])),
      add: vi.fn(() => ok(null)),
      update: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      listRemote: vi.fn(() => ok({ repositories: [], capped: false })),
      addFromGitHub: vi.fn(() => ok(null)),
      branches: vi.fn(() => ok(['origin/main'])),
      pullRequests: vi.fn(() => ok([])),
      readScript: vi.fn(() => ok('#!/bin/sh\n')),
      saveScript: vi.fn(() => ok(undefined)),
      scriptPaths: vi.fn(() => ok({ setup: null, run: null, archive: null })),
      repoConfig: vi.fn(() => ok({ present: false, ignored: false, items: [] })),
      importRepoConfig: vi.fn(() => ok([])),
      exportRepoConfig: vi.fn(() => ok([])),
      readCarryList: vi.fn(() => ok('.env\n')),
      saveCarryList: vi.fn(() => ok(undefined)),
      scripts: vi.fn(() => ok({ approved: true, scripts: {} })),
      envProfiles: vi.fn(() => ok({ profiles: ['default'], projectDefault: 'default' })),
      readEnv: vi.fn(() => ok('')),
      createEnv: vi.fn(() => ok(undefined)),
      renameEnv: vi.fn(() => ok(undefined)),
      removeEnv: vi.fn(() => ok(undefined)),
      saveEnv: vi.fn(() => ok(undefined)),
      isEnvIgnored: vi.fn(() => ok(true)),
      instructionSources: vi.fn(() => ok([])),
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

function chatFixture(): Chat {
  return {
    id: 'chat-1',
    workspaceId: 'planner/kyiv',
    agent: 'claude',
    status: 'idle',
    title: null,
    sessionId: null,
    model: null,
    planModel: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    knownCommands: [],
    skillOverrides: {},
    createdAt: '2026-08-08T00:00:00.000Z'
  }
}

function defaultConfig(): Config {
  return {
    version: 2 as const,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none' as const,
    workingMode: 'default' as const,
    effort: 'medium',
    model: null,
    planModel: null,
    alwaysAllowedTools: [],
    disabledSkillDefaults: [],
    theme: 'system' as const,
    language: 'en' as const,
    rightPanelTab: 'diff' as const,
    rightPanelWidth: 360,
    diffView: 'unified' as const,
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
    github: { connected: false, login: null, name: null, seesOrganisations: null }
  }
}

/** A workspace that has changed nothing — what most tests want from the tab. */
function emptyDiff(): WorkspaceDiff {
  return {
    baseCommit: '0000000',
    baseBranch: 'main',
    files: [],
    added: 0,
    removed: 0,
    omittedFiles: 0
  }
}

/**
 * A request nobody has reviewed and nothing has checked.
 *
 * What one looks like for the first minute of its life, and the state a test
 * about anything else should not have to spell out.
 */
function detailFixture(): PullRequestDetail {
  return {
    state: 'open',
    title: 'Rename the thing',
    url: 'https://github.com/ytsykvas/octopus/pull/1',
    draft: false,
    checks: [],
    comments: [],
    decision: null,
    mergeable: 'mergeable',
    mergeState: 'clean',
    capped: false
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
    port: 3100,
    createdAt: '2026-08-08T00:00:00.000Z',
    ownerId: null,
    envProfile: null
  }
}
