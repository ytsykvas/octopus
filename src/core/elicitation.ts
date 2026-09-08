/**
 * What an MCP server asks the user for, and how the answer goes back.
 *
 * An MCP server may stop mid-call and ask a question — a token, a choice, a
 * confirmation. The SDK offers `onElicitation` for it, and **declines
 * automatically when nothing is offered**: the server is refused, the agent
 * carries on as though an answer had been given, and nobody sees anything. That
 * is the same failure the agent's own questions had before `QuestionCard`, and
 * it is reachable today — `settingSources` includes the project layer and a
 * worktree's own `.mcp.json` starts servers, so any repository somebody clones
 * can raise one.
 *
 * Not to be confused with two things it sits between. `questions.ts` is the
 * agent asking through a tool call; `onUserDialog` is the CLI asking the host to
 * draw a dialog, and stays unbuilt because the SDK declares no payload for the
 * one kind that exists. This one has a declared schema at both ends, which is
 * why it is the half that could be built.
 *
 * Pure — zod and nothing else behind it — because the window draws the form
 * from these types and validates a field as it is typed (§11.1).
 */

import { z } from 'zod'

/**
 * The fields a server may ask for.
 *
 * MCP restricts an elicitation form to a **flat object of primitives**, and
 * that restriction is the reason this can be drawn at all: a schema that could
 * nest would be a form builder rather than a form. Everything here mirrors the
 * MCP SDK's own definitions, narrowed to what a window can put on screen.
 */
const StringFieldSchema = z.object({
  type: z.literal('string'),
  title: z.string().default(''),
  description: z.string().default(''),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  /** Only as a hint to the reader; nothing here refuses an address. */
  format: z.enum(['date', 'date-time', 'email', 'uri']).optional(),
  default: z.string().optional()
})

const NumberFieldSchema = z.object({
  type: z.enum(['number', 'integer']),
  title: z.string().default(''),
  description: z.string().default(''),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  default: z.number().optional()
})

const BooleanFieldSchema = z.object({
  type: z.literal('boolean'),
  title: z.string().default(''),
  description: z.string().default(''),
  default: z.boolean().optional()
})

/** One option of a choice, as either spelling of an enum writes it. The label
 *  is what to draw — the value itself where the server gave no title. */
export interface Choice {
  value: string
  label: string
}

/**
 * A choice, in the three spellings MCP has accumulated.
 *
 * `enum` is the plain list, `oneOf` carries a title per option, and `enumNames`
 * is the older parallel-array form the MCP SDK still accepts. All three are
 * read into one shape here, because which spelling a server used is not
 * something a form should have an opinion about.
 */
const TitledChoiceSchema = z.object({
  type: z.literal('string'),
  title: z.string().default(''),
  description: z.string().default(''),
  oneOf: z.array(z.object({ const: z.string(), title: z.string() })).min(1),
  default: z.string().optional()
})

const ListedChoiceSchema = z.object({
  type: z.literal('string'),
  title: z.string().default(''),
  description: z.string().default(''),
  enum: z.array(z.string()).min(1),
  /** The older parallel array of display names, which the MCP SDK still takes. */
  enumNames: z.array(z.string()).optional(),
  default: z.string().optional()
})

/*
 * A union rather than one object with two optional halves, so the **type**
 * carries what the schema promises: a choice has `oneOf` or it has `enum`, and
 * a reader picking the titles apart has no third case to write a line for that
 * no test could reach.
 */
const ChoiceFieldSchema = z.union([TitledChoiceSchema, ListedChoiceSchema])

/** The whole form, as `requestedSchema` carries it. */
export const RequestedSchema = z.object({
  type: z.literal('object'),
  properties: z.record(z.string(), z.unknown()),
  required: z.array(z.string()).default([])
})

/**
 * One field of a form, in the shape the window draws.
 *
 * A schema rather than an interface, and the type taken from it, because these
 * travel in a chat event and every event is read back out of the transcript
 * through zod. A hand-written type would be a second answer to the same
 * question, and the two would part company on the first change.
 */
const DrawnFieldSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  required: z.boolean()
})

export const ElicitationFieldSchema = z.union([
  DrawnFieldSchema.extend({
    kind: z.literal('text'),
    value: z.string(),
    minLength: z.number().optional(),
    maxLength: z.number().optional(),
    format: z.enum(['date', 'date-time', 'email', 'uri']).optional()
  }),
  DrawnFieldSchema.extend({
    kind: z.literal('number'),
    /** Text while it is being typed; made a number once, on the way out. */
    value: z.string(),
    integer: z.boolean(),
    minimum: z.number().optional(),
    maximum: z.number().optional()
  }),
  DrawnFieldSchema.extend({ kind: z.literal('boolean'), value: z.boolean() }),
  DrawnFieldSchema.extend({
    kind: z.literal('choice'),
    value: z.string(),
    choices: z.array(z.object({ value: z.string(), label: z.string() }))
  })
])

export type ElicitationField = z.infer<typeof ElicitationFieldSchema>

/**
 * The value each field holds, keyed by the name the server asked under.
 *
 * Text or a flag, and a number is text: the form holds what was typed, and the
 * one conversion happens in `toContent` on the way out. Parsed at the bridge,
 * because these become the `content` an MCP server reads back.
 */
