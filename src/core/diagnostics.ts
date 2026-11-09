import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'

const KEEP_BYTES = 1024 * 1024

/** Where errors swallowed on purpose go. Runs inside catches: synchronous, and never throws. */
export function diagnosticLog(
  file: string,
  echo: (line: string) => void = (line) => {
    console.error(line)
  },
  now: () => string = () => new Date().toISOString(),
  keepBytes = KEEP_BYTES
): (error: unknown) => void {
  let size = trim(file, keepBytes)
  return (error) => {
    try {
      const told = error instanceof Error ? (error.stack ?? error.message) : String(error)
      const line = `${now()} ${told}`
      echo(line)
      const entry = `${line}\n`
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, entry)
      size += Buffer.byteLength(entry)
      if (size > 2 * keepBytes) size = trim(file, keepBytes)
    } catch {
      // A log that cannot be written must not become the failure it records.
    }
  }
}

// Keeps the last `keepBytes` from the first whole line, reading only that tail: a log past 2 GiB
// cannot be read whole at all. Answers the size left, 0 when there is no log yet.
function trim(file: string, keepBytes: number): number {
  try {
    const { size } = statSync(file)
    if (size <= keepBytes) return size
    const tail = Buffer.alloc(keepBytes)
    const handle = openSync(file, 'r')
    try {
      readSync(handle, tail, 0, keepBytes, size - keepBytes)
    } finally {
      closeSync(handle)
    }
    const kept = tail.subarray(tail.indexOf(0x0a) + 1)
    writeFileSync(file, kept)
    return kept.length
  } catch {
    return 0
  }
}
