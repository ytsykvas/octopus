# A config patch reaches memory unvalidated

## What happens

`config:update` takes a `Partial<Config>` and passes it straight to the service.
Nothing validates it. `applyConfig` merges it into the config held in memory and
saves the result:

```ts
const next: Config = { ...config, ...patch }
await saveConfig(next, configPath)
config = next
```

`saveConfig` parses before writing and writes what the schema returned, so the
**file** is always valid. The **in-memory** copy is whatever arrived. The two
can therefore disagree until the next restart.

Every other renderer-facing channel parses its arguments with zod at the
boundary — `chats:effort`, `chats:model`, `chats:mode`, `projects:update`. This
one is the exception, and it is the channel that writes the settings.

## Why it matters

Today it is unreachable from the shipped renderer, which sends only what the
Settings screen produces. It stops being unreachable the moment anything else
sends a patch, and the failure is quiet: the app runs on one value and the file
holds another, so the bug survives a screenshot and disappears on restart.

It also weakens a claim made elsewhere: `docs/data.md` says a normalising
schema runs "on the way in and on the way out". For a patched field it runs on
the way out only.

## Evidence

- `src/main/ipc.ts` — the `config:update` handler; compare with `chats:effort`
  and `chats:model` a few lines down, which both parse.
- `src/core/service.ts` — `applyConfig`, the unparsed merge.
- `src/core/persist.ts` — `writeJsonFile` parses and writes `result.data`, which
  is why the file stays right while memory does not.

## A sketch

One line: `const next = ConfigSchema.parse({ ...config, ...patch })`. It costs
one parse per settings change — the same one `saveConfig` is about to do anyway
— and makes the in-memory config the same object that reached the disk.

Validating at the IPC boundary instead would match the other channels, but a
partial schema over a config this wide is more code for the same guarantee.
