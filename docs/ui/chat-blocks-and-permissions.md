# Blocks, permissions and questions

**A call and its answer are one block, at the call's place** (`buildBlocks` in
`logBlocks.ts`). The answer arrives later and sits further down the log, as does
the context recorded for an edit; both are folded into the call's block rather
than given blocks of their own. Position is a block's key, so an answer arriving
never moves a row — which is what keeps a row opened while its tool ran open
when the tool finishes. The question call is not a row at all: its card is the
whole of it, and a row beside the card would be the same question twice.

**Text the agent produced keeps the line breaks it arrived with.** A stack
trace, a compiler's three lines of context, a validation error listing the value
it refused — every failure worth reading has newlines in it, and they are the
first thing a reader uses to find the sentence that says what to do. Nothing in
`styles.css` sets `white-space` and Tailwind's preflight sets none on a `p`, so
a paragraph that does not ask for it collapses the lot: the tool failure did,
while the note against a plan ten lines below it did not. The pairing is
`whitespace-pre-wrap wrap-anywhere` — not `break-all`, which chops ordinary
words mid-character, and not `whitespace-pre`, which would take the scrolling
log sideways.

**Markdown carries the second half of that pairing itself.** The sent bubble was
capped first and the agent's side was left to `Markdown`, which set neither — so
the same pasted URL or line of minified JSON overflowed its paragraph one turn
later, when the agent quoted it back. The pane it sits in is `overflow-auto`, so
the overflow became a sideways scroll of the whole conversation and took every
other row off-centre with it. `wrap-anywhere` goes on the prose blocks
individually rather than on the wrapper: `overflow-wrap` is inherited, and a
fenced block keeps its own horizontal scroll — `white-space: pre` wraps nowhere
whatever this says, and breaking code at an arbitrary column would misrepresent
it — while a table already scrolls inside its own box, so wrapping its cells
instead would be a different design.

**A sent message is drawn from what it is made of** (`userMessage.ts`), and
never changed: what the agent read is what the log shows, only laid out. A note
on code — a `path:12-18` line with `>` lines under it, the shape `withNotes`
writes — becomes a card: the place in mono, the lines unwrapped and coloured by
their file's grammar, the remark under them. The colours land after the card is
drawn, as the viewer's do, and come from the quoted lines alone — four lines
from inside a comment opened above them are coloured as code. A reference in
running text, like a pasted ⌘C, becomes a mono chip; a path has to look like
one, so `10:30` stays a time and a URL's port stays in the URL. A message with
neither is drawn exactly as it always was, character for character.

**A turn's footer needs a turn.** One at the head of the log has nothing above
it to close, and `/clear` used to leave exactly that: the transcript went with
the reset and the command's own result landed a tick later, so an emptied
conversation opened on a row reading `0.1s · 0 tokens` — three facts about a
turn nobody could see, and clearing again only replaced it. `service.ts` no
longer writes that entry; this rule is what the transcripts already carrying one
need, and it is why `buildBlocks` skips rather than filters — position is a
block's key, and the entries after the footer have to keep the indices they had.

**An edit is drawn as the edit, under its row**: the path, `+8 −2`, and the
lines themselves on the `danger` and `success` washes, coloured by the file's
grammar the way the diff pane colours them, a gutter sign saying which is which
without the colour. An `Edit`, a `Write` and an older CLI's `MultiEdit` — its
edits drawn one after another with a `⋯` between them, since they land in
different places. An edit that failed draws no diff: it changed nothing, and
the line under the row says why. `Plan` is not a tool row at all — it arrives as
a tool call and is the substance of the turn.

Three things about that diff are worth knowing:

- The change itself is read from the **call's own arguments** — an `Edit` is
  handed the text it replaces and the text it writes. A `Write` is reported as
  all additions, because what stood there before is not in the call and a
  "before" invented for a tidier diff is the one part the reader could not check.
- **The lines either side are read from the file the moment the edit succeeds**,
  and kept. Looked up when the conversation is drawn they would be wrong: a later
  edit shifts every line after it, so the context would surround wherever that
  text has since ended up. Recorded once, it stays true — and it arrives as its
  own event a moment behind the call, because reading a file is not something
  the event handler can wait for without letting events overtake each other.
- **A removed line carries no number.** It belongs to the file as it was, which
  is not something we kept, and a number there would be out by everything the
  change added. Where no context was recorded — a `Write`, a file since changed,
  an older transcript — the numbers are left off altogether rather than started
  from one.

The first ten lines show under the closed row, as Claude Code shows them, with
"N more lines" for the rest; opening the row shows them all. The median change
is two lines, so it is almost always whole, while a file written whole runs to
hundreds and must not push the conversation away. The line diff runs once per
edit and is remembered against the call, since the blocks are rebuilt every
time the log grows.

