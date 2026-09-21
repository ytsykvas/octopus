# The core

`src/core` holds every decision the application makes. It imports no Electron
and touches no DOM, so it is tested without launching anything — and could be
lifted into a CLI or a daemon without rewriting.

Coverage here is 100%, enforced. That is the floor, not the goal: see
[testing.md](testing.md) for why a fully covered function can still be untested.

## The modules

### Pure, safe to import from the renderer

Nothing but zod behind them, so a **value** can cross into the window.

| Module                                                         | What it decides                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`branches.ts`](../src/core/branches.ts)                       | how a branch name is shown — `origin/` is noise                                                                                                                                                                                                                                                                               |
| [`colors.ts`](../src/core/colors.ts)                           | the project palette, and which colour a new project gets                                                                                                                                                                                                                                                                      |
| [`initials.ts`](../src/core/initials.ts)                       | the two characters on a project tab                                                                                                                                                                                                                                                                                           |
| [`icons.ts`](../src/core/icons.ts)                             | the icons a project may be marked with instead                                                                                                                                                                                                                                                                                |
| [`chats.ts`](../src/core/chats.ts)                             | what a chat is, and how much it may do without asking                                                                                                                                                                                                                                                                         |
| [`events.ts`](../src/core/events.ts)                           | `AgentEvent` — the only shape the UI sees of the SDK                                                                                                                                                                                                                                                                          |
| [`questions.ts`](../src/core/questions.ts)                     | the questions the agent asks, and how an answer reaches it                                                                                                                                                                                                                                                                    |
| [`elicitation.ts`](../src/core/elicitation.ts)                 | what an **MCP server** asks the user for, read out of the JSON Schema it sends into fields a window can draw — a flat object of primitives, which is the restriction that makes it drawable at all. Answers null for anything it cannot draw, because a half-drawn form collects an answer the server then refuses            |
| [`usage.ts`](../src/core/usage.ts)                             | what `/usage` answers, narrowed from a response wider than its own type — and the one narrowing of it: the sidebar's windows come out of the same report rather than a second reader of the same request. Includes the account's own `severity` for each window and which one is binding, joined to the windows by reset time |
| [`names.ts`](../src/core/names.ts)                             | workspace names, drawn at random from 256                                                                                                                                                                                                                                                                                     |
| [`codedError.ts`](../src/core/codedError.ts)                   | the one shape a failure crosses the bridge in — extending it is what puts a class in `attempt`, which used to be a hand-written list a ninth class fell off                                                                                                                                                                   |
| [`types.ts`](../src/core/types.ts)                             | shared identifiers                                                                                                                                                                                                                                                                                                            |
| [`pullRequestShapes.ts`](../src/core/pullRequestShapes.ts)     | what a pull request, its checks and its review threads look like                                                                                                                                                                                                                                                              |
| [`envBlock.ts`](../src/core/envBlock.ts)                       | the block of variables written into a workspace, and what is wrong with one                                                                                                                                                                                                                                                   |
| [`scriptEnv.ts`](../src/core/scriptEnv.ts)                     | the variables a script is given, and the three kinds of script there are                                                                                                                                                                                                                                                      |
| [`standingPermissions.ts`](../src/core/standingPermissions.ts) | what "always allow" granted, and whether it covers a call. Narrower than the rule says wherever it cannot be sure, because wider is the bug this replaces                                                                                                                                                                     |
| [`stores.ts`](../src/core/stores.ts)                           | which of the two directories octopus keeps things for the agent in — the installation's own, or one project's                                                                                                                                                                                                                 |
| [`libraryNames.ts`](../src/core/libraryNames.ts)               | what may name a command or a subagent, and which of the two it is. Underscores are allowed where a skill's name refuses them, because a command is typed by the user and `/run_checks` is a name people write                                                                                                                 |
| [`notes.ts`](../src/core/notes.ts)                             | how long a workspace's note may be. Its own module because the **window** enforces the ceiling as the text is typed, and the limit is bounded by `commit` rewriting `state.json` whole rather than by anything about a note                                                                                                   |
| [`skillNames.ts`](../src/core/skillNames.ts)                   | what may name a skill, which scope it came from, and the key the agent knows it by                                                                                                                                                                                                                                            |
| [`envProfileNames.ts`](../src/core/envProfileNames.ts)         | what may name a set of variables, and the name a project's first one gets. Split out of `envProfiles.ts` when the dialog asking for a name was built: that module reads and writes files, so its rule was unreachable from the field somebody types into                                                                      |

The last is the one that has to be **kept** pure. `SCRIPT_KINDS` began life in
`repoSource.ts`, which reaches `node:fs` — importing it into the window passed
every check and broke the app at runtime, the second time this project has made
exactly that mistake. A constant the renderer needs belongs in a module with no
Node imports, rather than being imported out of one that has them.

### Storage

| Module                                             | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`paths.ts`](../src/core/paths.ts)                 | every path under `~/.octopus`, in one place — and the three questions about containment: `insideWorktree` about a string, `unlinkedInside` about the filesystem before a write, `resolvesInside` about where a link lands before a read                                                                                                                                                                                                        |
| [`persist.ts`](../src/core/persist.ts)             | atomic writes of JSON and of text, validated reads, honest failures                                                                                                                                                                                                                                                                                                                                                                            |
| [`config.ts`](../src/core/config.ts)               | settings and their bounds                                                                                                                                                                                                                                                                                                                                                                                                                      |
| [`store.ts`](../src/core/store.ts)                 | projects, workspaces and chats, and the migrations                                                                                                                                                                                                                                                                                                                                                                                             |
| [`transcript.ts`](../src/core/transcript.ts)       | chat history as append-only JSONL                                                                                                                                                                                                                                                                                                                                                                                                              |
| [`frontmatter.ts`](../src/core/frontmatter.ts)     | a markdown document with YAML frontmatter, read the way the agent reads one — and the decision that frontmatter which will not parse is read line by line rather than refused                                                                                                                                                                                                                                                                  |
| [`parallel.ts`](../src/core/parallel.ts)           | waiting properly. `allOf` makes reads at once and abandons none of them when another fails — `Promise.all` rejects on the first failure and leaves the rest running, which for a child process means a `git` still writing into a directory the caller has moved on from, and that is the `ENOTEMPTY` that failed a full run in five for a month. `within` is the other half: waiting, but not for ever, and saying which of the two happened. |
| [`download.ts`](../src/core/download.ts)           | fetching one document over https: the scheme, the redirect, the timeout and the size cap, with the caller supplying its own words for a refusal                                                                                                                                                                                                                                                                                                |
| [`changeContext.ts`](../src/core/changeContext.ts) | the lines an edit landed among, read while they are still true, and **which file** a tool call left changed — an allowlist of the writing tools, because `Read` names a `file_path` too                                                                                                                                                                                                                                                        |
| [`repoConfig.ts`](../src/core/repoConfig.ts)       | a project's settings as its repository can carry them, in `.octopus/`                                                                                                                                                                                                                                                                                                                                                                          |
| [`repoSource.ts`](../src/core/repoSource.ts)       | which script actually runs for each kind, and the digest that has to be approved before one from the repository may                                                                                                                                                                                                                                                                                                                            |
| [`library.ts`](../src/core/library.ts)             | the commands and subagents the user keeps, beside the skills and in the same two stores. One markdown file each, which is the whole difference from a skill: nothing to walk, no folder to size, no symlink to refuse. The name **is** the file, and a subagent's frontmatter is kept in step with it                                                                                                                                          |
| [`envProfiles.ts`](../src/core/envProfiles.ts)     | a project's variables in named sets, one of which a workspace runs with — the half of a project's configuration a repository may never supply. The **names** live in `envProfileNames.ts`, where the window can reach them                                                                                                                                                                                                                     |

