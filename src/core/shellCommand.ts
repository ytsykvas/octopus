/**
 * Reading a shell command the way the guards need to: as the commands it runs.
 *
 * Not a shell. A hook is given the command's text and nothing else, so this is
 * the best reading of that text available — enough to find `git` and `gh` in
 * the places an agent puts them, and to hand back every quoted string so a
 * caller can read inside `bash -c '…'` too. What a script on disk does is out
 * of its reach by construction; the environment the agent runs in is what
 * covers that (`agentEnv` in `publishGuard.ts`).
 */

/** The words of one simple command, quotes resolved, and every quoted string met. */
export interface ParsedCommand {
  readonly segments: readonly (readonly string[])[]
  readonly quoted: readonly string[]
}

/** Characters that end one command and start the next — or open a nested one. */
const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`', '{', '}'])

/**
 * Splits `text` into simple commands and their words.
 *
 * `$(…)`, backticks and parentheses count as separators, so what runs inside
 * them is a command of its own rather than an argument of the one around it.
 * An unterminated quote runs to the end, which is what the shell would ask the
 * user to finish.
 */
export function parseCommand(text: string): ParsedCommand {
  const segments: string[][] = []
  const quoted: string[] = []
  let words: string[] = []
  let word = ''
  let inWord = false

  const endWord = (): void => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }

  let at = 0
  while (at < text.length) {
    const char = text.charAt(at)

    if (char === "'") {
      const close = text.indexOf("'", at + 1)
      const end = close === -1 ? text.length : close
      const inside = text.slice(at + 1, end)
      quoted.push(inside)
      word += inside
      inWord = true
      at = end + 1
      continue
    }

    if (char === '"') {
      let inside = ''
      let next = at + 1
      while (next < text.length && text.charAt(next) !== '"') {
        const inner = text.charAt(next)
        // Inside double quotes a backslash only escapes what the shell would
        // otherwise read; elsewhere it stays, as `"\n"` does.
        if (inner === '\\' && '"\\$`'.includes(text.charAt(next + 1))) {
          inside += text.charAt(next + 1)
          next += 2
        } else {
          inside += inner
          next += 1
        }
      }
      quoted.push(inside)
      word += inside
      inWord = true
      at = next + 1
      continue
    }

    if (char === '\\') {
      word += text.charAt(at + 1)
      inWord = true
      at += 2
      continue
    }

    if (char === '$' && text.charAt(at + 1) === '(') {
      endSegment()
      at += 2
      continue
    }

    if (SEPARATORS.has(char)) {
      endSegment()
    } else if (/\s/u.test(char)) {
      endWord()
    } else {
      word += char
      inWord = true
    }
    at += 1
  }
  endSegment()

  return { segments, quoted }
}

/** The last path component: `/usr/bin/git` is still git. */
export function commandName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** git's own options that take their value as the next word, rather than after `=`. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

/** What follows `git <command>` when `argv[at]` is git, past git's own options; null otherwise. */
export function gitCommand(
  argv: readonly string[],
  at = 0
): { command: string; args: string[] } | null {
  const first = argv[at]
  if (first === undefined || commandName(first) !== 'git') return null

  let next = at + 1
  for (let word = argv[next]; word?.startsWith('-') === true; word = argv[next]) {
    next += GIT_VALUE_OPTIONS.has(word) ? 2 : 1
  }

  const command = argv[next]
  return command === undefined ? null : { command, args: argv.slice(next + 1) }
}
