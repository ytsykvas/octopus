# Pasted images accumulate with nothing removing them

**Found:** 2026-09-06, on making the paperclip work.

## What happens

`~/.octopus/attachments/` gains a file every time an image is pasted into the
composer, and nothing ever takes one away. A screenshot is a few hundred
kilobytes; somebody who works by pasting them will have a few hundred megabytes
there in a year, and no reason to look.

Only pastes. A file dragged onto the composer or chosen from disk keeps its own
path and is never copied — that is the whole design, and it is why this is one
directory rather than a store.

## Why it matters

Less than it sounds, and the reason is worth keeping. The directory is under
`~/.octopus`, which the user can open and empty; the files are their own
screenshots; and nothing breaks when they go — the message that named one has
already been sent, and the path in it points at a file the agent has read.

What it is, is an application quietly using disk with no way to see it doing so.

## What is already decided

**Not a temporary directory.** That was the first answer and it is wrong here:
the directory is handed to every session as a root, and a system that tidies
`/tmp` mid-conversation would take a screenshot the agent is about to be asked
about.

**Not deleted with the conversation either.** A path in a message is a promise
the file is there, and a transcript is read back weeks later.

## Sketch

Two candidates, and the second is probably right:

- **A reaper on start-up** — remove anything older than some number of days.
  Simple, and it breaks the promise above for an old conversation.
- **Say it in Settings.** The About or Danger section already names where things
  live; a row saying how much is in there, with a button to empty it, makes the
  disk visible and leaves the decision where it belongs. That is also the shape
  used for the trust digest and the skill stores.

Worth doing when Settings is next opened rather than on its own.
