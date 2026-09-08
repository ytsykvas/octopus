import { describe, expect, it } from 'vitest'

import { isComplete, readForm, toContent } from './elicitation.js'

/** A form, in the shape `requestedSchema` arrives in. */
function form(properties: Record<string, unknown>, required: string[] = []): unknown {
  return { type: 'object', properties, required }
}

describe('the form a server is asking for', () => {
  it('reads a text field, with what it will accept', () => {
    const fields = readForm(
      form({
        token: {
          type: 'string',
          title: 'API token',
          description: 'From your account page.',
          minLength: 8,
          maxLength: 64,
          format: 'uri',
          default: 'ghp_'
        }
      })
    )

    expect(fields).toEqual([
      {
        kind: 'text',
        name: 'token',
        label: 'API token',
        description: 'From your account page.',
        required: false,
        value: 'ghp_',
        minLength: 8,
        maxLength: 64,
        format: 'uri'
      }
    ])
  })

  // A label is what the reader is answering, and a blank one answers nothing.
  it('falls back to the property name where the server gave no title', () => {
    const fields = readForm(form({ token: { type: 'string' } }))

    expect(fields).toMatchObject([{ label: 'token', description: '', value: '' }])
  })

  it('marks the fields the server said it needs', () => {
    const fields = readForm(
      form({ token: { type: 'string' }, note: { type: 'string' } }, ['token'])
    )

    expect(fields).toMatchObject([
      { name: 'token', required: true },
      { name: 'note', required: false }
    ])
  })

  /*
   * A number is held as a string while it is being typed. A field that emptied
   * itself the moment somebody typed "-" would be unusable, so the one
   * conversion happens on the way out.
   */
  it('holds a number as text, and says whether it must be whole', () => {
    const fields = readForm(
      form({ port: { type: 'integer', minimum: 1, maximum: 65535, default: 8080 } })
    )

    expect(fields).toEqual([
      {
        kind: 'number',
        name: 'port',
        label: 'port',
        description: '',
        required: false,
        value: '8080',
        integer: true,
        minimum: 1,
        maximum: 65535
      }
    ])
  })

  it('reads a plain number as one that need not be whole', () => {
    expect(readForm(form({ ratio: { type: 'number' } }))).toMatchObject([
      { kind: 'number', integer: false, value: '' }
    ])
  })

  it('reads a flag, which is off unless the server says otherwise', () => {
    expect(readForm(form({ force: { type: 'boolean' } }))).toMatchObject([
      { kind: 'boolean', value: false }
    ])
    expect(readForm(form({ force: { type: 'boolean', default: true } }))).toMatchObject([
      { value: true }
    ])
  })

  /*
   * The order in which the shapes are tried is load-bearing: a choice **is** a
   * string with an `enum` beside it, so recognised second it would draw as a
   * text box and the options would be gone.
   */
  it('reads a choice rather than the text field it also looks like', () => {
    expect(readForm(form({ env: { type: 'string', enum: ['dev', 'prod'] } }))).toMatchObject([
      {
        kind: 'choice',
        choices: [
          { value: 'dev', label: 'dev' },
          { value: 'prod', label: 'prod' }
        ]
      }
    ])
  })

  it('takes the titles a choice carries beside its values', () => {
    expect(
      readForm(
        form({
          env: {
            type: 'string',
            oneOf: [
              { const: 'dev', title: 'Development' },
              { const: 'prod', title: 'Production' }
            ]
          }
        })
      )
    ).toMatchObject([
      {
        choices: [
          { value: 'dev', label: 'Development' },
          { value: 'prod', label: 'Production' }
        ]
      }
    ])
  })

  it('takes the older parallel array of names too', () => {
    expect(
      readForm(form({ env: { type: 'string', enum: ['dev'], enumNames: ['Development'] } }))
    ).toMatchObject([{ choices: [{ value: 'dev', label: 'Development' }] }])
  })

  // A server whose names run short has said nothing about the rest, and the
  // value is a better label than an empty one.
  it('labels an option the parallel array does not reach with its own value', () => {
    expect(
      readForm(form({ env: { type: 'string', enum: ['dev', 'prod'], enumNames: ['Development'] } }))
    ).toMatchObject([
      {
        choices: [
          { value: 'dev', label: 'Development' },
          { value: 'prod', label: 'prod' }
        ]
      }
    ])
  })

  /*
   * Null rather than a partial form, and this is the decision worth keeping: a
   * form missing the one field the server actually needs would collect an answer
   * it then refuses, and the user would have typed it for nothing.
   */
  it('is nothing at all when one field cannot be drawn', () => {
    expect(readForm(form({ token: { type: 'string' }, nested: { type: 'object' } }))).toBeNull()
    expect(readForm(form({ items: { type: 'array' } }))).toBeNull()
  })

  it('is nothing for a schema that is not a form', () => {
    expect(readForm({ type: 'string' })).toBeNull()
    expect(readForm(null)).toBeNull()
    expect(readForm(form({}))).toBeNull()
  })
})

describe('whether a form may be sent', () => {
  const fields = readForm(
    form({ token: { type: 'string' }, force: { type: 'boolean' }, note: { type: 'string' } }, [
      'token',
      'force'
    ])
  )!

  it('needs every required field answered', () => {
    expect(isComplete(fields, {})).toBe(false)
    expect(isComplete(fields, { token: 'abc' })).toBe(true)
  })

  // A flag is answered by being either way round, so a required one is never
  // what is holding the form back.
  it('counts a flag as answered whichever way it is set', () => {
    expect(isComplete(fields, { token: 'abc', force: false })).toBe(true)
  })

  it('does not mind an optional field left empty', () => {
    expect(isComplete(fields, { token: 'abc', note: '' })).toBe(true)
  })
})

describe('the answer as the server takes it back', () => {
  it('makes a number of what was typed, and only there', () => {
    const fields = readForm(form({ port: { type: 'integer' }, host: { type: 'string' } }))!

    expect(toContent(fields, { port: '8080', host: 'localhost' })).toEqual({
      port: 8080,
      host: 'localhost'
    })
  })

  /*
   * Left out rather than sent as an empty string: the schema says which fields
   * are required, and an optional one nobody filled in was not answered.
   */
  it('leaves out a field nobody filled in', () => {
    const fields = readForm(form({ token: { type: 'string' }, note: { type: 'string' } }))!

    expect(toContent(fields, { token: 'abc' })).toEqual({ token: 'abc' })
  })

  // A flag is always sent, because "off" is an answer and leaving it out would
  // read as no answer at all.
  it('always sends a flag, either way round', () => {
    const fields = readForm(form({ force: { type: 'boolean' } }))!

    expect(toContent(fields, {})).toEqual({ force: false })
    expect(toContent(fields, { force: true })).toEqual({ force: true })
  })
})
