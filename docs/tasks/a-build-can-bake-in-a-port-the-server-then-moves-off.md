# A build can bake in a port the server then moves off

The port is settled at the start of the **server** half, because that is the
only moment the answer is knowable — nothing of ours may be listening while the
question is asked.

The build half prepares the workspace too, and writes the env block with
whatever port the workspace holds at that moment. So in the one run where the
port moves:

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
The cost is that a build started on its own would then also move the port, which
is the thing the current placement was careful to avoid while a server is up.

Worth doing when `useRunSequence` is next opened, with a test that runs a build
and a server across a port that moves.
