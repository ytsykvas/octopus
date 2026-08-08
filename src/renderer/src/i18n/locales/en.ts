/**
 * English locale — the source of truth.
 *
 * Every user-facing string lives here. Other locales mirror this shape,
 * and TypeScript enforces that they stay in sync (see `uk.ts`).
 */
export const en = {
  app: {
    name: 'octopus'
  },

  sidebar: {
    projects: 'Projects',
    empty: 'Nothing here yet. Add a repository with the "+" button.',
    addProject: 'Add repository',
    addFromDisk: 'From disk…',
    addFromDiskHint: 'A repository already on this machine',
    addFromGitHubHint: 'Clone one from your GitHub account',
    addFromGitHub: 'From GitHub…',
    removeProject: 'Remove project',
    editProject: 'Edit…',
    projectActions: 'More',
    renameHint: 'Enter to save, Escape to cancel',
    removeTitle: 'Remove project?',
    removeMessage: 'Remove “{{name}}” from the list?',
    removeDetail: 'The repository stays on disk exactly where it is.',
    removeDetailWorkspaces_one:
      'Its workspace is deleted along with its branch. The repository itself stays on disk.',
    removeDetailWorkspaces_few:
      'Its {{count}} workspaces are deleted along with their branches. The repository itself stays on disk.',
    removeDetailWorkspaces_many:
      'Its {{count}} workspaces are deleted along with their branches. The repository itself stays on disk.',
    removeDetailWorkspaces_other:
      'Its {{count}} workspaces are deleted along with their branches. The repository itself stays on disk.',
    removeConfirm: 'Remove',
    removeCancel: 'Cancel',
    settings: 'Settings'
  },

  repositories: {
    title: 'Add from GitHub',
    search: 'Search repositories',
    empty: 'No repositories found.',
    noMatch: 'Nothing matches “{{query}}”.',
    loading: 'Loading…',
    private: 'Private',
    cancel: 'Cancel',
    add: 'Add',
    cloning: 'Cloning {{name}}…',
    cloneInto: 'Cloning into',
    cloneIntoUnset: 'You will be asked where to clone.'
  },

  workspaces: {
    create: 'New workspace',
    emptyForProject: 'No workspaces yet. Add one with the + above.',
    rename: 'Rename',
    remove: 'Remove workspace',
    missing: 'Directory is gone',
    missingHint: 'Removed outside the app. Removing the entry is safe.',
    // Ukrainian needs `few` and `many` as well; i18next picks the form that
    // applies to the active language and ignores the rest.
    changedFiles_one: '{{count}} file',
    changedFiles_few: '{{count}} files',
    changedFiles_many: '{{count}} files',
    changedFiles_other: '{{count}} files',

    removeTitle: 'Remove workspace?',
    removeMessage: 'Remove “{{name}}”?',
    removeDetail: 'The worktree directory is deleted. Committed work stays on the branch.',
    removeDirty:
      'This workspace has uncommitted changes. They will be lost — nothing else keeps a copy.',
    removeBranch: 'Delete the branch {{branch}} as well',
    removeConfirm: 'Remove',
    removeCancel: 'Cancel'
  },

  project: {
    title: 'Project settings',
    sectionGeneral: 'General',
    sectionGit: 'Git',
    sectionScripts: 'Scripts',
    sectionDanger: 'Danger zone',
    done: 'Done',
    name: 'Name',
    nameHint: 'Shown in the sidebar. The repository and its folder are untouched.',
    baseBranch: 'Base branch',
    baseBranchHint:
      'New workspaces branch from here. Existing ones keep the branch they were created from.',
    branchSearch: 'Search branches',
    branchNone: 'No matching branch',
    branchFailed:
      'That branch could not be set. It may have been deleted since this list was read.',
    color: 'Colour',
    colorHint: 'Identifies the project in the tab strip and tints this sidebar.',
    setupScript: 'Build script',
    setupScriptHint:
      'Runs in a new workspace: copy an .env, install dependencies, anything a fresh checkout needs. Saved as setup.sh.',
    runScript: 'Server script',
    runScriptHint:
      'Starts the dev server. $OCTOPUS_PORT is set to the workspace\u2019s own port, so several can serve at once. Saved as run.sh.',
    repository: 'Repository',
    dangerZone: 'Danger zone',
    removeHint: 'Removes the project from octopus. The repository stays on disk.'
  },

  combobox: {
    search: 'Search',
    empty: 'Nothing found'
  },

  modal: {
    close: 'Close'
  },

  scripts: {
    build: 'Build',
    server: 'Server',
    run: 'Run',
    runAgain: 'Run again',
    restart: 'Restart',
    stop: 'Stop',
    edit: 'Write the script',
    noWorkspace: 'Select a workspace to run this in.',
    noSetup:
      'No build script yet. It runs in a fresh workspace — copying an .env, installing dependencies, whatever a checkout needs before work can start.',
    noRun:
      'No server script yet. It starts the dev server, and receives a port of its own so several workspaces can serve at once.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Runs setup.sh in this workspace.',
    runIdle: 'Starts the dev server for this workspace.'
  },

  panel: {
    changes: 'Changes',
    terminal: 'Terminal',
    collapse: 'Collapse panel',
    expand: 'Show panel',
    changesPlaceholder: "Changes in this workspace against the project's base branch.",
    terminalPlaceholder: 'Select a workspace to open a terminal in its directory.',
    resize: 'Resize panel'
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
    sectionGeneral: 'General',
    sectionGit: 'Git',
    sectionAgent: 'Agent',
    sectionAccounts: 'Claude',
    sectionAbout: 'About',

    theme: 'Theme',
    themeSystem: 'Follow system',
    themeLight: 'Light',
    themeDark: 'Dark',

    language: 'Language',
    languageHint: 'English is the default. Restart is not required.',

    branchPrefix: 'Branch prefix',
    branchPrefixHint:
      'Workspace branches are named <prefix>/<workspace>. A GitHub username is a common choice.',
    branchPrefixEmpty: 'The prefix cannot be empty.',

    cloneDirectory: 'Clone destination',
    cloneDirectoryHint:
      'Repositories added from GitHub are cloned here. Each gets its own directory named after the repository.',
    cloneDirectoryUnset: 'Not set — you will be asked on the first clone.',
    change: 'Change…',

    settingSources: 'Instruction sources',
    settingSourcesHint:
      'Controls what the agent loads besides what this app sends. "Nothing" keeps the context fully under your control.',
    settingSourcesNone: 'Nothing',
    settingSourcesNoneHint: 'The agent receives only what octopus passes explicitly.',
    settingSourcesProject: 'Project only',
    settingSourcesProjectHint: "Loads the repository's own CLAUDE.md and settings.",
    settingSourcesAll: 'Everything',
    settingSourcesAllHint: 'Loads user, project and local settings, as the plain CLI would.',

    accountsHint:
      'octopus never stores credentials. The CLI keeps them in the system keychain; this screen only reports what it says.',
    gitHint:
      'Connect GitHub to add a project by cloning one of your repositories, and to open pull requests and read checks. Credentials stay with the gh CLI, in the system keychain.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'The agent runs on this account.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Adding projects from GitHub, pull requests and checks.',
    connected: 'Connected',
    notConnected: 'Not connected',
    signIn: 'Sign in',
    signOut: 'Sign out',
    recheck: 'Refresh',
    signInRunning: 'Signing in to {{service}}',
    signingOut: 'Signing out…',
    signOutFailed: 'Could not sign out of {{service}}.',
    signInDone: 'Finished. Closing this returns to the account list.',
    signInKilled: 'The command was interrupted before it finished.',
    signInFailed: 'The command exited with code {{code}}.',
    closeTerminal: 'Done',
    opensTerminal:
      'Sign-in opens a terminal here — both tools ask questions interactively. The account list refreshes once it finishes.',
    plan: 'Plan',
    organisation: 'Organisation',
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
    notConnected: 'Could not reach GitHub. Check the account in Settings.',
    listFailed: 'GitHub returned something unexpected.',
    cloneFailed: 'Could not clone {{repository}}.',
    alreadyExists: '{{path}} already exists. Add it from disk instead.',
    branchExists: 'A branch named {{branch}} already exists.',
    pathExists: '{{path}} already exists.',
    uncommittedChanges: '{{name}} has uncommitted changes.',
    nameEmpty: 'The name cannot be empty.',
    worktreeMissing: 'That workspace is no longer there.',
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
