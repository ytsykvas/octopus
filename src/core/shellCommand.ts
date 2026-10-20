/**
 * Reading a shell command the way the guards need to: as the commands it runs.
 *
 * Not a shell. A hook is given the command's text and nothing else, so this is
 * the best reading of that text available — enough to find the programs an
 * agent runs, what it hands to an interpreter, and what a `$(…)` inside double
 * quotes would run. What a script on disk does is out of its reach by
 * construction; the environment the agent runs in is what covers that
 * (`agentEnv` in `publishGuard.ts`).
 */

/** One simple command: its words, quotes resolved, and the heredoc bodies fed to it. */
export interface Segment {
  readonly words: readonly string[]
  readonly heredocs: readonly string[]
}

export interface ParsedCommand {
  readonly segments: readonly Segment[]
  /** Double-quoted strings holding `$(…)` or backticks: the shell runs what is inside them. */
  readonly substitutions: readonly string[]
}

/** Characters that end one command and start the next — or open a nested one. */
const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`', '{', '}'])

/** A heredoc's delimiter, bare or quoted either way; the second group is the word. */
const DELIMITER = /^(['"]?)([^'"\s;&|<>()]+)\1/u

/** The escapes `$'…'` resolves that name one character each. */
const ANSI_ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  t: '\t',
  r: '\r',
  e: '\u001b',
  a: '\u0007',
  b: '\b',
  f: '\f',
  v: '\v'
}

/**
 * The text of a `$'…'` string starting at `from`, escapes resolved, and where
 * its closing quote is. `$'\x67h'` is `gh` to the shell, so it is `gh` here.
 */
function ansiQuoted(text: string, from: number): { value: string; end: number } {
  let value = ''
  let ended = false
  let at = from
  while (at < text.length && text.charAt(at) !== "'") {
    if (text.charAt(at) !== '\\') {
      if (!ended) value += text.charAt(at)
      at += 1
      continue
    }
    const escape =
      /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8})|([0-7]{1,3})|c(.)|(.))/su.exec(
        text.slice(at + 1)
      )
    const [whole = '', hex, unicode, wide, octal, control, single = ''] = escape ?? []
    const code = hex ?? unicode ?? wide
    const point =
      code !== undefined
        ? Number.parseInt(code, 16)
        : octal !== undefined
          ? // One byte, as bash keeps it: `\567` is `w`.
            Number.parseInt(octal, 8) & 0xff
          : control !== undefined
            ? // `\cX` is control-X; `\c@` is a NUL.
              control.toUpperCase().charCodeAt(0) & 0x1f
            : null
    // The shell's string ends at a NUL — what follows never reaches the command —
    // though the quote that closes it is still found past escapes.
    if (point === 0) ended = true
    else if (!ended) {
      value += point === null ? (ANSI_ESCAPES[single] ?? single) : String.fromCodePoint(point)
    }
    at += 1 + whole.length
  }
  return { value, end: at }
}

interface PendingHeredoc {
  readonly delimiter: string
  readonly stripTabs: boolean
  readonly into: string[]
}

/**
 * Splits `text` into simple commands and their words.
 *
 * `$(…)`, backticks and parentheses count as separators, so what runs inside
 * them is a command of its own rather than an argument of the one around it. A
 * heredoc's body is data handed to its command, never a command itself, which
 * is what keeps a commit message written with `<<'EOF'` from being read as
 * shell. An unterminated quote runs to the end, which is what the shell would
 * ask the user to finish.
 */
export function parseCommand(text: string): ParsedCommand {
  const segments: Segment[] = []
  const substitutions: string[] = []
  let words: string[] = []
  let heredocs: string[] = []
  let pending: PendingHeredoc[] = []
  let word = ''
  let inWord = false

  const endWord = (): void => {
    if (inWord) words.push(word)
    word = ''
    inWord = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) segments.push({ words, heredocs })
    words = []
    heredocs = []
  }
  const readHeredocs = (from: number): number => {
    let at = from
    for (const doc of pending) {
      const lines: string[] = []
      while (at < text.length) {
        const newline = text.indexOf('\n', at)
        const end = newline === -1 ? text.length : newline
        const line = text.slice(at, end)
        at = end + 1
        if ((doc.stripTabs ? line.replace(/^\t+/u, '') : line) === doc.delimiter) break
        lines.push(line)
      }
      doc.into.push(lines.join('\n'))
    }
    pending = []
    return at
  }

  let at = 0
  while (at < text.length) {
    const char = text.charAt(at)
    const next = text.charAt(at + 1)

    if (char === '$' && next === "'") {
      const { value, end } = ansiQuoted(text, at + 2)
      word += value
      inWord = true
      at = end + 1
      continue
    }

    if (char === "'") {
      const close = text.indexOf("'", at + 1)
      const end = close === -1 ? text.length : close
      word += text.slice(at + 1, end)
      inWord = true
      at = end + 1
      continue
    }

    if (char === '"' || (char === '$' && next === '"')) {
      let inside = ''
      let runs = false
      let scan = (char === '$' ? at + 1 : at) + 1
      while (scan < text.length && text.charAt(scan) !== '"') {
        const inner = text.charAt(scan)
        const after = text.charAt(scan + 1)
        if (inner === '\\' && after === '\n') {
          scan += 2
        } else if (inner === '\\' && after !== '' && '"\\$`'.includes(after)) {
          inside += after
          scan += 2
        } else {
          if (inner === '`' || (inner === '$' && after === '(')) runs = true
          inside += inner
          scan += 1
        }
      }
      if (runs) substitutions.push(inside)
      word += inside
      inWord = true
      at = scan + 1
      continue
    }

    if (char === '\\') {
      // A backslash before a newline joins the lines, as the shell does.
      if (next !== '\n') {
        word += next
        inWord = true
      }
      at += 2
      continue
    }

    // A here-string, `<<<`, hands over one word: nothing to skip.
    if (char === '<' && next === '<' && text.charAt(at + 2) === '<') {
      word += '<<<'
      inWord = true
      at += 3
      continue
    }

    if (char === '<' && next === '<') {
      endWord()
      at += 2
      const stripTabs = text.charAt(at) === '-'
      if (stripTabs) at += 1
      while (text.charAt(at) === ' ' || text.charAt(at) === '\t') at += 1
      const match = DELIMITER.exec(text.slice(at))
      const delimiter = match?.[2]
      if (match && delimiter !== undefined) {
        pending.push({ delimiter, stripTabs, into: heredocs })
        at += match[0].length
      }
      continue
    }

    if (char === '\n' && pending.length > 0) {
      endSegment()
      at = readHeredocs(at + 1)
      continue
    }

    if (char === '$' && next === '(') {
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

  return { segments, substitutions }
}

