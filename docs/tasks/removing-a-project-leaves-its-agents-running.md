# Removing a project leaves its agents running

## What happens

`removeWorkspaceById` closes the chats of the workspace it removes
(`service.ts:796` → `closeChatsOf`). `removeProjectById` (`service.ts:764-786`)
does not: it removes every worktree and then the records, and never touches
`sessions`. The child processes of every chat in that project stay alive, their
transcripts stay on disk, and their entries stay in the service's maps.

## Why it matters

A leaked `claude` process is not idle — it holds a session, and its working
directory has just been deleted underneath it. Nothing in the interface can
reach it again; only quitting the application ends it.

`service.test.ts:2518` — "takes the chats of a project with it" — asserts the
records are gone and nothing else, which is why this passes unnoticed.

## A sketch

Call `closeChatsOf` for each of the project's workspaces before removing them,
in the loop that is already there.
