# The board's folder

The board is the one thing octopus keeps outside `~/.octopus`. Its cards are markdown files in a folder the user chooses in Settings, so whatever syncs that folder carries the board between Macs, and every card stays a file Finder and any editor can open. [`src/core/boardFiles.ts`](../../src/core/boardFiles.ts) is the only module that touches it, and [`src/core/cardFiles.ts`](../../src/core/cardFiles.ts) for a card's files.

## Where it lives

```
<board folder>/
  <project>/                 boardFolderName(project name)
    backlog/                 column folders: made by the first write into them
    in progress/
    testing/
    staging/
    done/
    blocked/
    _attachments/<card>/     a card's attachments
    <any>.md                 a loose card, shown in Backlog
    <other folder>/<any>.md  a loose card, shown in Backlog
```

A project and its folder are matched by name (`boardFolderName`, then `sameName`, which ignores case and Unicode normalisation). Nothing stored links the two. The project's folder is found whatever its name, one the scan would skip included — `Release.tmp` is a name `boardFolderName` gives — and two projects whose names give one folder share it, and their writes wait for each other.

## A card file

An optional YAML header, only when the first line is exactly `---` and a closing `---` follows; then the description, whose first `# ` line outside a code fence is the title (none: the file name); then, after the line `<!-- octopus:comments -->`, the comments, each under `### <ISO time>`.

| Key        | Type                                | Absent means                     |
| ---------- | ----------------------------------- | -------------------------------- |
| `id`       | uuid                                | never run                        |
| `priority` | `urgent`, `high`, `medium` or `low` | none                             |
| `tag`      | a workspace kind                    | none                             |
| `order`    | number                              | after the ordered cards, by name |
| `links`    | http(s) URLs                        | none                             |
| `runs`     | list                                | never run                        |

A key with a bad value is dropped and the others kept; unknown keys are kept as written. A header that YAML cannot parse, but whose first line that is not a comment reads like a key, is **malformed**: the card is shown with a mark and its fields are never changed, because writing would put a second header above it. The header is rewritten through `yaml`, so its formatting may change when a field does; the body is copied byte for byte, BOM and CRLF included.

## Column folders

A board's columns are a list ([`src/core/boardColumns.ts`](../../src/core/boardColumns.ts)): the six built in, each its status, in the order shown. A folder is a column's when its name and the column's id, each lower-cased with `-`, `_` and runs of spaces turned into one space, are equal (`columnKey`): `In-Progress` is "in progress". Of two folders of one column the first by `compareNames` takes new and moved cards; the cards of both are shown. A link, a file, or a folder whose name starts with `_` or `.` is never a column folder. A card written or moved into a column the list does not hold is refused (`columnMissing`). Nothing is made by reading: a project with no folder is an empty board and a missing status folder an empty column, each made by the first write into it — so two Macs opening the board at once cannot leave a `backlog 2` behind.

## What is a card

Every `.md` file, in any case, in the project's folder or one level below it. One directly in the project's folder, or in a folder that is no column's, is a **loose** card, shown in Backlog. Skipped: names starting with `_` or `.`, names ending in `.tmp`, links, anything deeper, and files that cannot be read. A file that is not UTF-8 is listed by its file name with no text and marked, and nothing ever writes it: decoding would replace what it holds with U+FFFD, and writing that back would lose it.

A loose card is filed into its column's folder the first time it is moved, Backlog included; so is a card in the second folder of a column.

## A ref

A card is named by its path inside the project's folder, `backlog/Fix login.md`. Before a ref becomes a path, `guardRef` checks it: one or two segments, none starting with `_` or `.`, ending in `.md`, and no link anywhere along it.

## What is written, and when

Reading — the board, one card — writes nothing, not even a folder: the files are the user's, some predate the board, and an unasked write would sync to every Mac.

| Operation                         | Guard                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any change to a card (`editCard`) | reads the file, changes the text, writes only if it changed — through a temporary file and a rename — and refuses with `cardChanged` if its size or modification time moved in between             |
| A file that is not UTF-8          | never written (`cardNotText`); a move into another folder carries it and leaves its bytes, a reorder inside its folder is refused                                                                  |
| A header that cannot be read      | its fields are never written (`cardFrontmatterUnreadable`); a move into another folder carries it, a reorder inside its folder is refused                                                          |
| New card (`createCard`)           | its name is kept free across the whole project folder, every status and loose cards; `open` with `wx`: a file that reached the name since the listing is refused (`cardNameTaken`), never replaced |
| Move (`moveCard`)                 | refuses a file of the same name in the target folder (`cardNameTaken`); writes only `order`                                                                                                        |
| Description (`saveDescription`)   | refuses when the description changed since the editor opened (`cardChanged`) — blank lines at its end aside, since the first comment adds one — unless told to overwrite                           |
| Removal (`removeCard`)            | handed to the caller (`discardPath`); `boardFiles.ts` deletes nothing                                                                                                                              |

## Removing a card

A removal goes to the Trash: main hands `shell.trashItem` to the service as `discardPath`, and `boardFiles.ts` deletes no card itself. The service's default, used by tests, deletes.

## Changes from outside

