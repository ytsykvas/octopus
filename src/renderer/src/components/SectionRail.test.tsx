import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlertTriangle, GitBranch, Settings } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'

import { SectionRail, type RailSection } from './SectionRail.js'

type SectionId = 'general' | 'git' | 'danger'

const sections: readonly RailSection<SectionId>[] = [
  { id: 'general', label: 'General', Icon: Settings },
  { id: 'git', label: 'Git', Icon: GitBranch },
  { id: 'danger', label: 'Danger zone', Icon: AlertTriangle, destructive: true }
]

type RailProps = React.ComponentProps<typeof SectionRail<SectionId>>

function renderRail(overrides: Partial<RailProps> = {}): RailProps {
  const props: RailProps = {
    sections,
    active: 'general',
    onSelect: vi.fn(),
    ...overrides
  }

  render(<SectionRail {...props} />)
  return props
}

describe('SectionRail', () => {
  it('lists every section it was given', () => {
    renderRail()

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Git' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Danger zone' })).toBeInTheDocument()
  })

  it('marks the active section as the current one', () => {
    renderRail({ active: 'git' })

    expect(screen.getByRole('button', { current: true })).toHaveTextContent('Git')
  })

  it('selects the section that was clicked', async () => {
    const user = userEvent.setup()
    const props = renderRail({ active: 'general' })

    await user.click(screen.getByRole('button', { name: 'Git' }))

    expect(props.onSelect).toHaveBeenCalledWith('git')
  })

  // A destructive section is styled apart but navigated to like any other.
  it('selects a destructive section like any other', async () => {
    const user = userEvent.setup()
    const props = renderRail()

    await user.click(screen.getByRole('button', { name: 'Danger zone' }))

    expect(props.onSelect).toHaveBeenCalledWith('danger')
  })

  // Clicking the section already open is a no-op to the user, but the dialog
  // should not have to guard against being told to open what is open.
  it('reports the active section again when it is clicked', async () => {
    const user = userEvent.setup()
    const props = renderRail({ active: 'general' })

    await user.click(screen.getByRole('button', { name: 'General' }))

    expect(props.onSelect).toHaveBeenCalledWith('general')
  })

  it('reaches every section by keyboard', async () => {
    const user = userEvent.setup()
    renderRail()

    await user.tab()
    expect(screen.getByRole('button', { name: 'General' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Git' })).toHaveFocus()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Danger zone' })).toHaveFocus()
  })

  // The rail itself stays: the dialog lays out against it, and a rail that
  // vanished when its list was empty would take the layout with it.
  it('keeps the rail but offers nothing when there are no sections', () => {
    renderRail({ sections: [] })

    expect(screen.getByRole('navigation')).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
