# ⌥1–⌥3 switch conversation while you are typing

**Found:** 2026-08-20, while writing the keyboard shortcuts page and trying to
claim that nothing fires during typing.

## What happens

The shortcut listener in `App.tsx` is on the window and has no guard for where
the focus is. Every other shortcut needs `⌘` or `⌃`, which are not typing
gestures, so they are harmless. `⌥` is different: on macOS it is how a great many
characters are typed.

Press `⌥1` while writing a message and the conversation switches, and the
keystroke is swallowed by the `preventDefault` that goes with it.

## How narrow it is

`⌥1`, `⌥2` and `⌥3` produce `¡`, `™` and `£`. Somebody writing Spanish will type
`¡` deliberately; `£` is a plausible thing to want in a message about pricing.
Not common, and not never.

The branch reads `event.code` rather than `event.key` on purpose — the comment
explains why, and that reasoning is right. This is not about which key is read.

## The fix, and the thing to be careful about

A focus guard: ignore the event when it comes from an input, a textarea or
anything `contentEditable`.

The care needed is that the terminal is not one of those — xterm.js uses a
hidden textarea, and blanket-ignoring textareas could stop shortcuts working
while the terminal has focus. Decide deliberately whether ⌘⇧D should work from
inside a terminal; it probably should.

## Evidence

- `src/renderer/src/App.tsx` — the `onKey` handler, and the `altKey` branch
- no `activeElement`, `tagName` or `isContentEditable` check anywhere in it
