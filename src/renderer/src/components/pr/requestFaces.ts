import { GitMerge, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from 'lucide-react'

/** The status colours the pane draws with. */
export type Tone = 'danger' | 'warning' | 'accent' | 'success' | 'muted'

/** A status colour as text, and on its own paired ground — never the colour as a fill. */
export const TONES: Record<Tone, { readonly text: string; readonly badge: string }> = {
  danger: { text: 'text-danger', badge: 'bg-danger-bg text-danger' },
  warning: { text: 'text-warning', badge: 'bg-warning-bg text-warning' },
  accent: { text: 'text-accent', badge: 'bg-accent-bg text-accent' },
  success: { text: 'text-success', badge: 'bg-success-bg text-success' },
  muted: { text: 'text-ink-faint', badge: 'bg-muted text-ink-soft' }
}

/** Where a request stands as a whole, the way the header's pill names it. */
export type RequestFace = 'open' | 'draft' | 'merged' | 'closed' | 'none'

/**
 * The word, the glyph and the colour of each state.
 *
 * One table for the three places that draw them — the header's pill, the Merge
 * tile and the Merge view's closing card — so a request cannot be red in one
 * and grey in another. Merged and closed take the sidebar mark's colours
 * (`RequestMark.tsx`); an open request there is coloured by its checks, which
 * the pill leaves to the tiles.
 */
export const FACES = {
  open: { Icon: GitPullRequest, tone: 'success', labelKey: 'pullRequest.pillOpen' },
  draft: { Icon: GitPullRequestDraft, tone: 'muted', labelKey: 'pullRequest.isDraft' },
  merged: { Icon: GitMerge, tone: 'danger', labelKey: 'pullRequest.pillMerged' },
  closed: { Icon: GitPullRequestClosed, tone: 'muted', labelKey: 'pullRequest.pillClosed' },
  none: { Icon: GitPullRequest, tone: 'muted', labelKey: 'pullRequest.pillNotOpened' }
} as const satisfies Record<
  RequestFace,
  { readonly Icon: typeof GitPullRequest; readonly tone: Tone; readonly labelKey: string }
>