export const FormValuesSchema = z.record(z.string(), z.union([z.string(), z.boolean()]))
export type FormValues = z.infer<typeof FormValuesSchema>

/**
 * The form a server is asking for, or null where it asked for something this
 * cannot draw.
 *
 * Null rather than a partial form, and that is the decision worth keeping: a
 * form missing the one field a server actually needs would collect an answer
 * the server then refuses, and the user would have typed it for nothing. Where
 * this answers null the caller declines and says so, which is honest and costs
 * the same turn.
 */
export function readForm(requested: unknown): readonly ElicitationField[] | null {
  const parsed = RequestedSchema.safeParse(requested)
  if (!parsed.success) return null

  const fields: ElicitationField[] = []

  for (const [name, raw] of Object.entries(parsed.data.properties)) {
    const field = readField(name, raw, parsed.data.required.includes(name))
    if (field === null) return null

    fields.push(field)
  }

  return fields.length > 0 ? fields : null
}

/**
 * One field, tried against each shape in turn rather than against a union.
 *
 * The order is load-bearing: a choice **is** a string with an `enum` beside it,
 * so it has to be recognised first or every choice would draw as a text box. A
 * `z.union` cannot express that — both alternatives match, and it takes the one
 * it happens to try first.
 */
function readField(name: string, raw: unknown, required: boolean): ElicitationField | null {
  const choice = ChoiceFieldSchema.safeParse(raw)
  if (choice.success) {
    return {
      ...shared(name, choice.data, required),
      kind: 'choice',
      value: choice.data.default ?? '',
      choices: toChoices(choice.data)
    }
  }

  const flag = BooleanFieldSchema.safeParse(raw)
  if (flag.success) {
    return {
      ...shared(name, flag.data, required),
      kind: 'boolean',
      value: flag.data.default ?? false
    }
  }

  const text = StringFieldSchema.safeParse(raw)
  if (text.success) {
    return {
      ...shared(name, text.data, required),
      kind: 'text',
      value: text.data.default ?? '',
      ...(text.data.minLength !== undefined && { minLength: text.data.minLength }),
      ...(text.data.maxLength !== undefined && { maxLength: text.data.maxLength }),
      ...(text.data.format !== undefined && { format: text.data.format })
    }
  }

  const count = NumberFieldSchema.safeParse(raw)
  if (count.success) {
    return {
      ...shared(name, count.data, required),
      kind: 'number',
      // A string, because a half-typed number is not one and a field that
      // emptied itself while somebody was typing "-" would be unusable. The
      // value is made a number once, on the way out.
      value: count.data.default === undefined ? '' : String(count.data.default),
      integer: count.data.type === 'integer',
      ...(count.data.minimum !== undefined && { minimum: count.data.minimum }),
      ...(count.data.maximum !== undefined && { maximum: count.data.maximum })
    }
  }

  return null
}

/** What every field has, whatever kind it turns out to be. */
function shared(
  name: string,
  field: { readonly title: string; readonly description: string },
  required: boolean
): { name: string; label: string; description: string; required: boolean } {
  return {
    name,
    // The title where there is one, and the property's own name otherwise: a
    // label is what the reader is answering, and a blank one answers nothing.
    label: field.title === '' ? name : field.title,
    description: field.description,
    required
  }
}

function toChoices(field: z.infer<typeof ChoiceFieldSchema>): Choice[] {
  if ('oneOf' in field) {
    return field.oneOf.map((option) => ({ value: option.const, label: option.title }))
  }

  return field.enum.map((value, index) => ({
    value,
    // The parallel array only where it lines up. A server whose `enumNames` is
    // shorter than its `enum` has said nothing about the rest, and the value is
    // a better label than an empty one.
    label: field.enumNames?.[index] ?? value
  }))
}

/** Whether every required field has been answered, so a form can be submitted. */
export function isComplete(fields: readonly ElicitationField[], values: FormValues): boolean {
  return fields.every((field) => {
    // Decided by the **kind**, not by what the map happens to hold. A flag is
    // answered by being either way round — there is no empty checkbox — so a
    // required one is never what holds the form back, whether or not anybody
    // has touched it.
    if (!field.required || field.kind === 'boolean') return true

    return (values[field.name] ?? '') !== ''
  })
}

/** What one field contributes to the answer, or nothing where it is empty. */
export type AnswerValue = string | number | boolean

/**
 * The values as the server takes them back.
 *
 * Numbers become numbers here and nowhere else: the form holds a string while
 * it is being typed, and the one conversion is on the way out. A field left
 * empty is **left out** rather than sent as `''` — the schema says which are
 * required, and an optional one nobody filled in was not answered.
 */
export function toContent(
  fields: readonly ElicitationField[],
  values: FormValues
): Readonly<Record<string, AnswerValue>> {
  const content: Record<string, AnswerValue> = {}

  for (const field of fields) {
    const value = values[field.name]

    if (field.kind === 'boolean') {
      content[field.name] = value === true
      continue
    }

    const text = typeof value === 'string' ? value : ''
    if (text === '') continue

    content[field.name] = field.kind === 'number' ? Number(text) : text
  }

  return content
}
