# IPC

Every call from the interface to the rest of the application goes through one
of the channels below. The table lives in [`src/main/ipc.ts`](../src/main/ipc.ts); the
renderer never names a channel itself, it calls
[`src/preload/index.ts`](../src/preload/index.ts).

## The shape of every answer

```ts
type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; code?: string; params?: Record<string, string> }
```

Handlers do not throw. `attempt` in [`src/main/result.ts`](../src/main/result.ts)
catches and converts, because an exception crossing IPC arrives as an opaque
Electron error with the original message mangled — the renderer could say
nothing useful about it.

`code` is what makes a failure explainable: `useErrorMessage` maps it to a
localised string. `error` is the English text, kept as a fallback for logs and
for codes that have no translation yet.

The only channel outside this shape is `theme:get`, which cannot fail.

## The channels

### Theme and config

| Channel         | Arguments | Notes                                      |
| --------------- | --------- | ------------------------------------------ |
| `theme:get`     | —         | resolves `system` against the OS           |
| `config:get`    | —         |                                            |
| `config:update` | `patch`   | broadcasts `theme:changed` to every window |

### Projects

| Channel                  | Arguments     | Notes                                                                                                                                                  |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `projects:list`          | —             |                                                                                                                                                        |
| `projects:add`           | —             | opens a directory picker; `null` means cancelled                                                                                                       |
| `projects:addFromGitHub` | `repository`  | asks for a destination the first time, then remembers it                                                                                               |
| `projects:update`        | `id`, `patch` | patch validated with `ProjectPatchSchema`                                                                                                              |
| `projects:remove`        | `id`          | runs each workspace's cleanup script, then deletes the workspaces, their branches, and the project's directory under the data root                     |
| `projects:branches`      | `id`          | remote branches, ordered with main/master/develop first                                                                                                |
| `projects:pullRequests`  | `id`          | every branch of the repository that has a request, in one call — the workspace list marks each row, and a read per row would be a network call per row |
| `projects:listRemote`    | —             | what the account can push to, personal and organisation alike, through `gh api graphql`                                                                |

### Scripts, carried files and instructions

