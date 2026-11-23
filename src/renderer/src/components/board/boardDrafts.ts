/** A description edit not saved yet: what was typed, and the description it was opened on. */
export interface DescriptionDraft {
  readonly text: string
  readonly base: string
}

export function draftSlot(projectId: string, ref: string): string {
  return `${projectId}\n${ref}`
}

/** The same map when nothing changes: closing a panel with no draft does not redraw App. */
export function withDraft(
  drafts: ReadonlyMap<string, DescriptionDraft>,
  slot: string,
  draft: DescriptionDraft | null
): ReadonlyMap<string, DescriptionDraft> {
  if (draft === null && !drafts.has(slot)) return drafts
  const next = new Map(drafts)
  if (draft === null) next.delete(slot)
  else next.set(slot, draft)
  return next
}

export function movedDraft(
  drafts: ReadonlyMap<string, DescriptionDraft>,
  from: string,
  to: string
): ReadonlyMap<string, DescriptionDraft> {
  const draft = drafts.get(from)
  if (draft === undefined) return drafts
  const next = new Map(drafts)
  next.delete(from)
  next.set(to, draft)
  return next
}
