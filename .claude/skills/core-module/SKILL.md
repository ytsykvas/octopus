---
name: core-module
description: Створення або зміна модуля в src/core — headless-логіка з обов'язковим 100% покриттям тестами. Використовуй при роботі з будь-яким файлом у src/core, при додаванні операцій git, роботі з файловою системою, станом на диску чи зовнішніми процесами.
when_to_use: Коли треба додати чи змінити логіку в src/core, написати тести до неї, або коли постає питання «куди покласти цю функцію».
paths:
  - src/core/**
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(npx vitest:*), Bash(npm test:*), Bash(npm run typecheck:*)
---

# Модуль ядра

`src/core/` — це вся логіка застосунку. Він headless: жодних імпортів Electron,
жодного знання про UI. Це дозволяє тестувати його без запуску застосунку
і згодом винести в CLI чи демон (§11.1 docs/PROJECT.md).

## Обов'язкові умови

**Покриття 100%.** Поріг заданий у `vitest.config.ts` і ламає збірку при просіданні.
Це не побажання — тест пишеться разом з кодом, не «потім».

**Жодного `electron`.** Спроба імпортувати його в `src/core/` блокується хуком.
Якщо логіці потрібне вікно, діалог чи меню — вона належить до `src/main/`,
а в ядрі лишається чиста функція з типізованим інтерфейсом.

**`any` заборонений.** Для справді невідомого — `unknown` зі звуженням через zod.

## Як писати тестований модуль

Головний прийом — **залежності передаються параметром із типовим значенням**.
Це прибирає потребу в моках файлової системи й робить покриття тривіальним:

```ts
// Добре: тестується без моків
export function rootDir(home: string = homedir()): string {
  return join(home, '.maestro')
}

// Погано: щоб протестувати, доведеться мокати цілий модуль
export function rootDir(): string {
  return join(os.homedir(), '.maestro')
}
```

Той самий прийом для процесів і файлової системи: приймай виконавця параметром.

```ts
type Exec = (cmd: string, args: string[]) => Promise<string>

export async function listWorktrees(repo: string, exec: Exec = defaultExec): Promise<Worktree[]> {
  const out = await exec('git', ['-C', repo, 'worktree', 'list', '--porcelain'])
  return parseWorktrees(out)
}
```

Парсер (`parseWorktrees`) винось окремою чистою функцією — вона тестується
на рядках без жодного git.

## Зовнішні процеси

Тільки `execFile`, **ніколи `exec`**. Назви гілок і шляхи приходять від
користувача, а `exec` віддає їх шелу — це пряма ін'єкція команд.

```ts
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const { stdout } = await run('git', ['-C', repoPath, 'worktree', 'list', '--porcelain'])
```

## Дані ззовні

Усе, що приходить з диска, від git або від SDK, валідується zod **на межі**.
Далі всередині воно вже типізоване.

```ts
import { z } from 'zod'

const WorkspaceSchema = z.object({
  id: z.string(),
  branch: z.string(),
  port: z.number().int().min(3000).max(9000)
})

// Тип виводиться зі схеми — вони не розійдуться
export type Workspace = z.infer<typeof WorkspaceSchema>
```

## Помилки

Не ковтати. Якщо git упав — прокинути stderr нагору, щоб причина була видна
в UI, а не «щось пішло не так».

```ts
try {
  await run('git', args)
} catch (error) {
  const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : ''
  throw new Error(`git ${args.join(' ')} завершився помилкою: ${stderr || String(error)}`)
}
```

## Структура тесту

Назва describe — модуль або функція, назва `it` — **сценарій**, не назва методу.
Українською, як і решта коментарів.

```ts
describe('createWorkspace', () => {
  it('створює гілку з префіксом із конфігу', async () => { ... })
  it('відмовляє, якщо гілка вже існує', async () => { ... })
  it('прокидає stderr від git, а не ковтає його', async () => { ... })
})
```

Пам'ятай про типові значення параметрів: щоб покрити гілку з дефолтом,
виклич функцію і **з** аргументом, і **без** нього.

## Перевірка перед завершенням

```bash
npx vitest run --coverage
```

Покриття мусить лишитися 100%. Якщо просіло — дописуй тести, а не знижуй поріг.