| Channel                  | Arguments             | Notes                                                                                                                                                                                                                      |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts:read`           | `id`, `kind`          | a missing script comes back as a template                                                                                                                                                                                  |
| `scripts:save`           | `id`, `kind`, `body`  | written executable                                                                                                                                                                                                         |
| `scripts:paths`          | `id`                  | the project's **own** copies, for the editors in Project settings; `null` where nothing has been written. What actually runs is `scripts:resolved`                                                                         |
| `carry:read`             | `id`                  | one path per line; a project that has said nothing gets a list naming `.env`                                                                                                                                               |
| `carry:save`             | `id`, `body`          | the list, not the files                                                                                                                                                                                                    |
| `repoConfig:read`        | `id`                  | what `.octopus/` in the repository carries, beside what the app holds; and whether git ignores the folder                                                                                                                  |
| `repoConfig:import`      | `id`, `ids`           | writes the named items into the installation; ids parsed against the known list before any of them reaches a path                                                                                                          |
| `repoConfig:export`      | `id`, `ids`           | writes the named items into `.octopus/`; the only channel that writes inside a checkout                                                                                                                                    |
| `env:profiles`           | `projectId`           | the named sets this project holds, and which it uses by default; the default is unioned in so a picker always has a selection                                                                                              |
| `env:read`               | `id`, `name`          | the project's env overrides; empty where it has none, since a variable nobody wrote has no value worth guessing at                                                                                                         |
| `env:save`               | `id`, `name`, `body`  | validated for length, written `0o600`                                                                                                                                                                                      |
| `env:create`             | `id`, `name`, `from`  | adds one, empty or copied from another                                                                                                                                                                                     |
| `env:rename`             | `id`, `from`, `to`    | renames the file and moves every reference to it in one commit                                                                                                                                                             |
| `env:remove`             | `id`, `name`          | deletes it; workspaces on it go back to following the project, and the project falls to what is left                                                                                                                       |
| `workspaces:envProfile`  | `workspaceId`, `name` | puts one workspace on a set of its own; `null` puts it back to following                                                                                                                                                   |
| `workspace:prepare`      | `workspaceId`         | carries the listed files in, never over a file already there, then writes the env block below them; answers with what it copied                                                                                            |
| `env:ignored`            | `id`                  | whether git would keep the env file out of a commit — asked of the checkout, whose `.gitignore` every worktree shares                                                                                                      |
| `instructions:sources`   | `id`, `workspaceId`   | what the project offers the agent and what it will actually read; answered for the worktree a session would run in, `null` for the checkout                                                                                |
| `workspace:env`          | `workspaceId`         | the workspace's env file as it stands, `null` where it has none. The file, never a reconstruction                                                                                                                          |
| `workspaces:serving`     | `workspaceId`         | whether anything is listening on the port this workspace was given                                                                                                                                                         |
| `trust:read`             | `workspaceId`         | the files this worktree grants the agent something with, and whether they have been approved. A worktree that grants nothing digests to the empty string and needs no approval, which is most repositories                 |
| `trust:approve`          | `workspaceId`         | records the digest against the project, as a set, so moving between two branches whose settings differ does not ask on every switch                                                                                        |
| `scripts:resolved`       | `workspaceId`         | which script runs for each kind in this worktree, where it came from, and whether the ones the repository supplies have been read                                                                                          |
| `scripts:approve`        | `workspaceId`         | records that digest, in a list of its own — what the agent may load and what Run may execute are different questions                                                                                                       |
| `workspaces:port`        | `workspaceId`         | settles the port before a run, since a block free when the workspace was made can be taken by then. Called only while nothing of this workspace is alive, which is what lets it read anything answering as somebody else's |
| `instructions:read`      | `id`, `kind`          | `null` id is the installation's own                                                                                                                                                                                        |
| `instructions:save`      | `id`, `kind`, `body`  | same, and it needs no project to exist                                                                                                                                                                                     |
| `instructions:effective` | `workspaceId`, `kind` | what this workspace would send: its project's, or the installation's. Resolved in core so the renderer need not know the order and ask twice                                                                               |

### Skills

| Channel               | Arguments                  | Notes                                                                                                                                                                                              |
| --------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `skills:list`         | `store`                    | what one of the two stores holds. `store` is `{ kind: 'global' }` or `{ kind: 'project', projectId }`, parsed before it becomes a path                                                             |
| `skills:read`         | `store`, `name`            | the form's two fields and the whole document. The name is parsed with `SkillNameSchema`, which is what refuses `..` — this becomes a directory                                                     |
| `skills:save`         | `store`, `name`, `save`    | `{ kind: 'form', content }` keeps frontmatter the form never saw; `{ kind: 'raw', text }` writes the document as given                                                                             |
| `skills:remove`       | `store`, `name`            | the skill's whole folder, references and all                                                                                                                                                       |
| `skills:import`       | `store`, `request`         | a folder or a lone `SKILL.md` from disk, pasted text, or one document over `https`                                                                                                                 |
| `skills:inRepository` | `workspaceId`              | what the checkout carries in `.claude/skills`, so one can be copied out. Listed whatever the Agent setting says: these are files that are there either way                                         |
| `skills:forChat`      | `chatId`                   | every skill this conversation could use and whether it is on — three sources over two lists of defaults over the chat's own answer, resolved in core because a window would have to ask four times |
| `skills:forWorkspace` | `workspaceId`              | the same before the first message. `openChat` is lazy, so a fresh workspace has no conversation to ask about — and that is exactly where the panel is opened first                                 |
| `skills:setForChat`   | `chatId`, `key`, `enabled` | switches one, and tells a running session at once rather than at its next start                                                                                                                    |

The default marks need no channel of their own: they are a field on the config
and a field on the project, so they travel on `config:update` and
`projects:update` like any other setting.

### Workspaces

| Channel                        | Arguments                         | Notes                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces:list`              | `projectId`                       | reconciled against `git worktree list`                                                                                                                                                                                                                                                                                |
| `workspaces:create`            | `projectId`                       | fetches the base branch first; refuses when the remote cannot be reached                                                                                                                                                                                                                                              |
| `workspaces:rename`            | `id`, `name`                      | moves the branch, never the directory                                                                                                                                                                                                                                                                                 |
| `workspaces:remove`            | `id`, `options`                   | `force` discards uncommitted work                                                                                                                                                                                                                                                                                     |
| `workspaces:hasChanges`        | `id`                              | asked before offering to remove                                                                                                                                                                                                                                                                                       |
| `workspaces:diff`              | `id`                              | everything changed since the base branch                                                                                                                                                                                                                                                                              |
| `workspaces:revertFile`        | `id`, `path`, `oldPath`           | puts one file back to the state the workspace branched from, which is the pane's own scope — committed work is undone as a working-tree change and the commits stand. Both paths are parsed here: one becomes a git argument, the other a file to unlink. `oldPath` is the far end of a rename, one row and two paths |
| `workspaces:pullRequest`       | `workspaceId`                     | what has become of the branch on GitHub, if anything — `gh pr list --head` plus what git knows about the remote. Read on opening the tab, never behind one: this one leaves the machine                                                                                                                               |
| `workspaces:createPullRequest` | `workspaceId`, `request`          | commits everything under the message given, if one is, then pushes and opens the request; answers with its URL. The title, body and commit message are the user's and are bounded here, because all three become arguments. The base branch comes from the project rather than from the renderer                      |
| `workspaces:pullRequestDetail` | `workspaceId`, `number`           | the checks, the review and the mergeability of a request that exists — `gh pr view` plus a GraphQL query for the review threads. Apart from the read above because the two fail differently: that one failing means the branch cannot be described at all, this one leaves the number and the link worth drawing      |
| `workspaces:draftPullRequest`  | `workspaceId`                     | asks the agent for a title and a description, under the project's own instruction; stops at producing text, which the form then shows before anything reaches GitHub                                                                                                                                                  |
| `workspaces:commitAndPush`     | `workspaceId`, `message`          | commits everything here and pushes, to get an answer to a review onto a request that already exists                                                                                                                                                                                                                   |
| `workspaces:closePullRequest`  | `workspaceId`, `number`           | closes the request without merging, and deliberately not with `--delete-branch`: the branch belongs to a workspace, and what happens to it is decided when the workspace is removed, by somebody shown what it would cost. Reversible on GitHub, which is why nothing asks twice                                      |
| `workspaces:mergePullRequest`  | `workspaceId`, `number`, `method` | `merge`, `squash` or `rebase`. Never deletes the branch: a worktree is checked out on it. Answers with nothing — `gh` enables auto-merge rather than merging when a required check has not passed, so the caller reads the request again                                                                              |

