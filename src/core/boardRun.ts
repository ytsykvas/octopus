import type { ChatEntry } from './transcript.js'

export interface RunUsage {
  readonly turns: number
  readonly activeMs: number
  readonly tokensIn: number
  readonly tokensOut: number
}

// Each `result` counts once across the transcripts: a fork copies its source's history.
export function foldRunUsage(transcripts: readonly (readonly ChatEntry[])[]): RunUsage {
  const seen = new Set<string>()
  let turns = 0
  let activeMs = 0
  let tokensIn = 0
  let tokensOut = 0
  for (const entries of transcripts) {
    for (const entry of entries) {
      if (entry.role !== 'agent') continue
      const { event } = entry
      if (event.type !== 'result') continue
      const key = `${entry.at}|${JSON.stringify(event)}`
      if (seen.has(key)) continue
      seen.add(key)
      turns += 1
      activeMs += event.durationMs ?? 0
      tokensIn += event.inputTokens ?? 0
      tokensOut += event.outputTokens ?? 0
    }
  }
  return { turns, activeMs, tokensIn, tokensOut }
}
