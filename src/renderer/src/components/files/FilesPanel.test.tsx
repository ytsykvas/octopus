import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileTreeSnapshot, TreeEntry } from '@core/fileTree.js'
import type { WorkspaceView } from '@core/workspaces.js'

import { octopus } from '../../test/octopus.js'
import { workspaceView } from '../../test/workspaces.js'
import { FilesPanel, ROW_HEIGHT } from './FilesPanel.js'
import { loadIconResolver } from './fileIcons.js'

// The icons are their own concern (FileIcon.test.tsx); here they stay plain.
vi.mock('./fileIcons.js', () => ({ loadIconResolver: vi.fn(), loadedIconResolver: () => null }))

const ANNA = workspaceView('anna')
const BOB = workspaceView('bob')

const file = (path: string, ignored = false): TreeEntry => ({ path, kind: 'file', ignored })

const SNAPSHOT: FileTreeSnapshot = {
  entries: [
    file('src/core/a.ts'),
    file('src/b.ts'),
    file('src/gone.ts'),
    file('README.md'),
    file('.env', true),
    { path: 'node_modules', kind: 'directory', ignored: true }
  ],
  statuses: { 'src/b.ts': 'modified', 'src/gone.ts': 'deleted', 'README.md': 'conflicted' },
  truncated: false
}

const answering = (snapshot: FileTreeSnapshot = SNAPSHOT): void => {
  vi.mocked(octopus().files.tree).mockResolvedValue({ ok: true, value: snapshot })
}

beforeEach(() => {
  vi.mocked(loadIconResolver).mockReturnValue(new Promise(() => undefined))
})

interface Options {
  readonly workspace?: WorkspaceView | null
  readonly visible?: boolean
  readonly activePath?: string | null
}

function renderPanel({ workspace = ANNA, visible = true, activePath = null }: Options = {}): {
  onOpen: ReturnType<typeof vi.fn>
  rerender: (next: Options) => void
} {
  const onOpen = vi.fn()
  const view = (options: Options): React.JSX.Element => (
    <FilesPanel
      workspace={options.workspace === undefined ? workspace : options.workspace}
      visible={options.visible ?? visible}
      activePath={options.activePath === undefined ? activePath : options.activePath}
      onOpen={onOpen}
    />
  )
  const { rerender } = render(view({}))
  return {
    onOpen,
    rerender: (next) => {
      rerender(view(next))
    }
  }
}

const row = (name: string): HTMLElement =>
  screen.getByRole('treeitem', { name: new RegExp(`^${name.replace('.', '\\.')}\\b`) })

const names = (): string[] =>
  screen.getAllByRole('treeitem').map((item) => item.querySelector('.truncate')?.textContent ?? '')

async function shown(): Promise<HTMLElement> {
  return screen.findByRole('tree', { name: 'Files of this workspace' })
}

