---
name: agent-sdk
description: Integrating with @anthropic-ai/claude-agent-sdk — starting agent sessions, streaming events, tool permissions, resume, and mapping SDK messages onto the internal AgentEvent type. Use when working on src/core/agent.ts, adding agent chat capabilities, handling session events or session ids.
when_to_use: When an agent needs to be started in a workspace, its replies handled, tool permissions implemented, a session resumed after a restart, or session cost surfaced.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npx vitest:*), Bash(npm run typecheck:*)
---

# Working with the Claude Agent SDK

Package: `@anthropic-ai/claude-agent-sdk` (installed). Types live in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` — **check them**, because
the public documentation presents a simplified picture.

## The project's core principle

```ts
settingSources: []
```

This is the technical answer to the complaint about Conductor (§4, §12.3
docs/PROJECT.md). With an empty list the SDK loads **nothing implicitly** —
neither user settings nor `CLAUDE.md`. Everything reaching the agent's context
is put there deliberately.

Do not change this value "to make it work" — the config is meant to expose an
explicit switch: nothing / `['project']` / `['user','project','local']`.

## Basic run

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

const session = query({
  prompt: inputStream, // AsyncIterable<SDKUserMessage> — enables follow-ups
  options: {
    cwd: workspace.path,
    resume: workspace.sessionId ?? undefined,
    settingSources: [],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool: async (toolName, input) => {
      /* our own permission dialog */
    }
  }
})

for await (const message of session) {
  // map onto AgentEvent — see below
}
```

## The trap: where tool calls actually live

`SDKMessage` is a union of roughly 38 variants, and there is **no** separate
`SDKToolUseMessage` or `SDKToolResultMessage`. Tool activity arrives as
**blocks inside** messages in the Anthropic API shape:

```ts
// tool_use lives in SDKAssistantMessage.message.content
if (message.type === 'assistant') {
  for (const block of message.message.content) {
    if (block.type === 'text') emit({ type: 'text', text: block.text })
    if (block.type === 'thinking') emit({ type: 'thinking', text: block.thinking })
    if (block.type === 'tool_use') {
      emit({ type: 'tool_use', toolUseId: block.id, name: block.name, input: block.input })
    }
  }
}

// tool_result lives in SDKUserMessage.message.content
if (message.type === 'user') {
  const content = message.message.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === 'tool_result') {
        emit({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          ok: block.is_error !== true,
          content: String(block.content ?? '')
        })
      }
    }
  }
}
```

`SDKUserMessage` also carries `tool_use_result?: unknown` — the structured tool
output rather than the string sent to the model. Useful for rendering, but typed
as `unknown`: validate it with zod before use.

## session_id for resume

It arrives in the init system message:

```ts
if (message.type === 'system' && message.subtype === 'init') {
  emit({ type: 'session_started', sessionId: message.session_id })
}
```

Persist it to `state.json` immediately — that is what lets a conversation
continue after the application restarts.

## Completion and cost

```ts
if (message.type === 'result') {
  emit({
    type: 'result',
    ok: !message.is_error,
    costUsd: message.total_cost_usd,
    durationMs: message.duration_ms
  })
}
```

**Do not sum cost across results.** In streaming-input sessions
`total_cost_usd` is already cumulative — every `result` carries the running
total. Read the latest one.

## Follow-ups without restarting the session

The prompt must be an async generator you push messages into:

```ts
async function* inputStream(): AsyncGenerator<SDKUserMessage> {
  while (true) {
    const text = await queue.next() // queue fed by the UI
    yield {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: ''
    }
  }
}
```

Alternatively call `session.streamInput(...)` on an existing session object.

## Session control

- `session.interrupt()` — stop the current work;
- `session.setModel(model)` — switch models mid-flight;
- `session.setPermissionMode(mode)` — `'default' | 'plan' | 'dontAsk' | 'bypassPermissions'`;
- `session.close()` — **mandatory** when a workspace is removed or archived.

An unclosed `query()` leaves a live child process behind. Every workspace must
close its own session in its own teardown.

**There is no `setEffort`, and nothing else settings-shaped has a method here.**
Effort is a start-up option; moving it on a running session goes through
`applyFlagSettings`, which is also the only way in for the `Settings` keys that
are not options at all — `ultracode` among them. It **shallow-merges top-level
keys**, so everything that has to change together goes in one call: a flag sent
after a level replaces the level rather than joining it.

At start-up the same layer is `Options.settings`, which takes a `Settings` object
directly. It is not a `settingSource`, so passing it does not weaken the
`settingSources: []` rule above — but say every key explicitly, `false` included,
because with no sources loaded there is nothing else to turn one back off.

## Permissions

`canUseTool` fires only when the decision is not already covered by
`allowedTools` or settings. That is where our own dialog belongs — the point
at which the UI shows the user what the agent wants to do.

Do not make `bypassPermissions` the default: transparency beats convenience (§4).

## Isolation from the SDK

The core never hands `SDKMessage` to the renderer. Everything is mapped onto the
flat `AgentEvent` in `src/core/events.ts` (§11.2). Reason: the SDK union is large
and changes between versions — without this layer every package upgrade would
break the UI.

When a new kind of event is needed, **add the variant to `AgentEvent` first**,
then the mapping, then the rendering.

## Testing

The event mapping is a pure function from `SDKMessage` to `AgentEvent[]`. Test it
against message literals, without starting an agent: that gives 100% coverage
with no network and no child processes.

Never call `query()` from a test.
