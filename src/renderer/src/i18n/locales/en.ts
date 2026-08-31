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
    removeDetail:
      'Its scripts, carried-file list and variables are deleted from ~/.octopus, credentials included. The repository stays on disk exactly where it is.',
    removeDetailWorkspaces_one:
      'Its workspace is deleted along with its branch, and the cleanup script runs for it first. Its scripts, carried-file list and variables are deleted from ~/.octopus, credentials included. The repository itself stays on disk.',
    removeDetailWorkspaces_few:
      'Its {{count}} workspaces are deleted along with their branches, and the cleanup script runs for each first. Its scripts, carried-file list and variables are deleted from ~/.octopus, credentials included. The repository itself stays on disk.',
    removeDetailWorkspaces_many:
      'Its {{count}} workspaces are deleted along with their branches, and the cleanup script runs for each first. Its scripts, carried-file list and variables are deleted from ~/.octopus, credentials included. The repository itself stays on disk.',
    removeDetailWorkspaces_other:
      'Its {{count}} workspaces are deleted along with their branches, and the cleanup script runs for each first. Its scripts, carried-file list and variables are deleted from ~/.octopus, credentials included. The repository itself stays on disk.',
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
    /* Where a branch has got to, said in words as well as in the colour of the
       mark beside its name — a colour reaches nobody using a screen reader. */
    requestRunning: 'Pull request #{{number}} — checks running',
    requestPassed: 'Pull request #{{number}} — checks passed',
    requestFailed: 'Pull request #{{number}} — a check failed',
    requestWaiting: 'Pull request #{{number}} — no checks',
    requestMerged: 'Pull request #{{number}} — merged',
    requestClosed: 'Pull request #{{number}} — closed without merging',
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

  limits: {
    /* The account whose windows these are, not the app drawing them. */
    title: 'Claude',
    empty: 'Not read yet — press to ask the account.',
    refresh: 'Read the limits now',
    unavailable: 'Nothing to ask through yet. Open a workspace first.',
    fiveHour: '5h',
    week: '1w',
    reading: '{{name}} window, {{percentage}}% used',
    /* The hover half of the pair: the row says when the window comes back, the
       tooltip says how long that is from now. */
    resets: 'resets in {{time}}',
    hours: 'h',
    minutes: 'm',
    soon: 'now',
    stale: 'Read before this window reset, so the share is out of date. The next turn refreshes it.'
  },

  project: {
    title: 'Project settings',
    sectionGeneral: 'General',
    sectionGit: 'Git',
    sectionScripts: 'Scripts',
    sectionFiles: 'Files',
    sectionEnv: 'Env',
    sectionInstructions: 'Instructions',
    sectionRepository: 'Repository',
    sectionDanger: 'Danger zone',
    repoLoading: 'Reading the repository…',
    repoHint:
      'A project keeps its settings in ~/.octopus, which lives on this machine and goes with it. Its repository can carry a copy in .octopus/, so a fresh installation is rebuilt from the repository rather than from memory. Nothing here is read while the app works, and nothing in it runs on its own.',
    repoIgnored:
      'git ignores .octopus/, so anything written there stays on this machine. Take it out of .gitignore for the copy to reach anybody else.',
    repoIn: 'From the repository',
    repoOut: 'Into the repository',
    repoImport: 'Import',
    repoExport: 'Export',
    repoNothingOffered: 'This repository carries nothing yet.',
    repoShow: 'Show what {{path}} contains',
    repoStateOnlyInRepository: 'not here yet',
    repoStateOnlyInApp: 'not in the repository',
    repoStateSame: 'the same',
    repoStateDiffers: 'differs',
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
    envProfile: 'Set of variables',
    envProfileHint:
      'A project may keep several \u2014 a dev set and a production one, say \u2014 and each workspace uses one. Which is a choice made here rather than by commenting a block in and out of a file, where the last edit wins silently. They never travel to the repository: the repository decides what runs, this machine decides what it runs against.',
    envProfileName: 'Name for the new set (lowercase letters, digits and dashes)',
    envProfileNew: 'New',
    envProfileDuplicate: 'Duplicate',
    envProfileRemove: 'Delete',
    envProfileMakeDefault: 'Use by default',
    envOf: 'Variables in \u201c{{name}}\u201d',
    env: 'Variables added to every workspace',
    envHint:
      'One KEY=value per line. Written at the end of {{file}} in the workspace, so they win over whatever was copied — and they are the whole file where a clone had none to copy. $OCTOPUS_PORT becomes the workspace\u2019s own port, and $OCTOPUS_WORKSPACE_SLUG its name in a form an identifier can hold \u2014 lowercased, everything else an underscore \u2014 which is what a database named after the workspace needs. Kept on this machine, never in the repository.',
    envNotIgnored:
      'git does not ignore {{file}} in this repository, so what you type here will show up in the workspace as a change — and can be committed. Add it to .gitignore, or if the repository tracks it, stop tracking it first.',
    envMarker:
      'Line {{line}}: this is one of octopus\u2019s own markers — it is removed before the block is written.',
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
    sourceMcp: 'MCP servers (.mcp.json)',
    sourceSkills: 'Skills',
    sourceUserCommands: 'Your slash commands',
    sourceUserAgents: 'Your subagents',
    sourceNotLoaded: 'on disk, not read',
    sourcePresent: 'loaded',
    sourceAbsent: 'none',
    sourceCount: '{{count}} loaded',
    repository: 'Repository',
    dangerZone: 'Danger zone',
    removeHint:
      'Removes the project from octopus. Every workspace goes, its cleanup script running first, and the scripts, files and variables kept for this project are deleted from ~/.octopus \u2014 credentials included. The repository stays on disk.'
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
    /* The controls for the whole tab, on its own header. There used to be four
       across the two halves, two of which were called the same thing — and
       `Run` and `Start` beside each other say nothing about which one a reader
       wants. */
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
    /* The header's own way to the editors, and icon-only — so this string is
       the whole of what it says, and it names the act rather than the place.
       `Write` above is the offer made where a script is missing; this is the
       one that is there once it exists, which is when the other disappears. */
    editScripts: "Edit this project's scripts",
    /* Beside the build rather than in the project dialog alone: these are what
       a build reads, and the moment you notice one is missing is the moment the
       build in front of you did not find it. */
    env: 'Env',
    envFollow: 'Follow the project ({{name}})',
    editEnv: 'Variables…',
    repoNotice:
      'This repository supplies the scripts below. Read them before they run \u2014 they arrive with a git pull, so what runs here is whatever the branch says.',
    repoApprove: 'Allow these',
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

  /*
   * Every piece of prose the pull request tab can send.
   *
   * Named for what the button does rather than for the file, because the button
   * is where they are met. The scope sentence is appended to each hint by
   * `InstructionEditors`, so the difference between the two dialogs is said once.
   */
  instructions: {
    scopeGlobal: 'A project can write its own, which is used instead of this one.',
    scopeProject: 'Used instead of the one in Settings; empty means this project adds nothing.',

    pullRequest: 'Pull request descriptions',
    pullRequestHint: 'Sent when you ask the agent to describe a change for a pull request.',
    commitMessage: 'Commit messages',
    commitMessageHint:
      'Sent with the one above, when the pull request pane commits this workspace and nobody wrote a message for it.',
    fixChecks: 'Fixing a failing check',
    fixChecksHint:
      'Sent when a check on the pull request has failed and you ask the agent to put it right.',
    addressReview: 'Answering a review',
    addressReviewHint: 'Sent when you hand the review on a pull request to the agent to deal with.',
    review: 'Reviewing a change',
    reviewHint: 'Sent when you ask the agent to review the pull request itself.',
    multiAgentReview: 'A review from several angles',
    multiAgentReviewHint:
      'Sent when you ask for a review run by several subagents at once, each reading for one thing.',
    resolveConflicts: 'Resolving conflicts',
    resolveConflictsHint:
      'Sent when the pull request conflicts with its base branch and you ask the agent to settle it.'
  },

  pullRequest: {
    noWorkspace: 'Select a workspace to open a pull request for it.',
    loading: 'Asking GitHub about this branch…',
    /* The branch is the whole subject: it is what a pull request is made of,
       and what its name will be on GitHub. */
    editInstructions: 'Instructions for a new PR',
    /* The label of the open button while the title is empty: pressing it asks
       rather than opens, and the button has to say which of the two it is. */
    ask: 'Ask the agent to describe it',
    drafting: 'Writing…',
    /* Said where the empty fields are. The behaviour is the one thing about
       this form that cannot be guessed from looking at it. */
    emptyHint:
      'Leave these empty and the agent writes them: the title from what the task did, the description the way this project asks for one.',
    emptyHintSettings: 'Change how it writes them',
    /* After it has written: the fields are editable like any others, and this
       says so rather than leaving the reader wondering whether they may. */
    written: 'Written by the agent. Edit it, then open the request.',
    noConversation: 'Open a conversation in this workspace first.',
    nothingToOpen:
      'Nothing to open yet. This branch has no commits that {{base}} does not — make one first.',
    /* Said before the button rather than after it fails. Pushing is a thing
       that happens to somebody else's machine, and it should not be a surprise. */
    willPush: 'This branch is not on GitHub yet. Opening will push it.',
    dirty:
      'There are uncommitted changes here. They are committed with the request, under the message above or one the agent writes.',
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
    stateClosed: 'Pull request #{{number}} was closed without merging.',

    /* Committing from here, which is what lets a workspace go from finished
       work to an open request without a detour through the terminal. */
    /* On the window header, beside the branch. Short because it sits in a row
       already carrying a project, a path and a branch name. */
    createShortcut: 'Create PR',
    commitMessage: 'Commit message',
    commitMessagePlaceholder: 'Rename the thing',
    commitHint:
      'Commits every change in this workspace under this message, then opens the request.',
    /* Said beside the field rather than found out afterwards: octopus writes
       this file into every worktree, and committing everything would send it. */
    envNotIgnored:
      'git does not ignore {{file}}, and octopus writes this workspace’s variables into it. Committing everything would put them in the pull request.',

    refresh: 'Read GitHub again',
    isDraft: 'Draft',

    checks: 'Checks',
    checksNone: 'This repository runs nothing on a pull request.',
    /* The state as a word beside the mark, because a colour reaches nobody
       using a screen reader and no test can hold one. */
    checkPending: 'running',
    checkPassed: 'passed',
    checkFailed: 'failed',
    checkSkipped: 'skipped',

    review: 'Review',
    /* GitHub models a deleted account as no author at all. */
    unknownAuthor: 'a deleted account',
    reviewNone: 'Nobody has said anything yet.',
    /* Attaches the remark to the composer rather than sending it: the reader
       has a question about it, and the question is the point. */
    addToChat: 'Add to chat',
    resolved: 'resolved',
    verdictApproved: 'approved',
    verdictChangesRequested: 'requested changes',
    verdictCommented: 'commented',
    verdictDismissed: 'dismissed',
    decisionApproved: 'Approved',
    decisionChangesRequested: 'Changes requested',
    decisionReviewRequired: 'Review required',

    merge: 'Merge',
    close: 'Close',
    closing: 'Closing…',
    merging: 'Merging…',
    methodMerge: 'Merge commit',
    methodSquash: 'Squash and merge',
    methodRebase: 'Rebase and merge',
    /* Why merging is not offered, each naming the thing to do about it. */
    conflicting: 'This branch conflicts with {{base}}.',
    mergeBlocked: 'GitHub will not merge this yet — a required review or check is missing.',
    mergeBehind: '{{base}} has moved on since this branch left it.',
    mergeUnstable: 'A check has not passed, but merging is still allowed.',
    mergeDraft: 'A draft cannot be merged. Mark it ready on GitHub first.',

    /* The prepared messages, named for what pressing them does. Each sends the
       project's instruction as a visible message in the conversation. */
    fixChecks: 'Fix the checks',
    addressReview: 'Address the review',
    doReview: 'Review it',
    multiAgentReview: 'Multi-agent review',
    resolveConflicts: 'Resolve the conflicts',
    commitAndPush: 'Commit and push',
    /* The message the button commits under. Named for what the commit is
       rather than for what changed, which is the agent's to describe — and this
       button exists to get its answer onto the request, not to write history. */
    answerCommit: 'Answer the review',
    sending: 'Sending…',

    /* Appended to whichever instruction is sent, so the agent does not have to
       go looking for which request is meant. Visible in the log, like the
       instruction itself (§4). */
    context: 'Pull request #{{number}} — branch {{branch}} into {{base}}\n{{url}}',
    /* Sent with the instruction above when the checks are what is being fixed.
       The link is the whole point of the line: the job id at the end of it is
       what reads the log, and without it the agent is guessing at which run
       failed. A check reported through the older status API can arrive without
       one, so there is a spelling for that too. */
    failedChecks: 'Checks that failed:\n{{list}}',
    failedCheck: '- {{name}} — {{url}}',
    failedCheckNoLink: '- {{name}}',
    /* The line above a remark carried into the composer from the review. */
    quoteIntro: 'From the review on this pull request:'
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
    revert: 'Revert',
    revertFile: 'Revert {{path}}',
    revertTitle: 'Revert this file?',
    revertMessage: '{{path}} goes back to the state it had when this workspace branched.',
    revertDetail:
      'Unsaved changes in it are lost for good — git keeps no copy of those. Anything already committed stays in the branch, undone by a change in the working tree.',
    revertConfirm: 'Revert',
    revertCancel: 'Keep',
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

    usageReached: 'limit reached'
  },

  /* The card `/usage` draws. Its own section rather than more of `chat`,
     because it is the one surface with thirty strings about one subject. */
  usage: {
    title: 'Usage',
    unavailable: 'This session cannot say how much has been used.',

    session: 'Session',
    /* Shown here and nowhere else in the app. It is what the same tokens would
       have cost through the API, which a subscription never pays — a poor thing
       to put beside a workspace name, and the exact question `/usage` is. */
    cost: 'Total cost',
    costValue: '${{amount}}',
    tokens: 'Tokens',
    tokensValue: '{{input}} in · {{output}} out',
    cache: 'Cache',
    cacheValue: '{{read}} read · {{write}} written',
    apiTime: 'API time',
    wallTime: 'Wall time',
    changes: 'Code changes',
    changesValue: '+{{added}} / −{{removed}} lines',

    limits: 'Limits',
    /* An API-key, Bedrock or Vertex session. Not a failed reading — there is
       no plan for it to be near the end of. */
    noPlan: 'Plan limits do not apply to this session.',
    windowFiveHour: 'Current session',
    windowSevenDay: 'Current week (all models)',
    windowSevenDayOpus: 'Current week (Opus)',
    windowSevenDaySonnet: 'Current week (Sonnet)',
    windowSevenDayOauthApps: 'Current week (connected apps)',
    /* The server names these itself — `Fable`, and whatever follows it. */
    windowModel: 'Current week ({{name}})',
    windowModelScoped: 'Current week (per model)',
    reading: '{{name}} — {{percentage}}% used',
    resets: 'resets {{at}}',

    extra: 'Extra usage',
    extraSpent: '{{used}} of {{limit}}',

    contributing: 'What is contributing',
    day: 'Last 24h',
    week: 'Last 7d',
    requests_one: '{{count}} request',
    requests_few: '{{count}} requests',
    requests_many: '{{count}} requests',
    requests_other: '{{count}} requests',
    sessions_one: '{{count}} session',
    sessions_few: '{{count}} sessions',
    sessions_many: '{{count}} sessions',
    sessions_other: '{{count}} sessions',

    behaviourCacheMiss: 'Cache misses',
    behaviourLongContext: 'Long context',
    behaviourSubagentHeavy: 'Subagents',
    behaviourHighParallel: 'Work in parallel',
    behaviourCron: 'Scheduled runs',

    skills: 'Skills',
    agents: 'Agents',
    plugins: 'Plugins',
    mcpServers: 'MCP servers',
    share: '{{name}} — {{percentage}}%',
    /* The SDK's own caveat, kept rather than dropped: the figures come from
       reading this machine's transcripts, and the characteristics are counted
       separately from one another, so they do not add up to a hundred. */
    approximate:
      'Approximate, from sessions on this machine — other devices and claude.ai are not counted. The characteristics overlap rather than divide the total.',

    minutes: 'm',
    seconds: 's'
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

  trust: {
    title: 'What this repository can do',
    explain:
      'octopus loads the same settings as Claude Code in a terminal, so this repository can pre-approve tools without asking, run its own commands around every tool call, and start MCP servers. Read what it ships before allowing it. Only these files need approving — instructions like CLAUDE.md do not, and are read either way once you approve.',
    approve: 'Allow these',
    notice:
      'This project ships settings that would pre-approve tools and run its own commands. Until you have read them, the agent works without anything from this repository — including its CLAUDE.md.',
    review: 'Review'
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
    pushFailed: 'Could not push {{branch}}. Git said: {{reason}}',
    fetchFailed:
      'Could not fetch {{remote}}, so this workspace would start from a base branch that is behind. Git said: {{reason}}',
    createFailed: 'Could not open the pull request. GitHub said: {{reason}}',
    nothingToCommit: 'There is nothing here to commit.',
    commitFailed: 'Could not commit the changes. Git said: {{reason}}',
    mergeFailed: 'GitHub would not merge #{{number}}. It said: {{reason}}',
    closeFailed: 'GitHub would not close #{{number}}. It said: {{reason}}',
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
    repoConfigSymlink:
      '{{path}} is a symbolic link. octopus will not read or write through one, because it can point anywhere outside the repository.',
    repoConfigTooLarge: '{{path}} is larger than this kind of file is allowed to be.',
    repoConfigMalformed: '{{path}} does not describe a project.',
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
