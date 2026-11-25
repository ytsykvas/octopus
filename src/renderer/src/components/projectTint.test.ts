import { describe, expect, it } from 'vitest'

import { projectColorStyle } from './projectTint.js'

describe('projectColorStyle', () => {
  it('points the variable at the token of the colour', () => {
    expect(projectColorStyle('teal')).toEqual({ '--project-color': 'var(--project-teal)' })
  })
})
