import { describe, expect, it } from 'vitest'

import type { BranchRequest } from '@core/pullRequestShapes.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { workspaceView } from '../../test/workspaces.js'
import { agentsIn, openRequests, usageByWorkspace } from './overview.js'

const workspace = (name: string, overrides: Partial<WorkspaceView> = {}): WorkspaceView =>
  workspaceView(name, { branch: `octopus/${name}`, ...overrides })

const request = (overrides: Partial<BranchRequest> = {}): BranchRequest => ({
  branch: 'octopus/anna',
  number: 7,
  state: 'open',
  checks: 'passed',
  url: 'https://e.test/7',
  draft: false,
  decision: null,
  mergeable: 'mergeable',
  mergeState: 'clean',
  ...overrides
})

describe('agents in one state', () => {
  it('lists the workspaces in that state, with the conversation to open', () => {
    const anna = workspace('anna', {
      status: 'waiting_permission',
      chats: [
        {
          id: 'c-1',
          agent: 'claude',
          title: null,
          status: 'running',
          started: true,
          turnStartedAt: null
        },
        {
          id: 'c-2',
          agent: 'claude',
          title: null,
          status: 'waiting_permission',
          started: true,
          turnStartedAt: null
        }
      ]
    })
    const bob = workspace('bob', { status: 'running' })

    expect(agentsIn([anna, bob], 'waiting_permission')).toEqual([
      { workspace: anna, chatId: 'c-2' }
    ])
    expect(agentsIn([anna, bob], 'running')).toEqual([{ workspace: bob, chatId: null }])
  })
})

describe('open requests of our workspaces', () => {
  it('counts a request only where a workspace stands on its branch, and only while open', () => {
    const anna = workspace('anna')
    const bob = workspace('bob')
    const byProject = new Map([
      [
        'planner',
        new Map([
          ['octopus/anna', request({ checks: 'failed' })],
          ['octopus/bob', request({ branch: 'octopus/bob', state: 'merged' })],
          ['someone/else', request({ branch: 'someone/else' })]
        ])
      ]
    ])

    expect(openRequests([anna, bob], byProject)).toEqual([
      {
        workspace: anna,
        request: request({ checks: 'failed' }),
        standing: { kind: 'needsAction', reasons: ['checksFailed'] }
      }
    ])
  })

  it('has nothing for a project that has not answered', () => {
    expect(openRequests([workspace('anna')], new Map())).toEqual([])
  })
})

describe('the reading per workspace', () => {
  it('adds each workspace’s kinds together and puts the heaviest first', () => {
    const usage = usageByWorkspace({
      total: { cpu: 0, memory: 0 },
      app: { cpu: 0, memory: 0 },
      parts: [
        { workspaceId: 'planner/anna', kind: 'agent', cpu: 1, memory: 100 },
        { workspaceId: 'planner/bob', kind: 'server', cpu: 5, memory: 900 },
        { workspaceId: 'planner/anna', kind: 'terminal', cpu: 2, memory: 50 }
      ]
    })

    expect(usage).toEqual([
      {
        workspaceId: 'planner/bob',
        cpu: 5,
        memory: 900,
        kinds: [{ kind: 'server', memory: 900 }]
      },
      {
        workspaceId: 'planner/anna',
        cpu: 3,
        memory: 150,
        kinds: [
          { kind: 'agent', memory: 100 },
          { kind: 'terminal', memory: 50 }
        ]
      }
    ])
  })
})