**Permission requests appear in the log**, where the user is already looking,
with allow / always / decline. A request read back from the transcript shows no
buttons: it was answered long ago, and offering them would let someone answer a
question nobody is waiting on.

**A question the agent asks gets a card of its own**, with the options it
offered, what each one means, and a field for saying something it did not think
of. It stays in the log rather than becoming a dialog, and for the opposite
reason to the plan below: the answer belongs to the conversation and is still
worth reading a month later, and a modal would cover the very context the choice
is made from. Read back from the transcript it shows what was picked — which is
why the answer is recorded as an event, since the call above it holds the
questions as they stood before anyone answered.

The preview an option may carry opens under whichever option is being looked at,
following the pointer and the keyboard rather than the selection: it is there to
compare options while choosing, and four mock-ups open at once is a wall rather
than a comparison.

**Skip** is not a refusal. It approves the tool with its arguments untouched, and
the agent reads that as "nobody answered" — its cue to ask again rather than to
guess. Declining outright is not offered at all: a question is not a permission,
and the agent reads a refusal as instruction.

**A finished plan gets a dialog instead**, and the request that carried it draws
nothing in the log at all — the plan is already there, from the `ExitPlanMode`
call it arrived in, and a card would be the same text a second time under a
second set of buttons.

It is the one permission worth interrupting for. A plan is the substance of the
turn, and as a strip with two buttons on it the whole thing was read past on the
way to one; what the agent did next was start editing files.

**One button and a field**, which is what the question actually has:

- **Execute** runs it, out of planning, in the mode Settings names for an
  approved plan — `Auto` by default, or `Accept edits` — see the footer's mode
  in [chat-pickers.md](chat-pickers.md) for why. A line beside the button says which, because the click widens
  what the agent may do and that is worth reading before it rather than in the
  footer after it.
- **The field is how you carry on planning.** Writing in it _is_ that, so a
  button saying so was the same decision offered twice. `Enter` sends and
  `⇧Enter` breaks the line — the composer's keys, one convention rather than
  two. The note reaches the agent as the refusal's reason, so "add a step for
  the tests" comes back as a better plan rather than a stopped conversation, and
  that plan raises this dialog again.
- **Saved prompts are offered beside the field, and only the ones marked for the
  plan.** The same fan as the composer's, over the same button, drawn **into the
  dialog** because `showModal()` makes everything outside it inert. A prompt is
  written into the note where the caret is, and travels as the refusal's reason
  like anything else typed there, so it is visible in the log as the message it
  is. With nothing marked there is no button — the dialog stays as it was — and
  there is no way to the settings from here, because a plan is being decided
  about and the agent is blocked on the answer. Escape closes the fan and
  **only** the fan: it would otherwise be the dialog's own "keep planning",
  which answers the agent.

Dismissing sends whatever is in the field, empty or not. The agent is blocked on
this answer, so a dismissal that resolved nothing would leave the conversation
waiting on a question no longer on screen.

**Minimising is the one way out that answers nothing.** A plan often sends the
reader to a file, the diff or the terminal before they know what to say back,
and the dialog covered all of them. The `–` beside the × sets it aside: the
agent goes on waiting, and a strip above the message field says so and reopens
the dialog with the edited plan and the half-written note as they were — both
are held by the pane, by request, because the dialog unmounts while it is
away. The strip is what keeps this from being the dismissal refused above: the
question stays on screen. A new plan from the agent is a new question and opens
its own dialog.

**An MCP server's question gets a card, and says whose it is first.** A server
may stop mid-call and ask for a token, a choice or a confirmation. The SDK
offers `onElicitation` for it and **declines automatically when nothing answers**
— so before this the server was refused, the agent carried on as though an
answer had been given, and nobody saw anything. That is reachable today rather
than hypothetical: `settingSources` includes the project layer and a worktree's
own `.mcp.json` starts servers, so any repository somebody clones can raise one.

A card in the log rather than a dialog, for the reason `QuestionCard` gives: the
answer belongs to the conversation and stays worth reading a month later. What
is different from every other card is the first line — **which server is
asking**. This is the one thing in the log written by software nobody here
chose, and a form asking for a token with no visible author is the shape a
phishing prompt has.

**It marks the conversation as waiting**, as a permission does: the turn is held
on it just the same. So the workspace's amber dot, the project tile's mark and a
"has a question for you" notice all appear for it, and answering puts the
conversation back to working. It used to stay `running`, and an agent stuck on a
form looked busy rather than stuck.

Two things are refused rather than drawn, and both would otherwise be this app
pretending. A `url` mode asks the host to send somebody to an address a
repository chose, which is an outward-facing act and is not taken on a server's
say-so. And a schema `elicitation.ts` cannot read is declined with a reason,
because a half-drawn form collects an answer the server then refuses and the
user has typed it for nothing.

`decline` and `cancel` are different words to a server and so different
sentences here: one is the user saying no, the other is the question going away
when the turn stopped.
