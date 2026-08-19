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
    statusRunning: 'The agent is working here',
    statusWaiting: 'Waiting for your answer',
    statusError: 'The last turn ended in an error',
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
    sectionFiles: 'Files',
    sectionEnv: 'Env',
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
      'Runs in a new workspace: install dependencies, build what has to be built, anything a fresh checkout needs. Saved as setup.sh.',
    files: 'Files carried into a workspace',
    filesHint:
      'One path per line, relative to the repository. A worktree holds what git tracks and nothing else, so gitignored files — an .env, a config/master.key — have to be brought. Copied at creation and again before a run; a file already there is never overwritten.',
    archiveScript: 'Cleanup script',
    archiveScriptHint:
      'Runs when a workspace is removed, in its directory, while it still exists. Use it to take back what the build script gave out — a database or a container named after the workspace. Nothing it does can stop the removal. Saved as archive.sh.',
    envFile: 'Env file',
    envFileHint:
      'Which file in the workspace the variables are written into, relative to its root. .env suits most stacks; Vite reads .env.local and would ignore anything written beside it.',
    env: 'Variables added to every workspace',
    envHint:
      'One KEY=value per line. Written at the end of the workspace\u2019s .env, so they win over whatever was copied — and they are the whole file where a clone had none to copy. $OCTOPUS_PORT becomes the workspace\u2019s own port, so a value naming one differs per workspace. Kept on this machine, never in the repository.',
    envNotIgnored:
      'git does not ignore {{file}} in this repository, so what you type here will show up in the workspace as a change — and can be committed. Add it to .gitignore.',
    envNoAssignment: 'Line {{line}}: “{{subject}}” is not KEY=value, so nothing will read it.',
    envBadName: 'Line {{line}}: “{{subject}}” is not a name an env file can hold.',
    envDuplicate: 'Line {{line}}: {{subject}} is set again — only the last one counts.',
    envUnknownVariable:
      'Line {{line}}: ${{subject}} is not one of ours, so it stays in the file as text.',
    runScript: 'Server script',
    runScriptHint:
      'Starts the dev server. $OCTOPUS_PORT is set to the workspace\u2019s own port, so several can serve at once. Saved as run.sh.',
    sources: 'What the agent picks up on its own',
    sourcesHint:
      'octopus loads the same settings as Claude Code in a terminal, so the agent arrives knowing what this repository and this machine have written for it. None of it is sent by octopus.',
    sourceProjectMemory: 'CLAUDE.md in this repository',
    sourceProjectSettings: '.claude/settings.json',
    sourceLocalSettings: '.claude/settings.local.json',
    sourceUserSettings: 'Your settings.json',
    sourceUserMemory: 'Your CLAUDE.md',
    sourceCommands: 'Slash commands',
    sourceAgents: 'Subagents',
    sourcePresent: 'loaded',
    sourceAbsent: 'none',
    sourceCount: '{{count}} loaded',
    pullRequestInstruction: 'Pull request descriptions',
    pullRequestInstructionHint:
      'Sent to the agent when you ask it to describe a change for a pull request in this project. Used instead of the one in Settings; empty means this project adds nothing.',
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
    /* Three controls for the whole tab, on its own header. There used to be
       four across the two halves, two of which were called the same thing —
       and `Run` and `Start` beside each other say nothing about which one a
       reader wants. */
    serverRestart: 'Restart',
    stop: 'Stop',
    /* Names the port rather than saying "open the app": every workspace serves
       on one of its own, and which one is the fact worth carrying. */
    openInBrowser: 'Open localhost:{{port}}',
    /* Beside a half that is going, so the header's own words are free to say
       what pressing something would do rather than what is already happening. */
    busy: 'running…',
    foldBuild: 'Fold the build away',
    unfoldBuild: 'Show the build',
    edit: 'Write the script',
    /* Beside the build rather than in the project dialog alone: these are what
       a build reads, and the moment you notice one is missing is the moment the
       build in front of you did not find it. */
    env: 'Env',
    editEnv: 'Variables…',
    showEnv: "This workspace's env",
    noEnv:
      'This workspace has no env file yet. One appears when the project carries a file in or adds variables of its own.',
    editFiles: 'Files carried in…',
    /* The whole tab in one control: build, then serve. `Run` rather than
       `Build and start`, because the two steps are one intention — the second
       is only ever wanted after the first. */
    runAll: 'Run',
    running: 'Building\u2026',
    runHint: 'Builds this workspace, then starts its server.',
    runBuilding: 'Building. The server starts when this finishes.',
    runServing: 'Serving.',
    buildFailed: 'The build failed, so the server was not started.',
    /* Said rather than enforced: the script belongs to whoever wrote it, and
       being wrong about it must not take the link or the controls away. */
    portSilent: 'Running, but nothing is listening on {{port}}. Does the script use $OCTOPUS_PORT?',
    noWorkspace: 'Select a workspace to run this in.',
    noSetup:
      'No build script yet. It runs in a fresh workspace — installing dependencies, whatever a checkout needs before work can start.',
    noRun:
      'No server script yet. It starts the dev server, and receives a port of its own so several workspaces can serve at once.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Runs setup.sh in this workspace.',
    runIdle: 'Starts the dev server for this workspace.'
  },

  panel: {
    changes: 'Changes',
    terminal: 'Terminal',
    /* Named on the tab rather than in `scripts.*` with the two headings inside
       it: the tab is one place, and what it holds is two. */
    scripts: 'Scripts',
    pullRequest: 'Pull request',
    collapse: 'Collapse panel',
    expand: 'Show panel',
    terminalPlaceholder: 'Select a workspace to open a terminal in its directory.',
    resize: 'Resize panel'
  },

  pullRequest: {
    noWorkspace: 'Select a workspace to open a pull request for it.',
    loading: 'Asking GitHub about this branch…',
    /* The branch is the whole subject: it is what a pull request is made of,
       and what its name will be on GitHub. */
    editInstructions: 'Instructions for a new PR',
    ask: 'Ask the agent to describe it',
    noConversation: 'Open a conversation in this workspace first.',
    /* Emptying the instruction is how a project says it adds nothing, so this
       is a state somebody chose rather than one that went wrong. */
    noInstruction: 'This project adds nothing to a description. Write an instruction first.',
    branch: 'Branch',
    nothingToOpen:
      'Nothing to open yet. This branch has no commits that {{base}} does not — make one first.',
    /* Said before the button rather than after it fails. Pushing is a thing
       that happens to somebody else's machine, and it should not be a surprise. */
    willPush: 'This branch is not on GitHub yet. Opening will push it.',
    dirty:
      'There are uncommitted changes here. A pull request carries commits, so they stay behind.',
    title: 'Title',
    titlePlaceholder: 'What this change does',
    body: 'Description',
    bodyPlaceholder: 'Anything a reviewer needs to know',
    draft: 'Open as a draft',
    create: 'Open pull request',
    creating: 'Opening…',
    open: 'Open on GitHub',
    /* The state the branch is in, each said as a fact rather than as a status
       word — the number is what identifies it to anyone who goes looking. */
    stateOpen: 'Pull request #{{number}} is open.',
    stateMerged: 'Pull request #{{number}} was merged.',
    stateClosed: 'Pull request #{{number}} was closed without merging.'
  },

  diff: {
    noWorkspace: 'Select a workspace to see what it changed.',
    clean: 'Nothing has changed in this workspace yet.',
    loading: 'Reading the changes…',
    against: 'against {{branch}}',
    fileCount_one: '{{count}} file',
    fileCount_few: '{{count}} files',
    fileCount_many: '{{count}} files',
    fileCount_other: '{{count}} files',
    refresh: 'Re-read the changes',
    expandAll: 'Expand every file',
    collapseAll: 'Collapse every file',
    unified: 'One column',
    split: 'Side by side',
    splitTooNarrow: 'The panel is too narrow to show two columns — drag it wider.',
    renamedFrom: 'moved from {{path}}',
    binary: 'Binary file — nothing to show.',
    tooLarge: 'Too large to draw here. Open the file to read it.',
    invisibleCharacters:
      'This file contains characters that do not draw as themselves — a line may read differently from how it runs.',
    omittedFiles_one: '{{count}} file is too large to draw',
    omittedFiles_few: '{{count}} files are too large to draw',
    omittedFiles_many: '{{count}} files are too large to draw',
    omittedFiles_other: '{{count}} files are too large to draw',
    copyPath: 'Copy path',
    copied: 'Path copied',
    copyFailed: 'Could not copy',
    openFile: 'Open file',
    fileActions: 'Actions for {{path}}',
    // The one-letter marks in a file's header. Each is the initial of the word
    // beside it, so a translation changes both together or neither.
    statusAdded: 'A',
    statusModified: 'M',
    statusDeleted: 'D',
    statusRenamed: 'R',
    statusCopied: 'C',
    statusTypeChanged: 'T',
    statusUntracked: 'U',
    statusAddedLabel: 'Added',
    statusModifiedLabel: 'Modified',
    statusDeletedLabel: 'Deleted',
    statusRenamedLabel: 'Renamed',
    statusCopiedLabel: 'Copied',
    statusTypeChangedLabel: 'Type changed',
    statusUntrackedLabel: 'Untracked',
    comment: 'Comment on line {{line}}',
    commentOld: 'Comment on line {{line}} of the file as it was',
    /* What the button floating at a selection says. "Ask" rather than
       "comment": the passage was chosen to be asked about, and the field it
       opens is the same one the gutter's trigger opens. */
    askSelection: 'Ask about the selected code',
    commentPlaceholder: 'What should the agent change here?',
    commentSave: 'Add',
    commentCancel: 'Cancel',
    commentRemove: 'Remove this note',
    commentIntro: 'Review notes on the changes:'
  },

  chat: {
    /* The strip above the conversation. A workspace holds up to three, running
       at once in the same worktree; a tab is named after the agent that runs it
       and numbered by its place, because a title would have to be invented
       before there was anything to title. The name is interpolated rather than
       written in: it comes from the chat's `agent`, so a second kind of agent
       does not need these lines rewritten. */
    tabs: 'Conversations',
    tab: '{{agent}} {{number}}',
    /* What a tab says aloud, and what its tooltip shows. Takes the resolved
       name — the one the user gave it, or the automatic one above — because a
       renamed conversation should read as itself here too. */
    tabStatus: '{{name}}: {{state}}',
    /* Two quiet states, and the difference is what a glance down the list is
       usually after: a turn that ended cleanly, against a conversation nobody
       has written in. Neither says "idle", which describes both. */
    tabStatusIdle: 'nothing written yet',
    tabStatusDone: 'finished',
    newTab: 'New conversation',
    renameTab: 'Rename…',
    forkTab: 'Continue in a new conversation',
    forkTabHint: 'The agent keeps what it remembers of this one.',
    closeTab: 'Close conversation',
    closeTabTitle: 'Close this conversation?',
    closeTabMessage: '{{name}} and everything said in it.',
    closeTabDetail: 'The agent’s memory of it goes too, and cannot be brought back.',
    closeTabConfirm: 'Close',
    closeTabCancel: 'Cancel',

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
    /* The panel the model chip opens, and its two columns. Titled by what it
       holds rather than by which of the two matters more: the coding model is
       in force most of the time, but the reason to open this at all is that
       planning can have its own. */
    modelsTitle: 'Models for this conversation',
    modelsPlan: 'Plan and research',
    modelsCode: 'Writing code',
    /* The plan column's first row: no split, so whatever writes the code plans
       as well. The model that resolves to is named underneath, because that is
       the fact the reader came for. */
    modelsSame: 'Same as writing code',

    effort: 'Effort',
    effortLow: 'Low',
    effortMedium: 'Medium',
    effortHigh: 'High',
    effortXhigh: 'Very high',
    effortMax: 'Maximum',
    /* Left in the SDK's own spelling. It is a name rather than a description —
       the caption underneath is where the description goes — and translating it
       would break the one word someone searching for the feature would type. */
    effortUltracode: 'Ultracode',
    effortUltracodeNote: 'xhigh + workflows',
    effortUnsupported: 'This model does not take an effort setting.',
    effortScale: 'Thinking effort',
    /* The ends of the scale rather than labels for its halves: what is being
       traded is the interesting part, and neither end is the good one. */
    effortFaster: 'Faster',
    effortSmarter: 'Smarter',

    // Ukrainian needs `few` and `many` as well; i18next picks the form that
    // applies to the active language and ignores the rest.
    toolSteps_one: '{{count}} step',
    toolSteps_few: '{{count}} steps',
    toolSteps_many: '{{count}} steps',
    toolSteps_other: '{{count}} steps',

    /* Where the `+1 −1` normally sits, for an edit that replaced its text
       everywhere it appeared. No number, because the call carries none: it is
       handed one pair of fragments however many places it applies them to, and
       a rename through twelve of them used to read `+1 −1`. */
    changeEverywhere: 'replaced everywhere',

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
    sectionInstructions: 'Instructions',
    /* The global one. What a project's own instruction overrides, and what
       applies wherever a project has not written one. */
    pullRequestInstruction: 'Pull request descriptions',
    pullRequestInstructionHint:
      'Sent to the agent when you ask it to describe a change for a pull request. A project can write its own, which is used instead of this one.',
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
      'What the agent loads for itself. "Everything" is what Claude Code does in a terminal, and what octopus ships: the project\'s CLAUDE.md, its commands, skills and subagents. Narrow it only if you want an agent that knows less than your terminal does.',
    settingSourcesNone: 'Nothing',
    settingSourcesNoneHint:
      'The agent reads no CLAUDE.md, no commands and no skills. Isolation, at the cost of an agent that knows nothing about the project.',
    settingSourcesProject: 'Project only',
    settingSourcesProjectHint: "Loads the repository's own CLAUDE.md and settings.",
    settingSourcesAll: 'Everything',
    settingSourcesAllHint: 'User, project and local settings — what the plain CLI loads.',

    effort: 'Default effort',
    effortHint:
      'How much thinking a new conversation asks for. Each one can then be changed on its own, from the composer.',

    model: 'Model for writing code',
    modelHint:
      'What a new conversation runs on. The list is the agent’s own, so it is empty until a session has run once.',
    planModel: 'Model for planning and research',
    planModelHint:
      'Used while Plan is on, so a plan can be thought out by one model and carried out by another. Leave it the same to use one model for both.',

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
    baseUnknown:
      'Could not find where this workspace branched off {{branch}}. The branch may have been renamed or deleted — check the project settings.',
    duplicateProject: 'This repository is already added as project "{{name}}".',
    notConnected: 'Could not reach GitHub. Check the account in Settings.',
    listFailed: 'GitHub returned something unexpected.',
    cloneFailed: 'Could not clone {{repository}}.',
    noCommits: 'This branch has nothing that {{base}} does not.',
    pushFailed: 'Could not push {{branch}} to GitHub.',
    createFailed: 'Could not open the pull request. GitHub refused it.',
    alreadyExists: '{{path}} already exists. Add it from disk instead.',
    branchUnmerged:
      '{{branch}} has commits that are not in the base branch. Remove it with the branch checkbox cleared, or merge it first.',
    branchExists: 'A branch named {{branch}} already exists.',
    pathExists: '{{path}} already exists.',
    uncommittedChanges: '{{name}} has uncommitted changes.',
    nameEmpty: 'The name cannot be empty.',
    worktreeMissing: 'That workspace is no longer there.',
    // Ukrainian needs `few` and `many` as well; i18next picks the form that
    // applies to the active language and ignores the rest.
    tooManyChats_one: 'A workspace holds at most {{count}} conversation.',
    tooManyChats_few: 'A workspace holds at most {{count}} conversations.',
    tooManyChats_many: 'A workspace holds at most {{count}} conversations.',
    tooManyChats_other: 'A workspace holds at most {{count}} conversations.',
    lastChat: 'The last conversation cannot be closed. Use /clear to start it again.',
    nothingToFork: 'This conversation has not started yet, so there is nothing to continue.',
    forkFailed: 'The agent could not copy this conversation.',
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
