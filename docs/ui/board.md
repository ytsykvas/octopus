# The Board

`components/board/` draws one project's tasks as six columns — Backlog, In progress, Testing,
Staging, Done, Blocked — read from the project's folder inside the board folder
(`docs/data/board.md`).

**Reading never writes.** A project without a folder yet is six empty columns, not an error:
folders are made by the first card written into them (B105), so looking at a board in a synced
folder never races another Mac to create the same directories.

**`useBoard` holds the listing**, keyed by project and board folder, so a new folder is a new
board and another project's cards never show while the next one is read. A read counter keeps a
late answer from overwriting a newer one. An unchanged listing keeps its object, so no card
redraws, but `revision` moves on every read that worked: a changed description does not show in
the listing, and the open card's detail re-reads on it. The window's `focus` reads again — a
sync service writes while the window is elsewhere.

**Failures.** A first read that fails is the screen's own state, "The board could not be read"
with Try again. A later failure keeps the cards and goes to the banner, and the next read that
works clears it (`reported`). A later `boardFolderUnset` or `boardFolderUnreadable` means the
folder itself is gone, so the cards go too and the screen says so. The banner belongs to the whole window, so every read — Try again and the focus re-read included — is abandoned when its board stops being shown: another project, a cleared folder or the screen gone. Its answer, a failure or a success, then reaches neither the board nor the banner.

**A card** is its priority as a labelled icon, its title in two lines, its tag in the kind's
colour a quarter of the way to the ink (`LETTERS`, as the project tiles: raw pink and rose fail
4.5:1 as 11px text), its comment count, and one warning — a header that could not be read, or a
file that is not UTF-8 text, which is listed by its file name and never written. Cards with an
`order` come first; the rest follow in name order under a "By name" rule.

**Every hook in `BoardScreen` sits above its first return.** Later parts hang theirs on the
columns, and a hook below a return breaks the rules of hooks the moment the state changes.

## Getting there

Two tiles at the foot of the project strip, above Plugins, switch the window between Octopus and
the Board. The switch is about the window rather than a project, so it sits with Plugins, apart
from the scrolling list. Which screen is in front is not stored: like the list's fold, it lasts
for the session. With no projects at all both screens show the same pane offering to add one.

On the board the workspace list is not drawn and the right pane is folded **offstage**, not
unmounted: its terminals and servers belong to their workspaces and keep running. The fold's button
reads "Show workspaces" there and goes back to Octopus with the list open. The chat unmounts; its
composer files its draft on the way out, as on any switch. The workspace left selected is not on
screen there, so its agents' news arrives as a toast and a mark on the project's tab, and is cleared
when Octopus shows that workspace again. An error banner stays with the screen it was raised on:
every way off the board clears it, as a change of selection does.

Only ⌘⇧N and a digit under ⌘ or ⌃ work on the board. ⌘1–⌘9 switch the board's project; ⌃1–⌃9,
⌘⇧N, a toast's Show and a status-bar row open a workspace, and so leave for Octopus. The rest —
⌘T, ⌘⇧D, ⌥1 — act on a conversation or a pane the board does not show.

The title bar shows the project's board folder where the repository's path stands on Octopus,
with no branch and none of the controls at its right; with no folder chosen it shows the app's
name. A loose card whose file sits in a folder that is not a status shows that folder's name
first on its second line, so a renamed status folder is visible rather than silently emptied.

## Drag and drop

Not built yet: a card stays in the column its folder puts it in.

## Keyboard

Not built yet: the board has no keys of its own.

## Filter and search

Not built yet: every card of the project is shown.

## Known limitations

- Every read lists and reads every file of the project's folder; a folder of thousands of large
  files reads slowly.
