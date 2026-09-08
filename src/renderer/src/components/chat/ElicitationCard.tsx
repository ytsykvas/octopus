import { Plug } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { type ElicitationField, type FormValues, isComplete } from '@core/elicitation.js'

import { Button } from '../Button.js'
import { Field } from '../Field.js'

interface ElicitationCardProps {
  readonly serverName: string
  readonly message: string
  /** A heading the server offered, or empty where it offered none. */
  readonly title: string
  readonly fields: readonly ElicitationField[]
  /** False once the turn has moved on: the card becomes a record of itself. */
  readonly answerable: boolean
  /** What became of it, when this is being read back rather than answered. */
  readonly answered: 'accept' | 'decline' | 'cancel' | null
  readonly onAnswer: (values: FormValues) => void
  readonly onDecline: () => void
}

/**
 * An MCP server asking the user for something, in the log.
 *
 * A card rather than a dialog, for the reason `QuestionCard` gives: the answer
 * belongs to the conversation and stays worth reading a month later, and a
 * modal would cover the context the answer is decided from.
 *
 * **Named by its server, first thing.** This is the one card in the log that
 * comes from software nobody here wrote — a `.mcp.json` in a checkout starts
 * these, and a form asking for a token with no visible author is the shape a
 * phishing prompt has. Whose question it is comes before what it asks.
 *
 * The form itself is drawn from a schema the server sent, read into fields by
 * `elicitation.ts`. Anything that module cannot read never gets here: it is
 * declined where it arrives, because a half-drawn form collects an answer the
 * server then refuses and the user has typed it for nothing.
 */
export function ElicitationCard({
  serverName,
  message,
  title,
  fields,
  answerable,
  answered,
  onAnswer,
  onDecline
}: ElicitationCardProps): React.JSX.Element {
  const { t } = useTranslation()

  /*
   * Two states rather than one map of both, and that is what keeps the fields
   * honest: a text box holds a string and a checkbox holds a flag, and folded
   * into one `string | boolean` every reader would need an arm for the case
   * that cannot happen — a line no test can reach, which the coverage threshold
   * rightly fails the build over.
   *
   * Both start from the schema's own defaults, so a server that suggested
   * something has suggested it rather than merely mentioned it somewhere the
   * reader has to retype.
   */
  const [text, setText] = useState<Readonly<Record<string, string>>>({})
  const [flags, setFlags] = useState<Readonly<Record<string, boolean>>>({})

  /* The server's own defaults underneath whatever has been typed over them.
     Held this way round rather than copied into the state at the start, so a
     suggestion is a suggestion the reader need not retype and the state holds
     only what somebody actually changed. */
  const values: FormValues = {
    ...Object.fromEntries(fields.map((field) => [field.name, field.value])),
    ...text,
    ...flags
  }

  return (
    <div className="border-line bg-surface rounded-[var(--radius-panel)] border p-3 text-[13px]">
      <div className="mb-2 flex items-center gap-2">
        <Plug aria-hidden className="text-ink-faint shrink-0" size={13} />
        <span className="text-ink-soft min-w-0 truncate">
          {t('elicitation.from', { server: serverName })}
        </span>
      </div>

      {title !== '' && <p className="text-ink mb-1 font-medium">{title}</p>}
      <p className="text-ink mb-3 leading-relaxed">{message}</p>

      <div className="space-y-3">
        {fields.map((field) =>
          field.kind === 'boolean' ? (
            <FlagField
              key={field.name}
              field={field}
              checked={flags[field.name] ?? field.value}
              disabled={!answerable}
              onChange={(checked) => {
                setFlags({ ...flags, [field.name]: checked })
              }}
            />
          ) : (
            <ValueField
              key={field.name}
              field={field}
              value={text[field.name] ?? field.value}
              disabled={!answerable}
              onChange={(value) => {
                setText({ ...text, [field.name]: value })
              }}
            />
          )
        )}
      </div>

      {answerable ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="accent"
            disabled={!isComplete(fields, values)}
            onClick={() => {
              onAnswer(values)
            }}
          >
            {t('elicitation.send')}
          </Button>
          <Button onClick={onDecline}>{t('elicitation.decline')}</Button>
        </div>
      ) : (
        /* A record of itself. `cancel` and `decline` are different words to a
           server — one is the question going away, the other is the user saying
           no — so they are different sentences here. */
        <p className="text-ink-faint mt-3 text-[11px]">
          {answered === null ? t('elicitation.gone') : t(`elicitation.was.${answered}`)}
        </p>
      )}
    </div>
  )
}

/** A flag, which is answered by being either way round. */
function FlagField({
  field,
  checked,
  disabled,
  onChange
}: {
  readonly field: Extract<ElicitationField, { kind: 'boolean' }>
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (checked: boolean) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <label className="flex items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked)
        }}
        className="accent-accent mt-0.5"
      />
      <span className="min-w-0">
        <span className="text-ink block">{label(field, t)}</span>
        {field.description !== '' && (
          <span className="text-ink-faint block text-[11px]">{field.description}</span>
        )}
      </span>
    </label>
  )
}

/** Everything else: a line of text, a number, or one of a list. */
function ValueField({
  field,
  value,
  disabled,
  onChange
}: {
  readonly field: Exclude<ElicitationField, { kind: 'boolean' }>
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Field label={label(field, t)} hint={field.description}>
      {(id) =>
        field.kind === 'choice' ? (
          <select
            id={id}
            value={value}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value)
            }}
            className="input w-full"
          >
            {/* An empty first option, so a required choice starts unanswered
                rather than silently on whichever the server listed first. */}
            <option value="">{t('elicitation.choose')}</option>
            {field.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            /* `number` for a number, so the platform brings its own keypad and
               stepper — but the value stays text either way, because a
               half-typed number is not one. */
            type={field.kind === 'number' ? 'number' : 'text'}
            value={value}
            disabled={disabled}
            spellCheck={false}
            onChange={(event) => {
              onChange(event.target.value)
            }}
            className="input w-full"
          />
        )
      }
    </Field>
  )
}

/** The label, saying so where the server can do without an answer. */
function label(field: ElicitationField, t: TFunction): string {
  return field.required ? field.label : t('elicitation.optional', { label: field.label })
}
