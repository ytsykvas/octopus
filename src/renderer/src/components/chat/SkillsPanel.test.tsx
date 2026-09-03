import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SkillListing } from '@core/skills.js'

import { SkillsPanel } from './SkillsPanel.js'

function listing(overrides: Partial<SkillListing> = {}): SkillListing {
  return {
    key: 'octopus:review',
    name: 'review',
    description: 'When reviewing.',
    folder: 'review',
    path: '/skills/review',
    scope: 'global',
    enabled: true,
    ...overrides
  }
}

function renderPanel(skills: readonly SkillListing[]): {
  onToggle: ReturnType<typeof vi.fn>
  onOpen: ReturnType<typeof vi.fn>
  onOpenSettings: ReturnType<typeof vi.fn>
} {
  const onToggle = vi.fn()
  const onOpen = vi.fn()
  const onOpenSettings = vi.fn()
  render(
    <SkillsPanel
      skills={skills}
      onToggle={onToggle}
      onOpen={onOpen}
      onOpenSettings={onOpenSettings}
    />
  )

  return { onToggle, onOpen, onOpenSettings }
}

const openPanel = async (): Promise<void> => {
  await userEvent.click(screen.getByRole('button', { name: 'Skills for this conversation' }))
}

describe('the skills a conversation may reach for', () => {
  /*
   * Three groups because the answer to "where did this come from" changes what
   * can be done about it: the first two are octopus's own and are edited in
   * settings, the third is what the checkout carries and is read-only here.
   */
  it('groups them by where they came from', async () => {
    renderPanel([
      listing(),
      listing({ key: 'octopus-project:deploy', name: 'deploy', scope: 'project' }),
      listing({ key: 'core-module', name: 'core-module', scope: 'repository' })
    ])

    await openPanel()

    expect(screen.getByText('Everywhere')).toBeInTheDocument()
    expect(screen.getByText('This project')).toBeInTheDocument()
    expect(screen.getByText('From this repository')).toBeInTheDocument()
  })

  // An empty heading is a promise the interface is not keeping: most projects
  // have no skills of their own, and most checkouts carry none.
  it('draws no heading for a group with nothing in it', async () => {
    renderPanel([listing()])

    await openPanel()

    expect(screen.getByText('Everywhere')).toBeInTheDocument()
    expect(screen.queryByText('This project')).not.toBeInTheDocument()
    expect(screen.queryByText('From this repository')).not.toBeInTheDocument()
  })

  it('says where skills come from when there are none at all', async () => {
    const { onOpenSettings } = renderPanel([])

    await openPanel()

    expect(screen.getByText('No skills yet.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('switches one, by the key the agent knows it under', async () => {
    const { onToggle } = renderPanel([listing({ enabled: false })])

    await openPanel()
    await userEvent.click(screen.getByRole('switch', { name: 'review' }))

    expect(onToggle).toHaveBeenCalledExactlyOnceWith('octopus:review', true)
  })

  it('leaves out a description a skill does not have', async () => {
    renderPanel([listing({ description: '' })])

    await openPanel()

    expect(screen.getByText('review')).toBeInTheDocument()
    expect(screen.queryByText('When reviewing.')).not.toBeInTheDocument()
  })

  /*
   * A switch that looks like a lock is worse than no switch: this keeps a skill
   * out of the agent's listing, and says so, rather than implying the files are
   * out of its reach.
   */
  it('says what switching one off actually does', async () => {
    renderPanel([listing()])

    await openPanel()

    expect(screen.getByText(/files stay on disk/)).toBeInTheDocument()
  })

  // Nothing pushes a fresh list — what changes it happens in another window —
  // so opening the panel is the moment worth asking, and closing is not.
  it('asks for a fresh list on the way open and not on the way shut', async () => {
    const { onOpen } = renderPanel([listing()])

    await openPanel()
    expect(onOpen).toHaveBeenCalledTimes(1)

    await openPanel()
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
