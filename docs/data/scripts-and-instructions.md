# Scripts and instructions

**Instructions come at three levels.** A worktree may carry them, in
`.octopus/instructions/`, and that wins; below it
the files under a project's directory are the project's own; below that the same
names under the data root's `instructions/` are the installation's.
`effectiveInstruction` in `instructions.ts` writes down the lower two, and
`repoInstruction` in `repoSource.ts` is the layer above it — the two are joined
in `readEffectiveInstruction`, which is what the panel and the prompts ask.

There is one per button on the pull request tab — `pull-request.md`,
`commit-message.md`, `fix-checks.md`, `address-review.md`, `review.md`,
`multi-agent-review.md` and `resolve-conflicts.md`. Which kind lives in which
file is a `Record<InstructionKind, string>` in `instructions.ts`, so a new one
without a home is a compile error — and a test iterates the enum to catch the thing the
compiler cannot see, two kinds pointing at one file.

An **empty** project file counts as an answer. Emptying it says this project
adds nothing, and falling through to the global one there would make that
impossible to express — so the chain asks whether a file exists, not whether it
has text in it.

Both are files rather than strings in the config: they outgrow a text field,
they are worth reading in a diff, and they can be run or edited outside the app —
which is the point of not owning the workflow (§4).

They live under the data root, and that is the **last** place looked. A checkout
carrying `.octopus/scripts/` wins over both, so a clone runs
with nothing configured — and so a script can arrive with a `git pull`, which is
why the version is shown once before it runs.
[repo-config.md](../repo-config.md) has the chain and the gate.

There are three of them now, and the third runs on the way out. `archive.sh`
is given the same environment as the others and the workspace as its working
directory, so it can drop a database named after it — and **it cannot stop the
removal**. A failure, a hang, a script that was never written: all end with the
workspace gone. A workspace that cannot be deleted because a cleanup script is
broken is a worse problem than the one being cleaned up.

Scripts are saved executable. Without the bit, running one fails with
"permission denied", which says nothing about what to do.
