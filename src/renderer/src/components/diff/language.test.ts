import { describe, expect, it } from 'vitest'

import { languageFor } from './language.js'

describe('languageFor', () => {
  it('reads the extension, wherever the file sits', () => {
    expect(languageFor('src/core/diff.ts')).toBe('typescript')
  })

  it('tells a component apart from a module', () => {
    expect(languageFor('App.tsx')).toBe('tsx')
  })

  it('does not care how the extension was capitalised', () => {
    expect(languageFor('README.MD')).toBe('markdown')
  })

  it('knows a file whose name is the whole answer', () => {
    expect(languageFor('Dockerfile')).toBe('docker')
    expect(languageFor('deploy/Makefile')).toBe('make')
  })

  // The leading dot starts the name rather than an extension: `.gitignore` is
  // a filename, and `gitignore` is not a language.
  it('reads a dotfile by its name rather than by what follows the dot', () => {
    expect(languageFor('.gitignore')).toBe('ini')
    expect(languageFor('.mysterious')).toBeNull()
  })

  it('has nothing to say about a file with no extension', () => {
    expect(languageFor('LICENSE')).toBeNull()
  })

  // Guessing would colour a file as a language it is not, with nothing on
  // screen to say so.
  it('has nothing to say about an extension it does not know', () => {
    expect(languageFor('notes.wat')).toBeNull()
  })

  it('reads the last extension when a name carries several', () => {
    expect(languageFor('vite.config.ts')).toBe('typescript')
  })
})
