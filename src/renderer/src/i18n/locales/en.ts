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
    empty: 'Nothing here yet. Add a repository with the "+" button.',
    pick: 'Pick a project on the far left.',
    addProject: 'Add repository',
    // The dot on a project's tab when one of its agents finished out of sight.
    projectDone: 'An agent finished here while you were away',
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
    settings: 'Settings',
    plugins: 'Plugins',
    help: 'Help'
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
    connect: 'Connect GitHub…',
    /* No number in either: the limit and the scope name both live in the code,
       and a figure repeated in prose is one that goes stale without anything
       failing. */
    capped:
      'GitHub answered with as many repositories as it was asked for, so there may be more it is not showing.',
    noOrganisations:
      'An organisation missing from this list is missing because the signed-in token cannot see organisations. To grant it:',
    /* Names the organisation rather than guessing why it is quiet. SAML
       withholding one from a token that holds `read:org` looks exactly like an
       organisation with nothing to push to, and no local read tells them
       apart — but the reader knows which of the two theirs is, and could not
       act on either while the list simply looked complete. */
    silentOrganisations:
      'You belong to {{names}}, and none of its repositories are listed. Either there is nothing there you can push to, or the token needs SSO authorising for it on GitHub.',
    grantOrgScope: 'gh auth refresh -s read:org'
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
    createFirst: 'Create the first workspace',
    createFirstHint: 'Its own branch from {{branch}}',
    rename: 'Rename',
    remove: 'Remove workspace',
    missing: 'Directory is gone',
    statusRunning: 'The agent is working here',
    statusWaiting: 'Waiting for your answer',
    statusError: 'The last turn ended in an error',
    // The same states in a word, for the second line of a row, where the
    // sentences above would not fit beside the file count.
    lineRunning: 'Working',
    // The same word with the agents still at it, for a turn that has ended
    // while what it sent off has not.
    lineRunningAgents_one: 'Working · {{count}} agent',
    lineRunningAgents_few: 'Working · {{count}} agents',
    lineRunningAgents_many: 'Working · {{count}} agents',
    lineRunningAgents_other: 'Working · {{count}} agents',
    lineWaiting: 'Needs your answer',
    lineError: 'Error',
    lineDone: 'Finished',
    // The app quit or restarted mid-turn: the work stopped rather than finished.
    lineInterrupted: 'Interrupted',
    lineIdle: 'Not started',
    missingHint: 'Removed outside the app. Removing the entry is safe.',
    /* The Changes tab and the pull request pane both say this at length; here
       there is room for a tooltip, and it must not contradict them. Names the
       branch, because the row's own label is the workspace name and the branch
       is the thing that has been left behind. */
    headElsewhere:
      'The worktree is not on {{branch}}. Work done here will not go onto this workspace\u2019s branch.',
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
    /* An API-key, Bedrock or Vertex session. A different sentence from the one
       above because no amount of pressing changes it. */
    noPlan: 'This account has no plan windows.',
    failed: 'The account did not answer. Press to try again.',
    /* A plan that reported no windows at all — read, and empty, which is not
       the same as never read. */
    none: 'The account reported no windows.',
    /* The same windows the `/usage` card names, at the width a rail has for
       them. `usage.window*` is the long form; a window added to the allowlist
       in `core/usage.ts` has to be named in both, which `usageWindows.ts`
       enforces by type. */
    windowFiveHour: '5h',
    windowSevenDay: '1w',
    windowSevenDayOpus: '1w Opus',
    windowSevenDaySonnet: '1w Sonnet',
    windowSevenDayOauthApps: '1w apps',
    windowModelScoped: '1w per model',
    /* The server names this one itself — `Fable`, and whatever follows it. */
    windowModel: '1w {{name}}',
    reading: '{{name}} window, {{percentage}}% used',
    /* The window the account says is actually binding. On the name here, since
       the row has two hundred pixels for the whole of it. */
    binding: '{{name}} · now',
    /* The hover half of the pair: the row says when the window comes back, the
       tooltip says how long that is from now. */
    resets: 'resets in {{time}}',
    hours: 'h',
    minutes: 'm',
    soon: 'now',
    stale:
      'Read before this window reset, so the share is out of date. The next turn refreshes it.',
    /* The account's endpoint refuses most requests and the CLI then answers from
       the last figures it had, without saying so. Said here, because a number
       drawn as current that is an hour old is the worse of the two. */
    asOf: 'As of {{age}} ago',
    asOfHint:
      'The account did not answer a fresh read, so these are the last figures known. Press to try again.'
  },

  project: {
    title: 'Project settings',
    sectionGeneral: 'General',
    sectionGit: 'Git',
    sectionScripts: 'Scripts',
    sectionFiles: 'Files',
    sectionEnv: 'Env',
    sectionSkills: 'Skills',
    /* Commands and subagents together. Named for the half the reader types,
       because that is the one they go looking for. */
    sectionLibrary: 'Commands',
    sectionInstructions: 'Instructions',
    sectionRepository: 'Repository',
    sectionDanger: 'Danger zone',
    repoLoading: 'Reading the repository…',
    repoHint:
      'A project keeps its settings in ~/.octopus, on this machine. Its repository can carry them in .octopus/, where the app reads them while it works: scripts, instructions, and for a trusted repository the base branch and env file \u2014 each unless you chose your own \u2014 and its carry list adds to this project\u2019s. Name, icon and colour are taken once, when the project is added. Export writes what this installation holds into the checkout, as an ordinary uncommitted change.',
    repoIgnored:
      'git ignores .octopus/, so anything written there stays on this machine. Take it out of .gitignore for the copy to reach anybody else.',
    trustTitle: 'Trust',
    trustSwitch: 'Trust this repository',
    trustHint:
      'On, and its scripts run and its Claude settings, hooks and MCP servers load without being shown first \u2014 reasonable for a repository you write, not for a clone. Off, and each version is shown once before it is used, so a git pull that changes one asks again.',
    trustLegacy:
      'Its scripts are trusted from before there was one switch; its Claude settings, hooks and MCP servers are not. Turn this on to trust all of it.',
    trustScripts: 'Scripts it supplies',
    repoRunsNone:
      'This repository supplies no scripts, so the ones in this project\u2019s settings are what run.',
    repoRunsAllowed: 'These have been read and are allowed to run.',
    repoRunsWaiting: 'These have not been read yet, so Run is disabled until they are allowed.',
    trustSettings: 'Claude settings, hooks and MCP servers',
    trustSettingsNone: 'This repository ships none, so there is nothing to allow.',
    trustSettingsAllowed: 'These have been read, and every session loads them.',
    trustSettingsWaiting:
      'These have not been read yet, so sessions load none of the repository\u2019s own settings \u2014 its CLAUDE.md included \u2014 until they are allowed.',
    trustReview: 'Review and allow',
    repoOut: 'Into the repository',
    repoExport: 'Export',
    repoOverwrite_one:
      'The repository already has this file with other contents, and the whole team works from it. Write over it?',
    repoOverwrite_few:
      'The repository already has these {{count}} files with other contents, and the whole team works from them. Write over them?',
    repoOverwrite_many:
      'The repository already has these {{count}} files with other contents, and the whole team works from them. Write over them?',
    repoOverwrite_other:
      'The repository already has these {{count}} files with other contents, and the whole team works from them. Write over them?',
    repoOverwriteConfirm: 'Write over',
    repoOverwriteCancel: 'Keep the repository\u2019s',
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
      'One path per line, relative to the repository. A worktree holds what git tracks and nothing else, so gitignored files — an .env, a config/master.key — have to be brought. Copied at creation and again before a run; a file already there is never overwritten. Add “= /somewhere/else/.env” to take one from another checkout instead — which is the answer for a project cloned from GitHub, where the checkout has no gitignored file to give. Those sources stay on this machine and are left out of the copy in the repository. A trusted repository\u2019s .octopus/carry adds its own lines: only the path is used, only when git ignores that file in the workspace, and a line here wins over one there.',
    archiveScript: 'Cleanup script',
    archiveScriptHint:
      'Runs when a workspace is removed, in its directory, while it still exists. Use it to take back what the build script gave out — a database or a container named after the workspace. Nothing it does can stop the removal. Saved as archive.sh.',
    envFile: 'Env file',
    envFileHint:
      'Which file in the workspace the variables are written into, relative to its root. .env suits most stacks; Vite reads .env.local and would ignore anything written beside it.',
    envProfile: 'Set of variables',
    envProfileHint:
      'A project may keep several \u2014 a dev set and a production one, say \u2014 and each workspace uses one. Which is a choice made here rather than by commenting a block in and out of a file, where the last edit wins silently. They never travel to the repository: the repository decides what runs, this machine decides what it runs against. Which set a workspace uses is chosen in the Run row on the right.',
    /* The label on the field, which is the whole of the question. It used to be
       the argument to `window.prompt` — a dialog Electron replaces with a
       function that throws, so it was never seen. */
    envProfileName: 'Name for the set (lowercase letters, digits and dashes)',
    envProfileNewTitle: 'A new set of variables',
    envProfileDuplicateTitle: 'A copy of \u201c{{name}}\u201d',
    envProfileRenameTitle: 'Rename \u201c{{name}}\u201d',
    envProfileNameConfirm: 'Create',
    envProfileRenameConfirm: 'Rename',
    envProfileNameCancel: 'Cancel',
    /* Said as the name is typed rather than after the round trip, because the
       rule is knowable here: the name becomes a filename. */
    envProfileNameInvalid:
      'Lowercase letters, digits and dashes only, starting with a letter or a digit.',
    envProfileNew: 'New',
    envProfileDuplicate: 'Duplicate',
    envProfileRename: 'Rename',
    envProfileRemove: 'Delete',
    envProfileRemoveTitle: 'Delete \u201c{{name}}\u201d?',
    envProfileRemoveMessage:
      'This is the only copy. A set of variables is never written to the repository, so there is nothing to restore it from.',
    envProfileRemoveDetail:
      'Workspaces using it fall back to the project\u2019s default set, and are told nothing.',
    envProfileRemoveConfirm: 'Delete the set',
    envProfileRemoveCancel: 'Keep it',
    envProfileMakeDefault: 'Use by default',
    envOf: 'Variables in \u201c{{name}}\u201d',
    envPlaceholder: 'MYSQL_HOST=dev.example\nAPP_URL=http://localhost:$OCTOPUS_PORT',
    envHint:
      'One KEY=value per line. Written at the end of {{file}} in the workspace, so they win over whatever was copied — and they are the whole file where a clone had none to copy. $OCTOPUS_PORT becomes the workspace\u2019s own port, and $OCTOPUS_WORKSPACE_SLUG its name in a form an identifier can hold \u2014 lowercased, everything else an underscore \u2014 which is what a database named after the workspace needs. The build, server and cleanup scripts are given these variables in their own environment too, with $OCTOPUS_ENV_PROFILE naming the set \u2014 so one setup.sh can pull a different dump for each. Kept on this machine, never in the repository.',
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
      'octopus loads the same settings as Claude Code in a terminal, so the agent arrives knowing what this repository and this machine have written for it \u2014 the repository\u2019s own once it has been read and allowed. None of it is sent by octopus.',
    /* The permission rules inside those same files. A rule there is honoured
       before octopus is consulted at all, so a question that stopped being
       asked — or a command that stopped running — had no explanation anywhere
       in the interface until this. */
    permissions: 'What those settings allow and refuse',
    permissionsHint:
      'Rules Claude Code answers by itself, before octopus asks anything. Shown here, changed in the file that holds them — two of the three are inside the repository, and octopus editing one would put the project back to unapproved.',
    permissionAllow: 'allows',
    permissionDeny: 'refuses',
    permissionAsk: 'asks',
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
    repositoryHint:
      'Where the project lives. It can be pointed somewhere else while the project has no workspaces \u2014 the scripts, variables and instructions kept for it stay, because they are filed under the project rather than under the path.',
    repositoryLocked:
      'Each workspace is a git worktree registered in this repository, so the path cannot change while any exist. Remove them first.',
    repositoryChange: 'Change\u2026',
    repositoryPick: 'Choose the repository for this project',
    dangerZone: 'Danger zone',
    removeHint:
      'Removes the project from octopus. Every workspace goes, its cleanup script running first, and the scripts, files and variables kept for this project are deleted from ~/.octopus \u2014 credentials included. The repository stays on disk.'
  },

  combobox: {
    search: 'Search',
    empty: 'Nothing found'
  },

  modal: {
    close: 'Close',
    minimize: 'Minimise'
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
    envRestart:
      'The server is still running with the previous set of variables. Restart it to pick up the change.',
    /* Read aloud for the row of set names in the Run row, which is all a
       screen reader would otherwise have to go on. */
    envSwitch: 'Set of variables this workspace runs with',
    /* A restart starts the server again without building, so it cannot undo a
       build made with the other set — the dump it restored stays. */
    envRebuild:
      'Built with \u201c{{built}}\u201d. A restart keeps that build \u2014 stop, then run again to build with \u201c{{current}}\u201d.',
    envFollow: 'Follow the project ({{name}})',
    editEnv: 'Variables…',
    /* Asked on the way into a run when something octopus did not start is
       serving from the worktree — most often a server the agent started to
       look at a page and left behind. */
    strayTitle: 'A server is already running here',
    strayMessage:
      'Octopus did not start it \u2014 an agent or a terminal did. While it runs, this workspace\u2019s server may refuse to start.',
    strayLine: '{{command}} \u2014 process {{pid}}, port {{ports}}',
    strayConfirm: 'Stop it and run',
    strayCancel: 'Cancel',
    repoUnreadable:
      'This repository\u2019s settings could not be read, so nothing here can run: {{reason}}',
    repoNotice:
      'This repository supplies the scripts below. Read them before they run \u2014 they arrive with a git pull, so what runs here is whatever the branch says.',
    repoApprove: 'Allow these',
    showEnv: "This workspace's env",
    noEnv:
      'This workspace has no env file yet. One appears when the project carries a file in or adds variables of its own.',
    editFiles: 'Files carried in…',
    /* Named, not counted: the reader's next move is to look at that file, and
       "2 files" gives them nowhere to look. Muted rather than an error — the
       run did start, and this is why it may not finish. */
    carryMissing:
      'Not carried in, so the scripts run without them: {{files}}. Check the Files list \u2014 the source may have moved, or this checkout may never have had them.',
    /* The whole tab in one control: build, then serve. `Run` rather than
       `Build and start`, because the two steps are one intention — the second
       is only ever wanted after the first. */
    runAll: 'Run',
    running: 'Building\u2026',
    runHint: 'Builds this workspace, then starts its server.',
    runBuilding: 'Building. The server starts when this finishes.',
    runServing: 'Serving.',
    buildFailed: 'The build failed, so the server was not started.',
    /* The title bar's Run, held while the repository's scripts wait to be read
       on the Scripts tab — the button has no room to say why on its own. */
    awaitingApproval: 'Allow this repository\u2019s scripts on the Scripts tab first.',
    /* Said rather than enforced: the script belongs to whoever wrote it, and
       being wrong about it must not take the link or the controls away. */
    portSilent: 'Running, but nothing is listening on {{port}}. Does the script use $OCTOPUS_PORT?',
    noWorkspaceTitle: 'Nothing to run yet',
    noWorkspaceBody: 'Select a workspace on the left to run its scripts here.',
    noSetupTitle: 'No build script yet',
    noSetupBody:
      'It runs in a fresh workspace — installing dependencies, whatever a checkout needs before work can start.',
    noRunTitle: 'No server script yet',
    noRunBody:
      'It starts the dev server, and receives a port of its own so several workspaces can serve at once.',
    placeholder: '#!/bin/sh',
    setupIdle: 'Runs setup.sh in this workspace.',
    runIdle: 'Starts the dev server for this workspace.'
  },

  panel: {
    /* An icon in the tab row, like Terminal and Notes, so a sixth tab does not
       widen the narrowest the pane may be. */
    files: 'Files',
    changes: 'Changes',
    terminal: 'Terminal',
    /* Named on the tab rather than in `scripts.*` with the two headings inside
       it: the tab is one place, and what it holds is two. */
    scripts: 'Scripts',
    pullRequest: 'Pull request',
    /* An icon rather than a word in the tab row, so the fifth tab does not
       widen the narrowest the pane may be. This is still its name — it moves to
       the button's `aria-label` and its tooltip rather than disappearing. */
    notes: 'Notes',
    collapse: 'Collapse panel',
    expand: 'Show panel',
    terminalPlaceholderTitle: 'All quiet here',
    terminalPlaceholderBody:
      'Select a workspace on the left and a terminal opens in its directory.',
    resize: 'Resize panel'
  },

  /* The right pane's Files tab and the file tabs it opens in the centre. */
  files: {
    tree: 'Files of this workspace',
    refresh: 'Refresh',
    collapseAll: 'Collapse all folders',
    /* Opens the folders above the file in the centre and scrolls the tree to it. */
    reveal: 'Show the open file',
    filter: 'Filter files',
    /* The list of files the filter found, read aloud. */
    matches: 'Matching files',
    noMatchTitle: 'No file matches',
    noMatchBody: 'No file in the tree is called anything like “{{query}}”.',
    matchesCapped: 'The first {{limit}} matches. Type more to narrow them.',
    noWorkspaceTitle: 'Nothing to look through yet',
    noWorkspaceBody: 'Select a workspace on the left to browse its files.',
    loading: 'Reading files…',
    emptyTitle: 'Not a file in sight',
    emptyBody: 'This workspace has no files yet.',
    truncated: 'Only the first {{limit}} files are listed.',
    loadingFolder: 'Reading…',
    folderFailed: 'This folder could not be read.',
    folderTruncated: 'Only the first {{limit}} entries are listed.',
    /* Under an open folder read from disk with nothing in it — most often a submodule never checked out in this worktree. */
    folderEmpty: 'Nothing in this folder.',
    /* Said aloud after a greyed row's name; the grey says it to the eye. */
    ignored: 'ignored by git',
    /* Said aloud after a folder's name when its dot is drawn. */
    changesInside: 'has changes',
    /* Said aloud after a conflicted file's name; the `!` says it to the eye. */
    statusConflictedLabel: 'Conflicted',
    tabs: 'Open files',
    preview: '{{name}} — preview. Opening another file replaces it; double-click to keep it open.',
    close: 'Close {{name}}',
    /* A row's right-click menu. The keys are an editor's explorer's. */
    copyPath: 'Copy path (⌥⌘C)',
    copyRelativePath: 'Copy relative path (⌥⇧⌘C)',
    /* Attaches the row's path to the conversation in front, as a dropped file. */
    addToChat: 'Add to chat',
    pathCopied: 'Path copied',
    copyFailed: 'Could not copy the path'
  },

  /* A file opened from the Files tab, read-only. */
  viewer: {
    loading: 'Opening…',
    binary: 'This is a binary file ({{size}}) and is not shown here.',
    tooLarge: 'This file is {{size}}, more than the {{limit}} shown here.',
    missing: 'This file is no longer there.',
    deleted: 'This file has been deleted. This is its last committed version.',
    deletedUnreadable:
      'This file has been deleted, and its last committed version cannot be shown here.',
    plain: 'Shown without colours: the file is too large to highlight.',
    openExternally: 'Open in editor',
    reload: 'Reload',
    /* The toolbar over selected lines. */
    selection: 'Lines {{range}}',
    addTo: 'Add to {{name}}',
    copyReference: 'Copy path',
    copied: 'Path copied',
    copyFailed: 'Could not copy',
    notePlaceholder: 'What should the agent know about these lines? (optional)'
  },

  /*
   * Every piece of prose the pull request tab can send.
   *
   * Named for what the button does rather than for the file, because the button
   * is where they are met. The scope sentence is appended to each hint by
   * `InstructionEditors`, so the difference between the two dialogs is said once.
   */
  /* Where a script, an instruction or a project field comes from. The layers
     are named for where they live, which is what somebody goes to change. */
  sources: {
    layerRepository: 'Repository',
    layerProject: 'This project',
    layerGlobal: 'Settings',
    layerTemplate: 'Template',
    inEffect: 'In effect: {{layer}}',
    nothingInEffect: 'Nothing runs',
    layers: 'Where {{setting}} can come from',
    useMine: 'Use mine instead of the repository\u2019s',
    useMineHint:
      'The repository supplies this, and its copy is what applies. On, this project\u2019s own is used instead, and the repository\u2019s is not read for it.',
    useMineHintCarry:
      'The repository\u2019s list adds its lines to this project\u2019s, and yours wins where both name a file. On, only this project\u2019s list is carried, and the repository\u2019s is not read.',
    fromRepository: 'From {{path}} in the checkout. Change it there, or use your own.',
    fromRepositoryCarry:
      'From {{path}}. Its lines are added to this project\u2019s list \u2014 only the files git ignores in the workspace, never from where a line says, and only once the repository is trusted.',
    fromGlobal: 'From Settings \u2192 Instructions, for every project that writes none of its own.',
    fromTemplate: 'What octopus ships. It applies when nothing else is written.',
    scriptTemplate: 'Where an editor starts. Nothing runs from it.',
    repositoryStates: 'The repository sets {{value}}.',
    warningRepositoryNotTrusted:
      'It is not trusted yet, so this project\u2019s own applies. Trust it under Repository.',
    warningBaseBranchMissing:
      'This checkout has no such branch, so this project\u2019s own applies.',
    warningEnvFileOutside: 'That path leaves the worktree, so this project\u2019s own applies.',
    warningEnvFileNotIgnored:
      'git would commit that file, and the variables written there are credentials, so this project\u2019s own applies.',
    warningProjectFileUnreadable:
      'The repository\u2019s .octopus/project.json could not be read, so this project\u2019s own applies.',
    tableTitle: 'Where each setting comes from',
    tableHint:
      'The repository\u2019s .octopus/ is read while the app works and wins by default; switch an item to use this project\u2019s own. The repository\u2019s carry list adds to this project\u2019s rather than replacing it. Name, icon and colour are this project\u2019s own \u2014 the repository\u2019s are taken once, when the project is added.',
    columnSetting: 'Setting',
    columnInEffect: 'In effect',
    columnUseMine: 'Use mine',
    open: 'Open {{setting}}'
  },

  instructions: {
    scopeGlobal:
      'A project can write its own, which is used instead of this one \u2014 and a repository carrying one in .octopus/instructions/ is used before either.',
    scopeProject:
      'Used instead of the one in Settings; empty means this project adds nothing. A repository carrying one in .octopus/instructions/ is used first, unless you choose your own.',

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
    /* One of the reads came back full. Said rather than paginated: past these
       numbers the pane wants a search box, not a longer page — and a reader who
       cannot find a remark they remember should learn why here rather than by
       reasoning about it. */
    capped:
      'GitHub was asked for the most recent hundred comments and fifty threads, and answered with that many \u2014 so there may be older ones this pane is not showing. The request on GitHub has all of them.',
    noWorkspaceTitle: 'Nothing to propose yet',
    noWorkspaceBody: 'Select a workspace on the left to open a pull request from its branch.',
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
    /* Its twin for the request that already exists. The press there commits and
       pushes in one go, so the sentence has to name the publishing rather than
       the request the variables would land in. */
    envNotIgnoredPush:
      'git does not ignore {{file}}, and octopus writes this workspace’s variables into it. Committing and pushing would send them to GitHub.',

    refresh: 'Read GitHub again',
    readAt: 'Read at {{time}}',
    isDraft: 'Draft',

    checks: 'Checks',
    checksNone: 'This repository runs nothing on a pull request.',
    rerunFailed: 'Failed',
    rerunFailedTitle: 'Re-run the failed jobs',
    rerunAll: 'All',
    rerunAllTitle: 'Re-run every check',
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
    /* Answering a review is the other half of reading one: saying why something
       was left as it is fits in a sentence and nowhere in a commit. Offered on
       the last note of a thread, since that is where a reply lands. */
    reply: 'Reply',
    replyPlaceholder: 'Answer this thread…',
    replySend: 'Send',
    replying: 'Sending…',
    replyCancel: 'Cancel',
    resolveThread: 'Resolve',
    unresolveThread: 'Unresolve',
    /* Offered off the request's state, not off the press that merged it — so it
       is here for a merge done from the header or in a browser too. */
    mergedDone: 'This branch is merged. Its workspace is still here.',
    removeWorkspace: 'Remove workspace…',
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
    /* Not a refusal GitHub would make — it merges over a check that is not
       required — so this one says outright that the app is the one refusing. */
    /* Waited for rather than merged past. `gh` would take the press and turn it
       into auto-merge, which is a fair thing for `gh` to do and the wrong thing
       to offer beside a list that says "running". */
    mergeChecksRunning_one: '{{count}} check is still running.',
    mergeChecksRunning_few: '{{count}} checks are still running.',
    mergeChecksRunning_many: '{{count}} checks are still running.',
    mergeChecksRunning_other: '{{count}} checks are still running.',
    mergeChecksFailed_one: '{{count}} check failed. Fix it before merging.',
    mergeChecksFailed_few: '{{count}} checks failed. Fix them before merging.',
    mergeChecksFailed_many: '{{count}} checks failed. Fix them before merging.',
    mergeChecksFailed_other: '{{count}} checks failed. Fix them before merging.',

    /* The prepared messages, named for what pressing them does. Each sends the
       project's instruction as a visible message in the conversation. */
    fixChecks: 'Fix the checks',
    addressReview: 'Address the review',
    doReview: 'Review it',
    multiAgentReview: 'Multi-agent review',
    resolveConflicts: 'Resolve the conflicts',
    commitAndPush: 'Commit & push',
    amendAndPush: 'Amend commit & push',
    committing: 'Committing…',
    /* The other half of the pair: work already committed, which had no way onto
       the request short of the terminal. */
    push: 'Push',
    pushing: 'Pushing…',
    unpushed_one: '{{count}} commit is not on GitHub yet.',
    unpushed_few: '{{count}} commits are not on GitHub yet.',
    unpushed_many: '{{count}} commits are not on GitHub yet.',
    unpushed_other: '{{count}} commits are not on GitHub yet.',
    /* The third answer. Pushing from here would be refused anyway — the remote
       is ahead of this checkout, or HEAD is not on the branch — so the button
       goes with the number rather than failing when pressed. */
    unpushedUnknown:
      'What is left to push cannot be counted from here: this checkout does not have what GitHub holds for this branch, or HEAD is not on it. Fetch it in the terminal first.',
    /* The twin of `commitHint`, for the request that already exists. Said
       because both halves happen to something outside this window, and the
       message is now typed rather than fixed. */
    amendNeedsCommit:
      'This branch has no commit of its own to amend yet. Write a message to make one.',
    commitAndPushHint:
      'Commits every change in this workspace under this message, then pushes it onto the request. Left empty, the changes are added to the last commit instead, which replaces it on GitHub.',
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
    noWorkspaceTitle: 'Nothing to compare yet',
    noWorkspaceBody: 'Select a workspace on the left to see what it has changed.',
    cleanTitle: 'Not a single change',
    cleanBody:
      'Nothing has changed in this workspace yet. Edits — yours or the agent’s — show up here.',
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
    /* A permission change draws no lines at all, so without a line of its own
       the row read as a file that changed nothing — beside a revert control.
       Named rather than spelled in octal, because this is the bit that matters
       here: octopus executes the scripts it chmods to 0755, and one without it
       fails outright. */
    modeExecutable: 'made executable',
    modeNotExecutable: 'no longer executable',
    /* Anything else — a file becoming a symlink, a gitlink — is rare enough
       that the two modes are the clearest thing to show, and this is also what
       makes a `T` row say what it turned into. */
    modeChanged: 'mode {{from}} \u2192 {{to}}',
    binary: 'Binary file — nothing to show.',
    tooLarge: 'Too large to draw here. Open the file to read it.',
    nestedRepository:
      'A repository of its own. Git records it as a link rather than its files, once it has a commit of its own.',
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
    /* Which conversations wrote a file, and only where more than one could
       have: a workspace holds up to three working in one worktree, and "the
       agent changed this" stopped being one sentence. */
    writtenBy: 'Written by {{names}}',
    writtenByFilter: 'Show only what {{name}} wrote',
    writtenByAll: 'Everything',
    omittedFiles_one: '{{count}} file is too large to draw',
    omittedFiles_few: '{{count}} files are too large to draw',
    omittedFiles_many: '{{count}} files are too large to draw',
    omittedFiles_other: '{{count}} files are too large to draw',
    /* How far a file's change has got towards GitHub, and separately whether
       the request is already showing an older version of it. Two facts, two
       marks: the second is the one that costs a reviewer their time, and it
       applies whichever of the first three is true. */
    publishUncommitted: 'not committed',
    publishCommitted: 'committed',
    publishPushed: 'pushed',
    publishUncommittedLabel: 'Not committed — commit it, then push',
    publishCommittedLabel: 'Committed here, not on GitHub yet — push it',
    publishPushedLabel: 'On GitHub, and nothing here is newer',
    publishStale: 'The pull request still shows an older version of this file.',
    publishNoRemote: 'This branch is not on GitHub yet.',
    /* What the strip draws; `publishNoRemote` is its tooltip. The full
       sentence beside the rung counts wrapped the strip onto a second line on
       the pane's default width. */
    publishNoRemoteShort: 'not on GitHub',
    /* A changed file's state in words. The row draws it as dots and the colour
       of the name, so the tooltip and a screen reader get these instead. */
    pathWithStatus: '{{status}}: {{path}}',
    fileState: '{{status}} · {{stage}}',
    /* Said in place of everything else this strip carries, because everything
       else rests on HEAD being this workspace's branch: the rungs, both counts
       and Push are all measured from it. Not `publishNoRemote` — "not on GitHub
       yet" is a different false statement about a branch that may well be. */
    publishHeadElsewhere:
      'HEAD is not on this workspace\u2019s branch {{branch}}, so nothing here can be said about GitHub. Check it out in the terminal.',
    publishAllSent: 'Everything here is on GitHub.',
    // Push's tooltip. The button is only drawn when this count is above zero.
    publishUnpushed_one: '{{count}} commit not pushed',
    publishUnpushed_few: '{{count}} commits not pushed',
    publishUnpushed_many: '{{count}} commits not pushed',
    publishUnpushed_other: '{{count}} commits not pushed',
    publishStaleCount_one: '{{count}} file is out of date in the request',
    publishStaleCount_few: '{{count}} files are out of date in the request',
    publishStaleCount_many: '{{count}} files are out of date in the request',
    publishStaleCount_other: '{{count}} files are out of date in the request',
    publishStaleHint:
      'The version on GitHub is out of date: the pull request still holds an older version of these files than you have here. Push to bring it up to date.',
    publishCount: '{{count}} {{state}}',
    push: 'Push',
    pushing: 'Pushing…',
    copyPath: 'Copy path',
    copied: 'Path copied',
    copyFailed: 'Could not copy',
    openFile: 'Open file',
    fileActions: 'Actions for {{path}}',
    statusAddedLabel: 'Added',
    statusModifiedLabel: 'Modified',
    statusDeletedLabel: 'Deleted',
    statusRenamedLabel: 'Renamed',
    statusCopiedLabel: 'Copied',
    statusTypeChangedLabel: 'Type changed',
    statusUntrackedLabel: 'Untracked',
    comment: 'Comment on line {{line}}',
    commentOld: 'Comment on line {{line}} of the file as it was',
    /* What the button floating at a selection says, as visible text: the
       icon alone was easy to miss. Worded like the file viewer's "Add to …",
       which opens the same kind of note. */
    addToChat: 'Add to chat',
    commentPlaceholder: 'What should the agent change here?',
    commentSave: 'Add',
    commentCancel: 'Cancel',
    commentRemove: 'Remove this note',
    commentIntro: 'Review notes on the changes:',
    /* Appended to a note's heading in the message the agent reads. Without it
       the number is an address in a file that no longer exists — and the pane
       knows the side everywhere else, including the aria-label above. Worded
       like `commentOld`, which says the same thing to a screen reader. */
    noteOldSide: '(in the file as it was, before this change)',
    /* The same on the composer chip, where there is room for two words and the
       reader is deciding whether to take the note back. */
    noteOldSideShort: '(as it was)'
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
    /* The /btw drawer. The hint says nothing enters the chat: that is what
       makes it safe to ask mid-turn. */
    side: {
      title: 'Side questions',
      open: 'Ask a side question',
      close: 'Close side questions',
      clear: 'Clear side questions',
      hint: 'Ask about the conversation without interrupting it. The agent answers from what it already knows, with no tools, and nothing here enters the chat.',
      placeholder: 'Ask a side question',
      field: 'Your side question',
      send: 'Ask',
      answering: 'Answering…',
      empty: 'The agent had no answer for this one.',
      unread: 'An answer is waiting',
      fork: 'Continue from this answer in a new conversation'
    },
    /* What a tab says aloud, and what its tooltip shows. Takes the resolved
       name — the one the user gave it, or the automatic one above — because a
       renamed conversation should read as itself here too. */
    tabStatus: '{{name}}: {{state}}',
    /* Two quiet states, and the difference is what a glance down the list is
       usually after: a turn that ended cleanly, against a conversation nobody
       has written in. Neither says "idle", which describes both. */
    tabStatusIdle: 'nothing written yet',
    tabStatusDone: 'finished',
    tabStatusInterrupted: 'interrupted',
    newTab: 'New conversation',
    renameTab: 'Rename…',
    forkTab: 'Continue in a new conversation',
    forkTabHint: 'The agent keeps what it remembers of this one.',
    copyTranscript: 'Copy transcript',
    copyTranscriptHint: 'To brief another conversation on this one.',
    closeTab: 'Close conversation',
    /* The agent's own task list, pinned above the field while it has work
       left. The progress reads "3 of 7". */
    todos: 'Tasks',
    todosProgress: '{{done}} of {{total}}',
    todoStatus: {
      pending: 'to do',
      in_progress: 'in progress',
      completed: 'done'
    },
    // Above the first message of each day, and floating at the top of the log
    // while it is scrolled. The locale is the date's, not the interface's:
    // British English writes the day first, as the rest of the app does.
    today: 'Today',
    yesterday: 'Yesterday',
    dateLocale: 'en-GB',
    /* Beside the hour of a message sent while the agent worked, until it takes
       it. The hint says what Stop does not do: a held message is not
       withdrawn, and runs as a turn of its own once the agent stops. */
    waiting: 'Queued',
    waitingHint:
      'The agent takes this message once it is ready for it. Stop does not withdraw it: it then runs on its own.',
    /* Rewinding to before a message: the conversation, the files, or both. */
    rewind: 'Rewind to before this message',
    rewindTitle: 'Rewind to before this message',
    rewindBoth: 'Conversation and files',
    rewindConversation: 'Conversation only',
    rewindFiles: 'Files only',
    // What each choice does, under its name.
    rewindDropsMessages:
      'Removes this message and everything after it. The message goes back into the field, to edit and send again.',
    rewindPutsFilesBack_one:
      'Puts {{count}} file back to how it was before this message (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_few:
      'Puts {{count}} files back to how they were before this message (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_many:
      'Puts {{count}} files back to how they were before this message (+{{insertions}} −{{deletions}}).',
    rewindPutsFilesBack_other:
      'Puts {{count}} files back to how they were before this message (+{{insertions}} −{{deletions}}).',
    rewindKeepsFiles: 'The files stay as they are.',
    rewindKeepsConversation: 'The conversation stays as it is.',
    // Why a choice is not on offer, in its place.
    rewindNoConversation:
      'The agent no longer holds this point: the conversation was compacted since, or forked from another.',
    rewindFilesBusy: 'Another conversation in this workspace is working.',
    rewindNothing: 'The files are already as they were before this message.',
    rewindFilesRefused: 'The files cannot be put back: {{reason}}',
    rewindFilesRefusedPlain: 'The files cannot be put back to this message.',
    rewindDetail:
      'Anything changed in the files since — by the agent or by you — is overwritten, and cannot be brought back.',
    rewindCancel: 'Cancel',
    filesRewound:
      'Files put back to an earlier message: {{files}} changed, +{{insertions}} −{{deletions}}',
    filesRewoundSkipped_one: '({{count}} left alone — a link sat at its path)',
    filesRewoundSkipped_few: '({{count}} left alone — a link sat at their path)',
    filesRewoundSkipped_many: '({{count}} left alone — a link sat at their path)',
    filesRewoundSkipped_other: '({{count}} left alone — a link sat at their path)',
    /* The history of what was closed. Closing keeps a conversation, so this is
       how one comes back — and ⌘⇧T brings back the last. */
    history: 'Closed conversations',
    historyEmpty: 'Nothing closed yet',
    historyUntitled: 'Conversation with no messages',
    historyClosed: 'Closed {{when}}',
    historyFull: 'Close a tab first — {{limit}} are open',

    placeholder: 'Ask the agent to do something in this workspace…',
    send: 'Send',
    stop: 'Stop',
    /* The tooltip names the key; the accessible name stays the plain word. */
    stopHint: 'Stop (Esc)',
    working: 'Working…',
    thinking: 'Thinking',
    memoryReset: 'The agent’s memory of this conversation starts again here',
    compacted: 'The agent summarised everything above to make room',
    /* Said from the call, before its answer: the CLI may still ask for leave or refuse, and its refusal is the red line below. */
    worktreeEntered:
      'The agent is moving into another worktree, {{target}}. Changes, Files, the terminal and the scripts here stay on this workspace.',
    worktreeEnteredNew:
      'The agent is moving into a new worktree. Changes, Files, the terminal and the scripts here stay on this workspace.',
    worktreeLeft: 'The agent is leaving the other worktree and keeping it.',
    worktreeRemoved: 'The agent is leaving the other worktree and removing it, with its branch.',
    /* Said from the CLI's own hook, after the shell command that moved it: a `cd` the call never named. */
    cwdMoved:
      'The agent’s shell moved to {{path}}. Changes, Files, the terminal and the scripts here stay on this workspace.',
    cwdBack: 'The agent’s shell is back in this workspace’s worktree.',
    /* An exit code past 128 is a signal: something outside ended the process. */
    processStopped:
      'Claude Code was stopped from outside — by the system or another program. Send a message to carry on; the conversation is kept.',
    processFailed:
      'Claude Code stopped with an error (code {{code}}). Send a message to try again; the conversation is kept.',
    compactedBy:
      'The agent summarised everything above to make room \u2014 {{before}} became {{after}}',

    /* The one change of model nobody in the conversation asked for. Two
       sentences because the two scopes are two different facts: a session swap
       has already moved the chip, and a local one has not. */
    refusalSwapped:
      '{{from}} declined this turn, so {{to}} took it \u2014 and the rest of this conversation',
    refusalSwappedLocally: '{{from}} declined part of this turn, so {{to}} answered that part',
    /* And the case with no second model in it. Worth its own sentence rather
       than silence: after a fallback the reader has an answer, and here the
       turn just ends — which reads as the app having dropped something. */
    refusalDeclined: '{{from}} declined this turn, and no other model took it',
    /* A call refused without anyone being asked. Auto mode's classifier is the
       usual source, and named, because a mode that decides for the user has
       to leave its decisions on the screen; a deny rule is the other. */
    deniedByAuto: 'Auto mode blocked {{tool}}',
    deniedByRule: '{{tool}} was refused without asking',
    /* The chip moved by itself, and this is the line that says why. */
    autoFellBack: 'Auto mode is not available here, so this chat is on {{mode}} now',
    /* Struck through rather than dropped: the work was really done and then
       abandoned, and a log that quietly loses it reads as though the agent
       never started down that road. */
    retracted: 'The agent took this back after the model declined the turn.',

    emptyTitle: 'Start the conversation',
    /* Beside the switch on the empty conversation: which data the work about to
       be asked for runs against. */
    envLabel: 'Runs against',
    emptyBody:
      'The first message starts an agent session in this worktree. The branch already exists.',

    /* Names the control and the mode in force together: the button switches
       rather than opening a list, so the value is all it shows. */
    modeToggle: 'Permissions: {{mode}}',
    /* Manual, Accept edits and Auto are left in English in every locale: they
       are what Claude Code's own status line calls these, and a translated
       name for a borrowed one reads as a second setting rather than the same
       one. Accept edits is not Auto: that one is a classifier approving each
       call, this one accepts file edits and nothing else. */
    modeDefault: 'Manual',
    modeAcceptEdits: 'Accept edits',
    modeAuto: 'Auto',
    planMode: 'Plan',
    /* Names the keys rather than the states: the label beside it already
       says which one is in force, and the ring's order is learned by using it. */
    modeCycle: 'Switch mode — Manual, Accept edits, Plan, Auto (Shift+Tab)',

    context: 'Context',
    contextTitle: 'Context window — {{used}} of {{total}}',
    /* The second lines of the menu the reading opens. The commands themselves
       are not here: they are the CLI's own names, printed the way the
       suggestion list prints them, and a translated `/clear` would be a
       command that does nothing. */
    contextCompactNote: 'The agent keeps a summary of the conversation and carries on.',
    contextClearNote: 'The agent forgets this conversation, and the log goes with it.',
    /* The window group in the same menu. The values print through
       `formatTokens`, so only the words around them are here. */
    autoCompactTitle: 'Auto-compact',
    autoCompactNote:
      'When this conversation is compacted on its own. A change starts the session again; the conversation is kept.',
    autoCompactAuto: 'Auto',
    autoCompactAutoNote: 'As Claude Code decides',
    autoCompactAutoNow: 'As Claude Code decides — now {{window}}',
    autoCompactTooLarge: 'More than this model holds ({{window}})',
    autoCompactPending: 'Takes effect with the next message, once the agent has finished.',
    autoCompactOverridden:
      '{{variable}}={{value}} in {{from}} decides instead. Take it out there, then choose here again.',
    autoCompactOverriddenEnv:
      '{{variable}}={{value}} in the environment decides instead. Take it out there, then choose here again.',
    autoCompactMismatch: 'In effect: {{effective}}, not the chosen {{chosen}}.',
    autoCompactMismatchRetry:
      'In effect: {{effective}}, not the chosen {{chosen}}. Choose it again to start the session over.',
    clearTitle: 'Clear this conversation?',
    clearMessage: 'The agent starts again with no memory of what was said here.',
    clearDetail: 'The log is deleted with it, and cannot be brought back.',
    clearConfirm: 'Clear',
    clearCancel: 'Cancel',

    /* The composer's own name for the panel, and the count beside it: how many
       of the skills octopus reads itself — ours and the checkout's — are on.
       Claude Code's own are left out of it: they come from the running agent,
       so counting them made the number change by itself, and they carry a
       count of their own in the panel. A count rather than a fraction — the
       interesting number is what the agent has, not what it is missing. */
    skills: 'Skills',
    skillsTitle: 'Skills for this conversation',
    skillsGlobal: 'Everywhere',
    skillsProject: 'This project',
    skillsRepository: 'From this repository',
    /* Everything the agent holds that octopus never looked for — Claude Code's
       own, the user's `~/.claude/skills`, a plugin's. Named for where they come
       from rather than for what they are, like the three above it. */
    skillsSession: 'From Claude Code',
    /* Read as "{{count}} of them are on", beside the folded group's heading. */
    skillsSessionCount: '{{count}} on',
    /* Where each of Claude Code's own came from, as the group's subheadings. */
    skillsBuiltin: 'Built into Claude Code',
    skillsPlugin: 'Plugins',
    // Under the plugins' heading, where their rows carry no switch: Claude Code
    // keeps a plugin's skill whatever octopus says, and turns a plugin off whole.
    skillsPluginNote: 'Turned on and off with the whole plugin, through /plugin in Claude Code',
    skillsSynced: 'Synced from claude.ai',
    skillsOwn: 'Your own',
    /* Said once at the foot of the panel, because a switch that looks like a
       lock is worse than no switch. The SDK's own words for this mechanism are
       "a context filter, not a sandbox". */
    skillsNote: 'Switching one off keeps it out of the agent’s list. The files stay on disk.',
    skillsEmpty: 'No skills yet.',
    skillsEmptyNote: 'Add one in settings, and it appears here for every conversation.',
    skillsSettings: 'Open settings',
    /* A control with nothing behind it yet, and it says so rather than
       swallowing the click. */
    attach: 'Attach files',
    attachRemove: 'Take this file back',
    /* What the message says above the paths. The agent is told where the files
       are, not handed copies of them — §4's rule that nothing implicit reaches
       it, in the plainest form it takes. */
    attachIntro: 'Files I am pointing you at:',
    /* Shown over the composer while something is being dragged onto it. */
    attachDrop: 'Drop to attach',
    /* A tab's spoken name when notes wait in it: its name and state, then the count. */
    tabWithNotes: '{{described}}, {{waiting}}',
    /* The counter on a conversation's tab: notes from the viewer that will go
       out with its next message. */
    notesWaiting_one: '{{count}} note waiting',
    notesWaiting_few: '{{count}} notes waiting',
    notesWaiting_many: '{{count}} notes waiting',
    notesWaiting_other: '{{count}} notes waiting',

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
    /* The writing column's first row: no split, so whatever plans writes the
       code as well. The model that resolves to is named underneath, because
       that is the fact the reader came for. */
    modelsSameAsPlan: 'Same as plan',
    /* Above the columns while a `/model` command has the session on a model
       they do not tick: the command lasts for the session, the columns are
       what this conversation chose. */
    modelsSessionOnly: 'This session is running {{model}}: /model chose it for this session only.',

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
    /* Two jobs over one scale. Somebody who has one model think an approach
       through and another carry it out wants more thinking in the first half
       and less in the second — one judgement, and half of it used to be
       unsayable. */
    effortJob: 'Which job',
    effortWhileWorking: 'Writing code',
    effortWhilePlanning: 'Planning',
    effortSameAsPlan: 'Same as plan',
    effortMatchPlan: 'Use the same as plan',
    /* The ends of the scale rather than labels for its halves: what is being
       traded is the interesting part, and neither end is the good one. */
    effortFaster: 'Faster',
    effortSmarter: 'Smarter',

    /* A tool call is one row, as in Claude Code: a mark, the tool, what it
       acted on, and a line under it saying what came back. The marks are read
       aloud by these, since a spinner and a dot say nothing to a screen
       reader. Ukrainian needs `few` and `many` for the counts below; i18next
       picks the form that applies to the active language. */
    toolRunning: 'Running',
    toolDone: 'Done',
    toolFailed: 'Failed',
    toolStopped: 'No result — the turn ended first',
    toolScope: 'in {{scope}}',
    resultLines_one: '{{count}} line',
    resultLines_few: '{{count}} lines',
    resultLines_many: '{{count}} lines',
    resultLines_other: '{{count}} lines',
    resultLinesAtLeast_one: 'at least {{count}} line',
    resultLinesAtLeast_few: 'at least {{count}} lines',
    resultLinesAtLeast_many: 'at least {{count}} lines',
    resultLinesAtLeast_other: 'at least {{count}} lines',
    resultFiles_one: '{{count}} file',
    resultFiles_few: '{{count}} files',
    resultFiles_many: '{{count}} files',
    resultFiles_other: '{{count}} files',
    resultMatches_one: '{{count}} match',
    resultMatches_few: '{{count}} matches',
    resultMatches_many: '{{count}} matches',
    resultMatches_other: '{{count}} matches',
    resultMoreLines_one: '… +{{count}} line',
    resultMoreLines_few: '… +{{count}} lines',
    resultMoreLines_many: '… +{{count}} lines',
    resultMoreLines_other: '… +{{count}} lines',
    resultEmpty: '(no output)',
    agentToolUses_one: '{{count}} tool use',
    agentToolUses_few: '{{count}} tool uses',
    agentToolUses_many: '{{count}} tool uses',
    agentToolUses_other: '{{count}} tool uses',
    /* Sent off to run on its own: its report does not come back with the call. */
    agentBackground: 'Running in the background',
    diffMoreLines_one: '{{count}} more line',
    diffMoreLines_few: '{{count}} more lines',
    diffMoreLines_many: '{{count}} more lines',
    diffMoreLines_other: '{{count}} more lines',
    outputMoreLines_one: 'Show {{count}} more line',
    outputMoreLines_few: 'Show {{count}} more lines',
    outputMoreLines_many: 'Show {{count}} more lines',
    outputMoreLines_other: 'Show {{count}} more lines',
    /* A conversation read back after a restart kept only the head of each
       output, and the opened row says so rather than passing it off as whole. */
    outputSavedHead: 'Only the start of this output was saved.',
    outputSavedHeadOf_one: 'Only the start of this output was saved — {{count}} line in all.',
    outputSavedHeadOf_few: 'Only the start of this output was saved — {{count}} lines in all.',
    outputSavedHeadOf_many: 'Only the start of this output was saved — {{count}} lines in all.',
    outputSavedHeadOf_other: 'Only the start of this output was saved — {{count}} lines in all.',
    toolInput: 'Input',
    toolOutput: 'Output',
    agentReport: 'Report',
    openFile: 'Open {{path}} — double-click to keep it open',
    /* Claude Code's ctrl+o: every row and every piece of reasoning at once. */
    expandAll: 'Show every step (⌘O)',
    collapseAll: 'Fold every step (⌘O)',
    jumpToEnd: 'Jump to the latest message',
    previousMessage: 'Previous message you sent',
    nextMessage: 'Next message you sent',
    workingElapsed: 'Working… {{elapsed}}',

    /* Where the `+1 −1` normally sits, for an edit that replaced its text
       everywhere it appeared. No number, because the call carries none: it is
       handed one pair of fragments however many places it applies them to, and
       a rename through twelve of them used to read `+1 −1`. */
    changeEverywhere: 'replaced everywhere',

    plan: 'Plan',
    executePlan: 'Execute',
    executePlanMessage: 'Carry out the plan “{{title}}”.',
    executePlanEditedMessage: 'Carry out this plan:\n\n{{plan}}',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    planReady: 'The plan is ready',
    planExecute: 'Execute',
    planFork: 'Fork in new chat',
    planEdit: 'Edit',
    planEditDone: 'Back to the plan',
    planEditLabel: 'The plan, as markdown',
    planEdited: 'Plan, as you edited it',
    /* Said before the click, because the click widens what the agent may do:
       an approved plan always goes on in Accept edits. */
    planExecuteHint: 'Runs with Accept edits on — file changes go ahead without asking.',
    /* The exception: a chat in Auto goes back to Auto, which already decides
       each step on its own. */
    planExecuteHintAuto:
      'Runs in Auto — each step is approved or refused for you, and anything unclear is asked.',
    planFeedback: 'Anything to work out first?',
    planFeedbackPlaceholder: 'Write here and the agent will revise the plan',
    planSendFeedback: 'Send the note and keep planning',
    planWaiting: 'The plan is waiting for your answer',
    planReopen: 'Open the plan',
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

  /*
   * The agents a conversation sent off to work beside it: the count in the
   * composer, the map it opens, and the line under an `Agent` row in the log.
   */
  agents: {
    count_one: '{{count}} agent',
    count_few: '{{count}} agents',
    count_many: '{{count}} agents',
    count_other: '{{count}} agents',
    /* The chip's tooltip, in the three moods it has. */
    chipWorking_one: '{{count}} agent working — show what it is doing',
    chipWorking_few: '{{count}} agents working — show what they are doing',
    chipWorking_many: '{{count}} agents working — show what they are doing',
    chipWorking_other: '{{count}} agents working — show what they are doing',
    chipWaiting: 'An agent is waiting for your answer',
    chipDone: 'The agents this conversation ran — show what they did',
    title: 'Agents',
    working_one: '{{count}} working',
    working_few: '{{count}} working',
    working_many: '{{count}} working',
    working_other: '{{count}} working',
    ended_one: '{{count}} done',
    ended_few: '{{count}} done',
    ended_many: '{{count}} done',
    ended_other: '{{count}} done',
    commands: 'Background commands',
    /* Takes the ended ones off the map; the log keeps them. */
    clear: 'Clear finished',
    commandCount_one: '{{count}} command',
    commandCount_few: '{{count}} commands',
    commandCount_many: '{{count}} commands',
    commandCount_other: '{{count}} commands',
    statusRunning: 'Working',
    statusWaiting: 'Needs your answer',
    statusCompleted: 'Done',
    statusFailed: 'Failed',
    statusStopped: 'Stopped',
    tokens_one: '{{tokens}} token',
    tokens_few: '{{tokens}} tokens',
    tokens_many: '{{tokens}} tokens',
    tokens_other: '{{tokens}} tokens',
    toolUses_one: '{{count}} tool call',
    toolUses_few: '{{count}} tool calls',
    toolUses_many: '{{count}} tool calls',
    toolUses_other: '{{count}} tool calls',
    kindShell: 'Command',
    kindWorkflow: 'Workflow',
    kindOther: 'Task',
    /* A workflow's agents, of which only some are still going. */
    workflowAgents_one: '{{running}} of {{count}} agent working',
    workflowAgents_few: '{{running}} of {{count}} agents working',
    workflowAgents_many: '{{running}} of {{count}} agents working',
    workflowAgents_other: '{{running}} of {{count}} agents working',
    workflowNoPhase: 'Agents',
    mainAgent: 'The conversation',
    back: 'All agents',
    detailModel: 'Model',
    detailType: 'Type',
    detailElapsed: 'Time',
    detailTokens: 'Tokens',
    detailToolUses: 'Tool calls',
    detailSpawnedBy: 'Started by',
    prompt: 'Task',
    steps: 'Recent steps',
    noSteps: 'No steps yet.',
    showInChat: 'Show in conversation',
    stop: 'Stop {{name}}',
    stopAgent: 'Stop agent',
    /* Said on the permission card, so a reader knows which of several is asking. */
    asking: '{{name}} is asking',
    /* Under the log once the main agent's turn is over and its agents are not. */
    lineWorking_one: '{{count}} agent working in the background',
    lineWorking_few: '{{count}} agents working in the background',
    lineWorking_many: '{{count}} agents working in the background',
    lineWorking_other: '{{count}} agents working in the background'
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
    /* A word of its own here, where there is room: the card draws every window
       at equal weight and left the reader to work out which one decides. */
    binding: 'binding now',
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
    noProjectsTitle: 'Let’s find something to work on',
    noProjectsBody:
      'Add one from this machine, or clone it from GitHub. Workspaces are created inside it — each with its own branch, directory and agent session.',
    noSelectionTitle: 'Which project today?',
    noSelectionBody: 'Pick one on the far left, or add another repository.',
    /* The workspace half of the same pane. A project is chosen and the centre
       still has nothing to show, which is two different situations: one where
       there is nothing to pick, and one where nothing has been picked. */
    firstWorkspaceTitle: 'Your first workspace is one click away',
    firstWorkspaceBody:
      'A workspace is a copy of this project on a branch of its own, with its own folder and its own agent session. Nothing you do in one touches another.',
    noWorkspaceTitle: 'Which workspace shall we start with?',
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
    sectionSkills: 'Skills',
    /* Commands and subagents together. Named for the half the reader types,
       because that is the one they go looking for. */
    sectionLibrary: 'Commands',
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
    notificationSound: 'Sound',
    notificationSoundHint:
      'A quiet sound when an agent finishes, fails or needs your answer somewhere you are not looking.',
    notificationSoundChoice: 'Which sound',
    notificationSoundChoiceHint:
      'Press ▶ to hear one before choosing it. The chime is the one that sounds different for finished, failed and waiting.',
    soundPreview: 'Listen to {{name}}',
    sounds: {
      chime: 'Chime',
      airport: 'Airport',
      'alarm-clock': 'Alarm clock',
      bam: 'Bam',
      'cell-phone': 'Cell phone',
      craw: 'Crow',
      'door-bell': 'Doorbell',
      drum: 'Drum',
      fairy: 'Fairy',
      'funny-sound': 'Funny sound',
      gong: 'Gong',
      'hola-papa': 'Hola papa',
      japanese: 'Japanese',
      oyoy: 'Oy-oy',
      'sms-incoming': 'Incoming SMS',
      'uh-oh': 'Uh-oh',
      'water-drop': 'Water drop',
      whistle: 'Whistle',
      'whistle-here': 'Whistle here',
      wow: 'Wow'
    },

    branchPrefix: 'Branch prefix',
    branchPrefixHint:
      'Workspace branches are named <prefix>/<workspace>. A GitHub username is a common choice.',
    branchPrefixUnusable: 'The prefix needs at least one character git can use.',
    branchPrefixBecomes: 'Will be saved as {{prefix}}',

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
    settingSourcesProjectHint:
      "Loads the repository's own CLAUDE.md and settings, once they have been read and allowed.",
    settingSourcesAll: 'Everything',
    settingSourcesAllHint: 'User, project and local settings — what the plain CLI loads.',

    effort: 'Default effort',
    effortHint:
      'How much thinking a new conversation asks for. Each one can then be changed on its own, from the composer.',

    planModel: 'Model for planning and research',
    planModelHint:
      'What a new conversation plans and researches with, and writes code with too unless the model below says otherwise. The list is the agent’s own, so it is empty until a session has run once.',
    model: 'Model for writing code',
    modelHint:
      'Used while Plan is off, so a plan can be thought out by one model and carried out by another. Leave it the same as the plan to use one model for both.',

    permissionMode: 'What a new chat may do',
    permissionModeHint:
      'The starting point for every workspace, so the question is not asked again on each new branch. A chat can still be switched on its own.',
    permissionAsk: 'Manual',
    permissionAskHint:
      'Reading is silent; writing a file or running a command waits for an answer.',
    permissionAcceptEdits: 'Accept edits',
    permissionAcceptEditsHint:
      'File changes go through without asking, the plain file commands too (mkdir, mv, rm). Other commands still wait.',
    permissionAuto: 'Auto',
    permissionAutoHint:
      'A classifier approves or refuses each step, and asks when it cannot tell. Refusals show in the chat. Not every account and model has it; a chat falls back to Manual when it is not there.',
    planExecution: 'Carrying out an approved plan',
    planExecutionHint: 'What a chat switches to when you press Execute on a plan.',
    planExecutionAutoHint:
      'Each step is approved or refused by the classifier. Where Auto is not available, Accept edits is used instead.',
    planExecutionAcceptEditsHint:
      'File changes go through without asking; other commands still wait.',

    alwaysAllowed: 'Answered "always"',
    alwaysAllowedHint:
      'Tools you have waved through. They are never asked about again, in any workspace, until removed here.',
    alwaysAllowedEmpty: 'Nothing yet.',
    /* Under the tool name, where a rule names no place. An answer given before
       rules existed granted the tool outright, and the row has to say so
       rather than look like a narrow one. */
    alwaysAllowedEverywhere: 'anywhere',
    alwaysAllowedRemove: 'Ask again',

    accountsHint:
      'octopus never stores credentials. The CLI keeps them in the system keychain; this screen only reports what it says.',
    gitHint:
      'Connect GitHub to add a project by cloning one of your repositories, and to open pull requests and read checks. Credentials stay with the gh CLI, in the system keychain.',
    claudeAccount: 'Claude',
    claudeAccountHint: 'The agent runs on this account.',
    claudeAccountSetup:
      'Signing in needs Claude Code installed on this Mac. Without an account octopus still opens, but the agent cannot answer.',
    githubAccount: 'GitHub',
    githubAccountHint: 'Adding projects from GitHub, pull requests and checks.',
    githubAccountSetup:
      'Needs the GitHub CLI installed (brew install gh). Without it everything else works; pull requests and cloning do not.',
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
    installedAt: 'First run',

    /* The one place octopus quietly uses disk. Nothing removes a pasted image
       on its own and nothing should — a path in a sent message is a promise the
       file is there — so this makes the folder visible and leaves the decision
       here. */
    attachments: 'Pasted images',
    attachmentsEmpty: 'None yet',
    /* Four forms, as `diff.omittedFiles` has: English needs two and Ukrainian
       needs four, and the type is taken from this file. */
    attachmentsHeld_one: '{{count}} image, {{size}}',
    attachmentsHeld_few: '{{count}} images, {{size}}',
    attachmentsHeld_many: '{{count}} images, {{size}}',
    attachmentsHeld_other: '{{count}} images, {{size}}',
    attachmentsClear: 'Empty',
    attachmentsClearTitle: 'Empty the pasted images?',
    attachmentsClearMessage: 'Every image pasted into a composer is deleted from disk.',
    attachmentsClearDetail:
      'Messages that carried one keep the path, so an old conversation will show a file that is no longer there. Nothing else is affected.',
    /* Paired with "Keep them", and deliberately not "Empty" again: the button
       that opens the question and the one that answers it should not be the
       same word. */
    attachmentsClearConfirm: 'Delete them',
    attachmentsClearCancel: 'Keep them',

    /* What is still running. A pseudo-terminal outlives its pane more easily
       than it looks, and what it costs is a held port and a dev server writing
       to a file nobody reads — reported by somebody else's tool as "a server is
       already running". Making it visible is the answer. */
    terminals: 'Running terminals',
    terminalsNone: 'None',
    terminalPurpose: {
      shell: 'Terminal',
      setup: 'Setup script',
      run: 'Dev server',
      archive: 'Archive script',
      auth: 'Sign-in'
    },
    terminalsEnd: 'End',
    terminalsEndTitle: 'End this session?',
    terminalsEndMessage: 'The shell and everything it started are stopped.',
    terminalsEndDetail:
      'A dev server is asked to shut down first, and hung up on if it will not. Anything unsaved inside the session is lost.',
    terminalsEndConfirm: 'End it',
    terminalsEndCancel: 'Leave it running'
  },

  skills: {
    /* The two stores, named by their reach rather than by where the files sit:
       "global" is a word about our storage, and the reader is choosing which
       projects a skill applies to. */
    global: 'Skills everywhere',
    globalNote: 'Available in every project, unless a conversation turns one off.',
    project: 'Skills for this project',
    projectNote: 'Available in this project only. Kept in octopus, not in the repository.',

    add: 'New skill',
    /* An ellipsis because it opens a dialog rather than importing anything —
       and because the dialog's own button is the one called Import. */
    import: 'Import…',
    empty: 'No skills here yet.',
    /* Beside the switch on every row. A skill is on unless somebody says
       otherwise, which is how Claude Code treats one it discovers — so this
       reads as the state it is in, not as a favour being asked. */
    onByDefault: 'On by default',
    /* The row's menu button. Its face is an ellipsis, which reads as nothing
       at all to anyone not looking at it. */
    rowActions: 'What to do with {{name}}',
    edit: 'Edit',
    rename: 'Rename',
    /* A migration rather than an edit, which is why the editor's name field is
       disabled and this is a menu action: the name is the directory and the key
       three stored answers use, so core moves them together. */
    renameTitle: 'Rename \u201c{{name}}\u201d',
    renameLabel: 'New name (lowercase letters, digits and dashes)',
    renameConfirm: 'Rename',
    renameCancel: 'Cancel',
    renameInvalid: 'Lowercase letters, digits and dashes only, starting with a letter or a digit.',
    remove: 'Remove',
    removeTitle: 'Remove {{name}}?',
    removeMessage: 'The skill and everything in its folder are deleted.',
    removeDetail: 'Conversations that had it switched on simply stop seeing it.',
    removeConfirm: 'Remove',
    removeCancel: 'Cancel',

    /* The checkout's own, in the project section. The file is read-only here —
       it belongs to the repository, and editing it from a settings dialog would
       be octopus writing inside somebody's checkout — but whether the agent
       loads it is ours to say, so the note has to offer both. */
    inRepository: 'In this repository',
    inRepositoryNote:
      'The agent finds these in the checkout by itself. Switch one off to keep it out of conversations here, or copy it to use in every project.',
    copyToGlobal: 'Copy to all projects',
    /* Two steps, because the answer to "what am I importing" is not on screen
       until it has been read — and for a link the only thing on screen is an
       address. The second press is the one that writes. */
    inspectAction: 'Read it',
    noDescription: 'It describes itself as nothing.',

    /* The editor. `name` is fixed once created: it is the directory, and every
       stored answer is keyed by it. */
    editorNew: 'New skill',
    editorEdit: 'Edit {{name}}',
    name: 'Name',
    nameHint: 'Lowercase letters, digits and dashes. This is the folder it lives in.',
    nameInvalid: 'Use lowercase letters, digits and single dashes.',
    nameTaken: 'A skill of this name is already here.',
    description: 'When to use it',
    descriptionHint: 'The one line the agent reads to decide whether to reach for this.',
    body: 'Instructions',
    bodyHint: 'Markdown. What the agent should do once it has picked this up.',
    showRaw: 'Show SKILL.md',
    hideRaw: 'Back to the form',
    rawHint: 'The whole document, frontmatter included. Saved exactly as written.',
    save: 'Save',
    cancel: 'Cancel',

    /* Import. Three routes because a skill arrives in three shapes: as a
       folder somebody sent, as text in a chat, or as a link. */
    importTitle: 'Import a skill',
    fromDisk: 'From disk',
    fromDiskNote: 'A skill’s folder, or a single SKILL.md.',
    choose: 'Choose…',
    fromText: 'Paste',
    fromTextNote: 'The whole SKILL.md, frontmatter included.',
    fromUrl: 'From a link',
    fromUrlNote: 'An https address answering with one SKILL.md. Nothing beside it is fetched.',
    url: 'Address',
    importAction: 'Import'
  },

  library: {
    /* Commands and subagents, kept beside the skills and in the same two
       places. Named by what the reader does with them rather than by what
       Claude Code calls the directories: "commands" is what you type, and a
       "subagent" is a helper the model reaches for on its own. */
    commands: 'Commands',
    commandsNote:
      'Typed after a slash in any conversation. Kept in octopus, not in the repository.',
    commandsProjectNote:
      'Typed after a slash in this project’s conversations. Kept in octopus, not in the repository.',
    subagents: 'Subagents',
    /* The second sentence is measured, not guessed: against a live session, a
       command written while it was running appeared after a reload and a
       subagent did not. Said here rather than left to be discovered when the
       agent does not use one. */
    subagentsNote:
      'Helpers the agent reaches for on its own, each with its own instructions. Kept in octopus, not in the repository. A new one reaches conversations started after it, not ones already running.',
    subagentsProjectNote:
      'Helpers the agent reaches for in this project, each with its own instructions. Kept in octopus, not in the repository. A new one reaches conversations started after it, not ones already running.',

    empty: {
      command: 'No commands here yet.',
      subagent: 'No subagents here yet.'
    },
    add: {
      command: 'New command',
      subagent: 'New subagent'
    },
    new: {
      command: 'New command',
      subagent: 'New subagent'
    },
    /* An ellipsis because it opens a dialog rather than importing anything —
       and because the dialog's own button is the one called Import. */
    import: 'Import…',
    importTitle: {
      command: 'Import a command',
      subagent: 'Import a subagent'
    },

    /* The row's menu button. Its face is an ellipsis, which reads as nothing at
       all to anyone not looking at it. */
    rowActions: 'What to do with {{name}}',
    edit: 'Edit',
    editing: 'Edit {{name}}',
    rename: 'Rename',
    renameTitle: 'Rename \u201c{{name}}\u201d',
    renameLabel: 'New name (lowercase letters, digits, dashes and underscores)',
    renameConfirm: 'Rename',
    renameCancel: 'Cancel',
    renameInvalid: 'Lowercase letters, digits, dashes and underscores only.',
    remove: 'Remove',
    removeTitle: 'Remove {{name}}?',
    removeMessage: 'The file is deleted.',
    removeDetail: 'Conversations already running stop seeing it.',
    removeConfirm: 'Remove',
    removeCancel: 'Cancel',

    /* The editor. One field and not the form-and-raw pair a skill gets: a
       command is its text, and a subagent's other fields are ones a form could
       only drop. */
    name: 'Name',
    nameHint: {
      command: 'What you type after the slash. Lowercase letters, digits, dashes and underscores.',
      subagent: 'What the agent calls it. Lowercase letters, digits, dashes and underscores.'
    },
    nameInvalid: 'Use lowercase letters, digits, dashes and underscores.',
    nameTaken: 'Something of this name is already here.',
    document: 'Document',
    documentHint: {
      command: 'Markdown. The whole file is the prompt; $ARGUMENTS is what was typed after it.',
      subagent:
        'Markdown with frontmatter naming it and saying when to use it. tools and model are kept as written.'
    },
    save: 'Save',
    cancel: 'Cancel',

    /* Import. The same three routes a skill has, minus the folder — both of
       these are one file. The name is asked for, which a skill's import never
       does: a command names itself nowhere. */
    fromDisk: 'From disk',
    fromDiskNote: 'A single markdown file.',
    choose: 'Choose…',
    fromText: 'Paste',
    fromTextNote: 'The whole file, frontmatter included if it has any.',
    fromUrl: 'From a link',
    fromUrlNote: 'An https address answering with one markdown file. Nothing beside it is fetched.',
    url: 'Address',
    /* Two steps, because neither what is being imported nor what it will be
       called is on screen until it has been read. */
    inspectAction: 'Read it',
    importAction: 'Import',
    noDescription: 'It describes itself as nothing.'
  },

  elicitation: {
    /* A question from an MCP server. The one card in the log that comes from
       software nobody here wrote — a `.mcp.json` in a checkout starts these —
       so whose question it is comes before what it asks. */
    from: 'A question from {{server}}',
    optional: '{{label}} (optional)',
    choose: 'Choose…',
    /* "Answer", not "Send": the composer's own button is Send, and two of them
       on one screen is one too many. It is also the truer word — this answers a
       question rather than sending a message. */
    send: 'Answer',
    decline: 'Decline',
    /* What became of it, read back later. `decline` and `cancel` are different
       words to a server: one is the user saying no, the other is the question
       going away without an answer. */
    was: {
      accept: 'Answered.',
      decline: 'Declined.',
      cancel: 'Withdrawn when the turn stopped.'
    },
    /* Neither open nor recorded: the turn it belonged to is gone, and the
       transcript never got its outcome. */
    gone: 'No longer waiting for an answer.'
  },

  notes: {
    /* The one thing a workspace carries that the agent never reads. Everything
       else in the pane is something it acts on; this is only for the person. */
    placeholder: 'A line to yourself about this workspace. The agent never reads it.',
    noWorkspaceTitle: 'Nowhere to write yet',
    noWorkspaceBody: 'Select a workspace on the left to keep notes about it.',
    /* Shown only as the ceiling comes close. The limit is not about the note:
       the state file is rewritten whole on every save. */
    remaining_one: '{{count}} character left',
    remaining_few: '{{count}} characters left',
    remaining_many: '{{count}} characters left',
    remaining_other: '{{count}} characters left'
  },

  trust: {
    title: 'What this repository can do',
    explain:
      'octopus loads the same settings as Claude Code in a terminal, so this repository can pre-approve tools without asking, run its own commands around every tool call, and start MCP servers. Read what it ships before allowing it. Only these files need approving — instructions like CLAUDE.md do not, and are read either way once you approve.',
    approve: 'Allow these',
    notice:
      'This project ships settings that would pre-approve tools and run its own commands. Until you have read them, the agent works without anything from this repository — including its CLAUDE.md.',
    review: 'Review',
    linkRefused: 'A link leading out of this worktree. It is shown, not read: {{target}}',
    linkBroken: 'A link pointing at nothing.'
  },
  /* Heads-ups above the message field: a caveat shown once it starts to
     matter. Each tip has a one-line title and a paragraph behind "Learn more". */
  // News from an agent in a workspace out of sight, in the bottom-right corner.
  notices: {
    done: 'Finished',
    error: 'Ended with an error',
    question: 'Has a question for you',
    plan: 'Plan is ready for review',
    permission: 'Wants to use {{tool}}',
    show: 'Show',
    dismiss: 'Dismiss'
  },

  statusBar: {
    label: 'Status',
    hide: 'Hide the status bar',
    show: 'Show the status bar',
    working_one: '{{count}} working',
    working_few: '{{count}} working',
    working_many: '{{count}} working',
    working_other: '{{count}} working',
    waiting_one: '{{count}} waiting',
    waiting_few: '{{count}} waiting',
    waiting_many: '{{count}} waiting',
    waiting_other: '{{count}} waiting',
    workingTitle: 'Agents at work',
    waitingTitle: 'Waiting on you',
    nobodyWorking: 'No agent is working.',
    nobodyWaiting: 'Nothing is waiting on you.',
    requests_one: '{{count}} pull request',
    requests_few: '{{count}} pull requests',
    requests_many: '{{count}} pull requests',
    requests_other: '{{count}} pull requests',
    needsAction_one: '{{count}} needs action',
    needsAction_few: '{{count}} need action',
    needsAction_many: '{{count}} need action',
    needsAction_other: '{{count}} need action',
    ready_one: '{{count}} ready to merge',
    ready_few: '{{count}} ready to merge',
    ready_many: '{{count}} ready to merge',
    ready_other: '{{count}} ready to merge',
    requestsTitle: 'Open pull requests',
    needsActionTitle: 'Pull requests that need action',
    readyTitle: 'Pull requests ready to merge',
    noRequests: 'No workspace has an open pull request.',
    noneNeedsAction: 'Nothing needs your action.',
    noneReady: 'Nothing is ready to merge yet.',
    request: '#{{number}}',
    pending: 'In progress',
    checksFailed: 'a check failed',
    changesRequested: 'changes requested',
    conflict: 'merge conflict',
    turn: '{{chat}} · {{elapsed}}',
    resources: 'CPU {{cpu}} · {{memory}}',
    resourcesTitle: 'What octopus is using',
    resourcesReading: 'Measuring…',
    app: 'octopus itself',
    agent: 'agent',
    server: 'server',
    terminal: 'terminal',
    part: '{{kind}} {{memory}}'
  },

  plugins: {
    title: 'Plugins',
    troubleDot: 'A plugin would not load',
    tabInstalled: 'Installed',
    tabInstalledCount: 'Installed · {{count}}',
    tabStore: 'Store',
    userLayerOff:
      'Settings → Agent leaves your user settings out, and that is where plugins installed for every project are switched on. They stay installed, but conversations here will not load them.',
    openAgentSettings: 'Open Agent settings',
    applied_one: 'Applied to {{count}} open conversation.',
    applied_few: 'Applied to {{count}} open conversations.',
    applied_many: 'Applied to {{count}} open conversations.',
    applied_other: 'Applied to {{count}} open conversations.',
    appliedNone: 'Applied. Conversations started from now on will load it.',
    searchInstalled: 'Filter installed plugins',
    searchStore: 'Search plugins by name, description or keyword',
    loading: 'Reading plugins…',
    noneInstalled: 'No plugins yet',
    noneInstalledHint:
      'Plugins add skills, commands, agents and tools to Claude Code. Find one in the store.',
    browseStore: 'Browse the store',
    noMatch: 'Nothing matches “{{query}}”.',
    scope: {
      user: 'All projects',
      project: 'Project',
      local: 'Project, just you',
      managed: 'Managed'
    },
    switchLabel: 'Use {{name}}',
    stateOn: 'On',
    stateOff: 'Off',
    managedNote: 'Set up by your organisation, so it cannot be changed here.',
    unreachableNote:
      'Claude Code did not say where this one is installed, so it cannot be changed here.',
    homepage: 'Homepage',
    remove: 'Remove {{name}}',
    removeTitle: 'Remove plugin?',
    removeMessage: 'Remove “{{name}}”?',
    removeDetail:
      'Its data directory goes with it — its settings and anything it stored. Open conversations stop using it at once.',
    removeConfirm: 'Remove',
    cancel: 'Cancel',
    loadErrors: 'Would not load: {{errors}}',
    components: {
      skills: 'Skills',
      commands: 'Commands',
      agents: 'Agents',
      hooks: 'Hooks',
      mcp: 'MCP',
      lsp: 'LSP'
    },
    allCategories: 'All',
    categoriesLabel: 'Categories',
    categories: {
      development: 'Development',
      productivity: 'Productivity',
      database: 'Databases',
      monitoring: 'Monitoring',
      security: 'Security',
      deployment: 'Deployment',
      design: 'Design',
      automation: 'Automation',
      learning: 'Learning',
      location: 'Location',
      testing: 'Testing',
      math: 'Maths',
      migration: 'Migration'
    },
    otherCategory: 'Other',
    installs_one: '{{formatted}} install',
    installs_few: '{{formatted}} installs',
    installs_many: '{{formatted}} installs',
    installs_other: '{{formatted}} installs',
    install: 'Install',
    installing: 'Installing…',
    installed: 'Installed',
    by: 'by {{author}}',
    from: 'From {{marketplace}}',
    version: 'Version {{version}}',
    noDescription: 'No description.',
    closeDetails: 'Close details',
    trustNote:
      'A plugin runs with the same access as Claude Code: its hooks and servers run commands on this machine. Install only what you trust.',
    consentTitle: 'Run this command?',
    consentMessage:
      '“{{name}}” is installed by running a command its marketplace supplies. Read it before going on.',
    consentConfirm: 'Run it and install',
    connectTitle: 'The store is empty',
    connectHint:
      'The official Claude Code marketplace is not connected on this machine yet. Connecting it downloads its catalogue from GitHub.',
    connect: 'Connect the official marketplace',
    connecting: 'Connecting…',
    refresh: 'Check the official marketplace for new plugins',
    catalogFailedTitle: 'The store could not be read',
    catalogFailedHint: 'Claude Code did not answer with the list of plugins. The reason is above.',
    retry: 'Try again'
  },

  tips: {
    headsUp: 'Heads up',
    learnMore: 'Learn more',
    showLess: 'Show less',
    addToChat: 'Add to chat',
    knewIt: 'Knew this already',
    dismiss: 'Dismiss',
    rewindSkipsCommands: {
      title:
        'Rewinding files undoes only what the agent changed with its editing tools. Changes made by commands in the terminal stay.',
      detail:
        'Files are saved for a rewind when the agent edits them with Edit or Write. A command — a formatter, a code generator, git checkout, rm — changes files past those saves, so a rewind will not touch what it did. Before a command you may want to undo, commit or stash your work; the Changes tab shows what the files have gained and lost.'
    }
  },
  errors: {
    pluginCliUnavailable: 'Claude Code could not be run: {{message}}',
    pluginTimedOut:
      'Claude Code did not finish within {{seconds}} seconds. A slow network is the usual reason — try again.',
    pluginActionFailed: 'Claude Code refused: {{message}}',
    pluginOutputUnreadable: 'Claude Code answered with something unexpected: {{message}}',
    pluginNotInstalled: 'That plugin is no longer installed there. The list has been read again.',
    pluginProjectMissing: 'The project this plugin belongs to is gone: {{path}}',
    /* Commands and subagents. Each says what the reader can do about it, which
       for a name is "choose another" and for a document is "it is not one". */
    libraryNameInvalid:
      '\u201c{{name}}\u201d cannot be a name: use lowercase letters, digits, dashes and underscores. The name becomes a filename, and on this filesystem \u201cShip\u201d and \u201cship\u201d would be the same one.',
    libraryExists:
      'Something called \u201c{{name}}\u201d is already here, or in the store beside it.',
    libraryMissing: 'That file is not there any more.',
    libraryTooLarge: 'It is longer than {{limit}} characters, which is more than a prompt.',
    libraryUrlRefused:
      '\u201c{{url}}\u201d could not be read. Only https addresses answering with one markdown file are fetched.',
    librarySubagentNeedsDescription:
      'A subagent needs frontmatter with a description saying when to use it, or the agent will never reach for it.',
    branchMissing:
      'That repository has no branch called \u201c{{branch}}\u201d. Choose a base branch it does have before pointing the project at it.',
    draftFailed: 'The description could not be drafted: {{reason}}',
    trustChanged:
      'What the repository supplies changed after it was shown, so it was not allowed. Here is what is there now \u2014 read it again before allowing it.',
    /* Not a failure to reach the agent — it answered, and the answer had no
       title and body in it. Says what to do, because trying again is usually
       all it takes and nothing here is broken. */
    draftUnreadable:
      'The agent answered, but not with a title and a description. Try again, or write them yourself.',
    envProfileExists: 'This project already has a set of variables called \u201c{{name}}\u201d.',
    envProfileMissing: 'There is no set of variables called \u201c{{name}}\u201d any more.',
    envProfileName:
      '\u201c{{name}}\u201d cannot be the name of a set: use lowercase letters, digits and dashes, starting with a letter or a digit. The name becomes a filename, and on this filesystem \u201cProd\u201d and \u201cprod\u201d would be the same one.',
    repoPathHasWorkspaces:
      'This project still has workspaces, and each is a git worktree registered in its current repository. Remove them before pointing it somewhere else.',
    repoPathTaken: '\u201c{{name}}\u201d already uses that repository.',
    repoPathRelative: '{{path}} is not an absolute path.',
    repoPathEmpty: 'A repository path cannot be empty.',
    envFileEscapes:
      '{{path}} is not inside the workspace. The variables are written into the worktree, so the file has to sit in it.',
    envFileEmpty: 'An env file name cannot be empty.',
    /* The reason is zod's own sentence rather than one of ours: this frame
       covers every bounded field, and the useful half — which limit was
       exceeded — is what the issue already says. Before it, the whole of what
       reached the window was `JSON.stringify(issues)`. */
    valueRefused: 'That value was refused: {{reason}}',
    /* A file on disk this app wrote and can no longer read: a corrupt
       `state.json`, or one from a version that stored something else. Names
       the file, because the reader may want to move it aside. */
    fileUnreadable: '{{path}} could not be read: {{issues}}',
    notARepository: '{{path}} is not a git repository.',
    emptyRepository:
      '{{path}} has no commits yet. Make an initial commit — a worktree cannot be created without one.',
    noBaseBranch:
      'Could not determine a base branch in {{path}}. Check out the branch you want and try again.',
    baseUnknown:
      'Could not find where this workspace branched off {{branch}}. The branch may have been renamed or deleted — check the project settings.',
    notRemoved: '{{path}} is still there: it could not be removed.',
    duplicateProject: 'This repository is already added as project "{{name}}".',
    notConnected: 'Could not reach GitHub. Check the account in Settings.',
    listFailed: 'GitHub returned something unexpected.',
    cloneFailed: 'Could not clone {{repository}}.',
    noCommits: 'This branch has nothing that {{base}} does not.',
    pushFailed: 'Could not push {{branch}}. Git said: {{reason}}',
    fetchFailed:
      'Could not fetch {{remote}}, so this workspace would start from a base branch that is behind. Git said: {{reason}}',
    envPathEscapes:
      '{{file}} leaves this workspace through a symbolic link, so the variables would be written outside it. Point the project at a file the worktree really holds, or remove the link.',
    createFailed: 'Could not open the pull request. GitHub said: {{reason}}',
    strayStopFailed: 'Process {{pid}} would not stop. Stop it yourself, then run again.',
    nothingToCommit: 'There is nothing here to commit.',
    nothingToAmend: 'This branch has no commit of its own to amend.',
    remoteAhead:
      'GitHub has commits on this branch that are not here yet, so the last commit was left alone. Pull them in the terminal first.',
    commitFailed: 'Could not commit the changes. Git said: {{reason}}',
    mergeFailed: 'GitHub would not merge #{{number}}. It said: {{reason}}',
    /* Refused before `gh` was asked to do anything. Names both branches,
       because the reader's question is which request the button was about — and
       the number alone cannot answer it. */
    requestNotOnBranch:
      'Pull request #{{number}} is on {{head}}, not on this workspace\u2019s {{branch}}. Nothing was done.',
    /* Refused before anything was committed. Committing lands on whatever the
       worktree has checked out while pushing sends a name, so apart the two put
       the work on one branch and send another — and both report success. */
    headNotOnBranch:
      'HEAD is not on this workspace\u2019s branch {{branch}}. Nothing was committed or pushed \u2014 check it out in the terminal first.',
    closeFailed: 'GitHub would not close #{{number}}. It said: {{reason}}',
    nothingToRerun: 'No GitHub Actions run of #{{number}} can be re-run right now.',
    rerunFailed: 'GitHub would not re-run the checks of #{{number}}. It said: {{reason}}',
    /* No number on either: a reply and a resolve are addressed to a thread, and
       the thread is what the reader is looking at when one of them fails. */
    replyFailed: 'GitHub would not post the reply. It said: {{reason}}',
    /* A paste, always: a file chosen or dragged in is never copied, so its size
       and its type are somebody else's business. */
    attachmentTooLarge: 'That image is over {{limit}} MB. Save it and attach the file instead.',
    attachmentType: 'octopus cannot attach a {{type}}. Save it and attach the file instead.',
    resolveFailed: 'GitHub would not change the thread. It said: {{reason}}',
    alreadyExists: '{{path}} already exists. Add it from disk instead.',
    branchUnmerged:
      '{{branch}} has commits that are not in the base branch. Remove it with the branch checkbox cleared, or merge it first.',
    branchExists: 'A branch named {{branch}} already exists.',
    slugTaken:
      'Another workspace, \u201c{{name}}\u201d, already names the database {{slug}}. Two workspaces sharing one write over each other\u2019s data. Choose a name that differs by more than a dash or a dot.',
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
    rewindBusy: 'The agent is working. Stop it before rewinding.',
    rewindUnavailable: 'This conversation cannot be rewound to that message.',
    rewindUnavailableReason: 'This conversation cannot be rewound to that message: {{reason}}',
    rewindInProgress: 'This conversation is being rewound. Wait for it to finish.',
    chatClosed: 'That conversation was closed. Reopen it from the history first.',
    autoModeUnavailable: 'Auto mode is not available here: {{reason}}',
    turnRunning: 'The agent is still working. Wait for it to finish, then press the button again.',
    sideQuestionUnsupported:
      'This version of Claude Code cannot answer side questions. Update it and try again.',
    sideQuestionFailed: 'The side question could not be answered: {{reason}}',
    sideQuestionTimedOut: 'The side question took too long and was given up. Try again.',
    pushTargetChanged:
      '{{branch}} was not pushed: origin now pushes to {{current}}, not where it did when you pressed the button.',
    repoConfigSymlink:
      '{{path}} is a symbolic link. octopus will not read or write through one, because it can point anywhere outside the repository.',
    repoConfigTooLarge: '{{path}} is larger than this kind of file is allowed to be.',
    repoConfigMalformed: '{{path}} does not describe a project.',
    skillNameInvalid:
      '\u201c{{name}}\u201d cannot be the name of a skill: use lowercase letters, digits and single dashes. The name becomes the folder the skill lives in.',
    skillNameMismatch:
      'The document names \u201c{{found}}\u201d, but this skill is filed as \u201c{{name}}\u201d. Rename it in the document, or import it as a new skill.',
    skillExists: 'A skill called \u201c{{name}}\u201d is already here.',
    skillMissing: 'That skill is no longer there.',
    skillFrontmatterMissing:
      'A SKILL.md needs frontmatter naming the skill and saying when to use it. This one has none that could be read.',
    skillTooLarge:
      'That is larger than one skill has any business being, so nothing was written. The limit is {{limit}}.',
    skillLinkRefused:
      '\u201c{{name}}\u201d is a symbolic link. A skill is copied as it stands, and a link would make what this holds a question about somewhere else on the disk.',
    skillUrlRefused:
      'Nothing could be fetched from {{url}}. Only https addresses are followed, and a redirect off https is refused.',
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