### git

| Module                                       | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`git.ts`](../src/core/git.ts)               | running git safely; slugs; which branch is the base                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`worktree.ts`](../src/core/worktree.ts)     | worktrees and branches, and parsing what git prints                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`remotes.ts`](../src/core/remotes.ts)       | where a base branch's state comes from, and fetching it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [`workspaces.ts`](../src/core/workspaces.ts) | the workspace lifecycle and reconciliation — including whether each worktree still has its own branch checked out, which `--porcelain` reports per worktree and so costs nothing beyond the read that decides whether a directory is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`projects.ts`](../src/core/projects.ts)     | whether a directory can be a project                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`diff.ts`](../src/core/diff.ts)             | what a workspace changed, and parsing what git prints — plus `readWholeFileSides`, the same files' two sides complete, which is what the colours need and the drawn diff does not have. **Three reads, not two**: `--numstat` for the counts, `--name-status` for the kind, and `--raw` for the file modes — the last because a unified diff cannot be relied on for a mode, a permission change having no hunks at all and one beside content changes sitting above `@@` where the parser never looks. `--raw` is exact for every file whatever the drawing budget, which a mode carried by the unified parser would not be                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`publish.ts`](../src/core/publish.ts)       | how far each of those changes has travelled towards GitHub, and whether the request already shows an older version of it. Three `--name-only` listings — from the branch's copy on the remote back to its fork point, from that copy to the working tree, and from `HEAD` to the working tree — which is what tells `committed but not pushed` apart from `not committed at all`, a distinction one diff against the merge base cannot make. The first is measured from the **fork point** and not from the current merge base: once the base moves under the branch, everything it gained meanwhile differs from the older pushed copy purely because that copy is older, and the reviewer was warned about files the request does not contain. Both names of a moved file are asked on every rung, because the three listings pair renames against different candidate pools. The remote's copy is found through `<branch>@{upstream}` and then `refs/remotes/origin/<branch>` — the second only where the branch's fork point is an ancestor of it, since workspace names are recycled and nothing prunes a ref left by the last workspace of that name. Both are **caches**, current because every push of a workspace branch goes through this app or its own terminal, and nothing here fetches: `diff.ts` promises this read writes nothing, and refs are writes. Every reading is anchored on `HEAD` while the branch arrives as a name, so the two are compared first: the workspace's terminal is a shipped tab and `git checkout` is one command in it, and apart, `work`'s copy on the remote would be measured against a `side` that never had one |
| [`revert.ts`](../src/core/revert.ts)         | putting one of those files back, which is the half that writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### External tools and processes

