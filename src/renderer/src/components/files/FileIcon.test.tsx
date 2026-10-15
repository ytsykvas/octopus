import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FileIcon } from './FileIcon.js'
import { type IconResolver, loadedIconResolver, loadIconResolver } from './fileIcons.js'

vi.mock('./fileIcons.js', () => ({ loadIconResolver: vi.fn(), loadedIconResolver: vi.fn() }))

const resolver: IconResolver = (subject) =>
  subject.name === 'unknown.bin'
    ? null
    : subject.name === 'Cargo.toml'
      ? { dark: '/toml.svg', light: '/toml_light.svg' }
      : { dark: `/${subject.name}.svg`, light: null }

beforeEach(() => {
  vi.mocked(loadIconResolver).mockReset().mockResolvedValue(resolver)
  vi.mocked(loadedIconResolver).mockReset().mockReturnValue(null)
})

const images = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('img')].map((image) => image.getAttribute('src'))

describe('FileIcon', () => {
  it('draws the theme icon once it has loaded, hidden from a reader', async () => {
    const { container, findByRole } = render(
      <FileIcon name="a.ts" path="src/a.ts" kind="file" expanded={false} />
    )

    // The image is decorative, so it has no role; wait on the load instead.
    await vi.waitFor(() => {
      expect(images(container)).toEqual(['/a.ts.svg'])
    })
    expect(container.querySelector('img')).toHaveAttribute('aria-hidden', 'true')
    await expect(findByRole('img')).rejects.toThrow()
  })

  it('draws both variants when the theme has a light one, each for its ground', async () => {
    const { container } = render(
      <FileIcon name="Cargo.toml" path="Cargo.toml" kind="file" expanded={false} />
    )

    await vi.waitFor(() => {
      expect(images(container)).toEqual(['/toml.svg', '/toml_light.svg'])
    })
    const [dark, light] = container.querySelectorAll('img')
    expect(dark).toHaveClass('icon-on-dark')
    expect(light).toHaveClass('icon-on-light')
  })

  it('draws a plain icon until the theme loads, and for anything it cannot name', async () => {
    const { container } = render(
      <FileIcon name="unknown.bin" path="unknown.bin" kind="file" expanded={false} />
    )

    expect(container.querySelector('svg')).toBeInTheDocument()
    await vi.waitFor(() => {
      expect(loadIconResolver).toHaveBeenCalled()
    })
    expect(images(container)).toEqual([])
  })

  it('draws a plain folder, open or closed, when the theme will not load', async () => {
    vi.mocked(loadIconResolver).mockRejectedValue(new Error('gone'))

    const closed = render(<FileIcon name="src" path="src" kind="directory" expanded={false} />)
    const open = render(<FileIcon name="src" path="src" kind="directory" expanded />)
    await Promise.resolve()

    expect(closed.container.querySelector('.lucide-folder')).toBeInTheDocument()
    expect(open.container.querySelector('.lucide-folder-open')).toBeInTheDocument()
    expect(images(closed.container)).toEqual([])
  })

  // A row the virtualised tree mounts as it scrolls: no frame of plain icon.
  it('draws the theme icon on its first frame once the theme has loaded', () => {
    vi.mocked(loadedIconResolver).mockReturnValue(resolver)

    const { container } = render(<FileIcon name="a.ts" path="a.ts" kind="file" expanded={false} />)

    expect(images(container)).toEqual(['/a.ts.svg'])
  })
})
