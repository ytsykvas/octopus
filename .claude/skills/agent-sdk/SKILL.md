---
name: agent-sdk
description: Інтеграція з @anthropic-ai/claude-agent-sdk — запуск сесій агента, стрімінг подій, дозволи інструментів, resume, мапінг повідомлень SDK у власний тип AgentEvent. Використовуй при роботі з src/core/agent.ts, при додаванні можливостей чату з агентом, обробці подій сесії чи роботі з session_id.
when_to_use: Коли треба запустити агента у воркспейсі, обробити його відповіді, реалізувати дозволи інструментів, продовжити сесію після перезапуску або показати вартість сесії.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npx vitest:*), Bash(npm run typecheck:*)
---

# Робота з Claude Agent SDK

Пакет: `@anthropic-ai/claude-agent-sdk` (встановлений). Типи — у
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`; **звіряйся з ними**,
бо публічна документація подає спрощену картину.

## Головний принцип проєкту

```ts
settingSources: []
```

Це технічна відповідь на претензію до Conductor (§4, §12.3 docs/PROJECT.md).
З порожнім списком SDK **не підтягує неявно** ані користувацьких налаштувань,
ані `CLAUDE.md`. Усе, що потрапляє в контекст агента, ми додаємо свідомо.

Не змінюй це значення «щоб запрацювало» — конфіг має давати користувачеві
явний перемикач: нічого / `['project']` / `['user','project','local']`.

## Базовий запуск

```ts
import { query } from '@anthropic-ai/claude-agent-sdk'

const session = query({
  prompt: inputStream, // AsyncIterable<SDKUserMessage> — для follow-up
  options: {
    cwd: workspace.path,
    resume: workspace.sessionId ?? undefined,
    settingSources: [],
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool: async (toolName, input) => {
      /* власний діалог дозволів */
    }
  }
})

for await (const message of session) {
  // мапінг у AgentEvent — див. нижче
}
```

## Пастка: де насправді живуть виклики інструментів

`SDKMessage` — union із ~38 варіантів, і окремих `SDKToolUseMessage` чи
`SDKToolResultMessage` там **немає**. Виклики інструментів приходять як
**блоки всередині** повідомлень у форматі Anthropic API:

```ts
// tool_use — у SDKAssistantMessage.message.content
if (message.type === 'assistant') {
  for (const block of message.message.content) {
    if (block.type === 'text') emit({ type: 'text', text: block.text })
    if (block.type === 'thinking') emit({ type: 'thinking', text: block.thinking })
    if (block.type === 'tool_use') {
      emit({ type: 'tool_use', toolUseId: block.id, name: block.name, input: block.input })
    }
  }
}

// tool_result — у SDKUserMessage.message.content
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

`SDKUserMessage` має ще `tool_use_result?: unknown` — структурований вивід
інструмента (не рядок для моделі). Корисно для рендеру, але типізований як
`unknown`: валідуй через zod, перш ніж використовувати.

## session_id для resume

Приходить у стартовому системному повідомленні:

```ts
if (message.type === 'system' && message.subtype === 'init') {
  emit({ type: 'session_started', sessionId: message.session_id })
}
```

Зберігай його в `state.json` одразу — саме це дає продовження розмови після
перезапуску застосунку.

## Завершення й вартість

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

**Не підсумовуй вартість між результатами.** У сесіях зі стрімінговим вводом
`total_cost_usd` уже кумулятивна — кожен `result` несе поточний загальний
підсумок. Читай останній.

## Follow-up без перезапуску сесії

Промпт має бути async-генератором, у який ти дописуєш повідомлення:

```ts
async function* inputStream(): AsyncGenerator<SDKUserMessage> {
  while (true) {
    const text = await queue.next() // черга з UI
    yield {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: ''
    }
  }
}
```

Альтернатива — метод `session.streamInput(...)` на вже створеному об'єкті.

## Керування сесією

- `session.interrupt()` — перервати поточну роботу;
- `session.setModel(model)` — змінити модель на льоту;
- `session.setPermissionMode(mode)` — `'default' | 'plan' | 'dontAsk' | 'bypassPermissions'`;
- `session.close()` — **обов'язково** при видаленні чи архівації воркспейсу.

Незакритий `query()` лишає живий дочірній процес. Кожен воркспейс мусить
закривати свою сесію у своєму ж teardown.

## Дозволи

`canUseTool` викликається лише тоді, коли рішення не покрите `allowedTools`
чи налаштуваннями. Це місце для власного діалогу — саме тут UI показує
користувачеві, що агент хоче зробити.

Не став `bypassPermissions` типовим значенням: прозорість важливіша за
зручність (§4).

## Ізоляція від SDK

Ядро не віддає `SDKMessage` у renderer. Усе мапиться у власний плоский
`AgentEvent` з `src/core/types.ts` (§11.2). Причина: union SDK великий і
змінюється між версіями — без цього шару кожне оновлення пакета ламало б UI.

Якщо потрібен новий вид події — **спершу додай варіант в `AgentEvent`**,
потім мапінг, потім рендер.

## Тестування

Мапінг подій — чиста функція від `SDKMessage` до `AgentEvent[]`. Тестуй її
на літералах повідомлень, без запуску агента: це дає 100% покриття без мережі
й без дочірніх процесів.

Сам `query()` у тестах не викликай.
