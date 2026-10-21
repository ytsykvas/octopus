import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FileTreeSnapshot, TreeEntry } from '@core/fileTree.js'
import type { WorkspaceView } from '@core/workspaces.js'

import i18n, { DEFAULT_LANGUAGE } from '../../i18n/index.js'
import { held } from '../../test/held.js'
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
  onAttach: ReturnType<typeof vi.fn>
  rerender: (next: Options) => void
} {
  const onOpen = vi.fn()
  const onAttach = vi.fn()
  const view = (options: Options): React.JSX.Element => (
    <FilesPanel
      workspace={options.workspace === undefined ? workspace : options.workspace}
      visible={options.visible ?? visible}
      activePath={options.activePath === undefined ? activePath : options.activePath}
      onOpen={onOpen}
      onAttach={onAttach}
    />
  )
  const { rerender } = render(view({}))
  return {
    onOpen,
    onAttach,
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

  /*
   * The letters editors draw, in every language. The initial of the translated
   * word was the mark at first, and in Ukrainian "changed" is `З` — which
   * before a path reads as the digit 3.
   */
  describe('in another language', () => {
    // Unmounted first: switching back under a mounted panel re-renders it
    // outside act, after the test has ended.
    afterEach(async () => {
      cleanup()
      await i18n.changeLanguage(DEFAULT_LANGUAGE)
    })

    it("marks a row with the editor's letter, and says the word aloud", async () => {
      answering()
      renderPanel()
      await shown()
      await act(async () => {
        await i18n.changeLanguage('uk')
      })

      await userEvent.click(row('src'))
      expect(within(row('b.ts')).getByText('M')).toHaveClass('text-info')
      expect(row('b.ts')).toHaveAccessibleName(/Змінено/)
    })
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

    // The panel keeps it open across a switch; the listing has to come back with it.
    it('is read again when its workspace comes back with it still open', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [{ name: 'pkg', kind: 'directory' }], truncated: false }
      })
      const { rerender } = renderPanel()
      await shown()
      await userEvent.click(row('node_modules'))
      await screen.findByRole('treeitem', { name: /^pkg/ })

      rerender({ workspace: BOB })
      await shown()
      rerender({ workspace: ANNA })

      expect(await screen.findByRole('treeitem', { name: /^pkg/ })).toBeInTheDocument()
      expect(screen.queryByText('Reading…')).not.toBeInTheDocument()
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
        value: { entries: [{ name: 'pkg', kind: 'file' }], truncated: true }
      })
      renderPanel()
      await shown()

      await userEvent.click(row('node_modules'))

      expect(await screen.findByText(/Only the first 5,000 entries are listed/)).toBeInTheDocument()
    })

    // A submodule never checked out here is the usual one; with no row under
    // it, the open folder looked like it was still being read.
    it('says when there is nothing in it', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [], truncated: false }
      })
      renderPanel()
      await shown()

      await userEvent.click(row('node_modules'))

      expect(await screen.findByText('Nothing in this folder.')).toHaveClass('text-ink-faint')
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

    // The filter's list stands in for the tree; one back from under it draws
    // as tall as it is now, not as the pane measured while it was away.
    it('measures the tree again when it comes back from under the filter', async () => {
      answering(many)
      renderPanel()
      await shown()
      const field = screen.getByRole('combobox', { name: 'Filter files' })
      await userEvent.type(field, 'f1')
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await userEvent.clear(field)

      await waitFor(() => {
        expect(screen.getAllByRole('treeitem')).toHaveLength(40)
      })
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

  describe('the filter', () => {
    const field = (): HTMLElement => screen.getByRole('combobox', { name: 'Filter files' })
    const options = (): string[] =>
      screen.getAllByRole('option').map((option) => option.getAttribute('title') ?? '')

    it('lists the matching files flat, best first, each beside its folder', async () => {
      answering()
      renderPanel()
      await shown()

      await userEvent.type(field(), 'b')

      expect(screen.queryByRole('tree')).not.toBeInTheDocument()
      expect(options()).toEqual(['src/b.ts'])
      const match = screen.getByRole('option', { name: /^b\.ts/ })
      expect(match).toHaveTextContent('src')
      expect(match).toHaveAccessibleName(/Modified/)
    })

    it('ranks the way the mention list does, a name before a path', async () => {
      answering({
        entries: [file('docs/core/notes.md'), file('core.ts'), file('src/core/a.ts')],
        statuses: {},
        truncated: false
      })
      renderPanel()
      await shown()

      await userEvent.type(field(), 'core')

      expect(options()).toEqual(['core.ts', 'src/core/a.ts', 'docs/core/notes.md'])
    })

    it('greys a file git ignores, and finds what a folder read from disk holds', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [{ name: 'pkg.js', kind: 'file' }], truncated: false }
      })
      renderPanel()
      await shown()
      await userEvent.click(row('node_modules'))
      await screen.findByRole('treeitem', { name: /^pkg\.js/ })

      await userEvent.type(field(), 'e')

      expect(options()).toContain('.env')
      expect(screen.getByRole('option', { name: /^\.env/ })).toHaveAccessibleName(/ignored by git/)
      await userEvent.clear(field())
      await userEvent.type(field(), 'pkg')
      expect(options()).toEqual(['node_modules/pkg.js'])
    })

    it('opens with the arrows and Enter, and previews on a click', async () => {
      answering()
      const { onOpen } = renderPanel()
      await shown()

      await userEvent.type(field(), '.ts')
      expect(options()).toEqual(['src/b.ts', 'src/gone.ts', 'src/core/a.ts'])
      expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id)

      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowUp}')
      expect(screen.getByRole('option', { name: /^gone\.ts/ })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      await userEvent.keyboard('{Enter}')
      expect(onOpen).toHaveBeenLastCalledWith('src/gone.ts', true)

      await userEvent.click(screen.getByRole('option', { name: /^a\.ts/ }))
      expect(onOpen).toHaveBeenLastCalledWith('src/core/a.ts', false)
      await userEvent.dblClick(screen.getByRole('option', { name: /^b\.ts/ }))
      expect(onOpen).toHaveBeenLastCalledWith('src/b.ts', true)
    })

    // A longer query is a new list, and its first match is the likeliest.
    it('starts each new list at its first match, and stops at either end', async () => {
      answering()
      renderPanel()
      await shown()
      await userEvent.type(field(), '.ts')

      await userEvent.keyboard('{ArrowUp}')
      expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id)
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')
      expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[2]?.id)

      await userEvent.type(field(), 'x')
      await userEvent.keyboard('{Backspace}')
      expect(field()).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id)
    })

    // Every list here keeps what the arrows are on in view.
    it('scrolls the match the arrows reach into view', async () => {
      answering()
      renderPanel()
      await shown()
      const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView')
      await userEvent.type(field(), '.ts')

      await userEvent.keyboard('{ArrowDown}')

      expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByRole('option', { name: /^gone\.ts/ }))
      expect(scrolled).toHaveBeenLastCalledWith({ block: 'nearest' })
    })

    // The tree is read again after every turn; a place held across that would
    // point at another file.
    it('keeps the arrows on the same file when the tree is read again', async () => {
      answering()
      const { onOpen } = renderPanel()
      await shown()
      await userEvent.type(field(), '.ts')
      await userEvent.keyboard('{ArrowDown}')

      answering({ ...SNAPSHOT, entries: [file('src/a.ts'), ...SNAPSHOT.entries] })
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await waitFor(() => {
        expect(screen.getAllByRole('option')).toHaveLength(4)
      })
      fireEvent.keyDown(field(), { key: 'Enter' })

      expect(onOpen).toHaveBeenLastCalledWith('src/gone.ts', true)
    })

    it('follows the pointer, so Enter opens what it rests on', async () => {
      answering()
      const { onOpen } = renderPanel()
      await shown()
      await userEvent.type(field(), '.ts')

      fireEvent.mouseMove(screen.getByRole('option', { name: /^a\.ts/ }))
      fireEvent.keyDown(field(), { key: 'Enter' })

      expect(onOpen).toHaveBeenLastCalledWith('src/core/a.ts', true)
    })

    it('marks the file in front of the centre among the matches', async () => {
      answering()
      renderPanel({ activePath: 'src/b.ts' })
      await shown()

      await userEvent.type(field(), 'b')

      expect(screen.getByRole('option', { name: /^b\.ts/ })).toHaveClass('row-selected')
    })

    it('gives the tree back on Escape, and lets other keys through', async () => {
      answering()
      renderPanel()
      await shown()
      expect(fireEvent.keyDown(field(), { key: 'ArrowDown' })).toBe(true)

      await userEvent.type(field(), 'b')
      expect(fireEvent.keyDown(field(), { key: 'a' })).toBe(true)
      await userEvent.keyboard('{Escape}')

      expect(field()).toHaveValue('')
      expect(await shown()).toBeInTheDocument()
    })

    it('says when nothing matches', async () => {
      answering()
      const { onOpen } = renderPanel()
      await shown()

      await userEvent.type(field(), 'zzz ')

      expect(screen.getByText('No file matches')).toBeInTheDocument()
      expect(screen.getByText(/anything like “zzz”/)).toBeInTheDocument()
      expect(field()).not.toHaveAttribute('aria-activedescendant')
      expect(field()).toHaveAttribute('aria-expanded', 'false')
      expect(field()).not.toHaveAttribute('aria-controls')
      fireEvent.keyDown(field(), { key: 'Enter' })
      expect(onOpen).not.toHaveBeenCalled()
    })

    it('says when the list stopped at its cap', async () => {
      answering({
        entries: Array.from({ length: 300 }, (_, index) => file(`f${String(index)}.ts`)),
        statuses: {},
        truncated: false
      })
      renderPanel()
      await shown()

      await userEvent.type(field(), 'f')

      expect(screen.getAllByRole('option')).toHaveLength(200)
      expect(
        screen.getByText('The first 200 matches. Type more to narrow them.')
      ).toBeInTheDocument()
    })
  })

  describe('showing the open file', () => {
    const button = (): HTMLElement => screen.getByRole('button', { name: 'Show the open file' })

    it('waits for a file to be open', async () => {
      answering()
      renderPanel()
      await shown()

      expect(button()).toBeDisabled()
    })

    it('opens the folders above it, scrolls to it and gives it focus', async () => {
      answering()
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(3 * ROW_HEIGHT)
      renderPanel({ activePath: 'src/core/a.ts' })
      const tree = await shown()

      await userEvent.click(button())

      const target = row('a.ts')
      expect(row('src')).toHaveAttribute('aria-expanded', 'true')
      expect(row('core')).toHaveAttribute('aria-expanded', 'true')
      expect(tree).toHaveAttribute('aria-activedescendant', target.id)
      // node_modules, src, core, a.ts: the fourth row's bottom edge at the
      // bottom of a three-row view, the 4px padding under it.
      await waitFor(() => {
        expect(tree.scrollTop).toBe(4 + 4 * ROW_HEIGHT + 4 - 3 * ROW_HEIGHT)
      })
      // On the tree, so the arrows go on from the row it found.
      expect(tree).toHaveFocus()
    })

    // The tree is put away while the filter shows, and a resize meanwhile
    // measured nothing: the scroll is measured from the tree as it is now.
    it('scrolls by the height the tree has when it comes back', async () => {
      answering()
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(3 * ROW_HEIGHT)
      renderPanel({ activePath: 'src/core/a.ts' })
      await shown()
      await userEvent.type(screen.getByRole('combobox', { name: 'Filter files' }), 'b')
      act(() => {
        window.dispatchEvent(new Event('resize'))
      })

      await userEvent.click(button())

      const tree = await shown()
      await waitFor(() => {
        expect(tree.scrollTop).toBe(4 + 4 * ROW_HEIGHT + 4 - 3 * ROW_HEIGHT)
      })
    })

    // Not in the tree at all: nothing is read for it, and a re-read that later
    // brings it in must not move the tree long after the click.
    it('gives up on a file the tree does not hold', async () => {
      answering()
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(3 * ROW_HEIGHT)
      renderPanel({ activePath: 'src/late.ts' })
      const tree = await shown()
      await userEvent.click(button())

      answering({ ...SNAPSHOT, entries: [...SNAPSHOT.entries, file('src/late.ts')] })
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await screen.findByRole('treeitem', { name: /^late\.ts/ })

      expect(tree.scrollTop).toBe(0)
      expect(tree).not.toHaveFocus()
    })

    // Still waiting on a folder read from disk when the reader moved on.
    it.each([
      ['another file comes to the centre', 'activePath'],
      ['the tree is scrolled by hand', 'scroll'],
      ['a key is pressed in the tree', 'key'],
      ['the tab is put away', 'visible']
    ])('gives up when %s', async (_, how) => {
      answering()
      // One row tall, so the row the reveal waits for is out of view.
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(ROW_HEIGHT)
      const reply = held<{
        ok: true
        value: { entries: { name: string; kind: 'file' }[]; truncated: false }
      }>()
      vi.mocked(octopus().files.directory).mockReturnValue(reply.promise)
      const { rerender } = renderPanel({ activePath: 'node_modules/pkg.js' })
      const tree = await shown()
      await userEvent.click(button())

      if (how === 'activePath') rerender({ activePath: 'README.md' })
      if (how === 'scroll') fireEvent.scroll(tree)
      if (how === 'key') fireEvent.keyDown(tree, { key: 'x' })
      if (how === 'visible') rerender({ visible: false })
      if (how === 'visible') rerender({ visible: true })
      await act(async () => {
        reply.resolve({
          ok: true,
          value: { entries: [{ name: 'pkg.js', kind: 'file' }], truncated: false }
        })
        await Promise.resolve()
      })

      expect(await screen.findByRole('treeitem', { name: /^pkg\.js/ })).toBeInTheDocument()
      expect(tree.scrollTop).toBe(0)
      expect(tree).not.toHaveFocus()
    })

    // The control for the cases above: left alone, the same wait ends in a scroll.
    it('scrolls once the folder it waits on is read', async () => {
      answering()
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(ROW_HEIGHT)
      const reply = held<{
        ok: true
        value: { entries: { name: string; kind: 'file' }[]; truncated: false }
      }>()
      vi.mocked(octopus().files.directory).mockReturnValue(reply.promise)
      renderPanel({ activePath: 'node_modules/pkg.js' })
      const tree = await shown()
      await userEvent.click(button())

      await act(async () => {
        reply.resolve({
          ok: true,
          value: { entries: [{ name: 'pkg.js', kind: 'file' }], truncated: false }
        })
        await Promise.resolve()
      })

      await waitFor(() => {
        expect(tree.scrollTop).toBe(4 + 2 * ROW_HEIGHT + 4 - ROW_HEIGHT)
      })
    })

    it('clears the filter to show it', async () => {
      answering()
      renderPanel({ activePath: 'README.md' })
      await shown()
      await userEvent.type(screen.getByRole('combobox', { name: 'Filter files' }), 'b')

      await userEvent.click(button())

      expect(await shown()).toHaveAttribute('aria-activedescendant', row('README.md').id)
    })

    // Every folder from the first one read from disk down is read that way,
    // and the deeper ones are not in the tree until the outer listing lands.
    it('reads the folders it opens from disk, and waits for the row', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockImplementation((_, folder) =>
        Promise.resolve({
          ok: true,
          value:
            folder === 'node_modules'
              ? { entries: [{ name: 'pkg', kind: 'directory' }], truncated: false }
              : { entries: [{ name: 'index.js', kind: 'file' }], truncated: false }
        })
      )
      renderPanel({ activePath: 'node_modules/pkg/index.js' })
      const tree = await shown()

      await userEvent.click(button())

      const target = await screen.findByRole('treeitem', { name: /^index\.js/ })
      expect(octopus().files.directory).toHaveBeenCalledWith(ANNA.id, 'node_modules')
      expect(octopus().files.directory).toHaveBeenCalledWith(ANNA.id, 'node_modules/pkg')
      expect(tree).toHaveAttribute('aria-activedescendant', target.id)
    })

    it('reads no folder it already holds', async () => {
      answering()
      vi.mocked(octopus().files.directory).mockResolvedValue({
        ok: true,
        value: { entries: [{ name: 'pkg.js', kind: 'file' }], truncated: false }
      })
      renderPanel({ activePath: 'node_modules/pkg.js' })
      await shown()
      await userEvent.click(row('node_modules'))
      await screen.findByRole('treeitem', { name: /^pkg\.js/ })
      await userEvent.click(row('node_modules'))

      await userEvent.click(button())

      expect(await screen.findByRole('treeitem', { name: /^pkg\.js/ })).toBeInTheDocument()
      expect(octopus().files.directory).toHaveBeenCalledTimes(1)
    })
  })

  describe('a row’s path', () => {
    let writeText: ReturnType<typeof vi.fn>

    beforeEach(() => {
      writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    })

    async function menuOn(name: string): Promise<ReturnType<typeof renderPanel>> {
      answering()
      const view = renderPanel()
      await shown()
      fireEvent.contextMenu(row(name))
      return view
    }

    it('offers both paths and the chat on a right-click, and nothing else happens', async () => {
      const { onOpen } = await menuOn('src')

      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Copy path (⌥⌘C)',
        'Copy relative path (⌥⇧⌘C)',
        'Add to chat'
      ])
      // The right button neither opens a file nor folds a folder.
      expect(onOpen).not.toHaveBeenCalled()
      expect(row('src')).toHaveAttribute('aria-expanded', 'false')
    })

    it('copies the whole path, and says it did', async () => {
      await menuOn('README.md')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path (⌥⌘C)' }))

      expect(writeText).toHaveBeenCalledExactlyOnceWith('/tmp/planner/anna/README.md')
      expect(await screen.findByRole('status')).toHaveTextContent('Path copied')
    })

    it('copies a folder’s path relative to the workspace', async () => {
      await menuOn('src')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy relative path (⌥⇧⌘C)' }))

      expect(writeText).toHaveBeenCalledExactlyOnceWith('src')
    })

    it('hands the whole path to the chat', async () => {
      const { onAttach } = await menuOn('README.md')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Add to chat' }))

      expect(onAttach).toHaveBeenCalledExactlyOnceWith('/tmp/planner/anna/README.md')
      expect(writeText).not.toHaveBeenCalled()
    })

    it('says so when the clipboard refused', async () => {
      writeText.mockRejectedValue(new Error('not focused'))
      await menuOn('README.md')

      fireEvent.click(screen.getByRole('menuitem', { name: 'Copy path (⌥⌘C)' }))

      expect(await screen.findByRole('status')).toHaveTextContent('Could not copy the path')
    })

    it('puts focus on the row it was opened on', async () => {
      await menuOn('.env')

      const tree = screen.getByRole('tree')
      expect(tree).toHaveAttribute('aria-activedescendant', row('.env').id)
    })

    describe('from the keyboard', () => {
      /* `ç` is what ⌥C types on macOS, so the key alone would never match:
         the shortcut has to be read from the physical key. */
      const press = (tree: HTMLElement, keys: { shiftKey?: boolean; altKey?: boolean }): void => {
        fireEvent.keyDown(tree, { key: 'ç', code: 'KeyC', metaKey: true, altKey: true, ...keys })
      }

      async function onReadme(): Promise<HTMLElement> {
        answering()
        renderPanel()
        const tree = await shown()
        fireEvent.keyDown(tree, { key: 'End' })
        return tree
      }

      it('copies the whole path with ⌥⌘C', async () => {
        press(await onReadme(), {})

        expect(writeText).toHaveBeenCalledExactlyOnceWith('/tmp/planner/anna/README.md')
      })

      it('copies the relative path with ⌥⇧⌘C', async () => {
        press(await onReadme(), { shiftKey: true })

        expect(writeText).toHaveBeenCalledExactlyOnceWith('README.md')
      })

      it('leaves ⌘C alone, and copies nothing with no row focused', async () => {
        press(await onReadme(), { altKey: false })
        expect(writeText).not.toHaveBeenCalled()

        cleanup()
        answering()
        renderPanel()
        press(await shown(), {})
        expect(writeText).not.toHaveBeenCalled()
      })
    })
  })
})
