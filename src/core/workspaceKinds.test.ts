import { describe, expect, it } from 'vitest'

import { PROJECT_COLORS } from './colors.js'
import {
  DEFAULT_WORKSPACE_KIND,
  isWorkspaceKind,
  KIND_COLORS,
  WORKSPACE_KINDS
} from './workspaceKinds.js'

describe('workspace kinds', () => {
  it('gives a new workspace a kind from the set', () => {
    expect(WORKSPACE_KINDS).toContain(DEFAULT_WORKSPACE_KIND)
  })

  // The strip is drawn in `var(--project-<colour>)`, which exists only for
  // the palette's own names.
  it('draws every kind in a colour the stylesheet declares', () => {
    for (const kind of WORKSPACE_KINDS) expect(PROJECT_COLORS).toContain(KIND_COLORS[kind])
  })

  // Two kinds in one colour are one kind to the eye, which is all the strip
  // is for.
  it('never draws two kinds in the same colour', () => {
    const colours = WORKSPACE_KINDS.map((kind) => KIND_COLORS[kind])
    expect(new Set(colours).size).toBe(WORKSPACE_KINDS.length)
  })
})

describe('isWorkspaceKind', () => {
  it('knows a kind', () => {
    expect(isWorkspaceKind('fix')).toBe(true)
  })

  it('refuses a workspace name and an empty segment', () => {
    expect(isWorkspaceKind('anna')).toBe(false)
    expect(isWorkspaceKind('')).toBe(false)
  })
})