describe('FilesPanel', () => {
  it('asks for a workspace when none is chosen', () => {
    renderPanel({ workspace: null })

    expect(screen.getByText('Nothing to look through yet')).toBeInTheDocument()
    expect(
      screen.getByText('Select a workspace on the left to browse its files.')
    ).toBeInTheDocument()
  })

  it('says it is reading, and then why it could not', async () => {
    vi.mocked(octopus().files.tree).mockResolvedValue({ ok: false, error: 'git broke' })

    renderPanel()

    expect(screen.getByText('Reading files…')).toBeInTheDocument()
    expect(await screen.findByText(/git broke/)).toBeInTheDocument()
  })

  it('says so when the workspace has no files', async () => {
    answering({ entries: [], statuses: {}, truncated: false })

    renderPanel()

    expect(await screen.findByText('Not a file in sight')).toBeInTheDocument()
    expect(screen.getByText('This workspace has no files yet.')).toBeInTheDocument()
  })

  it('says when the listing was cut short', async () => {
    answering({ ...SNAPSHOT, truncated: true })

    renderPanel()

    expect(await screen.findByText(/Only the first 50,000 files are listed/)).toBeInTheDocument()
  })

  it('draws the top level, folders first, each with its level and place', async () => {
    answering()
    renderPanel()
    await shown()

    expect(names()).toEqual(['node_modules', 'src', '.env', 'README.md'])
    expect(row('src')).toHaveAttribute('aria-level', '1')
    expect(row('src')).toHaveAttribute('aria-expanded', 'false')
    expect(row('src')).toHaveAttribute('aria-posinset', '2')
    expect(row('src')).toHaveAttribute('aria-setsize', '4')
    expect(row('README.md')).not.toHaveAttribute('aria-expanded')
  })

  it("marks git's state on each row, and says it aloud", async () => {
    answering()
    renderPanel()
    await shown()

    // A conflict: the letter for the eye, the word for a reader.
    expect(within(row('README.md')).getByText('!')).toHaveClass('text-danger')
    expect(row('README.md')).toHaveAccessibleName(/Conflicted/)
    // A folder with work inside carries a dot rather than a letter.
    expect(row('src')).toHaveAccessibleName(/has changes/)
    expect(row('.env')).toHaveAccessibleName(/ignored by git/)
    expect(within(row('.env')).getByText('.env')).toHaveClass('text-ink-faint')
  })

  it('opens and closes a folder on a click', async () => {
    answering()
    renderPanel()
    await shown()

    await userEvent.click(row('src'))
    expect(row('src')).toHaveAttribute('aria-expanded', 'true')
    expect(names()).toEqual(['node_modules', 'src', 'core', 'b.ts', 'gone.ts', '.env', 'README.md'])
    expect(row('b.ts')).toHaveAttribute('aria-level', '2')
    expect(within(row('b.ts')).getByText('M')).toHaveClass('text-info')
    expect(within(row('gone.ts')).getByText('gone.ts')).toHaveClass('line-through')

    await userEvent.click(row('src'))
    expect(names()).toEqual(['node_modules', 'src', '.env', 'README.md'])
  })

  // Two toggles before React renders again must both count.
  it('opens two folders clicked within one frame', async () => {
    answering()
    renderPanel()
    await shown()
    await userEvent.click(row('src'))

    act(() => {
      row('core').click()
      row('node_modules').click()
    })

    expect(row('core')).toHaveAttribute('aria-expanded', 'true')
    expect(row('node_modules')).toHaveAttribute('aria-expanded', 'true')
  })

  it('previews a file on one click and keeps it on two', async () => {
    answering()
    const { onOpen } = renderPanel()
    await shown()

    await userEvent.click(row('README.md'))
    expect(onOpen).toHaveBeenLastCalledWith('README.md', false)

    await userEvent.dblClick(row('README.md'))
    expect(onOpen).toHaveBeenLastCalledWith('README.md', true)

    // Double-clicking a folder opens and closes it; it opens no tab.
    onOpen.mockClear()
    await userEvent.dblClick(row('src'))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('marks the file in front of the centre', async () => {
    answering()
    renderPanel({ activePath: 'README.md' })
    await shown()

    expect(row('README.md')).toHaveAttribute('aria-selected', 'true')
    expect(row('README.md')).toHaveClass('row-selected')
    expect(row('.env')).toHaveAttribute('aria-selected', 'false')
  })

  /*
   * A submodule is one path in git's listing, and was drawn as a file the
   * viewer then could not open. It is a folder read from disk the way an
   * ignored one is, and nothing inside it is greyed or marked: the outer
   * repository has nothing to say about it.
   */
  describe('a submodule', () => {
    const withSubmodule: FileTreeSnapshot = {
      entries: [file('README.md'), { path: 'vendor', kind: 'directory', ignored: false }],
      statuses: { vendor: 'modified' },
      truncated: false
    }

    it('opens as a folder read from disk, its rows neither greyed nor called ignored', async () => {
      answering(withSubmodule)
      vi.mocked(octopus().files.directory)
        .mockResolvedValueOnce({
          ok: true,
          value: {
            entries: [
              { name: 'src', kind: 'directory' },
              { name: 'lib.ts', kind: 'file' }
            ],
            truncated: false
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          value: { entries: [{ name: 'deep.ts', kind: 'file' }], truncated: false }
        })
      renderPanel()
      await shown()

      expect(row('vendor')).toHaveAttribute('aria-expanded', 'false')
      await userEvent.click(row('vendor'))
      const lib = await screen.findByRole('treeitem', { name: /^lib\.ts/ })
      expect(lib).not.toHaveAccessibleName(/ignored by git/)
      expect(within(lib).getByText('lib.ts')).not.toHaveClass('text-ink-faint')

      // A folder inside one is read from disk in turn: git lists nothing in there.
      await userEvent.click(row('src'))
      expect(await screen.findByRole('treeitem', { name: /^deep\.ts/ })).toBeInTheDocument()
      expect(octopus().files.directory).toHaveBeenLastCalledWith(ANNA.id, 'vendor/src')
    })

    // A new commit or an edit inside: either way the one status git gives it,
    // on the folder's own path.
    it('says when it has changed', async () => {
      answering(withSubmodule)
      renderPanel()
      await shown()

      expect(row('vendor')).toHaveAccessibleName(/has changes/)
    })
  })

  describe('an ignored folder', () => {
    it('is read from disk the first time it is opened, and only then', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [{ name: 'pkg', kind: 'directory' }], truncated: false }
      })
      renderPanel()
      await shown()

      await userEvent.click(row('node_modules'))
      expect(await screen.findByRole('treeitem', { name: /^pkg/ })).toHaveAccessibleName(
        /ignored by git/
      )

      await userEvent.click(row('node_modules'))
      await userEvent.click(row('node_modules'))
      expect(octopus().files.directory).toHaveBeenCalledTimes(1)
    })

    it('says it is reading, then that it could not', async () => {
      answering()
      let finish: (value: { ok: false; error: string }) => void = () => undefined
      vi.mocked(octopus().files.directory).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve
        })
      )
      renderPanel()
      await shown()

      await userEvent.click(row('node_modules'))
      expect(screen.getByText('Reading…')).toBeInTheDocument()

      await act(async () => {
        finish({ ok: false, error: 'gone' })
        await Promise.resolve()
      })
      expect(screen.getByText('This folder could not be read.')).toHaveClass('text-danger')
    })

    it('says when it holds more than is listed', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [], truncated: true }
      })
      renderPanel()
      await shown()

      await userEvent.click(row('node_modules'))

      expect(await screen.findByText(/Only the first 5,000 entries are listed/)).toBeInTheDocument()
    })
  })

  it('folds every folder at once, and reads again on refresh', async () => {
    answering()
    renderPanel()
    await shown()
    await userEvent.click(row('src'))

    await userEvent.click(screen.getByRole('button', { name: 'Collapse all folders' }))
    expect(names()).toEqual(['node_modules', 'src', '.env', 'README.md'])

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(octopus().files.tree).toHaveBeenCalledTimes(2)
  })

  // The panel stays mounted across workspaces; each keeps its own open folders.
  it('remembers which folders were open in each workspace', async () => {
    answering()
    const { rerender } = renderPanel()
    await shown()
    await userEvent.click(row('src'))

    rerender({ workspace: BOB })
    await waitFor(() => {
      expect(screen.queryByRole('treeitem', { name: /^b\.ts/ })).not.toBeInTheDocument()
    })
    expect(await screen.findByRole('treeitem', { name: /^src/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    rerender({ workspace: ANNA })
    expect(await screen.findByRole('treeitem', { name: /^b\.ts/ })).toBeInTheDocument()
  })

  describe('from the keyboard', () => {
    async function focused(): Promise<HTMLElement> {
      answering()
      const view = renderPanel()
      const tree = await shown()
      tree.focus()
      return Object.assign(tree, { onOpen: view.onOpen })
    }

    const current = (tree: HTMLElement): string | null =>
      document.getElementById(tree.getAttribute('aria-activedescendant') ?? '')?.title ?? null

    it('moves down and up the rows, and to either end', async () => {
      const tree = await focused()

      await userEvent.keyboard('{ArrowDown}')
      expect(current(tree)).toBe('node_modules')
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')
      expect(current(tree)).toBe('.env')
      await userEvent.keyboard('{ArrowUp}')
      expect(current(tree)).toBe('src')
      await userEvent.keyboard('{End}')
      expect(current(tree)).toBe('README.md')
      await userEvent.keyboard('{ArrowDown}')
      expect(current(tree)).toBe('README.md')
      await userEvent.keyboard('{Home}')
      expect(current(tree)).toBe('node_modules')
    })

    it('starts at the top whichever way the first key points', async () => {
      const tree = await focused()

      await userEvent.keyboard('{ArrowUp}')

      expect(current(tree)).toBe('node_modules')
    })

    it('opens a folder, steps into it, and back out to its parent', async () => {
      const tree = await focused()
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')

      await userEvent.keyboard('{ArrowRight}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'true')
      await userEvent.keyboard('{ArrowRight}')
      expect(current(tree)).toBe('src/core')
      await userEvent.keyboard('{ArrowLeft}')
      expect(current(tree)).toBe('src')
      await userEvent.keyboard('{ArrowLeft}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
      // At the top level there is no parent to go to.
      await userEvent.keyboard('{ArrowLeft}')
      expect(current(tree)).toBe('src')
    })

    it('leaves a file alone on right, and does nothing before a row has focus', async () => {
      const tree = await focused()

      await userEvent.keyboard('{ArrowLeft}{ArrowRight}{Enter}')
      expect(tree).not.toHaveAttribute('aria-activedescendant')

      await userEvent.keyboard('{End}{ArrowRight}')
      expect(current(tree)).toBe('README.md')
    })

    it('keeps a file with Enter and previews it with Space; both toggle a folder', async () => {
      const tree = await focused()
      const onOpen = (tree as HTMLElement & { onOpen: ReturnType<typeof vi.fn> }).onOpen

      await userEvent.keyboard('{End}{Enter}')
      expect(onOpen).toHaveBeenLastCalledWith('README.md', true)
      await userEvent.keyboard(' ')
      expect(onOpen).toHaveBeenLastCalledWith('README.md', false)

      await userEvent.keyboard('{Home}{ArrowDown}{Enter}')
      expect(row('src')).toHaveAttribute('aria-expanded', 'true')
      await userEvent.keyboard(' ')
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
    })

    // Collapsing hides the focused row; focus lands on the folder that hid it.
    it('keeps focus on the nearest folder still drawn when one is collapsed', async () => {
      const tree = await focused()
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowRight}')
      await userEvent.keyboard('{ArrowDown}')
      expect(current(tree)).toBe('src/core/a.ts')

      await userEvent.click(screen.getByRole('button', { name: 'Collapse all folders' }))
      expect(current(tree)).toBe('src')

      tree.focus()
      await userEvent.keyboard('{ArrowDown}')
      expect(current(tree)).toBe('.env')
    })

    // A focused file at the top that is gone after a re-read leaves nothing focused.
    it('lets go of focus when the focused row is gone from the tree', async () => {
      const tree = await focused()
      await userEvent.keyboard('{End}')
      expect(current(tree)).toBe('README.md')

      answering({
        ...SNAPSHOT,
        entries: SNAPSHOT.entries.filter((entry) => entry.path !== 'README.md')
      })
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))

      await waitFor(() => {
        expect(tree).not.toHaveAttribute('aria-activedescendant')
      })
    })

    it('lets other keys through', async () => {
      await focused()

      // Not handled, so not prevented: a Tab must still move focus on.
      expect(fireEvent.keyDown(document.activeElement ?? document.body, { key: 'a' })).toBe(true)
    })
  })

  describe('a long folder', () => {
    const many: FileTreeSnapshot = {
      entries: Array.from({ length: 5_000 }, (_, index) =>
        file(`f${String(index).padStart(4, '0')}.ts`)
      ),
      statuses: {},
      truncated: false
    }

    beforeEach(() => {
      // jsdom lays nothing out; the tree is given the height of twenty rows.
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(20 * ROW_HEIGHT)
    })

    it('draws only the rows in view and a margin around them', async () => {
      answering(many)
      renderPanel()
      const tree = await shown()

      expect(screen.getAllByRole('treeitem').length).toBeLessThan(100)

      tree.scrollTop = 2_000 * ROW_HEIGHT
      fireEvent.scroll(tree)

      expect(screen.getByTitle('f2000.ts')).toBeInTheDocument()
      expect(screen.queryByTitle('f0000.ts')).not.toBeInTheDocument()
    })

    it('scrolls to the row the keyboard moves to, either way', async () => {
      answering(many)
      renderPanel()
      const tree = await shown()
      await waitFor(() => {
        expect(screen.getAllByRole('treeitem')).toHaveLength(40)
      })
      tree.focus()

      await userEvent.keyboard('{End}')
      expect(screen.getByTitle('f4999.ts')).toBeInTheDocument()
      // The row's bottom edge and the tree's 4px padding under it, at the bottom of the view.
      expect(tree.scrollTop).toBe(4 + 5_000 * ROW_HEIGHT + 4 - 20 * ROW_HEIGHT)

      await userEvent.keyboard('{Home}')
      expect(tree.scrollTop).toBe(0)
      expect(screen.getByTitle('f0000.ts')).toBeInTheDocument()

      // A row already in view does not move the list.
      await userEvent.keyboard('{ArrowDown}')
      expect(tree.scrollTop).toBe(0)
    })

    // The next workspace's tree starts at its top, not where the last one was left.
    it('starts the next workspace at the top', async () => {
      answering(many)
      const { rerender } = renderPanel()
      const tree = await shown()
      tree.scrollTop = 2_000 * ROW_HEIGHT
      fireEvent.scroll(tree)
      expect(screen.queryByTitle('f0000.ts')).not.toBeInTheDocument()

      rerender({ workspace: BOB })

      expect(await screen.findByTitle('f0000.ts')).toBeInTheDocument()
    })

    it('measures itself again when the window is resized', async () => {
      answering(many)
      renderPanel()
      await shown()
      // Twenty rows in view and twenty below: the measurement has landed.
      await waitFor(() => {
        expect(screen.getAllByRole('treeitem')).toHaveLength(40)
      })

      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(60 * ROW_HEIGHT)
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await waitFor(() => {
        expect(screen.getAllByRole('treeitem')).toHaveLength(80)
      })
    })
  })
})
