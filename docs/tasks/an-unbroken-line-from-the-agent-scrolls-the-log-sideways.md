# An unbroken line from the agent scrolls the log sideways

## What happens

The same text that broke the sent bubble — a pasted URL, a line of minified
JSON, any run of characters with no space in it — still has nowhere to wrap when
the **agent** writes it back.

The bubble was fixed: `ChatLog.tsx` caps the user's own message at the column
width and gives it a break opportunity. The agent's prose goes through
`Markdown` instead, which sets neither, so a long word is laid out at its full
width and overflows its paragraph. The pane it sits in is `overflow-auto`
(`ChatSession.tsx:157`), so the overflow becomes a horizontal scrollbar under
the whole conversation: every other row is now off-centre too, and reading the
log means scrolling it back each time.

## Why it matters

The agent quotes what it was given. A JSON blob pasted into the composer comes
back in the answer, so the case that produced the original report reproduces
itself one turn later.

## Evidence

- `src/renderer/src/components/chat/Markdown.tsx` — the wrapper is `min-w-0`
  and nothing else; no paragraph carries `overflow-wrap`.
- `src/renderer/src/components/chat/ChatLog.tsx:308-329` — `UserMessage`, for
  the shape the fix took and why `wrap-anywhere` rather than `break-words`.
- `src/renderer/src/components/chat/ChatSession.tsx:157` — the scroll container
  that turns the overflow into a sideways scroll of the whole log.

Reproduced for the sent bubble, from a screenshot of a real session. The
agent's side is read off the CSS, not off a run — confirm it in the app before
picking the fix.

## What is already decided

Fenced code keeps its own horizontal scroll. `CodeBlock` renders `pre`, where
`white-space: pre` means no wrapping happens whatever `overflow-wrap` says, and
breaking code at an arbitrary column would misrepresent it.

Tables are already out of it too: `Markdown.tsx:63-67` puts every GFM table in
an `overflow-x-auto` wrapper, so a wide one scrolls inside its own box. What is
left exposed is the prose — paragraphs, list items, blockquotes, headings,
inline code and links.