/** The last path component: `/usr/bin/git` is still git. */
export function commandName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** Programs that run the program named after them. */
const WRAPPERS = new Set([
  'env',
  'sudo',
  'doas',
  'command',
  'builtin',
  'exec',
  'nohup',
  'time',
  'nice',
  'stdbuf',
  'timeout',
  'caffeinate',
  'xargs'
])

/** Wrapper options that take their value as the next word. */
const WRAPPER_VALUE_OPTIONS = new Set(['-u', '-g', '-n', '-C', '-I', '-P', '-L', '-d', '-E', '-s'])

/** `NAME=value` before a command: an assignment, not the program. */
const ASSIGNMENT = /^[A-Za-z_]\w*=/u

/**
 * Where each program in a simple command starts: the first word past any
 * assignments, and — when that is a wrapper such as `env`, `sudo` or `xargs` —
 * the program it runs, and so on. `env git push` runs git as surely as
 * `git push` does.
 */
export function programs(words: readonly string[]): { at: number; name: string }[] {
  const found: { at: number; name: string }[] = []
  let at = 0
  for (;;) {
    while (ASSIGNMENT.test(words[at] ?? '')) at += 1
    const word = words[at]
    if (word === undefined) return found
    const name = commandName(word)
    found.push({ at, name })
    if (!WRAPPERS.has(name)) return found

    at += 1
    for (let option = words[at]; option?.startsWith('-') === true; option = words[at]) {
      at += WRAPPER_VALUE_OPTIONS.has(option) ? 2 : 1
    }
    // `timeout 30 git push`: the duration comes before the program.
    if (name === 'timeout') at += 1
  }
}

/** git's own options that take their value as the next word, rather than after `=`. */
const GIT_VALUE_OPTIONS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])

export interface GitCommand {
  /** git's own options, before the command, values included. */
  readonly options: readonly string[]
  readonly command: string
  readonly args: readonly string[]
}

/** What `git` at `argv[at]` runs, past git's own options; null for anything else. */
export function gitCommand(argv: readonly string[], at = 0): GitCommand | null {
  const first = argv[at]
  if (first === undefined || commandName(first) !== 'git') return null

  let next = at + 1
  for (let word = argv[next]; word?.startsWith('-') === true; word = argv[next]) {
    next += GIT_VALUE_OPTIONS.has(word) ? 2 : 1
  }

  const command = argv[next]
  return command === undefined
    ? null
    : { options: argv.slice(at + 1, next), command, args: argv.slice(next + 1) }
}

/** `gh` options that take their value as the next word, `gh api`'s among them. */
const GH_VALUE_OPTIONS = new Set([
  '-R',
  '--repo',
  '--hostname',
  '-X',
  '--method',
  '-H',
  '--header',
  '-f',
  '-F',
  '--field',
  '--raw-field',
  '--input',
  '-q',
  '--jq',
  '-t',
  '--template',
  '-p',
  '--preview',
  '--cache'
])

/** The positional words after `gh` at `argv[at]` — `pr`, `create` — its own options skipped. */
export function ghWords(argv: readonly string[], at = 0): string[] {
  const positional: string[] = []
  let value = false
  for (const arg of argv.slice(at + 1)) {
    if (value) value = false
    else if (GH_VALUE_OPTIONS.has(arg)) value = true
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  return positional
}