| Module                                                       | What it decides                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`github.ts`](../src/core/github.ts)                         | which repositories the account can push to, and cloning one, through the `gh` CLI. Also which organisations the account belongs to, which rides on the same `viewer` in the same request: an organisation named there with nothing of its own in the list is one the picker can point at by name, where before a list short by a whole organisation looked complete                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`pullRequests.ts`](../src/core/pullRequests.ts)             | every `gh` command a pull request needs: reading a branch, committing, pushing, opening one, reading it in full, merging, and reading every branch of a project at once. **Merging and closing first ask which branch the number is on**, because `gh` resolves a number against the repository rather than against the worktree it is standing in — so a stale number drawn beside one workspace would merge whatever it names, and merging does not come back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [`pullRequestDraft.ts`](../src/core/pullRequestDraft.ts)     | asking the agent for a title and a description, and stopping at the text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`pullRequestShapes.ts`](../src/core/pullRequestShapes.ts)   | what GitHub sends about one, and what to make of it — schemas, lowering tables and normalisation, with no executor and no Node imports, so the renderer may import its values                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`accounts.ts`](../src/core/accounts.ts)                     | whether `claude` and `gh` are signed in, and what the GitHub token is allowed to see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`terminal.ts`](../src/core/terminal.ts)                     | what a pty should run, where, with which environment — and `owner`, the workspace a session belongs to and what it is running, which the renderer chooses and `main` keeps beside the pty because a spec is a directory and an argv and neither says whose it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| [`loginShell.ts`](../src/core/loginShell.ts)                 | the PATH a GUI launch never gets: how to ask the login shell for its own, and how to merge the answer with what launchd handed over. Decides only — `main/loginPath.ts` spawns and assigns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| [`scripts.ts`](../src/core/scripts.ts)                       | `setup.sh`, `run.sh` and `archive.sh`: where each lives, and the template a missing one comes back as                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [`scriptEnv.ts`](../src/core/scriptEnv.ts)                   | the variables a script is given, the workspace slug, the three script kinds and the block of ports a workspace owns. No Node imports at all: the renderer needs these as values, and a module reaching `node:os` behind one broke the window while every check stayed green — twice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| [`archive.ts`](../src/core/archive.ts)                       | running the cleanup script on the way out, without letting it block a removal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`attachments.ts`](../src/core/attachments.ts)               | the one attachment octopus stores. A file dragged onto the composer or chosen from disk keeps its own path and is never copied — the message carries the path — but a clipboard holds a picture rather than a file, so a pasted image is written here. The type is checked against an allowlist because it decides a filename                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| [`cliPermissions.ts`](../src/core/cliPermissions.ts)         | what Claude Code's own settings allow, refuse and ask about, from all three files, each rule naming the one it came from. Read and shown, never written — two are inside the checkout and one is in the trust digest                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`dataLock.ts`](../src/core/dataLock.ts)                     | one process at a time owns `~/.octopus`. A unix socket outside the root and named after it: a stale one refuses a connection and is retaken, so a crash never locks anybody out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| [`carry.ts`](../src/core/carry.ts)                           | which gitignored files travel into a workspace, where each is read from, copying them, and reporting the ones that did not arrive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [`env.ts`](../src/core/env.ts)                               | the files: a project's block on disk, and writing it into a workspace                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| [`envBlock.ts`](../src/core/envBlock.ts)                     | the block as text — checked and filled in. No Node imports: the renderer checks a block as it is typed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [`ports.ts`](../src/core/ports.ts)                           | which block of ten a workspace gets, and whether anything is already answering there                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| [`instructions.ts`](../src/core/instructions.ts)             | prose handed to the agent, per project and for the installation; `effectiveInstruction` is the order between those two, with `repoSource.ts` supplying the layer above both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| [`instructionSources.ts`](../src/core/instructionSources.ts) | what a directory offers the agent, and which of it the current `settingSources` actually loads — `carried` says whether that directory is the checkout or the worktree a session runs in                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| [`repoTrust.ts`](../src/core/repoTrust.ts)                   | what a checkout can make the agent do before anybody has looked at it, as a digest of the settings and of every file under `.claude/hooks/` — the directory whole, since a hook command is a shell line and need not name a path at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| [`skills.ts`](../src/core/skills.ts)                         | the two stores of the user's own skills, each shaped as a working-directory root with a `.claude/skills` inside it: reading a `SKILL.md`, writing one without losing frontmatter the form never saw, importing from a folder, from text or from a link, and whether a skill is on for one conversation. **A skill is addressed by its folder, not by its name** — the two are the same string only for one the app created, and a folder placed by hand may name something else, which used to mean every write went somewhere the listing had never looked. The name is what the agent calls it and the key every stored answer uses, and it is unique across **all three sources** — both stores and the checkouts that share a session with the one being written to, since a repository shipping `review` and one written here called `review` are two files for one skill — which is why **renaming is a migration**: `renameSkill` moves the directory and the frontmatter together, and `service.renameStoredSkill` moves the key with them, or the skill comes back on wherever somebody had turned it off. **Both roots are handed to a session whether or not either holds a skill**, and created if absent: they go over once, and the reload a write triggers re-scans only what was handed over, so a store omitted for being empty could never be filled for that conversation. **Not a local plugin**, which was tried and measured — a plugin's skills load and then `skillOverrides` will not touch them under any spelling of the key, which is the whole feature |
| [`agent.ts`](../src/core/agent.ts)                           | the Agent SDK: session lifecycle and event mapping                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

### The façade

[`service.ts`](../src/core/service.ts) is the single entry point. It holds state
in memory, persists after every change, and exists so that `main/` can be a
proxy — an IPC handler should only have to forward the call.

## How a module is written

**Dependencies are parameters with defaults.** This is what makes the layer
testable without mocking modules.

```ts
export function rootDir(home: string = homedir()): string
export async function listWorktrees(exec: GitExec): Promise<Worktree[]>
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string
```

The clock and randomness are parameters too. Without that, a test either asserts
nothing useful or becomes flaky.

**Parsing is separate from running.** `parseWorktrees` takes a string, so it can
be tested against output no real repository would produce — a bare worktree, a
locked one, CRLF line endings.

**Failures carry a code.** `ProjectValidationError`, `WorkspaceError` and
`GitHubError` each hold a machine-readable `code` the UI turns into a localised
message. The English text on the error is a fallback for logs.

## The invariants

These are the rules that have been broken, each costing a bug.

### Uniqueness has a scope

Before rejecting a duplicate, ask what it is unique **within**. A workspace name
and its branch are unique per project; the id is unique across the app. See the
table in [data.md](data.md).

### git is asked about git

A branch outlives the worktree it was made for — removal keeps it unless asked
otherwise. So a name free in `state.json` may still be taken in the repository,
and `worktree add` will refuse. `takenByBranches` in `workspaces.ts` exists for
exactly this.

### A workspace branches from a base that was just fetched

`git worktree add` was given the project's base branch, which meant this
checkout's _copy_ of it — as of whenever somebody last fetched by hand. On a
real project that was a fortnight; the workspace started a fortnight behind and
nothing said so, so the cost arrived at review.

`resolveBase` in `remotes.ts` answers where a base's state actually comes from,
in four steps: a base that is already remote-tracking is taken as it stands; a
local branch follows what git would pull into it, which may be named
differently; failing that, a remote carrying the same name; failing that,
nothing. The remote comes from `git remote` rather than from assuming `origin`,
which is what makes a differently-named remote work and stops a branch called
`feature/x` being read as a remote called `feature`.

**A repository with no remote is not a failure.** There is nothing to fetch and
nothing that could be stale, so creation proceeds as it always did — that is the
project added from a local folder, and it is answered by the first command.

**A remote that refuses stops the creation**, before anything exists to roll
back. A stale base is the whole failure being prevented, so producing the
workspace anyway would defeat the point.

**The branch that results tracks nothing, and `--no-track` is what makes sure
of it.** Starting a branch from a remote-tracking ref is exactly the case git's
default `branch.autoSetupMerge` sets an upstream for, so once every base
resolved to `origin/…` every workspace branch was born tracking the project's
base. Nothing reads that upstream — the pull-request path pushes with
`-u origin <branch>` itself — but under stock `push.default=simple` a bare
`git push` in the worktree is refused, and the first thing git suggests is
`git push origin HEAD:main`. A hurried reader following the suggestion puts the
workspace's work onto the base branch, which is what a worktree per task exists
to prevent. It is invisible with `push.default=current`, so looking for it on
the wrong machine finds nothing.