### Files

| Channel      | Arguments    | Notes                                                |
| ------------ | ------------ | ---------------------------------------------------- |
| `files:open` | `id`, `path` | the path is validated and proved inside the worktree |

### The agent chat

| Channel                     | Arguments                          | Notes                                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `chats:list`                | `workspaceId`                      | empty until someone writes; creates nothing                                                                                                                                                                                                                              |
| `chats:open`                | `workspaceId`                      | the chat, created on first use                                                                                                                                                                                                                                           |
| `chats:create`              | `workspaceId`                      | an **additional** conversation; refuses past three. Separate from opening rather than a flag on it: opening is idempotent and answers "the conversation to write into", while this one always writes a record, which is the whole request                                |
| `chats:fork`                | `chatId`                           | a new conversation continuing this one. Forks the agent's session through the SDK and copies the transcript; refuses one that has never run                                                                                                                              |
| `chats:close`               | `chatId`                           | ends a conversation and discards it, transcript included. Refuses the last one of a workspace — emptying the only conversation is `/clear`, which leaves the pane with something to draw                                                                                 |
| `chats:rename`              | `chatId`, `title`                  | names a conversation. The one of these four carrying something the user typed, so it is parsed and bounded; an empty name is a request rather than a refusal — the conversation goes back to the name it is given                                                        |
| `chats:history`             | `chatId`                           | the transcript, as it will be redrawn after a restart                                                                                                                                                                                                                    |
| `chats:send`                | `chatId`, `text`                   | answers immediately; the reply arrives as events                                                                                                                                                                                                                         |
| `chats:interrupt`           | `chatId`                           | stops the turn, leaves the session open                                                                                                                                                                                                                                  |
| `chats:mode`                | `chatId`, `mode`                   | how freely the agent works once it is working; applies to the running session as well as the record. Refuses `plan` — that is the channel below                                                                                                                          |
| `chats:planMode`            | `chatId`, `planning`               | whether the next message is asked for a plan first. Its own channel because it is its own stored field, not a third value of the mode above                                                                                                                              |
| `chats:effort`              | `chatId`, `effort`                 | same shape as the mode; refuses `null`, which used to mean "leave it to the agent" — a chat always names a level now, and the level shown is the level sent. Parsed against the **wider** of core's two schemas, since `ultracode` crosses here too                      |
| `chats:model`               | `chatId`, `model`                  | the model the chat writes code with; same shape as the mode, and `null` hands the choice back to the agent                                                                                                                                                               |
| `chats:planModel`           | `chatId`, `model`                  | the model it plans with; `null` here means "no split", not "the agent's default" — that is said with the word `default`. One character from `chats:planMode` above, which the channel list in `ipc.test.ts` and the one in `preload` are what catch                      |
| `chats:models`              | —                                  | what the agent last reported the account may use; empty until a session has run                                                                                                                                                                                          |
| `chats:commands`            | `chatId`                           | the slash commands this chat may use, for the composer's suggestion list. Per chat rather than application-wide, unlike the models above: a project's own commands live in its `.claude/commands/`                                                                       |
| `chats:usage`               | `chatId`                           | what the running session says about its context window and the account's; a chat with no session answers nulls rather than starting one                                                                                                                                  |
| `chats:pending`             | `chatId`                           | what the agent is blocked on, or `null`. Asked on opening a conversation because `permission_request` goes out once — a window that missed it would show a chat busy for ever with no way to answer                                                                      |
| `chats:answerQuestions`     | `requestId`, `answers`             | answers the agent's own questions. Not a permission — the user hands over information rather than saying whether the agent may act — and the answers reach the tool as a modified copy of its own arguments, which is the only way in it has                             |
| `chats:permission`          | `requestId`, `answer`, `feedback?` | the agent is blocked until this arrives. `feedback` accompanies a refusal and reaches the agent as the reason — how the plan dialog's "keep planning" sends a correction without costing a turn                                                                          |
| `chats:rateLimit`           | —                                  | the last reading; `null` before a turn has run                                                                                                                                                                                                                           |
| `chats:subscription`        | —                                  | the account's window shares, from the last reading the service kept — answered with no chat in the question, since the sidebar draws them and they belong to the account                                                                                                 |
| `chats:refreshSubscription` | —                                  | asks the account now rather than waiting for a turn — a press of the sidebar block, which is what makes reading it allowed. Starts a session if none is running; nothing is sent to the agent, so it costs no turn. `null` where there is no conversation to ask through |

