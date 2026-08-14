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
    collapse: 'Hide workspaces',
    expand: 'Show workspaces',
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
    cloneIntoUnset: 'You will be asked where to clone.',
    connect: 'Connect GitHub…'
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
    sectionInstructions: 'Instructions',
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
    icon: 'Icon',
    iconHint: 'Stands on the project tab in place of the initials.',
    iconNone: 'Initials',
    setupScript: 'Build script',
    setupScriptHint:
      'Runs in a new workspace: copy an .env, install dependencies, anything a fresh checkout needs. Saved as setup.sh.',
    runScript: 'Server script',
    runScriptHint:
      'Starts the dev server. $OCTOPUS_PORT is set to the workspace\u2019s own port, so several can serve at once. Saved as run.sh.',
    pullRequestInstruction: 'Pull request descriptions',
    pullRequestInstructionHint:
      'Handed to the agent when it writes a pull request for this project. Nothing reads it yet — pull requests are still ahead.',
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

  chat: {
    placeholder: 'Ask the agent to do something in this workspace…',
    send: 'Send',
    stop: 'Stop',
    working: 'Working…',
    thinking: 'Thinking',
    memoryReset: 'The agent’s memory of this conversation starts again here',

    emptyTitle: 'Start the conversation',
    emptyBody:
      'The first message starts an agent session in this worktree. The branch already exists.',

    /* Names the control and the mode in force together: the button switches
       rather than opening a list, so the value is all it shows. */
    modeToggle: 'Permissions: {{mode}}',
    modeDefault: 'Ask first',
    /* Left in English in every locale: it is what the agent's own interfaces
       call this, and a translated name for a borrowed one reads as a second
       setting rather than the same one. */
    modeAcceptEdits: 'Auto mode',
    modeAfterPlan: 'What the agent may do once the plan is approved.',
    planMode: 'Plan',
    planModeHint: 'Work out an approach first. The agent runs no tools until you approve it.',

    context: 'Context',
    contextTitle: 'Context window — {{used}} of {{total}}',
    /* The second lines of the menu the reading opens. The commands themselves
       are not here: they are the CLI's own names, printed the way the
       suggestion list prints them, and a translated `/clear` would be a
       command that does nothing. */
    contextCompactNote: 'The agent keeps a summary of the conversation and carries on.',
    contextClearNote: 'The agent forgets this conversation, and the log goes with it.',
    clearTitle: 'Clear this conversation?',
    clearMessage: 'The agent starts again with no memory of what was said here.',
    clearDetail: 'The log is deleted with it, and cannot be brought back.',
    clearConfirm: 'Clear',
    clearCancel: 'Cancel',
    windowFiveHour: '5h',
    windowFiveHourTitle: 'Five-hour window',
    windowWeek: 'Week',
    windowWeekTitle: 'Weekly window',

    model: 'Model',
    /* The default row's name, for a catalogue that has not arrived yet and so
       cannot say which model the default actually runs. */
    modelDefault: 'Default model',
    /* Under the model the agent's default runs, so that row is read as a
       standing choice rather than as one more model beside the others. */
    modelDefaultNote: 'by default',

    effort: 'Effort',
    effortLow: 'Low',
    effortMedium: 'Medium',
    effortHigh: 'High',
    effortXhigh: 'Very high',
    effortMax: 'Maximum',
    effortUnsupported: 'This model does not take an effort setting.',

    // Ukrainian needs `few` and `many` as well; i18next picks the form that
    // applies to the active language and ignores the rest.
    toolSteps_one: '{{count}} step',
    toolSteps_few: '{{count}} steps',
    toolSteps_many: '{{count}} steps',
    toolSteps_other: '{{count}} steps',

    plan: 'Plan',
    executePlan: 'Execute',
    executePlanMessage: 'Carry out the plan “{{title}}”.',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    planReady: 'The plan is ready',
    planExecute: 'Execute',
    planFeedback: 'Anything to work out first?',
    planFeedbackPlaceholder: 'Write here and the agent will revise the plan',
    questionTitle: 'The agent is asking',
    questionOther: 'Something else',
    questionOtherPlaceholder: 'Write your own answer',
    questionSend: 'Answer',
    questionSkip: 'Skip',
    questionAnswered: 'Answered.',
    questionUnanswered: 'Left unanswered.',

    permissionTitle: 'The agent wants to use {{tool}}',
    permissionAnswered: 'Already answered.',
    allow: 'Allow',
    always: 'Always allow',
    deny: 'Decline',

    duration: '{{seconds}}s',
    // Ukrainian needs `few` and `many` as well; i18next picks the form that
    // applies to the active language and ignores the rest.
    tokens_one: '{{tokens}} token',
    tokens_few: '{{tokens}} tokens',
    tokens_many: '{{tokens}} tokens',
    tokens_other: '{{tokens}} tokens',

    endedInterrupted: 'stopped',
    endedLimit: 'hit a limit',
    endedTooLong: 'conversation too long',
    endedBlocked: 'stopped by a hook',
    endedFailed: 'ended with an error',

    usageResets: 'resets in {{time}}',
    usageReached: 'limit reached',
    hours: 'h',
    minutes: 'm',
    soon: 'now'
  },

  center: {
    noProjectsTitle: 'Start with a repository',
    noProjectsBody:
      'Add one from this machine, or clone it from GitHub. Workspaces are created inside it — each with its own branch, directory and agent session.',
    noSelectionTitle: 'Select a project',
    noSelectionBody: 'Pick one from the list on the left, or add another repository.',
    /* The workspace half of the same pane. A project is chosen and the centre
       still has nothing to show, which is two different situations: one where
       there is nothing to pick, and one where nothing has been picked. */
    firstWorkspaceTitle: 'Create the first workspace',
    firstWorkspaceBody:
      'A workspace is a copy of this project on a branch of its own, with its own folder and its own agent session. Nothing you do in one touches another.',
    noWorkspaceTitle: 'Select a workspace',
    noWorkspaceBody:
      'Every conversation belongs to one workspace. The agent works on that workspace’s own copy of the project, and what it changes lands on that workspace’s branch.',
    addFromDisk: 'Add from disk…',
    addFromGitHub: 'Add from GitHub…',
    checkingGitHub: 'Checking GitHub…'
  },

  settings: {
    title: 'Settings',
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

    effort: 'Default effort',
    effortHint:
      'How much thinking a new conversation asks for. Each one can then be changed on its own, from the composer.',

    permissionMode: 'What a new chat may do',
    permissionModeHint:
      'The starting point for every workspace, so the question is not asked again on each new branch. A chat can still be switched on its own.',
    permissionAsk: 'Ask first',
    permissionAskHint:
      'Reading is silent; writing a file or running a command waits for an answer.',
    permissionAcceptEdits: 'Accept edits',
    permissionAcceptEditsHint:
      'File changes go through without asking. Commands still wait — they leave the worktree.',

    alwaysAllowed: 'Answered "always"',
    alwaysAllowedHint:
      'Tools you have waved through. They are never asked about again, in any workspace, until removed here.',
    alwaysAllowedEmpty: 'Nothing yet.',
    alwaysAllowedRemove: 'Ask again',

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
    branchUnmerged:
      '{{branch}} has commits that are not in the base branch. Remove it with the branch checkbox cleared, or merge it first.',
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
