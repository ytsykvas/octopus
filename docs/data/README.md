# Data on disk

Everything the application stores lives under `~/.octopus`. Paths are built in
one place — [`src/core/paths.ts`](../../src/core/paths.ts) — so nothing anywhere
else joins a home directory by hand.

```
~/.octopus/
  config.json                        settings
  state.json                         projects, workspaces and chats
  chats/<chatId>.jsonl               one conversation each, append-only
  instructions/*.md                  seven prompts every project falls back to
  skills/                            an extra working-directory root: what every project gets, made at the first message
    .claude/skills/<folder>/SKILL.md one skill, in Claude Code's own format
    .claude/commands/<name>.md       one command, typed as /<name>; the file is the whole prompt
    .claude/agents/<name>.md         one subagent, named and described in its frontmatter
  attachments/                       pasted images, and another root — nothing else attached is ever copied here.
                                     Nothing removes one on its own; About says how much is here and can empty it
  projects/<projectId>/
    carry                            paths carried from the checkout into a workspace
    envs/                            named sets of variables, one written last into every workspace's .env
      default                        the name the old single `env` file is moved to
    scripts/setup.sh                 prepares a new workspace, on Run
    scripts/run.sh                   starts the dev server
    scripts/archive.sh               takes back what setup gave out, on removal
    instructions/*.md                this project's own, which win
    skills/                          the same shape again, for what only this project gets
  workspaces/<projectId>/<name>/     the git worktrees
```

| File                                                       | Read it when                                                                                             |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [config.md](config.md)                                     | you are adding a setting or changing what `config.json` holds                                            |
| [ownership.md](ownership.md)                               | you are wondering why two copies of the app cannot share a data root, or how writes are serialised       |
| [state.md](state.md)                                       | you are adding a field to `state.json` or changing what a project, workspace or chat records             |
| [transcripts-and-ports.md](transcripts-and-ports.md)       | you are working on what a conversation writes to disk, what is deliberately not stored, or the port pool |
| [migrations-and-writes.md](migrations-and-writes.md)       | you are changing the schema's version or how a file reaches the disk                                     |
| [scripts-and-instructions.md](scripts-and-instructions.md) | you are working on the three scripts or the seven instructions                                           |
| [carried-files.md](carried-files.md)                       | you are working on the files copied from a checkout into a workspace                                     |
| [repository-grants.md](repository-grants.md)               | you are working on what a repository may make the agent or the Run button do before anybody approved it  |
| [env.md](env.md)                                           | you are working on a workspace's variables and the env file they are written into                        |

## What is stored, and what is not

**git is the source of truth about git.** Branches, worktrees and changes are
never mirrored into `state.json` — they are read from git when needed. The file
holds only what git cannot know: the agent session, the port, the label.

This is why `reconcile` in [`workspaces.ts`](../../src/core/workspaces.ts) exists.
It compares stored records against `git worktree list` and marks anything git
no longer backs as **missing**, rather than dropping the record or trusting it.
A silent disagreement between the two is precisely the class of bug the layout
is meant to avoid.

One subtlety that cost a bug: deleting a worktree directory by hand does not
remove git's record of it. The entry stays, flagged `prunable`, so comparing
paths alone reported such a workspace as healthy. The parser reads the flag now.
