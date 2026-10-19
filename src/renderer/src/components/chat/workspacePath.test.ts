import { describe, expect, it } from 'vitest'

import { workspaceRelative } from './workspacePath.js'

const ROOT = '/Users/me/.octopus/planner/anna'

describe('a path the agent named, as the file tabs name it', () => {
  it('takes the workspace off an absolute path inside it', () => {
    expect(workspaceRelative(ROOT, `${ROOT}/src/App.tsx`)).toBe('src/App.tsx')
    expect(workspaceRelative(`${ROOT}/`, `${ROOT}/a.ts`)).toBe('a.ts')
  })

  it('leaves a relative path as it is', () => {
    expect(workspaceRelative(ROOT, 'src/App.tsx')).toBe('src/App.tsx')
  })

  // Not a file of this workspace, so the row offers no click that could only
  // fail — a sibling whose name merely starts the same way included.
  it('refuses a path outside the workspace', () => {
    expect(workspaceRelative(ROOT, '/etc/hosts')).toBeNull()
    expect(workspaceRelative(ROOT, `${ROOT}-other/a.ts`)).toBeNull()
    expect(workspaceRelative(ROOT, ROOT)).toBeNull()
    expect(workspaceRelative(ROOT, '')).toBeNull()
  })

  it('refuses a path that climbs out of it', () => {
    expect(workspaceRelative(ROOT, `${ROOT}/../bob/a.ts`)).toBeNull()
    expect(workspaceRelative(ROOT, '../secret')).toBeNull()
  })
})
