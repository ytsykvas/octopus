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
the listing, and the open card's detail re-reads on it. The board reads again on `board:changed`
for its project — the folder's watcher saying something on disk moved
([data/board.md](../data/board.md#changes-from-outside)) — and on the window's `focus`, for a
change no event reported: a sync service writes while the window is elsewhere.

**Failures.** A first read that fails is the screen's own state, "The board could not be read"
with Try again. A later failure keeps the cards and goes to the banner, and the next read that
works clears it (`reported`). A later `boardFolderUnset` or `boardFolderUnreadable` means the
folder itself is gone, so the cards go too and the screen says so. The banner belongs to the whole window, so every read — Try again and the re-reads on `board:changed` and on focus included — is abandoned when its board stops being shown: another project, a cleared folder or the screen gone. Its answer, a failure or a success, then reaches neither the board nor the banner.

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

Of the window's shortcuts only ⌘⇧N and a digit under ⌘ or ⌃ work on the board; its own keys are
under [Keyboard](#keyboard). ⌘1–⌘9 switch the board's project; ⌃1–⌃9, ⌘⇧N, a toast's Show and a
status-bar row open a workspace, and so leave for Octopus. The rest —
⌘T, ⌘⇧D, ⌥1 — act on a conversation or a pane the board does not show.

The title bar shows the folder the board reads where the repository's path stands on Octopus, with
no branch and, instead of the controls at its right, the [filter](#filter-and-search); with no
folder chosen it shows the app's name and no filter. That folder is the one on disk, which core
finds by name regardless of case, so `BoardScreen` writes it into a slot App leaves in the bar
(`titleSlot`) rather than App building it from the project's name; the slot is empty while the first
read is out or has failed. A loose card whose file sits in a folder that is not a status shows that
folder's name first on its second line, so a renamed status folder is visible rather than silently
emptied.

## Creating a task

The + in a column's header opens a field above its first card. It is `NameEditor`, so Enter or a
click elsewhere creates the task and Escape or an empty title creates nothing — the same field
every rename in the window uses. The new card goes to the top of its column: it is what was just
thought of. Every write, worked or refused, reads the board again (`settle`): a refusal usually
means the disk has moved on from the cards on screen, and the board should show it. A refusal is
reported after that read, so the read cannot clear it, and a write whose board leaves before it
settles — before its answer or during that read — reports nothing and answers as refused, so the
next board never opens or follows a card the last one wrote.

## The card panel

A click on a card opens its panel on the right — a panel rather than a modal, so the board stays
in view and the next card is one click away — and a card just created opens at once. The header
holds the status, priority and tag menus, More (Delete) and Close. Their items carry no icons:
`DropdownMenu` draws the tick where an item's icon would be, so the value's look sits on the
trigger instead: the priority's icon, the tag's colour. Choosing the value a card already has
writes nothing.

**A move follows its card.** A status change moves the file into another folder, which gives it a
new ref. Every move goes through `moveCard` in `BoardScreen` — the status menu's, dragging's and
⌥↑/⌥↓'s — and the panel follows the new ref, but only while it still shows
that card. The panel and its detail are keyed by the opening, not the ref, so a move keeps what
the panel holds and shows, and an opening's number is never reused, so a card opened after a close
never shows the last one's description. The status menu puts the card first in its new column.
Another project or another board folder closes the panel and the new-task field.

**Delete asks first** and sends the file to the Trash through core; it closes the panel only when
it was that card's. Copy description puts the whole description on the clipboard, its `# title`
line included, with the whitespace around it trimmed. A file that is not UTF-8 shows a warning in
place of its description and has nothing to copy or edit; its comments still show.
A double-click on the title renames the card: only its `# ` line changes, and the file keeps its
name, which is what other Macs and links know it by. The panel's width is dragged from its left edge,
320 to 720px, and not saved.

`useCardDetail` reads the open card at its ref, again on every listing `revision`, and keeps the
previous detail while the same opening is read again. A card removed outside is quiet
(`cardMissing`): the next listing drops its panel, and the panel comes back if the file does. Any
other failure to read it is said in the panel, where the description would be, not in the banner:
it belongs to the card, and the next read that works takes it away.

## Editing a description

Edit opens the whole description, title line included, in a plain textarea with a preview —
not a rich editor: the file is the source of truth and the agent reads the Markdown as written.
Saving sends `base`, the description as it was when the editor opened, not the whole file, so
octopus's own header writes in the background do not count as a conflict. When the description
changed on disk meanwhile, nothing is written, the banner stays out of it, and the editor offers
Reload, which drops the edit, and Overwrite, which saves over it on purpose — and neither happens
until one is chosen.

An edit not saved yet survives closing the panel, another card, a status change, ⌘1–⌘9 and the
screen switch: the editor hands it up once on the way out, as the composer does, and `App` keeps
it by project and card (`boardDrafts`); a move carries it to the card's new ref, and a card
created in place of a deleted one starts without it. The panel is keyed by the opening, so a move
does not remount the editor.

## Comments

Comments sit under the description, oldest first, with their time; they are kept at the end of
the card's file under a marker (`docs/data/board.md`). The field opens on demand — opening a card
is a click on the board, and a field that took the caret then would take it from the board — and
⌘Enter posts once, however many times it is pressed while the write is out. A refused comment
stays in the field. Editing or deleting a comment is not offered.

## Drag and drop

A card is dragged with the browser's own drag and drop, one state for every column (`useBoardDrag`).
The drag carries its own type, `application/x-octopus-card`; a file from the Finder or dragged text
has none, so the board's `dragover` never calls `preventDefault` for it and the browser shows that
it cannot be dropped. The landing index is counted in the target column without the dragged card and
cut to the ordered part (`dropSlot`; core does the same in `orderForDrop`), and the line is drawn
under the card before that slot, which keeps it above the "By name" divider where the card really
lands. Leaving a column for something outside it — the panel, the title bar — takes its line away. A
drop that would change nothing — an ordered card on its own slot, a card alone in its column, or a
card let go over its own tile — writes nothing. The move goes through the screen's `moveCard`, so an
open card stays open under its new path. `useDragReorder` is not reused: it keeps one list, its
`dragstart` gets no event to put the type on, and an empty list cannot take a drop.

## Keyboard

The board is driven from the keyboard with the browser's own focus, as the workspace list is:
a card is a button carrying `data-card-ref`, with no roving tabindex and no focus state of its
own. Enter and Space open the focused card because it is a button. The board's keys act only
when the key lands on a card button or on the body; on any other control the key is that
control's, so Enter on the panel's Close closes it and letters typed in a field stay text. The
key acts on the focused card, or on the open one when nothing has the focus. C, J and K are read
as typed on a Latin layout and by the key's place on any other, so a Cyrillic layout's `с`, `о`
and `л` work too.

| Key               | Action                                                        |
| ----------------- | ------------------------------------------------------------- |
| `C`               | new task in the target's column, or in Backlog with no target |
| `↓` `J` / `↑` `K` | next / previous task in the column                            |
| `→` / `←`         | the neighbouring column that has tasks, at the same position  |
| `⌥↓` / `⌥↑`       | move the task one place down / up                             |
| `Esc`             | close the panel; with it closed, let go of the focused task   |
| `⌘⌫`              | delete the task, after asking                                 |
| `/`               | put the focus in the search                                   |

An open menu or popover — a status-bar list — keeps every key: its Escape listener is added after
the board's, so the board checks for `[role="menu"]` and `[role="dialog"]` rather than
`defaultPrevented`. `⌥↓` does nothing past the last
ordered card: core cuts a drop index to the ordered part, so the step would write the same
place.

With a panel open, the arrows and J/K open the card the focus lands on, so the panel follows the
focus and the description editor of the card left hands its draft up. React keeps the focus on a
tile it moves, but a loose card comes back from ⌥↑/⌥↓ under a new ref, as a new node; a layout
effect puts the focus on it once the moved listing is drawn, and the same effect gives the focus to
the card whose panel Esc closed. It does so only from the body: a key pressed while a move was out
— C, J — may have put the focus where it is wanted.

## Filter and search

The search field and the priority and tag menus sit at the right of the title bar while the board
of a chosen project is in front (`BoardFilterBar`). The filter lives in `App`, is not saved, and
starts empty for every other project: the reset happens during render, as the selection's does. A
card stays when every word of the query (NFC, lower case) is in its title or in its tag's label in
the current language, and its priority and tag are among those chosen, "none" included. Under a
filter a column shows a fraction of its cards, so dragging and `⌥↑` / `⌥↓` are off — the
neighbours a new position is computed from would be wrong — while the status still changes from
the panel. A column's count reads "1 of 2", and a column the filter emptied says so instead of the
ordinary empty state; a card it hides keeps its panel open, a card just created under it included.
`/` puts the focus in the search under the same rule as the board's keys, and is read by its place
too, unshifted, as C, J and K are; Escape clears the query alone and leaves the focus on the body.

## Run

**Run** makes a workspace from the card (`board:run`), switches to it and puts the card's
description into its first conversation's field — never sent. **Open workspace** takes its place
when a workspace on this machine was started from the card, and goes through the same call: the
core answers with that workspace and, while none of its conversations has started, the
description again, because the first draft lived only in the window. A draft goes only into an
empty field (`offerDraft`), so text somebody typed there stays. Before a second workspace is
started for a card another installation has an open run of (`device`, not the hostname), the
screen asks; opening the one here asks nothing. The button is disabled while its call is out, and
`App` starts one run at a time: the panel closed and opened again offers the button afresh. Help's
command does the opposite on purpose — it sends — because a card is a task the reader may still
edit.

## Marks

The second line of a card says what is happening to the work, first match wins: a workspace on
this machine started from the card — its status mark, mood word and pull request mark, the same
components the list draws; any run without an end whose `device` is another installation's — "In
work on <machine>", even when a later run has ended; the latest run merged — "Merged"; the latest run
ended, which the removal writes, or a run of this installation without an end and no workspace here
— "Workspace removed" (a removal that could not write its summary; a slow one may land it later).
The live workspace wins over the file because it is what is happening now. The pull requests come
from App's own `useBranchRequests`; a request older than the hundred most recent is not in that
answer, and the card then shows no request mark. Until the workspace list has loaded, a run of this
installation reads as removed for a moment.

## Runs

The panel lists a card's runs newest first by `started` — not in file order, since a run whose
first write failed is appended later; the marks take the latest run the same way. Each row gives
the day, the machine label, and how the run stands — merged, workspace removed, or in work — with
the pull request as a link (`#310`, or the address when it names no number). Unlike the marks,
which ask only whether any workspace from the card is here, a row matches its own workspace: an
open run of this installation is in work only while the workspace whose `createdAt` is its
`started` is here. A run merged on another Mac reads "merged" while its workspace there lives, even
as the card's mark still says "In work on <machine>". Once the removal writes the run's summary, a
second line adds turns, active time and tokens in and out — written by `formatDuration` and
`formatTokens`, as the usage card writes them — and the accounts seen. Neither line shows a cost
(PROJECT.md §16).

## Resources

Below the description, a card lists its links — the `links` key of its header. **+** opens a menu;
"Add link" asks for one address in the app's own dialog and refuses, while it is typed, anything
`isCardUrl` refuses: an address that is not `http:` or `https:`, that carries credentials or that is
longer than 2,000 characters — the rule `board:update` applies again. An address already in the list is not added twice, and at
twenty links the item is disabled, because `CardPatchSchema` refuses a longer list. A link opens in
the system browser: the window hands a `target="_blank"` link to `setWindowOpenHandler`, which
passes only web pages on. Each row has a button that removes the address; the whole list is written
back at once. While it is written, the remove buttons and "Add link" are disabled: each change is
built from the list on screen, which changes only once the board is read again, so a second one
would bring back what the first removed. A file that is not UTF-8 has no section: its header cannot be changed.

## Known limitations

- Every read lists and reads every file of the project's folder; a folder of thousands of large
  files reads slowly.
- A card cannot be dragged from the keyboard: the browser's drag and drop has no keyboard path.
  ⌥↑/⌥↓ reorder one within a column, and the status menu in the card panel moves it to another.
- The filter menus close after each choice, so several values take several openings, and they
  announce their items as radios although several can be chosen.
