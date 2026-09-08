/**
 * Reads made at once, where none of them is abandoned when another fails.
 *
 * `Promise.all` rejects the moment its first promise does, and everything else
 * it was given goes on running with nobody waiting for it. For four `fetch`es
 * that is fine. For four **child processes** it is not: the caller believes the
 * read is over, and three `git` commands are still writing into a directory it
 * has moved on from.
 *
 * That is not a theory. `pullRequests.test.ts` failed roughly one full run in
 * five for a month with `ENOTEMPTY: directory not empty, rmdir …/work/.git`,
 * always in `afterEach` and never in the test that caused it. Every named victim
 * was a test where the `gh` half of `readPullRequest` rejects — a refusal about
 * the answer's shape — while its three `git` reads were still in flight: the
 * assertion passed, the test ended, and `rm` raced a `git` that was still
 * making files.
 *
 * So this waits for **all** of them and then reports the first failure. The
 * cost is the milliseconds between the first rejection and the last answer; what
 * it buys is that a caller holding a directory knows, when this resolves or
 * rejects, that nothing it started is still writing into it.
 */

import { inspect } from 'node:util'

/**
 * Every one of them, or the first failure once every one has settled.
 *
 * Deterministic where `Promise.all` is a race: two reads that both fail used to
 * report whichever lost the toss, and this reports the one written first — the
 * loop walks the answers in order. A caller with a fallible read beside three
 * cheap ones can therefore say which error the user will see by looking at the
 * order it wrote them in.
 *
 * One pass rather than a check and then a map: the second would have an arm for
 * a rejection that the first has already thrown on, which is a line no test can
 * reach and the coverage threshold rightly fails the build over.
 */
export async function allOf<T extends readonly unknown[] | []>(
  values: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const answers: unknown[] = []

  for (const outcome of await Promise.allSettled(values)) {
    if (outcome.status === 'rejected') {
      const reason: unknown = outcome.reason

      // Rethrown as it arrived. These are coded errors the window turns into
      // sentences, and wrapping one would replace it with something vaguer.
      // `inspect` is only for a rejection that is not an `Error` at all, which
      // nothing here produces and every one of these has to survive anyway.
      throw reason instanceof Error ? reason : new Error(inspect(reason))
    }

    answers.push(outcome.value)
  }

  return answers as { -readonly [K in keyof T]: Awaited<T[K]> }
}
