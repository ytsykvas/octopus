# The Files tab

The worktree as an editor's explorer draws it, with git's marks. Kept mounted
while hidden like every tab of the pane, so the open folders and the scroll
position survive a look elsewhere; the open folders are remembered per
workspace too.

**The marks are measured against where the branch began** — the same starting
point the Changes tab and the viewer use — so a commit does not empty the tree
while Changes still lists the file. They were measured against HEAD at first,
as an editor's explorer does, and a branch of committed work then showed nothing
at all. The marks come from the same `--name-status` read as the Changes tab; an
untracked file and a conflict, which no diff sees, come from `git status`, and a
file edited and put back the way the base had it carries no mark. With no base
to be found the tree marks against HEAD, as it used to. A file deleted in a
commit stays in the tree, struck through, and opens on the last version the
branch had. The colours and letters come from
`statusMarks.ts`: green for new, amber for edited — the colour Changes gives what is not
yet committed — red for deleted and conflicted, the conflict marked `!` because a diff against a merge base never
sees one. The letters are the ones editors draw — git's `M A D R C T`, `U` for
untracked, `!` for a conflict — in every language; only the word said after the
name is translated. The Ukrainian initial for "changed" was `З`, which before a
path read as a 3. Changes no longer draws the letters — its letter column holds
the rung, and the kind of change is on the name there. A folder with work below
it carries a dot in the colour of the strongest change inside, so a collapsed
folder still says there is something in it. Each mark is said aloud after the
name; the colour alone says nothing.

**Deleted files stay in the tree, struck through.** An editor's explorer drops
them, but a deletion is work as much as an edit is, and the mark is the point of
the tab. Git lists them unevenly — a file removed from disk is still in the
index, one removed with `git rm` only in the status — so `fileTree.ts` adds every
path the status names.

**Ignored entries are shown greyed**, and an ignored folder opens: git reports
`node_modules/` as one entry, and its contents are read from disk only when it
is expanded, through the same containment check as opening a file. A folder
lists at most 5 000 entries and says so under the last. One rule decides what
is read (`useFileTree`): a folder drawn open that is read from disk — one git
names whole, or an untracked one holding something (below) — is read whenever no
listing holds it: the one just clicked, those opened to show the open file, and
every one after a switch to another workspace and back, since the open folders
outlive the switch and the listings do not. A refresh reads again only those
still drawn open; one closed, or left open inside a folder closed since
(`drawnOpen`), is let go rather than read on every turn after, and read afresh
once it is drawn again. A listing replaces the children of a folder git names
whole and completes those of an untracked folder holding something; `git add
-f`, an edited `.gitignore` or a commit hands the folder back to git's own
children and marks, and the listing is let go on the next read, as it is for a
folder deleted whole, rather than read again on every turn for nothing. A first
file in an empty folder turns replacing into completing. A folder inside one
read from disk goes the same way once that one's listing stops naming it —
`node_modules/pkg` after a reinstall, which git cannot report, since it still
names `node_modules` whole. Names are compared composed: git prints them so on
macOS, and the disk gives back a name Finder stored decomposed.

**A submodule is a folder, read from disk the same way**, and nothing inside it
is greyed or marked: the outer repository has nothing to say about it, its own
ignored folders included. `ls-files --cached` names one like any file, which
drew it as a file the viewer then found to be a folder, so the tracked files are
read with `--stage` and a mode of `160000` makes the entry a folder. Every
folder inside it is read from disk in turn — git lists nothing in there — and a
submodule git reports as changed, by a new commit or an edit inside, carries
that status on the folder's row. A workspace's submodules are often not checked
out — `git worktree add` leaves every one an empty folder — and any folder read
from disk with nothing in it says so on a line of its own, rather than opening
onto nothing that reads as still loading. A repository cloned or initialised
inside the worktree without being added as a submodule is the same kind of
folder: git names it `nested/` among the untracked and never looks inside, and
taken as a path that drew a folder holding a row with no name. It now opens like
a submodule, ungreyed, with the untracked mark on its own row.

