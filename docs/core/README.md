# The core

`src/core` holds every decision the application makes. It imports no Electron
and touches no DOM, so it is tested without launching anything — and could be
lifted into a CLI or a daemon without rewriting.

Coverage here is 100%, enforced. That is the floor, not the goal: see
[testing.md](../testing.md) for why a fully covered function can still be untested.

| File                                       | Read it when                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [modules.md](modules.md)                   | you need to know which module decides what, and which ones the renderer may import a value from |
| [writing-a-module.md](writing-a-module.md) | you are adding a module or a function to one                                                    |

## The invariants

These are the rules that have been broken, each costing a bug.

| File                                           | Read it when                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [workspaces-and-git.md](workspaces-and-git.md) | you are checking a name for clashes, creating or removing a workspace, or asking git what it knows                              |
| [agent-sdk.md](agent-sdk.md)                   | you are touching how a session is started, what the SDK sends, or how an answer travels back                                    |
| [models-and-effort.md](models-and-effort.md)   | you are reading or changing which model runs, its effort, or what a reset of the conversation does                              |
| [conversations.md](conversations.md)           | you are working on a chat: saving it, opening one, forking, a workspace's status, refusals, questions withdrawn, a stopped turn |
| [skills-and-plugins.md](skills-and-plugins.md) | you are working on the skills panel or on plugins                                                                               |
| [diff-and-writes.md](diff-and-writes.md)       | you are working on the diff, on the one place the app writes inside a checkout, or on how errors reach the user                 |
