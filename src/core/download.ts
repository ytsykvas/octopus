/**
 * Fetching one document over https, refused the moment it stops being one.
 *
 * Split out of `skills.ts` when commands and subagents gained the same "import
 * from a link" route. Nothing here knows what the document is for: the scheme
 * check, the redirect check, the timeout and the size cap are the same
 * questions whatever is at the other end, and they were the half of that module
 * with nothing to do with skills.
 *
 * The caller supplies its own refusals, so an address that will not do reports
 * itself in that feature's own words rather than in a shared vocabulary the
 * window would have to learn twice.
 */

import type { CodedError } from './codedError.js'

type Fetch = typeof fetch

/**
 * How a download is made, handed in rather than defaulted.
 *
 * The convention every other outward-facing module here follows — `git.ts`
 * takes its executor, `agent.ts` takes its `query`. A default would also make
 * the timeout untestable: covering the branch that fires it would mean waiting
 * out the real one, and covering the default itself would mean the suite
 * reaching the network.
 */
export interface Download {
  readonly fetch: Fetch
  readonly timeoutMs: number
}

/** What the service passes, and the only place the number is written down. */
export const DOWNLOAD_TIMEOUT_MS = 10_000

/**
 * How a caller says no in its own words.
 *
 * Two reasons, because they are two different sentences to a reader: the
 * address will not do, or what came back is too big for what it was meant to
 * be. Both carry parameters the window interpolates.
 */
export interface Refusals {
  refuseUrl(params: Readonly<Record<string, string>>, message: string): CodedError<string>
  refuseSize(params: Readonly<Record<string, string>>, message: string): CodedError<string>
}

/** The address, or null for anything that is not an `https` URL. */
export function httpsUrl(value: string): URL | null {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }

  return url.protocol === 'https:' ? url : null
}

/**
 * The body, decoded as it arrives and refused the moment it is too long.
 *
 * Read through the stream rather than `text()` because the length is the one
 * thing about a download the user does not decide: a server answering with a
 * gigabyte would otherwise be held in memory in full before anything checked.
 */
async function readCapped(response: Response, limit: number, refusals: Refusals): Promise<string> {
  // Annotated rather than inferred: `Response.body` reaches us from
  // `@types/node` as an unparameterised `ReadableStream`, which is
  // `ReadableStream<any>` — and `any` flowing into a length check and a
  // decoder is exactly what the no-`any` rule is there to stop. Saying what a
  // fetch body is made of costs nothing and is not in doubt.
  const body: ReadableStream<Uint8Array> | null = response.body
  if (body === null) return ''

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break

    bytes += chunk.value.byteLength
    if (bytes > limit) {
      await reader.cancel()
      throw refusals.refuseSize({ limit: String(limit) }, 'The download is too large.')
    }

    text += decoder.decode(chunk.value, { stream: true })
  }

  return text + decoder.decode()
}

/**
 * The document at an address.
 *
 * `https` only, and checked again after the redirects: a hop down to plaintext
 * is exactly the case the scheme check exists for.
 */
export async function fetchDocument(
  value: string,
  limit: number,
  download: Download,
  refusals: Refusals
): Promise<string> {
  const url = httpsUrl(value)
  if (url === null) {
    throw refusals.refuseUrl({ url: value }, 'Only https addresses are fetched.')
  }

  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, download.timeoutMs)

  try {
    const response = await download.fetch(url, { signal: controller.signal, redirect: 'follow' })

    if (!response.ok) {
      throw refusals.refuseUrl(
        { url: value, status: String(response.status) },
        `${value} answered ${String(response.status)}.`
      )
    }

    if (response.url !== '' && httpsUrl(response.url) === null) {
      throw refusals.refuseUrl({ url: response.url }, 'The redirect left https.')
    }

    return await readCapped(response, limit, refusals)
  } finally {
    clearTimeout(timer)
  }
}
