import { describe, expect, it } from 'vitest'

import type { AgentSkill } from './agent.js'
import { describeSessionSkill, SESSION_SKILL_SOURCES, withholdable } from './sessionSkills.js'

const skill = (name: string, description: string, builtin = false): AgentSkill => ({
  name,
  description,
  builtin
})

/*
 * Every case below is a real entry, shortened, from what a live session
 * answered `reloadSkills` with in an empty repository.
 */
describe('where a skill the agent holds comes from', () => {
  it('trusts the SDK’s own flag for Claude Code’s skills', () => {
    expect(describeSessionSkill(skill('dataviz', 'Charts.', true))).toEqual({
      source: 'builtin',
      name: 'dataviz',
      description: 'Charts.'
    })
  })

  it('reads a skill synced from claude.ai off its description, and drops the label', () => {
    expect(describeSessionSkill(skill('docx', 'Word documents. (claude.ai sync)'))).toEqual({
      source: 'synced',
      name: 'docx',
      description: 'Word documents.'
    })
  })

  it('reads a plugin’s skill off its name, and drops the plugin’s name from the text', () => {
    expect(
      describeSessionSkill(skill('commit-commands:commit', '(commit-commands) Create a git commit'))
    ).toEqual({
      source: 'plugin',
      name: 'commit-commands:commit',
      description: 'Create a git commit'
    })
  })

  it('leaves a plugin’s description alone when it does not lead with the name', () => {
    expect(describeSessionSkill(skill('tools:lint', 'Lint it.')).description).toBe('Lint it.')
  })

  it('calls everything else the user’s own', () => {
    expect(describeSessionSkill(skill('deploy', 'Ship it.'))).toEqual({
      source: 'own',
      name: 'deploy',
      description: 'Ship it.'
    })
  })

  /* The order is the rule: a synced skill can carry a namespace too. */
  it('takes a namespaced synced skill as synced, not as a plugin', () => {
    expect(
      describeSessionSkill(skill('anthropic-skills:deep-research', 'Research. (claude.ai sync)'))
        .source
    ).toBe('synced')
  })

  it('takes the flag over the description', () => {
    expect(describeSessionSkill(skill('init', 'Write CLAUDE.md. (claude.ai sync)', true))).toEqual({
      source: 'builtin',
      name: 'init',
      description: 'Write CLAUDE.md. (claude.ai sync)'
    })
  })

  it('names the sources in the order the panel draws them', () => {
    expect(SESSION_SKILL_SOURCES).toEqual(['builtin', 'plugin', 'synced', 'own'])
  })
})

/* The CLI ignores `skillOverrides` for a plugin's skill; every other source obeys it. */
describe('which sources can be withheld one skill at a time', () => {
  it('takes every source but a plugin', () => {
    expect(SESSION_SKILL_SOURCES.filter(withholdable)).toEqual(['builtin', 'synced', 'own'])
  })
})