Events flow the other way, on `chats:event`, carrying `{ chatId, workspaceId,
event }`. A **broadcast**, not a reply to whoever asked: events keep arriving
long after the call that started them returned, and a second window on the same
workspace should see the same conversation.

**`workspaces:status`** is the second stream, carrying
`{ workspaceId, status }` whenever a workspace starts working, stops, or blocks
on a question. A stream rather than something the list re-reads for itself:
re-reading asks git about every workspace of every project, several times a
turn, to learn what the main process had already decided. It says nothing about
a conversation, which is why it is not folded into the one above — the list that
draws it is not looking at a chat.

**`chats:status`** is the third, carrying `{ chatId, workspaceId, status }`.
The twin of the one above, a level in: the tab strip draws a conversation while
the list draws its workspace, and the two move at different moments — a second
conversation finishing leaves a workspace whose first is still running exactly
where it was. It is not folded into `chats:event` either, because that stream
carries `AgentEvent`, which is the isolation boundary around the SDK and the
shape written to the transcript — while half of these changes come from moments
no agent message describes: an interrupt, an answered permission, a closed tab.

**`usage:windows`** is the fourth, carrying the account's plan windows whenever
the service learns they moved. Pushed rather than left to be asked for, and
that is the whole of what stopped the block at the foot of the sidebar lagging:
it used to watch for a finished turn and then read a cache the chat pane was
still filling, so it drew the previous turn's figure on every turn.

