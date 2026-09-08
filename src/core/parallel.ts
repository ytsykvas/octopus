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
 * So `allOf` waits for **all** of them and then reports the first failure. The
 * cost is the milliseconds between the first rejection and the last answer; what
 * it buys is that a caller holding a directory knows, when this resolves or
 * rejects, that nothing it started is still writing into it.
 *
 * `within` is the other half of the same subject: waiting properly, but not for
 * ever. Some work is worth a moment and not a hang — a quit that waits for a
 * transcript append is right up to about a second and wrong after it.
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

/**
 * Waits for work, and gives up after a while.
 *
 * Answers whether the work finished. A caller that has to go on either way —
 * quitting, closing a pane — needs a bounded wait rather than a promise it must
 * trust, and needs to be told which of the two happened rather than guessing
 * from the absence of a failure.
 *
 * The work is **not** cancelled when the ceiling is reached, because it cannot
 * be: a filesystem write in flight is in flight. What ends is the waiting, and
 * that distinction is the whole honesty of this function — it says "I stopped
 * waiting", not "it stopped".
 *
 * A failure counts as finishing. Whether the work went well is the work's own
 * business and is reported wherever such things are reported; this answers only
 * whether it is over.
 */
export async function within(ms: number, work: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined

  const ceiling = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      resolve(false)
    }, ms)
  })

  try {
    return await Promise.race([
      work.then(
        () => true,
        () => true
      ),
      ceiling
    ])
  } finally {
    // Or a process with nothing else to do would sit out the rest of the
    // ceiling before exiting — which for a quit is the delay this is avoiding.
    clearTimeout(timer)
  }
}
