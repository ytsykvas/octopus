import { ResizeHandle } from '../ResizeHandle.js'

export const PANEL_WIDTH = 420
const PANEL_MIN = 320
const PANEL_MAX = 720

export interface SidePanelProps {
  readonly label: string
  readonly width: number
  readonly onWidth: (width: number) => void
  readonly children: React.ReactNode
}

export function SidePanel({ label, width, onWidth, children }: SidePanelProps): React.JSX.Element {
  return (
    <aside
      aria-label={label}
      style={{ width }}
      className="border-line bg-surface project-tinted-top relative flex min-h-0 shrink-0 flex-col border-l"
    >
      <ResizeHandle
        grows="left"
        width={width}
        min={PANEL_MIN}
        max={PANEL_MAX}
        onResize={onWidth}
        onCommit={onWidth}
      />
      {children}
    </aside>
  )
}
