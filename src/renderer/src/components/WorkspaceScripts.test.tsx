import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { stubTerminalHost } from '../test/terminal.js'
import { workspaceView } from '../test/workspaces.js'
import { WorkspaceScripts } from './WorkspaceScripts.js'

const anna = workspaceView('anna')
const bob = workspaceView('bob')

function scripts(activeId: string, shown?: boolean): React.JSX.Element {
  return (
    <WorkspaceScripts
      workspaces={[anna, bob]}
      activeId={activeId}
      kind="run"
      scriptFor={() => null}
      projectFor={() => ({ rootPath: '/tmp/planner' })}
      onOpenSettings={vi.fn()}
      tokenFor={() => 0}
      stopTokenFor={() => 0}
      onOutcome={vi.fn()}
      {...(shown !== undefined && { shown })}
    />
  )
}

/*
 * A runner not on screen is kept laid out, so a running server's terminal keeps
 * its size, and moved out of the root's clip, so xterm stops drawing its log.
 * `invisible` alone left it drawing. jsdom lays nothing out, so the classes are
 * what can be asserted.
 */
describe('WorkspaceScripts', () => {
  beforeEach(() => {
    stubTerminalHost()
  })

  it('moves the runner of a workspace off screen while another is shown', () => {
    const { container, rerender } = render(scripts(anna.id))
    rerender(scripts(bob.id))

    const root = container.firstElementChild
    const [annas, bobs] = [...(root?.children ?? [])]
    expect(root).toHaveClass('overflow-hidden')
    expect(annas).toHaveClass('offstage')
    expect(bobs).not.toHaveClass('offstage')
  })

  // The folded build: a box of no height still counts as on screen to xterm.
  it('moves every runner off screen while the half itself is not shown', () => {
    const { container } = render(scripts(anna.id, false))

    expect(container.firstElementChild?.firstElementChild).toHaveClass('offstage')
  })
})
