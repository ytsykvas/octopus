import type { Project } from '@core/store.js'

/**
 * The project every renderer suite starts from, `planner`. One copy, because a
 * new required field on `Project` would otherwise be six edits.
 */
export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'planner',
    name: 'planner',
    repoPath: '/Users/someone/code/planner',
    baseBranch: 'origin/main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'default',
    trustRepoScripts: false,
    trustRepository: false,
    preferLocal: [],
    disabledSkillDefaults: [],
    color: 'blue',
    ...overrides
  }
}
