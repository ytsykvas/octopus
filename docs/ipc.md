# IPC

Every call from the interface to the rest of the application goes through one
of 35 channels. The table lives in [`src/main/ipc.ts`](../src/main/ipc.ts); the
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

| Channel                  | Arguments     | Notes                                                    |
| ------------------------ | ------------- | -------------------------------------------------------- |
| `projects:list`          | —             |                                                          |
| `projects:add`           | —             | opens a directory picker; `null` means cancelled         |
| `projects:addFromGitHub` | `repository`  | asks for a destination the first time, then remembers it |
| `projects:update`        | `id`, `patch` | patch validated with `ProjectPatchSchema`                |
| `projects:remove`        | `id`          | deletes the workspaces and their branches too            |
| `projects:branches`      | `id`          | remote branches, ordered with main/master/develop first  |
| `projects:listRemote`    | —             | through the `gh` CLI                                     |

### Scripts and instructions

| Channel             | Arguments            | Notes                                     |
| ------------------- | -------------------- | ----------------------------------------- |
| `scripts:read`      | `id`, `kind`         | a missing script comes back as a template |
| `scripts:save`      | `id`, `kind`, `body` | written executable                        |
| `scripts:paths`     | `id`                 | `null` where nothing has been written     |
| `instructions:read` | `id`, `kind`         |                                           |
| `instructions:save` | `id`, `kind`, `body` |                                           |

### Workspaces

| Channel                 | Arguments       | Notes                                  |
| ----------------------- | --------------- | -------------------------------------- |
| `workspaces:list`       | `projectId`     | reconciled against `git worktree list` |
| `workspaces:create`     | `projectId`     |                                        |
| `workspaces:rename`     | `id`, `name`    | moves the branch, never the directory  |
| `workspaces:remove`     | `id`, `options` | `force` discards uncommitted work      |
| `workspaces:hasChanges` | `id`            | asked before offering to remove        |

### The agent chat

| Channel            | Arguments             | Notes                                                 |
| ------------------ | --------------------- | ----------------------------------------------------- |
| `chats:list`       | `workspaceId`         | empty until someone writes; creates nothing           |
| `chats:open`       | `workspaceId`         | the chat, created on first use                        |
| `chats:history`    | `chatId`              | the transcript, as it will be redrawn after a restart |
| `chats:send`       | `chatId`, `text`      | answers immediately; the reply arrives as events      |
| `chats:interrupt`  | `chatId`              | stops the turn, leaves the session open               |
| `chats:mode`       | `chatId`, `mode`      | applies to the running session as well as the record  |
| `chats:permission` | `requestId`, `answer` | the agent is blocked until this arrives               |
| `chats:rateLimit`  | —                     | the last reading; `null` before a turn has run        |

Events flow the other way, on `chats:event`, carrying `{ chatId, workspaceId,
event }`. A **broadcast**, not a reply to whoever asked: events keep arriving
long after the call that started them returned, and a second window on the same
workspace should see the same conversation.

Listing and opening are separate on purpose. A workspace nobody has spoken to
should have no record and no transcript file, so the pane looks the chat up
without creating one — the first message is what brings it into being.

### Terminals

| Channel            | Arguments            | Notes                                                     |
| ------------------ | -------------------- | --------------------------------------------------------- |
| `terminal:create`  | `spec`               | answers with a session id                                 |
| `terminal:write`   | `id`, `data`         |                                                           |
| `terminal:resize`  | `id`, `cols`, `rows` | a resize after the session ended is ignored, not an error |
| `terminal:dispose` | `id`                 |                                                           |

Output flows the other way, on `terminal:data` and `terminal:exit`.

### Accounts and dialogs

| Channel                | Arguments       | Notes                                                    |
| ---------------------- | --------------- | -------------------------------------------------------- |
| `accounts:status`      | —               | asks the `claude` and `gh` CLIs                          |
| `accounts:signOut`     | `kind`, `login` | signing in is interactive and runs in a terminal instead |
| `dialog:pickDirectory` | `title`         | `null` when cancelled                                    |

## Validation

**Every argument that becomes a path, a process argument or a file is parsed
with zod before it goes anywhere.** TypeScript guarantees nothing across a
process boundary: the renderer is a separate process that displays agent
output, and a compromised or simply buggy one must not reach a command line.

| Argument               | Schema                                             |
| ---------------------- | -------------------------------------------------- |
| project patch          | `ProjectPatchSchema`                               |
| script kind, body      | `ScriptKindSchema`, `ScriptBodySchema`             |
| instruction kind, body | `InstructionKindSchema`, `InstructionBodySchema`   |
| terminal spec          | `TerminalSpecSchema`                               |
| account kind           | `AccountKindSchema`                                |
| chat message           | `ChatMessageSchema` — bounded; it becomes a prompt |
| permission mode        | `PermissionModeSchema`                             |
| permission answer      | `PermissionAnswerSchema`                           |

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
`prefersDark`, `broadcastTheme`, `broadcastChatEvent` — instead of importing
Electron. A test then supplies six small functions rather than a framework, and
the whole table can be exercised without a window. It is the same reasoning that
keeps the core headless, applied to the process that talks to it.
