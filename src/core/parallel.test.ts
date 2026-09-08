import { describe, expect, it } from 'vitest'

import { allOf } from './parallel.js'

/** A promise that settles after a tick, so "waited for" is observable. */
function later<T>(value: T, ms: number, done?: () => void): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => {
      done?.()
      resolve(value)
    }, ms)
  })
}

function failsLater(reason: Error, ms: number, done?: () => void): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => {
      done?.()
      reject(reason)
    }, ms)
  })
}

/**
 * A thenable that refuses with something that is not an `Error`.
 *
 * Written as a thenable rather than `Promise.reject`, and not to dodge the lint
 * rule that forbids one: a rejection like this only ever arrives from code that
 * is not ours, and that is exactly what a foreign thenable is. `allSettled`
 * takes one as readily as a promise.
 */
function refusing(reason: unknown): PromiseLike<never> {
  return {
    then: (_onFulfilled, onRejected) => {
      onRejected?.(reason)

      return refusing(reason)
    }
  }
}

describe('reads made at once', () => {
  it('answers in the order they were written, whatever order they finish in', async () => {
    await expect(
      allOf([later('slow', 20), later('quick', 1), Promise.resolve(3)])
    ).resolves.toEqual(['slow', 'quick', 3])
  })

  it('has nothing to wait for when given nothing', async () => {
    await expect(allOf([])).resolves.toEqual([])
  })

  /*
   * The whole point. `Promise.all` rejects the moment its first promise does
   * and leaves the rest running with nobody waiting — which for a child process
   * means a `git` still making files in a directory the caller has moved on
   * from. That is the `ENOTEMPTY` that failed a full run in five for a month.
   */
  it('waits for every one of them before reporting a failure', async () => {
    const finished: string[] = []

    await expect(
      allOf([
        failsLater(new Error('first out'), 1, () => finished.push('failure')),
        later('a', 30, () => finished.push('a')),
        later('b', 40, () => finished.push('b'))
      ])
    ).rejects.toThrow('first out')

    expect(finished).toEqual(['failure', 'a', 'b'])
  })

  /*
   * Deterministic where `Promise.all` is a race. Two reads that both fail used
   * to report whichever lost the toss; this reports the one written first, so a
   * caller can say which error the user will see by reading the order.
   */
  it('reports the first failure in the order written, not the first to happen', async () => {
    await expect(
      allOf([failsLater(new Error('written first'), 30), failsLater(new Error('failed first'), 1)])
    ).rejects.toThrow('written first')
  })

  it('carries the failure through as it arrived, so a coded one stays coded', async () => {
    const coded = Object.assign(new Error('nope'), { code: 'listFailed' })

    await expect(allOf([Promise.reject(coded), Promise.resolve(1)])).rejects.toMatchObject({
      code: 'listFailed'
    })
  })

  // Nothing here rejects with anything but an `Error`; this is so that one
  // arriving from somewhere else still reaches the caller as something readable
  // rather than as `[object Object]`.
  it('makes an error of a rejection that was not one', async () => {
    await expect(allOf([refusing({ why: 'odd' })])).rejects.toThrow(/odd/)
  })

  // `null` is a value a promise can reject with, so "nothing failed" has to be
  // tellable from "failed with null" — which it is not if the reason alone is
  // carried back.
  it('treats a rejection with null as a failure rather than as success', async () => {
    await expect(allOf([refusing(null), Promise.resolve('kept')])).rejects.toThrow('null')
  })
})
