/**
 * The rows the model picker shows, out of the catalogue the agent reported.
 *
 * Kept out of the component and free of React so it can be tested against
 * plain lists — the same arrangement as `commandMatch.ts`. The wording arrives
 * as arguments rather than through `t`: this file has no business knowing what
 * language the window is in.
 */

import { type AgentModel, DEFAULT_MODEL, defaultAgentModel, findAgentModel } from '@core/chats.js'

interface DefaultLabels {
  /** What to call the default row when the catalogue cannot name the model. */
  readonly fallback: string
  /** The second line, once the row has a real model's name to wear. */
  readonly note: string
}

/**
 * Every model the picker offers, the agent's default first.
 *
 * Three things happen here and they are one idea: the picker names models, and
 * "Default (recommended)" is not the name of one. So the default row wears the
 * name of the model it actually runs; that model's own row is folded into it
 * rather than drawn twice under one name; and the row exists even when no
 * catalogue has arrived, because a chat with nothing chosen still has to be
 * able to say what it is on.
 *
 * `pinned` is the model this chat chose, and it is never folded away or
 * dropped. A chat may hold a name the catalogue has since forgotten, or the
 * very name the default now stands for, and either way the one click that
 * changes it has to stay on screen — even at the cost of two rows reading
 * alike, which only the note under one of them tells apart.
 *
 * The return type is a non-empty tuple because the caller needs a row to fall
 * back on and `noUncheckedIndexedAccess` will not take that on trust.
 */
export function modelRows(
  models: readonly AgentModel[],
  labels: DefaultLabels,
  pinned: string | null
): readonly [AgentModel, ...AgentModel[]] {
  const named = defaultAgentModel(models)
  const declared = models.find((model) => model.value === DEFAULT_MODEL)

  const head: AgentModel = {
    ...(declared ?? {
      value: DEFAULT_MODEL,
      resolvedModel: null,
      supportedEffortLevels: null,
      supportsEffort: null
    }),
    displayName: named?.displayName ?? labels.fallback,
    // Only when a real name was found: without one the row would read "Default
    // model / by default", which says the same thing twice and neither time
    // usefully.
    description: named === undefined ? '' : labels.note
  }

  const rest = models.filter(
    (model) =>
      model.value !== DEFAULT_MODEL && (model.value !== named?.value || model.value === pinned)
  )

  const rows: [AgentModel, ...AgentModel[]] = [head, ...rest]

  // A model the catalogue no longer names is still the one this chat runs on,
  // so it is offered as itself. Dropping it would leave the picker claiming a
  // default that is not in force, and take away the one click that changes it.
  if (pinned !== null && findAgentModel(rows, pinned) === undefined) {
    rows.push({
      value: pinned,
      resolvedModel: null,
      displayName: pinned,
      description: '',
      supportedEffortLevels: null,
      supportsEffort: null
    })
  }

  return rows
}
