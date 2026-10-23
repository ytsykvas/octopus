# How a module is written

**Dependencies are parameters with defaults.** This is what makes the layer
testable without mocking modules.

```ts
export function rootDir(home?: string, env: NodeJS.ProcessEnv = process.env): string
export async function listWorktrees(exec: GitExec): Promise<Worktree[]>
export function nextWorkspaceName(taken: readonly string[], random: Random = Math.random): string
```

The clock and randomness are parameters too. Without that, a test either asserts
nothing useful or becomes flaky. So is the environment: `rootDir` takes `env`
rather than reading `process.env`, and its tests hand it `{ OCTOPUS_DATA_DIR: … }`
instead of setting the real variable.

**Parsing is separate from running.** `parseWorktrees` takes a string, so it can
be tested against output no real repository would produce — a bare worktree, a
locked one, CRLF line endings.

**Failures carry a code.** `ProjectValidationError`, `WorkspaceError` and
`GitHubError` each hold a machine-readable `code` the UI turns into a localised
message. The English text on the error is a fallback for logs.
