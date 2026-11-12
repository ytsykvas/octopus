import { describe, expect, it } from 'vitest'

import { inProject, slotOf, withoutWorkspaces, workspaceOfSlot } from './workspaceSlots.js'

describe('what is held per workspace', () => {
  it('files a tab under its workspace and reads the workspace back', () => {
    expect(slotOf('planner/anna', 'first')).toBe('planner/anna#first')
    expect(workspaceOfSlot('planner/anna#first')).toBe('planner/anna')
    expect(workspaceOfSlot(slotOf('c#-tools/anna', 'first'))).toBe('c#-tools/anna')
  })

  it('drops only the workspaces that match', () => {
    const held = new Map([
      ['planner/anna', 1],
      ['planner/bob', 2]
    ])

    expect([...withoutWorkspaces(held, (id) => id === 'planner/anna')]).toEqual([
      ['planner/bob', 2]
    ])
  })

  it('hands back the same map when nothing matches', () => {
    const held = new Map([['planner/anna', 1]])

    expect(withoutWorkspaces(held, (id) => id === 'planner/bob')).toBe(held)
  })

  it('reads the workspace out of a slot when told how', () => {
    const held = new Map([
      [slotOf('planner/anna', 'first'), 'a'],
      [slotOf('planner/anna', 'chat-2'), 'b'],
      [slotOf('planner/bob', 'first'), 'c']
    ])

    expect([...withoutWorkspaces(held, (id) => id === 'planner/anna', workspaceOfSlot)]).toEqual([
      ['planner/bob#first', 'c']
    ])
  })

  it('matches a project’s workspaces and not those of a project its name begins', () => {
    const planned = inProject('plan')

    expect(planned('plan/anna')).toBe(true)
    expect(planned('planner/anna')).toBe(false)
  })
})
