import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const KEEP_BYTES = 1024 * 1024

/**
 * Where errors swallowed on purpose go. Synchronous and never throwing: it runs inside the
 * catches that keep a session alive. Cut to its last megabyte when opened.
 */
export function diagnosticLog(
  file: string,
  echo: (line: string) => void = (line) => {
    console.error(line)
  },
  now: () => string = () => new Date().toISOString()
): (error: unknown) => void {
  trim(file)
  return (error) => {
    const told = error instanceof Error ? (error.stack ?? error.message) : String(error)
    const line = `${now()} ${told}`
    echo(line)
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${line}\n`)
    } catch {
      // A log that cannot be written must not become the failure it records.
    }
  }
}

function trim(file: string): void {
  try {
    const { size } = statSync(file)
    if (size <= KEEP_BYTES) return
    const tail = readFileSync(file).subarray(size - KEEP_BYTES)
    // From the first whole line: the tail most likely begins in the middle of one.
    writeFileSync(file, tail.subarray(tail.indexOf(0x0a) + 1))
  } catch {
    // No log yet, or none readable: the first line makes one.
  }
}
