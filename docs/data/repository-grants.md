# What a repository is allowed to grant itself

`approvedSettings` on a project holds sha256 digests of the files in a worktree
that grant capability: `.claude/settings.json`, `.claude/settings.local.json`,
`.mcp.json`, and every file under `.claude/hooks/`, however deep. The hook
scripts are in there because the settings only **name** them — digesting the
settings alone would let a repository change what runs while the line that runs
it stays put. The path goes into the digest beside the contents, so moving a hook
to another name counts as a change.

A hook that is a **link** out of the worktree is shown rather than read, and what
is digested for it is where it leads. Following it would put whatever it points
at — a private key, say — into the trust card; leaving it out is how a hook came
to run without anybody being shown it. Retargeting such a link therefore asks
again, while nothing else about the repository has changed.

The allow rules of a `settings.local.json` the project's carry list brought are
left out of the digest (`carriedTrust.ts`): the CLI adds to them on every
"always allow", so a carried copy asked again in every new worktree. Only when
the file is reached through no link, a carry line names it, and git tracks it
neither in the worktree nor where it was carried from — all compared without
case, as macOS reads paths, so neither a line spelled
`.CLAUDE/settings.local.json` nor a committed `.Claude/settings.local.json` gets
a repository's file through. The rest of the file — hooks, MCP servers, `env`,
the other permissions — is still digested, and shown as what is left; contents
that are not a JSON object count whole. A digest approved before this counted
the rules, so such a project is asked once more.

A linked **directory** is the same: one entry, never walked. The listing is
walked by hand, one level at a time, because `readdir`'s own `recursive` stopped
meaning that between Node 26.0 and 26.11 — the newer one walks through a linked
directory, and a hook directory linking to a folder elsewhere then had every
file in that folder read into the card.

A **set**, capped at ten: two branches whose settings differ would otherwise ask
on every switch. A worktree that grants nothing digests to the empty string,
which is how "nothing to approve" is told apart from "approved" without a second
field.

`approvedScripts` beside it holds the same shape of digest over the scripts the
**repository** supplies — `.octopus/scripts/*`. A separate list on purpose: what the agent may load
and what the Run button may execute are different questions, and one list would
mean reading a hook file quietly approved a build script. The kind goes into it
beside the text, so allowing a body as the cleanup script is not allowing it as
the one that runs on every build. A script the user wrote in Project settings is
never in it — approving your own text is a dialog people learn to click through.

`trustRepository` turns **both** digests off for one project. Off — the default
— a version is shown once and is used only after it is allowed, so a `git pull`
that changes a script or a hook asks again. On, whatever the checkout holds runs
and loads unasked, which is a reasonable thing to say about a repository you
write and not about a clone. One switch because the unit somebody trusts is a
repository: with a switch for scripts alone, a project whose scripts were trusted
went on asking about its settings on every new workspace. The two lists stay
separate underneath, so reading a hook still approves no build script.

`trustRepoScripts` is the older, scripts-only switch, and it is still honoured
for scripts — nothing that ran unasked starts asking. It is deliberately **not**
read as `trustRepository`: that would extend a decision about scripts to hooks
and MCP servers nobody agreed to. Turning the one switch either way clears it.

An approval records the digest the reader was **shown**, not one computed at the
click: the renderer sends the digest back, and a repository whose files changed
in between — a pull, an agent writing a hook — is refused with `trustChanged`
rather than allowed unseen. And it is written from the state as it stands inside
the commit, so two approvals landing together both survive.

Both lists are read from the **worktree a session runs in**, not the checkout —
the SDK is pointed at the worktree, and a branch may carry different settings
from the one beside it. The Instructions panel narrows by the same rule over the
same directory, through one function, so the two cannot drift into disagreeing.
They did once: the panel narrowed by the setting alone while the session narrowed
by the setting and the gate, and an unapproved repository was reported as read
while the agent read none of it.

## Choosing your own over the repository's

`preferLocal` on a project lists the scripts and instructions it takes from its
own settings even where the checkout's `.octopus/` supplies one — _use mine
instead_, per item. The repository wins by default, because `.octopus/` is how a
team agrees on a script or an instruction; this is the way out of that for one
item, not for the whole repository.

A list of what was opted out rather than a flag per item, so an item added later
starts on the default without a migration, and an empty list — every record
written before it existed — means the repository wins everywhere. Chosen
against, the repository's file is not even read: a script the project never
wrote then runs nothing, rather than the repository's quietly coming back, and
there is nothing of the repository's left to approve.