The fetch is the only command in `src/core` that leaves the machine on purpose,
and the only one given a deadline and an environment. `GIT_TERMINAL_PROMPT=0` is
the load-bearing half: git spawned from Electron has no controlling terminal, so
a fetch that decides to ask for a password writes the prompt nowhere and waits
for ever, behind a button with no way to cancel.

The same resolution has to serve the reads. `baseRefOf` in `service.ts` applies
it to the diff, the count of commits ahead and the merged check — a workspace
cut from `origin/main` and measured against local `main` reports a fortnight of
other people's commits as its own. It falls back to the stored name when git
says nothing, because a repository that was moved answers no question at all and
those reads must still report the workspace as missing rather than throw.

### An operation that fails cleans up after itself

Creating a workspace makes a directory, a branch and a record. If the record
cannot be written, `rollbackWorkspace` undoes the first two. Debris left in git
is invisible to the app but still holds its name, so one failure would otherwise
become permanent.

Rollback is best-effort and never throws: it runs while another failure is being
handled, and a second must not replace the first.

Removal is the same rule read backwards. `removeWorkspaceById` asks
`ensureRemovable` before it closes a single session, because everything after
that line destroys something a refusal cannot give back — and the refusal is
the ordinary path, not a rare one: the pane pre-ticks the delete-branch box, so
a clean workspace whose commits are not merged refuses every time. The split
between `ensureRemovable` and `discardWorkspace` exists so that a caller with
work of its own to do in between cannot accidentally ask twice; asking twice is
worse than it sounds, because the cleanup script runs in the worktree and a
script that writes there would make the second answer differ from the first.

### An update applies every field it carries

`updateProject` lists fields explicitly, which protects against writing back a
stale value — and silently drops any field added to the type but not to the
update. That is why the colour picker did nothing for a while. A test per field
is the only thing that catches it.

### The SDK is reached through one function

`agent.ts` takes `query` as a parameter, the same way `git.ts` takes an
executor. That is what lets the whole chat — a message sent, events mapped, a
permission answered, a session closed — be tested without a child process, a
network call or a model. `query()` is never called from a test.

The mapping itself is a pure function from `SDKMessage` to `AgentEvent[]`, kept
apart from the session for the same reason: the SDK's union has some forty
variants and grows between releases, and a variant we do not draw maps to
nothing rather than to a placeholder.

**One message is parsed rather than read, and the reason generalises.**
`compact_boundary` is declared with `compact_metadata`, `pre_tokens` and
`post_tokens`; a live session sends `compactMetadata`, `preTokens` and
`postTokens`, and four fields the declaration does not mention. Reading the
typed shape yields `undefined` at runtime — an event of nulls that looks like it
worked. So it goes through zod like any other external data, accepting both
spellings, and a shape neither fits degrades the event to nulls instead of
dropping it: the log's line is worth drawing on the boundary alone.

**A model that refuses is announced, and the announcement is drawn.**
`model_refusal_fallback` is the one change of model that is neither the user's
decision nor the agent's: the primary model ends the stream with
`stop_reason: "refusal"` and the CLI retries the turn on another one. It used to
land in the `default` arm with the other three dozen subtypes, so the composer's
chip moved to a different model mid-conversation with nothing accounting for it.

`scope` is the difference between two sentences: `session` means the swap
outlives the turn and the chip has moved, `local` means only a subagent, a side
question or a background fork fell back. Absent from older CLIs, where it reads
as `session` — the SDK says so, and it is the conservative way round, since the
other would describe a lasting swap as a passing one.

`direction` is not carried. It still types as `retry | revert | sticky` and only
`retry` is emitted, the other two kept for consumer compatibility — a field
whose every value is the same value says nothing.

**And the refusal nothing was retried after is drawn too**, which for a while it
was not. `model_refusal_no_fallback` arrives when no fallback model is configured
or per-category routing declines the retry; the SDK sends exactly one of the two
and never both. It fell into the same `default` arm the fallback message was
rescued from — so the worse of the two cases wore the quieter symptom: after a
fallback the reader at least has an answer and a line naming who gave it, and
here the turn simply ended with nothing in the log to interpret.

Its own event rather than a nullable `fallbackModel` and a nullable `scope` on
the first. Those two would have to agree — null exactly when null — and a shape
that can spell a state nothing means is a shape the renderer has to answer for.
A second member of the union also leaves every transcript already on disk
untouched, since no line written before it carries that type.

**And what the fallback took back is taken back here too.** The refused model
had usually already said something — a half-answer, and any tool results that
went with it — and the CLI evicts those from its own state when it retries. They
were kept here, so a reopened conversation showed the abandoned work above its
own replacement and the transcript disagreed with what the agent held.

Two signals name the same thing and both are read. `supersedes` rides on the
replacement message itself, so the retraction is settled while the event that
caused it is in hand; `retracted_message_uuids` says it again at the end of the
turn and is the complete audit record, carrying results that no replacement
frame was attached to. The SDK calls the two idempotent.

The ids are **opaque**, and that is a decision rather than laziness. The CLI
splits a multi-block message before emitting it and derives a per-block id for
each part; the ids in a retraction are the ones it handed us. Computing that
derivation here would be encoding an implementation that `sdk.d.ts` does not
document — so they are matched by equality and an unmatched one is a no-op,
which is what the SDK promises and what its own reader does. A message naming
itself is dropped: it would strike out its own replacement.

**Marked, not removed.** The retraction is appended like any other event, and
the rows it names are struck through. Removing them would break the append-only
promise the transcript is built on — the log's React keys are positions in it,
so a deletion renumbers every row below — and it would lose the thing the
retraction is evidence of: the agent started down a road and abandoned it.

One case still has no line, and it is the SDK's rather than ours: a user who
**declines the retry dialog** gets neither message. octopus does not draw that
dialog either — `supportedDialogKinds` is undeclared, and the CLI fails closed
on a kind that is not declared — so nothing is inconsistent, and it is worth knowing which silence is whose.

### What the types leave unsaid is measured, not guessed

Two fields on the way in carry no unit in the SDK's types, and both were checked
against a real session rather than assumed:

- `rate_limit_info.resetsAt` is a bare number. It arrives in **seconds**.
  `toIsoTimestamp` still accepts either, because seconds and milliseconds differ
  by three orders of magnitude and telling them apart is a check, not a guess.