None of the four is a `handle`, so none is counted among the channels above.

Listing and opening are separate on purpose. A workspace nobody has spoken to
should have no record and no transcript file, so the pane looks the chat up
without creating one — the first message is what brings it into being.

### Terminals

| Channel            | Arguments            | Notes                                                     |
| ------------------ | -------------------- | --------------------------------------------------------- |
| `terminal:create`  | `spec`               | answers with a session id                                 |
| `terminal:write`   | `id`, `data`         |                                                           |
| `terminal:resize`  | `id`, `cols`, `rows` | a resize after the session ended is ignored, not an error |
| `terminal:dispose` | `id`                 | resolves when the session has gone, not when it was asked |

Output flows the other way, on `terminal:data` and `terminal:exit`.

### Accounts and dialogs

| Channel                | Arguments       | Notes                                                    |
| ---------------------- | --------------- | -------------------------------------------------------- |
| `accounts:status`      | —               | asks the `claude` and `gh` CLIs, for the Settings card   |
| `accounts:github`      | —               | `gh` alone, on a short timeout: it sits behind a button  |
| `accounts:signOut`     | `kind`, `login` | signing in is interactive and runs in a terminal instead |
| `dialog:pickDirectory` | `title`         | `null` when cancelled                                    |
| `dialog:pickSkill`     | `title`         | a file **or** a folder: a skill arrives as either        |

## Validation

**Every argument that becomes a path, a process argument or a file is parsed
with zod before it goes anywhere.** TypeScript guarantees nothing across a
process boundary: the renderer is a separate process that displays agent
output, and a compromised or simply buggy one must not reach a command line.

| Argument               | Schema                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| project patch          | `ProjectPatchSchema`                                                                                                                |
| script kind, body      | `ScriptKindSchema`, `ScriptBodySchema`                                                                                              |
| instruction kind, body | `InstructionKindSchema`, `InstructionBodySchema` — the project id is deliberately not narrowed, `null` being the installation's own |
| terminal spec          | `TerminalSpecSchema`                                                                                                                |
| account kind           | `AccountKindSchema`                                                                                                                 |
| chat message           | `ChatMessageSchema` — bounded; it becomes a prompt                                                                                  |
| permission mode        | `PermissionModeSchema`                                                                                                              |
| permission answer      | `PermissionAnswerSchema`                                                                                                            |

Two related rules, both learned the hard way:

- external commands run through `execFile` with an argument array, **never**
  `exec` — a branch name reaching a shell is command injection;
- nothing is interpolated into a shell command or AppleScript source.

There is exactly one deliberate exception, and it is worth knowing rather than
tripping over. A terminal opened for a script may be given a `commandLine`
instead of an argv, and that string reaches `zsh -i -c` **as written** — because
what it carries is a command line, and quoting `bin/rails s -p $OCTOPUS_PORT`
would make the whole line the name of a program. It is not a hole in the rule
above so much as the reason the rule has a shape: the only strings that go that
way are ones a person or a repository wrote as a command, and a repository's is
shown before it runs (see [repo-config.md](repo-config.md)).

## Adding a channel

1. Register it in `main/ipc.ts` — validate anything that leaves the process.
2. Expose it in `preload/index.ts` with a type.
3. Add it to `EXPECTED` in `src/main/ipc.test.ts`, and to `CALLS` in
   `src/preload/index.test.ts`. Those two lists are what catch a name that
   drifts between the sides — a mismatch otherwise appears only at runtime, and
   says only _"no handler registered"_.
4. Add it to the stub in `src/renderer/src/test/octopus.ts`, which is typed as
   the real API, so omitting it is a compile error.

## Why the Electron surface is injected

`registerIpc` takes an `IpcHost` — `handle`, `showOpenDialog`, `windowFor`,
`prefersDark`, `broadcastTheme`, `broadcastChatEvent`, `openPath` — instead of
importing Electron. A test then supplies nine small functions rather than a
framework, and
the whole table can be exercised without a window. It is the same reasoning that
keeps the core headless, applied to the process that talks to it.
