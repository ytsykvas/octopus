import { vi } from 'vitest'

import type { AccountsStatus } from '@core/accounts.js'
import type { Chat } from '@core/chats.js'
import type { Config } from '@core/config.js'
import type { WorkspaceDiff } from '@core/diff.js'
import type { DraftEvent, DraftState } from '@core/pullRequestDraft.js'
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
  draftListeners.clear()
  nextDraft = WRITTEN
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
      edit: vi.fn(() => ok(defaultConfig())),
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
    resources: {
      read: vi.fn(() => ok({ total: { cpu: 0, memory: 0 }, app: { cpu: 0, memory: 0 }, parts: [] }))
    },
    terminal: {
      create: vi.fn(() => ok('term-1')),
      write: vi.fn(),
      resize: vi.fn(),
      // Resolves, because it now answers when the session has actually gone and
      // a restart waits on that.
      dispose: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => ok([])),
      refused: vi.fn(() => ok(undefined)),
      onData: vi.fn(subscription),
      onExit: vi.fn(subscription)
    },
    tasks: {
      list: vi.fn(() => ok([])),
      stop: vi.fn(() => ok(undefined)),
      onChanged: vi.fn(subscription)
    },
    chats: {
      list: vi.fn(() => ok([])),
      open: vi.fn(() => ok(chatFixture())),
      create: vi.fn(() => ok(chatFixture())),
      fork: vi.fn(() => ok(chatFixture())),
      handOffPlan: vi.fn(() => ok(chatFixture())),
      close: vi.fn(() => ok(undefined)),
      closed: vi.fn(() => ok([])),
      reopen: vi.fn(() => ok(chatFixture())),
      rename: vi.fn(() => ok(undefined)),
      history: vi.fn(() => ok([])),
      rewindPreview: vi.fn(() =>
        ok({
          conversation: true,
          files: {
            canRewind: true,
            error: null,
            filesChanged: [],
            insertions: 0,
            deletions: 0,
            skippedLinks: 0
          }
        })
      ),
      rewind: vi.fn(() => ok({ files: null, text: null })),
      send: vi.fn(() => ok<string | null>(null)),
      interrupt: vi.fn(() => ok(undefined)),
      setWorkingMode: vi.fn(() => ok(undefined)),
      setPlanMode: vi.fn(() => ok(undefined)),
      setEfforts: vi.fn(() => ok(undefined)),
      setAutoCompact: vi.fn(() => ok(undefined)),
      setModels: vi.fn(() => ok(undefined)),
      models: vi.fn(() => ok([])),
      commands: vi.fn(() => ok([])),
      agents: vi.fn(() => ok([])),
      pendingPermissions: vi.fn(() => ok([])),
      usage: vi.fn(() => ok({ context: null, autoCompact: null })),
      sideQuestion: vi.fn(() => ok(null)),
      answerPermission: vi.fn(() => ok(undefined)),
      answerElicitation: vi.fn(() => ok(undefined)),
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
      read: vi.fn(() => ok(null)),
      create: vi.fn(() => ok(workspaceFixture())),
      rename: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      hasChanges: vi.fn(() => ok(false)),
      // Sides empty, which is the answer for a workspace with nothing in it and
      // the cue to colour from the hunks alone.
      changes: vi.fn(() => ok({ diff: emptyDiff(), sides: {} })),
      revertFile: vi.fn(() => ok(undefined)),
      // A branch with commits and no pull request — the state the pane offers
      // to act on, and the one most tests are about.
      pullRequest: vi.fn(() =>
        ok({
          request: null,
          pushed: false,
          dirty: false,
          ahead: 1,
          unpushedCommits: 1,
          base: 'main',
          previous: null
        })
      ),
      createPullRequest: vi.fn(() => ok('https://github.com/ytsykvas/octopus/pull/1')),
      /* As main does it: answered once started, then announced — writing at
         once, and what came of it a moment later unless a test holds it. */
      draftPullRequest: vi.fn((workspaceId: string) => {
        announceDraft({ workspaceId, state: { status: 'writing' } })
        const outcome = nextDraft
        if (outcome !== null) {
          void Promise.resolve().then(() => {
            announceDraft({ workspaceId, state: outcome })
          })
        }
        return ok(undefined)
      }),
      drafts: vi.fn(() => ok([])),
      onDraft: vi.fn((handler: (event: DraftEvent) => void) => {
        draftListeners.add(handler)
        return () => {
          draftListeners.delete(handler)
        }
      }),
      commitAndPush: vi.fn(() => ok(undefined)),
      amendAndPush: vi.fn(() => ok(undefined)),
      push: vi.fn(() => ok(undefined)),
      updateFromBase: vi.fn(() => ok(undefined)),
      // A request nobody has reviewed and nothing has checked, which is what
      // one looks like for the first minute of its life.
      pullRequestDetail: vi.fn(() => ok(detailFixture())),
      mergePullRequest: vi.fn(() => ok(undefined)),
      closePullRequest: vi.fn(() => ok(undefined)),
      rerunChecks: vi.fn(() => ok(undefined)),
      replyToReviewThread: vi.fn(() => ok(undefined)),
      setReviewThreadResolved: vi.fn(() => ok(undefined)),
      instruction: vi.fn(() => ok('Describe what changed and why.')),
      helpContext: vi.fn(() =>
        ok({
          rootPath: '/tmp/planner',
          workspaceName: 'Alice',
          slug: 'alice',
          port: 3111,
          portListening: true,
          envFile: '.env',
          profile: 'default',
          variableNames: [],
          envProblems: [],
          carry: [],
          scripts: {},
          scriptsApproved: true,
          lastRuns: []
        })
      ),
      prepare: vi.fn(() => ok({ written: [], missing: [], profile: 'default', variables: {} })),
      env: vi.fn(() => ok('')),
      trust: vi.fn(() => ok({ approved: true, digest: '', files: [] })),
      scripts: vi.fn(() => ok({ approved: true, digest: '', scripts: {} })),
      setEnvProfile: vi.fn(() => ok(undefined)),
      setNotes: vi.fn(() => ok(undefined)),
      // The port answers by default: a test about a script that ignores
      // `$OCTOPUS_PORT` says so, and the rest are not about ports at all.
      serving: vi.fn(() => ok(true)),
      port: vi.fn(() => ok(3111)),
      // Nothing left serving in a workspace unless a test puts it there.
      strays: vi.fn(() => ok([])),
      stopStrays: vi.fn(() => ok(undefined))
    },
    files: {
      open: vi.fn(() => ok(undefined)),
      tree: vi.fn(() => ok({ entries: [], statuses: {}, untrackedFolders: [], truncated: false })),
      directory: vi.fn(() => ok({ entries: [], truncated: false })),
      read: vi.fn(() => ok({ kind: 'text' as const, text: '', bytes: 0 })),
      lineChanges: vi.fn(() => ok({ added: [], modified: [], removedAfter: [] }))
    },
    attachments: {
      paste: vi.fn(() => ok('/tmp/paste.png')),
      measure: vi.fn(() => ok({ files: 0, bytes: 0 })),
      clear: vi.fn(() => ok({ files: 0, bytes: 0 })),
      // A dropped file's real path. Empty for anything that never was a file on
      // disk, which is what a drag out of a browser gives.
      pathFor: vi.fn((file: File) => `/dropped/${file.name}`)
    },

    dialog: {
      pickDirectory: vi.fn(() => ok(null)),
      pickSkill: vi.fn(() => ok(null)),
      pickMarkdown: vi.fn(() => ok(null)),
      pickFiles: vi.fn(() => ok([]))
    },
    library: {
      list: vi.fn(() => ok([])),
      read: vi.fn(() =>
        ok({
          kind: 'command' as const,
          name: 'ship',
          description: '',
          body: '',
          raw: '',
          path: '/library/ship.md'
        })
      ),
      save: vi.fn(() =>
        ok({
          kind: 'command' as const,
          name: 'ship',
          description: '',
          path: '/library/ship.md'
        })
      ),
      create: vi.fn(() =>
        ok({
          kind: 'command' as const,
          name: 'ship',
          description: '',
          path: '/library/ship.md'
        })
      ),
      remove: vi.fn(() => ok(undefined)),
      rename: vi.fn(() =>
        ok({
          kind: 'command' as const,
          name: 'ship',
          description: '',
          path: '/library/ship.md'
        })
      ),
      inspect: vi.fn(() => ok({ name: 'ship', description: '', text: '' }))
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
    plugins: {
      list: vi.fn(() => ok([])),
      catalog: vi.fn(() => ok({ officialConnected: true, plugins: [] })),
      install: vi.fn(() => ok({ kind: 'installed' as const, reloaded: 0 })),
      uninstall: vi.fn(() => ok({ reloaded: 0 })),
      setEnabled: vi.fn(() => ok({ reloaded: 0 })),
      connectOfficial: vi.fn(() => ok(undefined)),
      refresh: vi.fn(() => ok(undefined))
    },
    settings: {
      onOpen: vi.fn(subscription)
    },
    projects: {
      list: vi.fn(() => ok([])),
      add: vi.fn(() => ok(null)),
      update: vi.fn(() => ok(undefined)),
      edit: vi.fn(() => ok(undefined)),
      reorder: vi.fn(() => ok(undefined)),
      remove: vi.fn(() => ok(undefined)),
      listRemote: vi.fn(() => ok({ repositories: [], capped: false, organisations: [] })),
      addFromGitHub: vi.fn(() => ok(null)),
      branches: vi.fn(() => ok(['origin/main'])),
      pullRequests: vi.fn(() => ok({ requests: [], capped: false })),
      readScript: vi.fn(() => ok('#!/bin/sh\n')),
      saveScript: vi.fn(() => ok(undefined)),
      scriptPaths: vi.fn(() => ok({ setup: null, run: null, archive: null })),
      repoConfig: vi.fn(() => ok({ present: false, ignored: false, items: [] })),
      exportRepoConfig: vi.fn(() => ok([])),
      readCarryList: vi.fn(() => ok('.env\n')),
      saveCarryList: vi.fn(() => ok(undefined)),
      // Nothing declared, which is the ordinary answer for a checkout with no
      // `.claude` permissions in it.
      cliPermissions: vi.fn(() => ok([])),
      scripts: vi.fn(() => ok({ approved: true, digest: '', scripts: {} })),
      approveScripts: vi.fn(() => ok(undefined)),
      sources: vi.fn(() => ok([])),
      trust: vi.fn(() => ok({ approved: true, digest: '', files: [] })),
      approveSettings: vi.fn(() => ok(undefined)),
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

const WRITTEN: DraftState = {
  status: 'written',
  draft: {
    title: 'Written by the agent',
    body: 'Because of this.',
    // Not the title: a test of which one a commit went under cannot tell them
    // apart when the two read the same.
    commitMessage: 'Commit written by the agent'
  }
}

const draftListeners = new Set<(event: DraftEvent) => void>()
let nextDraft: DraftState | null = WRITTEN

/**
 * What the next description asked for comes to. Null holds it at writing, so
 * a test can do something in between and then `announceDraft` the outcome.
 */
export function answerDraft(outcome: DraftState | null): void {
  nextDraft = outcome
}

/** Says to every window listening what main would say on `workspaces:draft`. */
export function announceDraft(event: DraftEvent): void {
  for (const listener of [...draftListeners]) listener(event)
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
    interrupted: false,
    title: null,
    sessionId: null,
    resumeAt: null,
    model: null,
    planModel: null,
    planEffort: null,
    effort: 'medium',
    workingMode: 'default',
    planMode: false,
    autoCompactWindow: null,
    knownCommands: [],
    knownAgents: [],
    skillOverrides: {},
    closedAt: null,
    aside: null,
    createdAt: '2026-08-08T00:00:00.000Z',
    lastTurnAt: null
  }
}

function defaultConfig(): Config {
  return {
    version: 2 as const,
    branchPrefix: 'ytsykvas',
    cloneDirectory: '',
    settingSources: 'none' as const,
    workingMode: 'default' as const,
    planExecutionMode: 'auto' as const,
    effort: 'medium',
    model: null,
    planModel: null,
    opusPlan: false,
    alwaysAllowedTools: [],
    disabledSkillDefaults: [],
    dismissedTips: [],
    theme: 'system' as const,
    language: 'en' as const,
    rightPanelOpen: true,
    statusBarOpen: true,
    agentProgressSummaries: true,
    notificationSound: true,
    notificationSoundId: 'chime',
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
    omittedFiles: 0,
    remoteCommit: null,
    hasRemote: true,
    headOnBranch: true,
    unpushedCommits: 0,
    nothingToSend: false
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
    description: '',
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
    branchSince: null,
    writers: {},
    notes: '',
    envFileApplied: null,
    ownerId: null,
    envProfile: null
  }
}
