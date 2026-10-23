# Files carried into a workspace

`projects/<projectId>/carry` holds one path per line, relative to the project's
checkout. `carry.ts` copies each into a new workspace at creation, and again
before a run so a workspace that predates a list entry picks it up.

**A list of paths, not the contents.** Keeping contents here would be a copy
that goes stale, and it did: a `.env` snapshot taken while it pointed at
production kept pointing there long after the checkout had moved on. The list
names files; it never holds them.

**A line may say where its file comes from**, after an `=`:

```
.env = ~/work/planner/.env
config/master.key = ~/work/planner/config/master.key
```

Written for the case that has no other answer. A project added by **cloning it
from GitHub** has a checkout with no gitignored file in it at all — they were
never pushed — while the real `.env` is on the same disk, in another copy of the
same repository. Before this the workspace simply came up without it and said
nothing.

The split is on the **first** `=`, since a path may contain another. A source is
expanded for `~` and used as it stands; one that is still relative resolves
against the checkout, which is what a bare path already means. A line with a
source uses it and does not fall back — the line says where the file comes from.

The confinement rule applies to the **left side alone**. That half decides where
a file is written and stays inside the worktree; the right half only ever says
what is read, so an absolute path there is the ordinary case rather than an
escape.

It is two rules rather than one, because a string being relative is not the same
as a file landing inside. `insideWorktree` answers the first and drops the line;
`unlinkedInside` answers the second, walking every segment of the destination
before the copy — a checkout may track `config -> ../shared`, and a worktree
materialises that verbatim. It walks the path normalised, as `join` will use it:
spelled `x/../config/master.key`, a raw walk stopped at the missing `x` and
never reached the link. Both live in `paths.ts`, and the env file is held to the
same pair.

`resolvesInside` beside them is the third, and the odd one: it **follows** a link
rather than refusing it, and answers where it landed. Refusing every link is
right before a write, where a link is a redirection nobody asked for, and wrong
before a read of something already committed — `hooks/format.sh ->
../../tools/format.sh` is ordinary, and the file it names is in the worktree.
The trust digest is its caller. An absent path answers false here and true
there, for the same reason read and write differ: nothing that is not there can
redirect a write, and nothing that is not there can be read.

**Sources do not travel.** `.octopus/carry` is committed and cloned by everybody,
and `~/work/planner/.env` is a fact about one laptop — so `carryListForExport`
strips every source on the way out and the repository receives the list it always
did. The same holds coming in. A trusted repository's list is read live from
the worktree being prepared and added to this one (`resolveCarry` in
`repoSource.ts`), but a repository line gives only its path — its file comes
from the checkout — and counts only with no link along it, in the worktree or
the checkout, and when git ignores that path **in the worktree**, with the
branch's own `.gitignore`. So a repository can neither name a file on this
machine to be copied in nor have a real `.env` land where a commit would publish
it. Where both lists name a file, this one's line wins,
source and all; a list replacing it would drop the `config/master.key` somebody
added. Nothing is copied when a project is added — a copy is what kept a list
changed upstream from ever arriving — so this file holds only what was written
here.

It **never overwrites** — `COPYFILE_EXCL`, so a file edited inside the worktree
survives and there is no window between a check and a write. A path the checkout
does not have is passed over rather than failed on: a list is written once and a
project's needs change.

Anything absolute, or reaching outside the checkout with `..`, is dropped rather
than refused. The list is typed by hand, and one bad line should not stop the
rest of a workspace being prepared.
