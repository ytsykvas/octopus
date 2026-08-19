# IPC

Every call from the interface to the rest of the application goes through one
of 58 channels. The table lives in [`src/main/ipc.ts`](../src/main/ipc.ts); the
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

| Channel                  | Arguments     | Notes                                                                                   |
| ------------------------ | ------------- | --------------------------------------------------------------------------------------- |
| `projects:list`          | —             |                                                                                         |
| `projects:add`           | —             | opens a directory picker; `null` means cancelled                                        |
| `projects:addFromGitHub` | `repository`  | asks for a destination the first time, then remembers it                                |
| `projects:update`        | `id`, `patch` | patch validated with `ProjectPatchSchema`                                               |
| `projects:remove`        | `id`          | deletes the workspaces and their branches too                                           |
| `projects:branches`      | `id`          | remote branches, ordered with main/master/develop first                                 |
| `projects:listRemote`    | —             | what the account can push to, personal and organisation alike, through `gh api graphql` |

### Scripts, carried files and instructions

| Channel                  | Arguments             | Notes                                                                                                                                        |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts:read`           | `id`, `kind`          | a missing script comes back as a template                                                                                                    |
| `scripts:save`           | `id`, `kind`, `body`  | written executable                                                                                                                           |
| `scripts:paths`          | `id`                  | `null` where nothing has been written                                                                                                        |
| `carry:read`             | `id`                  | one path per line; a project that has said nothing gets a list naming `.env`                                                                 |
| `carry:save`             | `id`, `body`          | the list, not the files                                                                                                                      |
| `carry:apply`            | `workspaceId`         | copies them from the checkout, never over a file already there; answers with what it wrote                                                   |
| `workspaces:serving`     | `workspaceId`         | whether anything is listening on the port this workspace was given                                                                           |
| `instructions:read`      | `id`, `kind`          | `null` id is the installation's own                                                                                                          |
| `instructions:save`      | `id`, `kind`, `body`  | same, and it needs no project to exist                                                                                                       |
| `instructions:effective` | `workspaceId`, `kind` | what this workspace would send: its project's, or the installation's. Resolved in core so the renderer need not know the order and ask twice |

### Workspaces

| Channel                        | Arguments                | Notes                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspaces:list`              | `projectId`              | reconciled against `git worktree list`                                                                                                                                                                                                              |
| `workspaces:create`            | `projectId`              |                                                                                                                                                                                                                                                     |
| `workspaces:rename`            | `id`, `name`             | moves the branch, never the directory                                                                                                                                                                                                               |
| `workspaces:remove`            | `id`, `options`          | `force` discards uncommitted work                                                                                                                                                                                                                   |
| `workspaces:hasChanges`        | `id`                     | asked before offering to remove                                                                                                                                                                                                                     |
| `workspaces:diff`              | `id`                     | everything changed since the base branch                                                                                                                                                                                                            |
| `workspaces:pullRequest`       | `workspaceId`            | what has become of the branch on GitHub, if anything — `gh pr list --head` plus what git knows about the remote. Read on opening the tab, never behind one: this one leaves the machine                                                             |
| `workspaces:createPullRequest` | `workspaceId`, `request` | pushes the branch if it needs it, then opens the request; answers with its URL. The title and body are the user's and are bounded here, because both become arguments to `gh`. The base branch comes from the project rather than from the renderer |

### Files

| Channel      | Arguments    | Notes                                                |
| ------------ | ------------ | ---------------------------------------------------- |
| `files:open` | `id`, `path` | the path is validated and proved inside the worktree |

### The agent chat

| Channel                 | Arguments                          | Notes                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chats:list`            | `workspaceId`                      | empty until someone writes; creates nothing                                                                                                                                                                                                         |
| `chats:open`            | `workspaceId`                      | the chat, created on first use                                                                                                                                                                                                                      |
| `chats:create`          | `workspaceId`                      | an **additional** conversation; refuses past three. Separate from opening rather than a flag on it: opening is idempotent and answers "the conversation to write into", while this one always writes a record, which is the whole request           |
| `chats:fork`            | `chatId`                           | a new conversation continuing this one. Forks the agent's session through the SDK and copies the transcript; refuses one that has never run                                                                                                         |
| `chats:close`           | `chatId`                           | ends a conversation and discards it, transcript included. Refuses the last one of a workspace — emptying the only conversation is `/clear`, which leaves the pane with something to draw                                                            |
| `chats:rename`          | `chatId`, `title`                  | names a conversation. The one of these four carrying something the user typed, so it is parsed and bounded; an empty name is a request rather than a refusal — the conversation goes back to the name it is given                                   |
| `chats:history`         | `chatId`                           | the transcript, as it will be redrawn after a restart                                                                                                                                                                                               |
| `chats:send`            | `chatId`, `text`                   | answers immediately; the reply arrives as events                                                                                                                                                                                                    |
| `chats:interrupt`       | `chatId`                           | stops the turn, leaves the session open                                                                                                                                                                                                             |
| `chats:mode`            | `chatId`, `mode`                   | how freely the agent works once it is working; applies to the running session as well as the record. Refuses `plan` — that is the channel below                                                                                                     |
| `chats:planMode`        | `chatId`, `planning`               | whether the next message is asked for a plan first. Its own channel because it is its own stored field, not a third value of the mode above                                                                                                         |
| `chats:effort`          | `chatId`, `effort`                 | same shape as the mode; refuses `null`, which used to mean "leave it to the agent" — a chat always names a level now, and the level shown is the level sent. Parsed against the **wider** of core's two schemas, since `ultracode` crosses here too |
| `chats:model`           | `chatId`, `model`                  | the model the chat writes code with; same shape as the mode, and `null` hands the choice back to the agent                                                                                                                                          |
| `chats:planModel`       | `chatId`, `model`                  | the model it plans with; `null` here means "no split", not "the agent's default" — that is said with the word `default`. One character from `chats:planMode` above, which the channel list in `ipc.test.ts` and the one in `preload` are what catch |
| `chats:models`          | —                                  | what the agent last reported the account may use; empty until a session has run                                                                                                                                                                     |
| `chats:commands`        | `chatId`                           | the slash commands this chat may use, for the composer's suggestion list. Per chat rather than application-wide, unlike the models above: a project's own commands live in its `.claude/commands/`                                                  |
| `chats:usage`           | `chatId`                           | what the running session says about its context window and the account's; a chat with no session answers nulls rather than starting one                                                                                                             |
| `chats:pending`         | `chatId`                           | what the agent is blocked on, or `null`. Asked on opening a conversation because `permission_request` goes out once — a window that missed it would show a chat busy for ever with no way to answer                                                 |
| `chats:answerQuestions` | `requestId`, `answers`             | answers the agent's own questions. Not a permission — the user hands over information rather than saying whether the agent may act — and the answers reach the tool as a modified copy of its own arguments, which is the only way in it has        |
| `chats:permission`      | `requestId`, `answer`, `feedback?` | the agent is blocked until this arrives. `feedback` accompanies a refusal and reaches the agent as the reason — how the plan dialog's "keep planning" sends a correction without costing a turn                                                     |
| `chats:rateLimit`       | —                                  | the last reading; `null` before a turn has run                                                                                                                                                                                                      |

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

None of the three is a `handle`, so none is counted among the channels above.

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
importing Electron. A test then supplies seven small functions rather than a
framework, and
the whole table can be exercised without a window. It is the same reasoning that
keeps the core headless, applied to the process that talks to it.