- `usage.input_tokens` counts only what was **not** cached. A measured turn
  reported 2 beside 17,392 read from cache and 7,825 written to it, so
  `promptTokens` sums all three. The bare field would have understated the
  prompt by four orders of magnitude — a number that looks fine and is wrong.

The same session showed `utilization` absent from the event entirely, which is
why the header is built to say nothing rather than to hold space for it.

**What the two readings cost was guessed wrong, and then measured.** The suspect
was `get_usage`: its response carries a scan of every transcript on the machine,
and something asks for it at the end of every turn. Against a live session with
845 transcript files and 608MB behind them, the first call takes about 250ms and
every call after it **under 40ms** — the CLI works the scan out once and keeps
it. It was never the expensive half.

`getContextUsage` is, at **600–700ms**, every time, with nothing cached — and it
is the one that looked cheap because it never leaves the machine. The two used
to be asked for together, so a turn's end cost the slower of them; they are
asked for separately now, by the two things that want them. Loading a project's
own settings does not move either figure: the same numbers come back from an
empty directory and from a repository with a `CLAUDE.md`, skills, hooks and
MCP servers.

**And the whole of a read was measured later**, when the account block turned
out to be lagging: `query()` to answer, including spawning the CLI, is
**720–850ms** cold and about **260ms** against a session already running. That
is what makes reading it on a timer reasonable, and it is written down here
because the block was built on the opposite assumption.

Slash commands were measured the same way, and three of the four answers were
not what the types suggested:

- a **local command answers as ordinary assistant text**. An unknown command
  replies "Unknown command: …", and it arrives as an `assistant` message. There
  is no separate event to map, and none is mapped.

  `/usage` was the same until it stopped being sent at all. Its prose table has
  a structured original — `usage_EXPERIMENTAL_…`, "the structured data behind
  the `/usage` command" — so `sendToChat` recognises the command (aliases and
  all, through `isUsageCommand`), reads the report and emits a `usage` event
  instead of forwarding the message. `readUsageReport` narrows the response;
  `toUsageReport` in `usage.ts` is the pure half of that and holds the reasons
  for the allowlist of windows. It is the one command the CLI never sees.

- a local command **does produce a `result`**, with `terminal_reason` unset. The
  chat therefore stops looking busy on its own, and no special case decides that
  a turn has ended.
- `conversation_reset` carries two ids and **neither resumes the conversation it
  opened**. `new_conversation_id` fails outright — "No conversation found with
  session ID" — and the id that works arrives a moment later in an `init` of its
  own. So the event carries no id at all, and `session_started` stays the only
  thing that records one.
- that `init` now arrives **after every command**, not once per session, which is
  why the branch that stores the id first checks whether it changed.

A fourth, measured later on a real `/compact` (CLI 2.1.224): the command runs a
**model call the `result` does not account for**. The turn took 66 seconds and
cost a dollar, and its `result` reported `input_tokens: 0` and
`output_tokens: 0` — so the footer read `65.9s · 0 tokens` under a turn that was
neither idle nor free. Nothing reads those figures for anything but display, so
this costs only the reading; it is written down because a zero that looks like a
bug is worth recognising as the agent's own answer. The compaction itself is
announced on `compact_boundary`, which is dropped.

### An answer travels as the tool's own arguments

`AskUserQuestion` is an ordinary tool, so the agent's questions arrive as a
permission request and nothing else. What is not ordinary is the reply: the tool
reads the user's choices off its own input, so the answer goes back as a
modified copy of the arguments — `PermissionOutcome.updatedInput`. There is no
message to send and no other way in.

Three details of that were measured against the real CLI rather than read off
the types, and each one is a way to lose a day:

- **free text belongs in `answers`**, beside the chosen labels, not in the
  separate `response` field the tool's _output_ has. The CLI's branch for
  `response` discards the list answers entirely, so anything ticked would vanish
  the moment something was also typed;
- **several answers are joined with `', '`** — the separator the CLI splits them
  back on;
- **approving without touching the arguments is "skip"**, and the agent reads it
  as `The user did not answer the questions`. Which is what every question did
  before this existed.

`config.ts` keeps the tool out of any standing approval for the same reason it
keeps `ExitPlanMode` out: `askPermission` answers a standing tool before it
emits anything, so an "always" here does not grant a permission — it deletes the
question.

### Which model is running, and where that is readable

Two readings claim to answer it and only one is current — measured, and the
difference costs a turn:

- the **init message** carries a `model`, and init arrives after every slash
  command, so it looks like the push channel. It is not: after `/model haiku`
  the init of that same turn still names the old model. The new one appears an
  init later, which is a turn too late for the footer.
- **`getContextUsage()`** answers correctly the moment the turn ends. It is a
  non-cached round trip, and it is one the pane already makes: `useSessionUsage`
  reads it on every `result`. So the running model rides along with the context
  gauge and needs no channel of its own.

`supportedModels()` answers neither — it is a catalogue, and the runtime freezes
it at the first `initialize`. Nor does `initializationResult()`, whose response
has no model in it at all.

This is also why `sendToChat` re-asserts the permission mode but **not** the
model. It briefly did both, on the belief that a `/model` could not be detected;
once it could, the re-assertion stopped guarding against drift and became an
undo of an explicit instruction.

### Two models, and when one replaces the other

A conversation holds two: `model` for writing the code and `planModel` for
planning. `sessionModel` folds them into the one the SDK takes — see
`docs/data.md` for why the two nulls mean different things — and nothing but its
return value is ever handed to `setModel` or to `SessionOptions.model`.

Which means the effective model can move without anyone naming one, at exactly
two moments: planning turned on or off, and a plan approved. `pushModel` handles
both, and the guard in it is what keeps the paragraph above true — it sends
nothing unless the value actually changed, so a conversation whose two jobs
share a model is never pushed at, and a `/model` given to it still stands.

That is a change **this application made and knows the moment of**, which is the
whole difference from re-asserting per message: sending a message moves nothing,
so a push there would still be undoing `/model` and nothing else. On an approved
plan it goes out **before** the permission reply resolves — the reply is what
releases the tool call, and there is no `updatedModel` to ride along with the
mode the way `updatedPermissions` carries it.

### Two efforts, and one of them folded into two

