/**
 * What a board is made of, decided without a disk.
 *
 * Pure: nothing but zod and other pure core modules behind it, so the window
 * takes values from here too.
 */
import { z } from 'zod'

import type { Column } from './boardColumns.js'
import { COMMENTS_MARKER, splitBody } from './boardText.js'
import { CodedError } from './codedError.js'
import { isExternalUrl } from './externalUrls.js'
import type { Failure } from './failure.js'
import { WorkspaceKindSchema } from './workspaceKinds.js'
import type { KindDetour } from './workspaces.js'

export const BOARD_STATUSES = [
  'backlog',
  'in progress',
  'testing',
  'staging',
  'done',
  'blocked'
] as const
export const BoardStatusSchema = z.enum(BOARD_STATUSES)
export type BoardStatus = z.infer<typeof BoardStatusSchema>

export const COLUMN_ID_MAX = 100
export const ColumnIdSchema = z.string().min(1).max(COLUMN_ID_MAX)
export type ColumnId = z.infer<typeof ColumnIdSchema>

export const CARD_PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
export const CardPrioritySchema = z.enum(CARD_PRIORITIES)
export type CardPriority = z.infer<typeof CardPrioritySchema>

export const ATTACHMENTS_DIR = '_attachments'
export const ATTACHMENT_NAME_MAX = 255
export const CARD_TITLE_MAX = 200
/** The composer's own limit (`ChatMessageSchema`): a description longer than this could not be sent to an agent. */
export const CARD_TEXT_MAX = 100_000
export const CARD_LINKS_MAX = 20
export const CARD_REF_MAX = 400
export const CARD_URL_MAX = 2000

/** A link the system may be asked to open, and no longer than a URL bar holds. */
export function isCardUrl(url: string): boolean {
  return url.length <= CARD_URL_MAX && isExternalUrl(url)
}

const ExternalUrlSchema = z.string().refine(isCardUrl)

export const CardRunEntrySchema = z.looseObject({
  started: z.iso.datetime(),
  // Whose run it is: the installation's `config.deviceId`. A host name changes with the network.
  device: z.string().min(1),
  machine: z.string().min(1),
  branch: z.string().min(1),
  ended: z.iso.datetime().optional(),
  // Caught rather than failing the entry: a link edited into the file by hand
  // should cost the link, not the run's figures beside it.
  pr: ExternalUrlSchema.optional().catch(undefined),
  merged: z.iso.datetime().optional(),
  turns: z.number().int().nonnegative().optional(),
  activeMs: z.number().nonnegative().optional(),
  tokensIn: z.number().nonnegative().optional(),
  tokensOut: z.number().nonnegative().optional(),
  accounts: z.array(z.string()).optional()
})
export type CardRunEntry = z.infer<typeof CardRunEntrySchema>

export const CardMetaSchema = z.object({
  id: z.uuid().optional().catch(undefined),
  priority: CardPrioritySchema.optional().catch(undefined),
  tag: WorkspaceKindSchema.optional().catch(undefined),
  // No `.finite()`: zod 4's `z.number()` already refuses Infinity and NaN.
  order: z.number().optional().catch(undefined),
  links: z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) =>
      items.filter((item): item is string => ExternalUrlSchema.safeParse(item).success)
    ),
  runs: z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((items) =>
      items.flatMap((item) => {
        const parsed = CardRunEntrySchema.safeParse(item)
        return parsed.success ? [parsed.data] : []
      })
    )
})
export type CardMeta = z.infer<typeof CardMetaSchema>

/** A path inside a project's board folder: `<folder>/<name>.md` or `<name>.md`, nothing hidden. */
export function isCardRef(ref: string): boolean {
  if (ref.length > CARD_REF_MAX || ref.includes('\\') || ref.includes('\u0000')) return false
  const segments = ref.split('/')
  return (
    segments.length <= 2 &&
    segments.every(
      (segment) => segment !== '' && !segment.startsWith('.') && !segment.startsWith('_')
    ) &&
    /\.md$/i.test(ref)
  )
}
export const CardRefSchema = z.string().min(1).max(CARD_REF_MAX).refine(isCardRef)