One recursive watcher covers the whole board folder (`boardWatch.ts`). The first segment of a changed path names the project — every project whose folder it is — and after 300 ms without another change there the window is told to read that board again. A change to the board folder itself — FSEvents names it by its own name, which a project may share — tells every project. octopus's own temporary files and hidden names inside a project's folder are ignored; `_attachments` is not. The watcher is opened when the folder is chosen or the projects change, and checked again on every read of the board, so one that could not open — the folder not there yet — or that reported an error comes back the next time the board is read. A folder deleted and made again needs none of that: FSEvents watches the path, and its events keep coming. Reading the board when the window gains focus covers a change no event reported. A change made on another Mac arrives when the sync service writes it here, not before.

## Runs

`runCard` writes the card an `id` if it has none and appends one entry to `runs`: `started` (the workspace's `createdAt`, the entry's key), `device` (this installation's `config.deviceId`, which decides "another machine"), `machine` (the hostname without `.local`, a label only), `branch` after the rename, and the signed-in Claude account. An empty account list is not written. The id is written before the workspace is made, so a card whose creation failed keeps an id and no run.

`readBranchRequests` writes `pr` into the run of a workspace whose branch has a request, and `merged` the first time it sees the request merged — the time octopus saw it, not GitHub's `mergedAt`. It rides the window's poll, so it happens only while the project is open or the status bar shows, and waits for the board at most 5 seconds. A card that is gone or cannot be written is tried once per change of the request. At removal, once the record is gone and before the transcripts are deleted, `settleCardRun` writes `ended`, `turns`, `activeMs`, `tokensIn`, `tokensOut` and the account signed in then (joined with the one at the start, so a third account in between is not seen), and `pr`/`merged` when the removal itself asked GitHub. `tokensIn` counts the whole prompt of each turn, cache reads included, so it grows with the conversation; `activeMs` is each turn's wall time, waits for a permission answer included. A removal waits for the board at most 5 seconds; past them it goes on, and the summary may still land a moment later. No dollar figure is written (PROJECT.md §16). Nothing here moves a card or makes a folder.

## Order

A card's place in its column is its `order`: cards that have one come first, lowest first, and the rest follow by name. A drop writes a number between its new neighbours' — dropped among cards with no `order`, right after the last one that has — into the moved card and nothing else, so one drag writes one file; a new card takes one less than the first.

## Attachments

A card's files live in `_attachments/<stem>/` in the project's folder, `<stem>` being the card's file name without `.md`, so they sync with the cards. They are copies of files picked in the system's open dialog in main; the window never names a path. A name already taken gets `-2`, `-3`… before its extension, compared as `sameName` compares, and the copy is made with `COPYFILE_EXCL`, so nothing is ever replaced. A picked file whose name the board would skip (`.env`, `_draft.png`, `x.tmp`) is not copied, since it would never be listed. The folder is made just before the first copy, so nothing is made when nothing is copied. A copy keeps the picked file's quarantine flag (`com.apple.quarantine`), which `copyFile` drops: without it Finder would run a downloaded `.command` without asking, and a copy whose flag cannot be written is removed. A folder of files that cannot be read makes its card unreadable as well, named by `boardFolderUnreadable`. A failure part-way leaves the files already copied: removing them from a folder iCloud may already be uploading is worse than an extra file.

A file is only ever shown in Finder, never opened: a synced `.command` must not run on a click.

Two cards with one stem (`backlog/a.md`, `ideas/a.md`) share one folder, and a removed card's folder stays — a new card of that name inherits it. Renaming a card's file in Finder leaves its files behind. Neither the listing nor a copy goes through a symbolic link; a link planted between the check and the copy is an accepted gap. A folder of files linked out of the board is refused with `cardOutside`, naming `_attachments/<stem>`.

## iCloud

What iCloud does to this folder was measured on two Macs in B001 rather than read from documentation. A new card took about 9 seconds to reach the other Mac. After a card is moved to another folder, the maintainer assumes File → Revert To still offers its earlier versions; B001 did not check it. macOS guards Desktop and Documents: the built app says why it reads them (`NSDesktopFolderUsageDescription`, `NSDocumentsFolderUsageDescription` in `electron-builder.yml`), so a Mac that asks shows that reason ([releasing.md](../releasing.md)).

### Names in two Unicode forms

B001 saw names change form on the way: `Größe ändern.md` and `Їжак.md`, written composed (NFC) on one Mac, were listed decomposed (NFD, with U+0308) on the other, and a name created decomposed there arrived decomposed back. So one file can carry different bytes in its name on two Macs. The board keeps a card's name exactly as `readdir` gives it — a ref is never normalised, and nothing synced holds one: a workspace finds its card by the `id` in its header — and compares names with `sameName`, which composes both sides first. So such a card opens and moves under its own name, its `_attachments` folder is found by the volume, which ignores the form too, and a new card with the composed spelling of that name gets `-2`.

## Known limitations

- A project is found by name: renamed, it shows the empty board of its new name until its folder is renamed too.
- Prose between two `---` lines at the very top that parses as a YAML map is read as a header.
- Only iCloud was measured on two Macs (B001). Google Drive in stream mode gives the same plain files, but its not-yet-downloaded files, conflict copies and watch events were never measured.
- `order` is fractional and never rebalanced: many drops between the same two cards make long numbers.
- There is no cache: creating, moving and finding a card list the folder again, and an edit reads its one file again.
- A move checks that the name is free in the target folder, then renames: a file that reaches that name in between is replaced, because `rename` has no form that refuses.