A conversation holds a pair here as well: `effort` for writing the code and
`planEffort` for planning, folded by `effortInForce`. The argument is the model
pair's word for word and arguably harder — somebody who has one model think an
approach through and another carry it out wants **more** thinking in the first
half and less in the second, which is one judgement of which half used to be
expressible. It also costs money in the direction nobody wants: effort left
where planning needed it is what every file edit after the plan is paid for.

Two cases rather than `sessionModel`'s three. There is no "the agent's own
default" here, because effort is always a level and `null` can mean nothing but
"no split".

`pushEffort` is `pushModel`'s twin, at the same two moments and with the same
guard: a conversation whose two jobs share an effort is never pushed at, so
`/effort` given to one still stands for its turn. It also runs on the two
setters, which the model pair does not need — setting the working level while a
plan is being made must move nothing, and the guard is what says so.

`planEffort` starts null and is never copied from the settings: there is no
application-wide effort for planning, and there should not be. It does come
along on a fork, unlike `planMode` — it is a statement about how this task
should be approached, and a fork is another go at the same one.

### One effort, folded into two

`sessionEffort` is the third of these folds, and the odd one: the two answers it
produces are not two stored fields. A chat holds a single choice, five levels
wide plus `ultracode`, and the SDK asks about that choice twice — for a level,
and for a flag that turns dynamic-workflow orchestration on. `ultracode` sets
both, `xhigh` and `true`.

Which is why it is stored as one value. A level beside a boolean would admit
`ultracode` with `low`, a state nothing can run, and both halves would then have
to agree everywhere they were read.

The flag goes out with the level in **one** call, at both moments it can move:
`Options.settings` at start-up, and `applyFlagSettings` on a running session.
That is not tidiness — `applyFlagSettings` shallow-merges top-level keys, so a
flag sent after a level would replace it rather than join it. Both are always
said, `false` included, and the reason is that same shallow merge rather than
anything about what else is loaded: a key left out is a key left standing, so
silence would keep the last session's answer. That used to be argued from
`settingSources` being empty. It is not empty — the default loads `user`,
`project` and `local`, so a settings file can carry the flag too, which is one
more reason to state it outright instead of hoping nothing else does.

### A reset is not consent

`conversation_reset` is emitted by `/clear`, by leaving plan mode, and by
fresh-session flows. Only the first should empty the log, so the intent is
recorded where it is known — `sendToChat` notes that the message was a clearing
command, aliases included — and consumed by the event it caused. Read off the
event alone, approving a plan would erase the conversation that produced it.

**The clearing turn outlives its own reset by one event.** The transcript is
discarded the moment the reset says it was asked for, and the command's own
`result` arrives a tick later — recreating the file it had just removed, to hold
the footer of a turn nobody can see. An emptied conversation reopened as one row
reading `0.1s · 0 tokens`, and clearing again only replaced it.

So the request is consumed in two steps rather than one: `clearRequests` ends at
the reset, `clearedTurns` at the result that follows it. Only the **writing** is
skipped — the result is still announced, being what stops the composer offering
to stop.

Both sets are also emptied with the chat when its workspace is removed, which is
bookkeeping rather than a guard. Neither can strand a flag that matters: a
`/clear` whose result never arrives means the session stopped answering, and
`closeChatsOf` — the only thing that drops a session — runs on workspace
removal, not on an agent error. A session that dies is kept in `sessions`, so
there is no later turn for a stale flag to swallow.

The log has the matching rule, because the transcripts written before this did
not get one: a footer at the head of the log closes no turn, so `groupToolRuns`
does not draw it.

### One writer at a time

`persist.ts` writes to a fixed temporary path and renames it, so two saves in
flight race for that one file — the first rename wins and the second fails with
`ENOENT`.

`writeTextFile` shares that mechanism, and the env block is written through it
with no queue in front. The race is bounded rather than prevented, which is
deliberate: writing the block is idempotent and convergent — every run strips any
block of ours and appends a fresh one — so two of them land the same file, and
the only cost of losing the race is one spurious `ENOENT`. A queue would buy
nothing here, and a lock file would live inside somebody's repository.

That function also **re-asserts the mode** rather than passing it to `writeFile`,
whose `mode` option reaches `open(2)` and is ignored unless the call creates the
file. Appending credentials to a `.env` carried in from a checkout would
otherwise leave it as readable as the copy was. Agent events arrive from a callback nobody awaits, so a status change
from the agent and one the user asked for genuinely do land together. `commit`
serialises them, and takes a **function** of the current state rather than a
finished one: a queued write computed from a stale snapshot would silently undo
whatever landed while it waited.

Transcript appends have their own chain. They do not read the state, so making
them wait for a save would only slow the log down — what they need is order.

Nothing inside a `commit` may call `commit` again: it would queue behind the
write it is already part of, and wait for itself. That deadlock cost an
afternoon.

**A decision that depends on the state belongs inside the callback, not before
it.** `openChat` used to look for an existing record and then await `commit`;
the renderer has two ways in — a setting picked in the composer, and a message
sent — and both callers saw none and both wrote one. The reply and its whole
transcript then went to the second while `listChats` answered with the first, so
the conversation reopened empty and the transcript that held it was filed under
an id nothing pointed at. Serialising the write is worth nothing if the question
it answers was asked outside the queue.

`createChat` counts against the cap inside its own callback for exactly that
reason: two presses of the new-tab button landing together would both see room
against two conversations, and the cap would hold for neither.

### Opening a conversation, and creating another

`openChat` answers "the conversation to write into" and is idempotent — it is
what the pane calls when a setting is picked or a first message sent, and a
workspace nobody has spoken to gets no record from it being looked at.
`createChat` always writes one, which is the whole of what the new-tab button
asks for. A flag on the first would have made every caller say which of the two
it meant.

`closeChat` ends a conversation and discards it, and refuses the last one of a
workspace: emptying the only conversation is `/clear`, which does it without
leaving the pane with nothing to draw — and does it with a confirmation, which a
second route through the tab's menu would not have carried.

The sequence a closing conversation goes through — abandon its questions and its
edits in flight, drop its `clearRequests` and `clearedTurns`, close the session —
lives in `closeOneChat`, and `closeChatsOf` is a loop over it. Written out twice
it would drift, which is what `removeProjectById` did before its own cascade was
factored out.

