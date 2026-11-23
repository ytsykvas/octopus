# The board's folder

The board is the one thing octopus keeps outside `~/.octopus`. Its cards are markdown files in a folder the user chooses in Settings, so whatever syncs that folder carries the board between Macs, and every card stays a file Finder and any editor can open. [`src/core/boardFiles.ts`](../../src/core/boardFiles.ts) is the only module that touches it.

## Where it lives

```
<board folder>/
  <project>/                 boardFolderName(project name)
    backlog/                 status folders: made by the first write into them
    in progress/
    testing/
    staging/
    done/
    blocked/
    _attachments/<card>/     a card's attachments
    <any>.md                 a loose card, shown in Backlog
    <any folder>/<any>.md    a loose card, shown in Backlog
```

A project and its folder are matched by name (`boardFolderName`, then `sameName`, which ignores case and Unicode normalisation). Nothing stored links the two.

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

## Status folders

A folder is a status when its name, lower-cased, with `-`, `_` and runs of spaces turned into one space, is one of the six (`statusOfFolder`): `In-Progress` is "in progress". Of two folders of one status the first by `compareNames` takes new and moved cards; the cards of both are shown. A link, a file, or a folder whose name starts with `_` or `.` is never a status folder. Nothing is made by reading: a project with no folder is an empty board and a missing status folder an empty column, each made by the first write into it — so two Macs opening the board at once cannot leave a `backlog 2` behind.

## What is a card

Every `.md` file, in any case, in the project's folder or one level below it. One directly in the project's folder, or in a folder that is not a status, is a **loose** card, shown in Backlog. Skipped: names starting with `_` or `.`, names ending in `.tmp`, links, anything deeper, and files that cannot be read. A file that is not UTF-8 is listed by its file name with no text and marked, and nothing ever writes it: decoding would replace what it holds with U+FFFD, and writing that back would lose it.

## A ref

A card is named by its path inside the project's folder, `backlog/Fix login.md`. Before a ref becomes a path, `guardRef` checks it: one or two segments, none starting with `_` or `.`, ending in `.md`, and no link anywhere along it.

## What is written, and when

Reading — the board, one card — writes nothing, not even a folder: the files are the user's, some predate the board, and an unasked write would sync to every Mac.

## Known limitations

- A project is found by name: renamed, it shows the empty board of its new name until its folder is renamed too.
- Prose between two `---` lines at the very top that parses as a YAML map is read as a header.
- Only iCloud was measured on two Macs (B001). Google Drive in stream mode gives the same plain files, but its not-yet-downloaded files, conflict copies and watch events were never measured.
