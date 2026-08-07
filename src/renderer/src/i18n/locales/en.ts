/**
 * English locale — the source of truth.
 *
 * Every user-facing string lives here. Other locales mirror this shape,
 * and TypeScript enforces that they stay in sync (see `uk.ts`).
 */
export const en = {
  app: {
    name: 'maestro'
  },

  sidebar: {
    projects: 'Projects',
    empty: 'Nothing here yet. Add a repository with the "+" button.',
    addProject: 'Add repository',
    removeProject: 'Remove project'
  },

  panel: {
    changes: 'Changes',
    terminal: 'Terminal',
    collapse: 'Collapse panel',
    expand: 'Show panel',
    changesPlaceholder: "Changes in this workspace against the project's base branch.",
    terminalPlaceholder: "A terminal in the workspace's directory."
  },

  center: {
    noProjectsTitle: 'Start with a repository',
    noProjectsBody:
      'Add a project in the left panel. Workspaces are created inside it — each with its own branch, directory and agent session.',
    noSelectionTitle: 'Select a project',
    noSelectionBody: 'Pick one from the list on the left.',
    projectBody: 'Base branch {{branch}}. The agent chat appears here once workspaces exist.'
  },

  errors: {
    notARepository: '{{path}} is not a git repository.',
    emptyRepository:
      '{{path}} has no commits yet. Make an initial commit — a worktree cannot be created without one.',
    noBaseBranch:
      'Could not determine a base branch in {{path}}. Check out the branch you want and try again.',
    duplicateProject: 'This repository is already added as project "{{name}}".',
    unknown: 'Something went wrong: {{message}}'
  }
}

/**
 * Shape every locale must match.
 *
 * Note there is no `as const`: keys stay typed (so `t('...')` is checked)
 * while values remain plain strings, which is what lets a translation differ
 * from the English original.
 */
export type Translation = typeof en