The transcript is **not** among them, and the omission is deliberate. Everything
`closeOneChat` does is memory and a child process, and it runs early — before
the cleanup script, before the worktree goes. A transcript deleted there is
deleted before the steps that can still fail, and a removal that then refuses
leaves a record whose history is gone: the pane draws the conversation empty
above an agent that remembers all of it. So `discardHistories` takes the
transcripts after the state commit instead, and each of the three callers that
wants them gone calls it — the same order, and the same reasoning, as
`removeProjectData`. A file nothing points at is litter; a record without its
history is a lie.

`renameChat` trims what it is handed and stores null for an empty name. Trimmed
in the service rather than at the boundary, because what reaches the record is
what the strip will draw, and a name of three spaces draws as a gap nothing
explains.

### A workspace's status is derived, not written

`Workspace.status` used to be written by whichever conversation last had an
event. With three per workspace that is wrong in the ordinary case: the tab that
finished marked the two still working as idle, and the composer's stop button
went with it.

The status now sits on the **chat**, and the workspace's is computed from its
conversations by `workspaceStatusFrom` — `waiting_permission` first, because
that turn has stopped and is waiting on the user; then `running`, because the
dot says what is happening now; then `error`, which is a record of something
that already happened; then `idle`. The workspace's own status is not consulted:
every value the enum holds is something a conversation is doing.

Both move in one `commit` (`commitChats`), because two would leave a moment in
which the chats say one thing and the workspace derived from them says another —
and that moment is when the file gets written. Every stream that leaves this
funnel fires only when its own reading actually changed: a second conversation
finishing does not move a workspace whose first is still running, and announcing
it anyway would redraw the whole list for nothing.

**Which conversations a workspace has leaves here too**, as `chats:changed`, and
its reading is the ordered ids and titles — not the statuses. Every status move
comes through this same funnel, so a reading that included them would tell every
window to re-read its tab strip several times a turn, which is the reason the
status stream is a status. Announced here rather than from the five writers that
change the set — open, create, fork, rename, close — because a hand-kept list of
call sites is what a sixth writer falls off; `openChat` and `renameChat` were
routed through the funnel to reach it.

`settleStatuses` follows the same shape on load: the conversations are put down
first, and the workspaces derived from the settled list rather than settled
alongside it by a rule that would drift the first time one of them changed.

`reconcile` puts one more fact on each conversation than its status: `started`,
which is `sessionId !== null`. The list draws a conversation that ran and
finished differently from one nobody has written in, and both of those are
`idle` — so the status alone cannot say which, and this is what does. Note the
order it becomes true in: a turn is under way before the session it runs in has
announced itself, so a conversation is `running` and not yet `started`, which is
the honest reading of both.

### Forking a conversation

A plain `resume` continues a session **in place and keeps its id** — which is
what the SDK's own `forkSession` option exists to opt out of, and what the guard
in `handleEvent` that skips an unchanged `sessionId` had already shown. So
copying the id onto a second record is not a cosmetic clash but two agent
processes appending to one session file, each reading the other's turns as part
of its own conversation.

`forkChat` therefore calls the SDK's standalone `forkSession(sessionId, { dir })`
**before** any record exists, and stores what comes back. `dir` is the
workspace's path and is not optional in practice: without it the SDK searches
every project directory for the id. Injected like `query`, so a test reaches no
CLI and no conversation that happened on the machine running it.

That copies what the _model_ remembers. Our own transcript is copied beside it
(`copyTranscript`, queued behind the appends), because that is what the _screen_
draws — without it the new tab opens empty above an agent that remembers all of
it. A fork the SDK refuses writes no record at all: a tab that says it continues
a conversation and does not is worse than a refusal.

### What the renderer holds is what the core last said

A patch arriving over IPC is external data like any other. `applyConfig` merged
one straight into memory while `saveConfig` parsed before writing, so the file
was always valid and the copy the application ran on was whatever came — and the
two could disagree until the next restart, which is the kind of bug that
survives a screenshot. The parse now happens on the way in as well, which is the
same parse a moment earlier.

### A refusal does not end the turn

The SDK's deny carries an `interrupt` flag and `agent.ts` leaves it off on
purpose: the refusal reaches the model as a tool result, and the same turn
carries on. That is the whole of deny-with-feedback — "not quite, do this
instead" reaching the agent without costing a turn — and it is what the plan
dialog's "keep planning" is, Escape and the close button included.

So `answerPermission` writes `running` on a refusal, symmetric with the allow
arm. It shipped writing `idle`, on the premise that declining ends the turn, and
the workspace then sat grey for the whole remainder of every steered turn — at
the moment the agent is doing the most work, and with nothing to put it back,
since no agent event writes `running`.

Not `interrupt: true`, which would make the write honest by destroying the
feature. Not leaving it unwritten either: the chat would stay
`waiting_permission`, which outranks `running`, so the list would show the amber
"come and answer this" mark against a question nobody can answer any more.

Self-correcting rather than a second thing to remember — the turn always ends in
a `result`, which writes `idle` or `error`, and `settleStatuses` clears a
`running` left by a crash.

### The skills panel lists what the session holds, not what we can see

Three of its four groups are directories octopus reads. The fourth is the
session's own answer, and without it the panel read as a list of what a
conversation may reach for while being a list of what **octopus can see** — a
different claim, and the difference is invisible until somebody wonders why a
skill they can watch the agent using is not on it. Claude Code's bundled skills,
the user's `~/.claude/skills` and a plugin's are none of them in a directory we
look at.

`refreshSkills` is the reading, and it already existed: it calls the SDK's
`reloadSkills` and used to throw the answer away. Measured against a live
session, standing in a temporary directory with no project skills at all, that
answer carried `dataviz`, `code-review`, `commit-commands:commit` and a dozen
more. `supportedCommands()` was the obvious call and is the wrong one — it mixes
skills with built-in commands and `SlashCommand` says nothing about which is
which, 53 entries against `reloadSkills`' 25 in the same checkout.

**The reconciliation runs one way only.** Extras the directories do not account
for become the fourth group; a directory entry the session does not list is not
a problem to draw, because a skill with `paths:` in its frontmatter is offered
only where the work touches those paths and is legitimately absent. Measured:
`core-module` and `ui-component` are missing from the list while the seven
beside them are in it.

The switch works on all four, because `skillOverrides` names a skill by the key
the CLI knows it by and that is what the fourth group carries — a bare name
ordinarily, `plugin:skill` for a plugin's. The list is asked for on the write as
well as the read: the deny-list is built from the listing, so a skill missing
from it would be switched off in the record and left on in the session.

