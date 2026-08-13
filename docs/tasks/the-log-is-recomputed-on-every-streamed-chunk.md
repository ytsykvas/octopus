# The log is recomputed on every streamed chunk

## What happens

`ChatLog` calls `groupToolRuns(entries)` inline in its render body
(`ChatLog.tsx:79`), and every `text_delta` re-renders the pane. Each pass walks
the whole conversation and re-runs the LCS diff for every edit in it — twice per
edit, since `readChange` is called once to classify the entry and again to build
the block.

## Why it matters

An `Edit` replacing a 400-line block is a 160,000-cell table, rebuilt on every
chunk of the answer being typed out. A few such edits in one conversation and
the pane crawls for the rest of the turn — while the agent is writing, which is
when the log is being read.

## A sketch

`useMemo` on `entries` in `ChatLog`, and keep the `readChange` result from the
classification rather than computing it twice in `toolRuns.ts`.
