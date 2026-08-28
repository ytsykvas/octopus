/**
 * Asking the agent for a title and a description, when nobody wants to type
 * them.
 *
 * The instruction is the project's own — the same text the settings editor
 * shows and the same one the chat prompt sends — so a project that has said how
 * it wants pull requests written gets that here without saying it twice.
 *
 * The answer is shown in the form before anything reaches GitHub. Everything in
 * this module stops at producing text.
 */

import { z } from 'zod'

import { InputQueue, mapMessage, type QueryFn, READ_ONLY_TOOLS, userMessage } from './agent.js'
import type { WorkspaceDiff } from './diff.js'
import { GitHubError } from './github.js'

/**
 * Delimiters rather than JSON.
 *
 * A description is multi-line markdown, and JSON would have the model escape
 * every newline in it — the one part of the format it reliably gets wrong.
 * Markers also survive a preamble and a code fence, both of which arrive
 * routinely however plainly the prompt asks for neither.
 */
const TITLE_MARKER = '<<<OCTOPUS_TITLE>>>'
const BODY_MARKER = '<<<OCTOPUS_BODY>>>'

/**
 * Bounds match `NewPullRequestSchema`: what cannot be opened is not worth
 * drafting, and a title over the limit would fail at `gh` after the user had
 * already accepted it.
 */
export const DraftedPullRequestSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(20_000)
})

export type DraftedPullRequest = z.infer<typeof DraftedPullRequestSchema>

/**
 * How much of the diff the prompt carries.
 *
 * The agent has read-only tools and can open any file it wants, but it cannot
 * run git — so the diff has to be handed over rather than fetched. This is the
 * ceiling on that, past which the prompt stops being about the change and
 * starts being the change.
 */
const MAX_DIFF_LINES = 600

/** The diff as unified text, bounded, with what was left out stated plainly. */
export function renderDiff(diff: WorkspaceDiff, maxLines: number = MAX_DIFF_LINES): string {
  const out: string[] = [
    `${String(diff.files.length)} file(s), +${String(diff.added)} -${String(diff.removed)}`
  ]
  let budget = maxLines

  for (const file of diff.files) {
    const moved = file.oldPath === null ? '' : ` (from ${file.oldPath})`
    out.push(
      '',
      `--- ${file.path}${moved} [${file.status}] +${String(file.added)} -${String(file.removed)}`
    )

    // A binary or oversized file has no lines to show, and saying so is more
    // use to whoever reads the description than silence about it.
    if (file.omitted !== 'none') {
      out.push(`(contents omitted: ${file.omitted})`)
      continue
    }

    for (const hunk of file.hunks) {
      if (budget <= 0) break
      out.push(`@@ ${hunk.heading}`.trimEnd())

      for (const line of hunk.lines) {
        if (budget <= 0) break
        const sign = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' '
        out.push(sign + line.text)
        budget -= 1
      }
    }
  }

  if (budget <= 0) out.push('', '(diff truncated — read the files for the rest)')
  return out.join('\n')
}

/** What the agent is asked, and the shape the answer has to come back in. */
export function buildPrompt(instruction: string, diffText: string, branch: string): string {
  return [
    'Write the title and description for a pull request opening the branch',
    `\`${branch}\`. The diff follows. You may read files in the working`,
    'directory for context; do not change anything.',
    '',
    'Reply in exactly this form, with nothing before or after it and no code',
    'fence around it:',
    '',
    TITLE_MARKER,
    'a single line',
    BODY_MARKER,
    'markdown, as long as it needs to be',
    '',
    '# How this project wants pull requests written',
    '',
    instruction.trim(),
    '',
    '# The change',
    '',
    diffText
  ].join('\n')
}

/**
 * Pulls the two values out of whatever the agent replied with.
 *
 * Returns null rather than throwing: a malformed answer is a thing that
 * happens, and the caller turns it into a message about drafting rather than a
 * crash.
 */
export function parseDraft(reply: string): DraftedPullRequest | null {
  const titleAt = reply.indexOf(TITLE_MARKER)
  const bodyAt = reply.indexOf(BODY_MARKER)
  if (titleAt === -1 || bodyAt === -1 || bodyAt < titleAt) return null

  // A title is one line by definition; anything after the first is the model
  // ignoring that, and taking the first line is closer to the intent than
  // refusing the whole answer.
  //
  // Cut at the newline rather than `split(…)[0]`, which is never absent but
  // types as though it might — a branch that cannot run is a branch no test
  // can honestly cover.
  const block = reply.slice(titleAt + TITLE_MARKER.length, bodyAt).trim()
  const breaks = block.indexOf('\n')
  const title = (breaks === -1 ? block : block.slice(0, breaks)).trim()

  const body = reply.slice(bodyAt + BODY_MARKER.length).trim()

  const parsed = DraftedPullRequestSchema.safeParse({ title, body })
  return parsed.success ? parsed.data : null
}

export interface DraftOptions {
  readonly cwd: string
  readonly instruction: string
  readonly diff: WorkspaceDiff
  readonly branch: string
  readonly model: string | null
}

/**
 * One question, one answer, no session.
 *
 * Nothing here resumes or is resumable: this is not a conversation the user is
 * having, and leaving a session id behind would put a chat in their list that
 * they never opened.
 */
export async function draftPullRequest(
  options: DraftOptions,
  query: QueryFn
): Promise<DraftedPullRequest> {
  const prompt = buildPrompt(options.instruction, renderDiff(options.diff), options.branch)

  let reply = ''
  try {
    const input = new InputQueue()
    input.push(userMessage(prompt))
    // Closed immediately: nothing else will ever be said, and `stream` ends on
    // its own once the one message has gone out.
    input.close()

    const conversation = query({
      prompt: input.stream(),
      options: {
        cwd: options.cwd,
        // Reading is the most this needs. Describing a change is not a licence
        // to make one, and a draft that edited the working tree on its way to a
        // sentence would be the worst kind of surprise.
        allowedTools: [...READ_ONLY_TOOLS],
        permissionMode: 'default',
        ...(options.model === null ? {} : { model: options.model })
      }
    })

    for await (const message of conversation) {
      for (const event of mapMessage(message)) {
        if (event.type === 'text') reply += event.text
      }
    }
  } catch (error) {
    throw new GitHubError(
      'draftFailed',
      {},
      `The agent could not be asked for a description: ${String(error)}`
    )
  }

  const draft = parseDraft(reply)
  if (draft === null) {
    throw new GitHubError('draftFailed', {}, 'The agent did not answer with a title and a body.')
  }

  return draft
}