A session that will not answer costs the fourth group and nothing else. The
three above it are read from disk and still true, and a closed transport is the
ordinary way that happens.

### A question nobody can answer is withdrawn

`canUseTool` blocks the agent on a promise, so an open permission request is a
turn held open. Every way a turn can end withdraws the chat's questions:
stopping it, the session closing with its workspace, and the `result` or `error`
that ends it on its own. `abandonPermissions` resolves each as a refusal and
drops it — resolving rather than dropping, because the promise is what holds the
tool call, and a refusal is the only answer that cannot start work nobody
approved. It carries `ABANDONED` rather than `DENIED`: the agent reads a
refusal's message as instruction, and nobody declined anything.

Only an answer used to remove one, which let the map outlive the sessions in it.
That was invisible until `pendingPermission` began handing the first entry it
finds for a chat to whatever window opens the conversation — at which point a
question the user had stopped instead of answering came back with live buttons
on it.

The other half of the same rule: the entry is removed where the answer is
**given**, after the writes that can fail. Removing it first meant a config
write that failed left the agent blocked on a question nothing could ask again —
the window had dropped its copy, and `pendingPermission` had none.

Only the session's own stream reaches `handleEvent`; a background write that
failed is reported straight to the listeners by `report`. That is what makes the
`error` case safe to withdraw on.

### What a diff counts is exact; what it draws is bounded

The counts come from `git diff --numstat` and are always right, whatever else
happens. Only how much of a change is **drawn** is limited, and a file left out
says so rather than quietly appearing unchanged. Keeping those two apart is what
lets a pane degrade into "this file is too large to draw" instead of into a
failure.

The ceilings used to count files and lines only, and a line has no length: a
source map or a minified bundle is two changed lines and passes every one of
them, then puts megabytes through a buffer that holds 32MB. So there is a byte
ceiling beside the line one, applied by handing git `core.bigFileThreshold` —
past it git reports a file as binary rather than writing its content out. That
flag goes **only** on the call carrying the lines: under the same setting
`--numstat` answers `-`, and the counts are the half that must not move.

Two consequences worth keeping:

- **The pathspec has to be built from what was drawable, not from what is left.**
  Comparing the drawn files against an already-marked list compares two numbers
  that are equal by construction, so git is asked for the whole diff whatever the
  ceilings said — and the file the ceiling excluded arrives in full anyway.
- **Untracked files are not a special case.** They are measured before they are
  read, read one at a time, and share the same budget as everything else.
  Reading them all at once and measuring afterwards means a workspace whose
  build output is not ignored opens a read per file in the tree.

### What a stopped turn was holding goes with it

`editsInFlight` records an edit the agent announced so the lines around it can
be read once the result says it worked. A turn stopped mid-edit produces no
result, so the entry stayed for ever — against the map's own promise that it
cannot grow, and the same shape as the question above. `abandonEdits` is called
wherever a turn stops being answered for: with the session, and with an
interrupt.

The same omission is worth watching for one level up. `removeWorkspaceById`
closed the chats of the workspace it removed and `removeProjectById` did not, so
every agent in a removed project stayed alive with its working directory deleted
underneath it, reachable from nothing but a quit. A test asserting that the
records are gone will not notice: the records were the part that worked.

### Reading and writing about the same thing live apart

`diff.ts` opens by promising that nothing in it writes: "a review pane that
modified the repository it is reporting on would change the answer by asking the
question." Reverting a file is the operation that undoes what the pane draws,
which makes it the obvious thing to add there and the wrong thing to add there.

So `revert.ts` sits beside it and borrows one function, `mergeBase`, which is a
read. The promise survives, and a reader of either module can tell at a glance
which of the two can change the repository.

The rule inside it is worth carrying elsewhere: **which command to run is
decided by asking git, not by branching on what git already told us.** The diff
reports a `FileStatus`, and rename and copy detection are heuristics — a status
that guessed wrong would send a file down the wrong arm of a `switch`. Two
questions instead, "did the base commit have this path" and "is it tracked now",
and the answers cannot be wrong about the repository they are asked of.

### The one place the app writes inside a checkout

`SECURITY.md` named two places octopus may touch — the data root and the
worktree — and for a long time that was simply true: every use of a project's
`repoPath` in the service is a git call or a read. It now names three.

"Writes inside a checkout" means its **working tree**. git itself writes under
`.git` on our behalf whenever we ask it to — `worktree add` and `branch` always
did, and the fetch before a workspace is created now writes refs and objects
there too. None of that touches a file the checkout tracks.

Exporting a project's settings into `.octopus/` is the exception, and it is
confined rather than trusted. Every path is a fixed constant assembled in
`repoConfig.ts`; `repoConfig.test.ts` walks the whole record and fails if one of
them is ever absolute or climbs out with `..`; the id that selects a path is
parsed by zod before it crosses IPC; and a symbolic link inside the directory is
refused in both directions, since a link is what turns every one of those
guarantees into decoration.

The link check walks **every segment** of the path, and the first version did
not. `lstat` leaves the last component unresolved but follows the ones above it,
so checking the file alone answered "absent" for a symlinked `.octopus/scripts`
and the write then followed the link outside the repository. A guard that looks
at the leaf of a path it does not control is not a guard.

The confinement check is a **test over the constants** rather than a branch in
the code, deliberately. The paths cannot vary, so a runtime `if` guarding them
is a branch no input reaches — a line nobody can exercise and therefore nobody
should trust. What varies is the id, and that is checked where it arrives.

`.octopus/` is read while the app works — it is where a script is looked for
first — which is why the same guard applies to every path assembled from it:
[repo-config.md](repo-config.md) has the chain, and `repoSource.ts` the gate in
front of it.

### Errors are not swallowed

If git fails, stderr reaches the user. A `catch` is justified when the fallback
is genuinely correct — not to make a coverage gap disappear. If the alternative
is a clearer error one line later, let it through.

Two failures in one chain are two decisions. Asking the agent for its model list
is fire-and-forget: a list that cannot be **read** is swallowed, since it is a
convenience for the picker and failing a message over it would report the wrong
problem — but a list that cannot be **written** is a failed write like any
other, and goes into the chat through `background`. Handling only the first left
the second uncaught in the main process, where Electron answers with a modal
about a JavaScript error over an application that is otherwise fine.
