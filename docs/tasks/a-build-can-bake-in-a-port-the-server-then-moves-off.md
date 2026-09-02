# A build can bake in a port the server then moves off

The port is settled at the start of the **server** half
(`src/renderer/src/components/ScriptRunner.tsx:244-256`, inside `launch()`),
because that is the only moment the answer is knowable — nothing of ours may be
listening while the question is asked.

The build half prepares the workspace too (`ScriptRunner.tsx:267`), and
`prepare` writes the env block with whatever port the workspace holds at that
moment (`src/core/service.ts:1743-1757`, reading `workspace.port` at `:1753`).
So in the one run where the port moves:

1. build prepares, writing `$OCTOPUS_PORT` as 3100;
2. build runs, and a bundler that reads env at build time bakes 3100 in;
3. server settles, finds 3100 taken, moves to 3110;
4. server prepares again — the `.env` now says 3110 — and serves on 3110.

The served bundle points at 3100. Vite's `import.meta.env.VITE_*` and Next's
`NEXT_PUBLIC_*` are both read at build time, so this is not hypothetical for
those stacks; it is just narrow, needing the port to move on the same run as a
build.

The fix is to settle once for the whole Run sequence rather than per half —
`useRunSequence` knows both halves and the build already waits for nothing else.
There is nothing in the hook to move, though: it holds the stage and the tokens
and nothing else (`src/renderer/src/hooks/useRunSequence.ts:69-159`), while the
settle is a call inside `ScriptRunner.launch()`. So the change spans both —
settle where the sequence is started
(`src/renderer/src/components/RightPanel.tsx:326-339`) and hand the number down,
or have the build half read a port already settled for it.

The cost is that a build started on its own would then also move the port, which
is the thing the current placement was careful to avoid while a server is up.
`Restart` is the sharper case: it bumps the server token with our own server
still listening (`RightPanel.tsx:386`, `useRunSequence.ts:90-97`), and what keeps
that safe is the teardown inside the half, which happens before `launch()` asks
(`ScriptRunner.tsx:288-318`). Asked from above the half, the question would be
asked while we are the thing listening — the bug the comment there records.

Worth doing when `useRunSequence` is next opened, with a test that runs a build
and a server across a port that moves — and with an eye on
`src/renderer/src/components/ScriptRunner.test.tsx:238`, which pins the build
asking for no port and holds only while the settle stays out of that half.
