import type { Project } from '../store.js'

/** A project as the store holds one, its repository at `/repos/<id>`. */
export function makeProject(id: string): Project {
  return {
    id,
    name: id,
    repoPath: `/repos/${id}`,
    baseBranch: 'main',
    branchPrefix: 'ytsykvas',
    envFile: '.env',
    approvedSettings: [],
    approvedScripts: [],
    envProfile: 'default',
    trustRepoScripts: false,
    trustRepository: false,
    preferLocal: [],
    disabledSkillDefaults: [],
    color: 'blue'
  }
}