**An empty folder is in the tree too.** git lists files, so a folder the agent
has just made — before it writes into it — was nowhere here while every editor's
explorer showed it. `ls-files --others --directory` names it, and names a folder
of untracked files the same way, so `parseUntrackedFolders` keeps as empty only
the folders with nothing at or under them in the untracked or the ignored
listing — a hidden name like `.DS_Store` not counting, since the tree drops it.
Each is read from disk when opened, and says it holds nothing; a folder holding
only an empty folder is named whole and opens onto it. git names only the
topmost untracked folder, though, so the agent's usual scaffold — `mkdir -p
new/{a,b}`, then a file in `a` — prints `new/` alone and never the empty `b`.
The folders it names that do hold something travel with the tree
(`untrackedFolders`), and each of them, and every folder of git's inside one, is
read from disk when opened: its rows stay git's, with their marks, and the
folders on disk git does not name are added (`withFoldersOnDisk`). One read per
open untracked folder, never a walk of the worktree.

**Read when it could have changed, never watched**: when the tab is shown, when
a turn of any of the workspace's chats ends (settled 300ms, like the diff), when
the window regains focus — which is what catches an edit made in another editor
— and on Refresh. Nothing is read while the tab is hidden, and a turn that ends
while the window is hidden is read once it is shown. `git status` runs
with `--no-optional-locks`, so it never takes the index lock the agent's own git
needs in the same worktree.

**Rows are virtualised.** Every row is 22px, so the rows in view are a slice of
an array and the space above and below them is one spacer each; a folder of
thousands opens without a pause. For the same reason the tree is a `tree` with
`aria-activedescendant` rather than a roving tabindex — the focused row may not
exist in the DOM, and focus kept on the tree cannot be lost when a row is
recycled. Arrows, Home and End move; Right opens a folder and steps into it, Left
closes it and steps out; Enter keeps a file open, Space previews it. Collapsing
a folder that held the focused row leaves focus on the folder, not at the top.

**The filter narrows the tree to a flat list.** Typing in the field over the
tree swaps it for the files that answer, best first and each beside its folder,
ranked by `rankFiles` — the `@` list's own order, so the two never disagree
about what a query means. Flat, because the question was "where is it", and an
answer folded into folders makes the reader open them to find out. It covers
every file the tree holds, including those of a folder already read from disk —
the tree, not the disk, which is what the empty answer says — and stops at 200
with a line saying so. The field keeps focus — a combobox over its listbox — so
the arrows move through the matches while typing goes on, the one they reach is
scrolled into view, Enter keeps it open, a click previews it, and Escape gives
the tree back. The choice is held by its file, not its place: the tree is read
again after every turn, and a place held across that pointed at another file.
The state lives in `useFileFilter`; a match draws its name and mark with the
tree's own `EntryLabel`.

**Show the open file** opens every folder above the file in the centre, scrolls
to its row and puts focus on the tree there, as an editor's explorer does on
request. A folder above it that is read from disk — `node_modules`, a submodule
— is read along the way, and every folder inside that one too, since the tree
cannot know them before their parent's listing arrives; the scroll waits for
the row rather than for the click. It stops waiting once nothing it opened is
still being read — a folder the listing above it no longer names is never read,
and not waited on — or when the reader moves on — another file in the centre, a
key or a scroll in the tree, the tab put away. Left armed, a row turning up in a
later re-read moved the tree long after the click. The scroll is measured from
the tree as it is at that moment, which is also why the tree measures itself
when it comes back from under the filter.

**A row's path is copied the way an editor's explorer copies it.** `⌥⌘C` puts
the whole path on the clipboard, `⌥⇧⌘C` the one relative to the worktree, and
a right-click offers both beside **Add to chat**, which writes the whole path
into the conversation in front, at the caret its field last had — the
paperclip's way in, brought forward so the path is seen landing. Folders as
well as files. The keys are read from
`code`, because ⌥ turns the `c` into `ç` on macOS. What the copy did is said on
a line under the toolbar for two seconds: the menu that asked has closed, and a
refused clipboard is worth saying. Neither the menu nor the keys are on the
filter's list of matches.

**The icons are Catppuccin Icons**, the VS Code theme, resolved by the rules VS
Code applies to the same manifest: the whole name, then each extension from the
longest (`test.ts` before `ts`), then the language. It replaced Material Icon
Theme before the tab shipped, at the user's choice. There is no npm package, so
`vendor/catppuccin-icons/` holds the release as published — Latte's pictures,
Mocha's, the one table both share, and the licence — and
`scripts/vendor-icons.ts` refreshes it from a release pinned by version and
hash. Two traps, both handled in `components/files/`:

- `?no-inline` on the SVG glob is required. The CSP is `default-src 'self'`,
  and Vite turns assets under 4 KB into `data:` URIs, which that policy refuses —
  the icons would show in development and vanish from the built app.
- Every icon is drawn twice, Latte and Mocha, and one of the pair hidden by the
  app's own `.dark` class. Tailwind's `dark:` follows the operating system, not
  the theme the user picked.

The URL tables and the manifest are chunks of their own, loaded the first time
the tab draws.
