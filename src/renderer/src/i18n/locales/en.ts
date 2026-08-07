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
    removeProject: 'Remove project',
    settings: 'Settings'
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

  settings: {
    title: 'Settings',
    close: 'Close',
    saved: 'Saved',

    sectionGeneral: 'General',
    sectionGit: 'Git',
    sectionAgent: 'Agent',
    sectionAccounts: 'Accounts',
    sectionAbout: 'About',

    appearance: 'Appearance',
    theme: 'Theme',
    themeSystem: 'Follow system',
    themeLight: 'Light',
    themeDark: 'Dark',

    language: 'Language',
    languageHint: 'English is the default. Restart is not required.',

    git: 'Git',
    branchPrefix: 'Branch prefix',
    branchPrefixHint:
      'Workspace branches are named <prefix>/<workspace>. A GitHub username is a common choice.',
    branchPrefixEmpty: 'The prefix cannot be empty.',

    agent: 'Agent',
    settingSources: 'Instruction sources',
    settingSourcesHint:
      'Controls what the agent loads besides what this app sends. "Nothing" keeps the context fully under your control.',
    settingSourcesNone: 'Nothing',
    settingSourcesNoneHint: 'The agent receives only what maestro passes explicitly.',
    settingSourcesProject: 'Project only',
    settingSourcesProjectHint: "Loads the repository's own CLAUDE.md and settings.",
    settingSourcesAll: 'Everything',
    settingSourcesAllHint: 'Loads user, project and local settings, as the plain CLI would.',

    accounts: 'Accounts',
    accountsHint:
      'maestro never stores credentials. Both tools keep them in the system keychain; this screen only reports what they say.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'The agent runs on this account.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Used for pull requests and checks.',
    connected: 'Connected',
    notConnected: 'Not connected',
    signIn: 'Sign in',
    signOut: 'Sign out',
    recheck: 'Refresh',
    opensTerminal:
      'Sign-in runs in Terminal — both tools ask questions that need a real terminal. Come back and press Refresh when done.',
    plan: 'Plan',
    organisation: 'Organisation',
    cliMissing: 'Command not found. Install the tool first.',

    about: 'About',
    deviceId: 'Device id',
    installedAt: 'First run'
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