/** One line: a title becomes a `# ` line in the file, and a newline in it would start a second one. */
export const CardTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(CARD_TITLE_MAX)
  .refine((title) => !/[\r\n]/.test(title))
// The comments marker written after it must still be the first, in the text as written, trimmed:
// four spaces before a fence or a marker on its first line are prose only until the trim.
export const CardDescriptionSchema = z
  .string()
  .max(CARD_TEXT_MAX)
  .refine((text) => {
    const body = text.trim()
    return splitBody(`${body}\n${COMMENTS_MARKER}\n`).description === `${body}\n`
  })
export const CardDraftSchema = z.strictObject({
  status: ColumnIdSchema,
  title: CardTitleSchema,
  description: CardDescriptionSchema.optional(),
  priority: CardPrioritySchema.optional(),
  tag: WorkspaceKindSchema.optional()
})
export const CardRewriteSchema = z.strictObject({
  title: CardTitleSchema,
  description: CardDescriptionSchema,
  priority: CardPrioritySchema.nullable(),
  tag: WorkspaceKindSchema.nullable(),
  // The description as the brainstorm read it: a change made since is refused (`cardChanged`).
  base: z.string().max(CARD_TEXT_MAX)
})
export const CARDS_PER_BATCH = 10
export const CardBatchSchema = z.array(CardDraftSchema).min(1).max(CARDS_PER_BATCH)
export const CardPatchSchema = z
  .strictObject({
    priority: CardPrioritySchema.nullable(),
    tag: WorkspaceKindSchema.nullable(),
    links: z.array(ExternalUrlSchema).max(CARD_LINKS_MAX)
  })
  // Not `.partial()`: an explicit `undefined` would read as "remove", which is what `null` says.
  .exactPartial()
export const CardMoveSchema = z.strictObject({
  status: ColumnIdSchema,
  index: z.number().int().min(0).max(10_000)
})
export const DescriptionSaveSchema = z.strictObject({
  text: z.string().max(CARD_TEXT_MAX),
  base: z.string().max(CARD_TEXT_MAX).nullable()
})
export const CommentTextSchema = z.string().trim().min(1).max(20_000)

export type CardDraft = z.infer<typeof CardDraftSchema>
export type CardRewrite = z.infer<typeof CardRewriteSchema>
export type CardPatch = z.infer<typeof CardPatchSchema>
export type CardMove = z.infer<typeof CardMoveSchema>
export type DescriptionSave = z.infer<typeof DescriptionSaveSchema>

export interface BoardCard {
  readonly ref: string
  readonly status: ColumnId
  readonly loose: boolean
  readonly title: string
  readonly meta: CardMeta
  readonly malformed: boolean
  /** The bytes are not UTF-8: listed by its file name, and no content write touches it (B104, B105). */
  readonly notText: boolean
  readonly comments: number
}
export interface CardComment {
  readonly at: string
  readonly text: string
}
export interface CardDetail extends BoardCard {
  readonly description: string
  readonly thread: readonly CardComment[]
  readonly attachments: readonly string[]
}
export interface BoardListing {
  readonly folder: string
  readonly columns: readonly Column[]
  readonly cards: readonly BoardCard[]
}
export interface CardLaunch {
  readonly workspaceId: string
  readonly draft: string | null
  readonly detour: KindDetour | null
  /** False when one started from the card was already here: the window must keep its drafts. */
  readonly created: boolean
}
/** `failure` is the earliest refusal only; a later one shows only as a null ref. */
export interface CreatedCards {
  readonly refs: readonly (string | null)[]
  readonly failure: Failure | null
}
export interface BoardChangedEvent {
  readonly projectId: string
}

export type BoardErrorCode =
  | 'boardFolderUnset'
  | 'boardFolderUnreadable'
  | 'cardMissing'
  | 'cardNameTaken'
  | 'cardChanged'
  | 'cardFrontmatterUnreadable'
  | 'cardOutside'
  | 'cardNotText'
  | 'cardTooLong'
  | 'columnMissing'
  | 'columnBuiltIn'
  | 'columnNameTaken'
  | 'columnsFull'
  | 'columnNotEmpty'

export class BoardError extends CodedError<BoardErrorCode> {
  override readonly name = 'BoardError'
}
