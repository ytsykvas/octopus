import { Gauge } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type AgentModel, EFFORT_LEVELS, type EffortChoice, effortInForce } from '@core/chats.js'

import { useAnchoredPanel } from '../../hooks/useAnchoredPanel.js'
import artHigh from '../../assets/effort/high.png'
import artLow from '../../assets/effort/low.png'
import artMax from '../../assets/effort/max.png'
import artMedium from '../../assets/effort/medium.png'
import artUltracode from '../../assets/effort/ultracode.png'
import artXhigh from '../../assets/effort/xhigh.png'
import { ComposerChip } from './ComposerChip.js'

interface EffortPickerProps {
  /** What this conversation asks for while it works; always answered. */
  readonly value: EffortChoice
  readonly onChange: (value: EffortChoice) => void
  /** What it asks for while planning, or null for "the same as the work". */
  readonly planValue: EffortChoice | null
  readonly onPlanChange: (value: EffortChoice | null) => void
  /** Whether planning is on, which decides which half the chip is naming. */
  readonly planMode: boolean
  /**
   * The model the next message will run on, which decides the scale's length.
   *
   * Undefined before the agent has reported anything, which is not the same as
   * a model that takes no effort — that one says so, and greys the chip out.
   */
  readonly model: AgentModel | undefined
}

const LABELS: Record<
  EffortChoice,
  | 'chat.effortLow'
  | 'chat.effortMedium'
  | 'chat.effortHigh'
  | 'chat.effortXhigh'
  | 'chat.effortMax'
  | 'chat.effortUltracode'
> = {
  low: 'chat.effortLow',
  medium: 'chat.effortMedium',
  high: 'chat.effortHigh',
  xhigh: 'chat.effortXhigh',
  max: 'chat.effortMax',
  ultracode: 'chat.effortUltracode'
}

/**
 * One octopus per level, and the reason the scale is worth opening.
 *
 * A `Record` rather than a lookup that can miss: a level added without a
 * picture is a build error here rather than an empty box at the top of the
 * panel.
 */
const ART: Record<EffortChoice, string> = {
  low: artLow,
  medium: artMedium,
  high: artHigh,
  xhigh: artXhigh,
  max: artMax,
  ultracode: artUltracode
}

/**
 * Room for five ticks, the divider, and a column wide enough for `ultracode`.
 *
 * Wide enough that no notch has to truncate its own name, which is what decides
 * this number rather than the picture above it: at 480 the scale read
 * `Very hi…` and `Maxim…`, and a label cut short is a level the reader has to
 * already know to recognise.
 */
const PANEL_WIDTH = 640

/** The art, the ends, the scale and what they sit in — enough to flip in time. */
const PANEL_HEIGHT = 400

/**
 * Which choices to offer for the model in force.
 *
 * A model that says nothing about effort gets the full list — silence is not a
 * refusal, and hiding levels the model would in fact accept is worse than
 * offering one it quietly downgrades.
 *
 * `ultracode` is offered exactly when `xhigh` is, that being what it runs: the
 * SDK asks for an xhigh-capable model, and a scale offering it on a model that
 * cannot would be a step to nowhere.
 */
export function effortChoicesFor(
  model: AgentModel | undefined,
  inForce: EffortChoice
): readonly EffortChoice[] {
  const supported = model?.supportedEffortLevels

  // The choice in force is offered whatever the model says about it. It is what
  // the next message will run with, and a scale whose marker sits on no tick of
  // its own has nothing to draw.
  const levels = supported
    ? EFFORT_LEVELS.filter((level) => supported.includes(level) || level === inForce)
    : EFFORT_LEVELS

  return levels.includes('xhigh') || inForce === 'ultracode' ? [...levels, 'ultracode'] : levels
}

/**
 * How hard the agent thinks, as a scale rather than a list.
 *
 * Effort is one ordered axis — faster at one end, more thorough at the other —
 * and the menu this replaced drew it as five unrelated words, which said
 * nothing about that ordering or about how far along it you were.
 *
 * `ultracode` sits past the end, behind a divider, because it is not a sixth
 * amount of thinking: it is `xhigh` with a fleet of agents behind it, and the
 * gap is what says so before the caption does.
 *
 * The octopus above the scale is the point of opening it at all. Six pictures
 * for six choices, and the one thing here that is recognised rather than read.
 */
export function EffortPicker({
  value,
  onChange,
  planValue,
  onPlanChange,
  planMode,
  model
}: EffortPickerProps): React.JSX.Element {
  const { t } = useTranslation()
  const { open, position, container, toggle } = useAnchoredPanel()

  /*
   * Which half the panel is setting.
   *
   * A pair of tabs over one scale, rather than the second marker the note that
   * asked for this leaned towards. The scale is one `role="slider"` with one
   * handle, and two handles on it is the range pattern — which these two are
   * not: planning may sit either side of the work, and `aria-valuenow` has room
   * for one answer. Two scales was the other option and is what the panel
   * argues against: two octopuses in a window that argues for calm.
   *
   * It opens on the half that is actually running, so the picture above is the
   * one the chip named.
   */
  const [tab, setTab] = useState<'code' | 'plan'>(planMode ? 'plan' : 'code')

  const shown = tab === 'plan' ? (planValue ?? value) : value
  const inForce = effortInForce({ planMode, effort: value, planEffort: planValue })

  const choices = effortChoicesFor(model, shown)
  const current = choices.indexOf(shown)

  const unsupported = model?.supportsEffort === false

  // Unclamped on purpose: past either end there is no notch, and `undefined` is
  // how the scale says so. Clamping would have `End` on the last tick report a
  // change to the level already in force.
  const move = (to: number): void => {
    const choice = choices[to]
    if (choice === undefined || choice === shown) return

    if (tab === 'plan') onPlanChange(choice)
    else onChange(choice)
  }

  return (
    <div ref={container} className="contents">
      <ComposerChip
        label={t('chat.effort')}
        value={t(LABELS[inForce])}
        open={open}
        popup="dialog"
        icon={<Gauge aria-hidden size={12} />}
        // Greyed out rather than hidden when the model does not use effort: a
        // control that disappears as you change model is harder to make sense
        // of than one that stays put and explains itself.
        disabled={unsupported}
        {...(unsupported && { title: t('chat.effortUnsupported') })}
        onClick={(event) => {
          event.stopPropagation()
          toggle(event.currentTarget, { width: PANEL_WIDTH, height: PANEL_HEIGHT })
        }}
      />

      {open && position && (
        <div
          role="dialog"
          aria-label={t('chat.effortScale')}
          style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
          className="border-line bg-canvas fixed z-50 rounded-[var(--radius-panel)] border p-4 shadow-[var(--shadow-pop)]"
        >
          {/* Two tabs over one scale. Which job you are setting is the only
              thing that differs between them, so it is a word rather than a
              second copy of the control. */}
          <div role="tablist" aria-label={t('chat.effortJob')} className="mb-3 flex gap-1">
            <JobTab
              label={t('chat.effortWhileWorking')}
              note={t(LABELS[value])}
              selected={tab === 'code'}
              onSelect={() => {
                setTab('code')
              }}
            />
            <JobTab
              label={t('chat.effortWhilePlanning')}
              note={planValue === null ? t('chat.effortSameAsWork') : t(LABELS[planValue])}
              selected={tab === 'plan'}
              onSelect={() => {
                setTab('plan')
              }}
            />
          </div>

          {/* A fixed box rather than a fitted one. The six pictures are not one
              shape — a square hatching egg, a wide excavator — and sized to
              their own edges they would resize the panel as the marker moved. */}
          <div className="flex h-60 items-center justify-center">
            <img
              // Scaled smoothly rather than with `image-rendering: pixelated`:
              // 512px into 240 is not a whole ratio, and nearest-neighbour drops
              // pixels unevenly there, which reads as a broken image rather than
              // as pixel art. The same reasoning as `Mascot`.
              //
              // Never scaled up, which is what caps the box at the source's own
              // 512: a pixel drawing enlarged past its grid goes soft in exactly
              // the way the drawing was made to avoid. Growing the box past this
              // means regenerating the files, not changing the number.
              src={ART[shown]}
              alt=""
              aria-hidden
              className="max-h-60 max-w-96 object-contain"
            />
          </div>

          <div className="text-ink-faint mt-4 flex justify-between text-[13px]">
            <span>{t('chat.effortFaster')}</span>
            <span>{t('chat.effortSmarter')}</span>
          </div>

          {/* One slider rather than a row of buttons: every tick is the same
              question answered differently, and the ordering between them is
              the fact the control exists to show. Buttons inside would also be
              a tab stop each, on a control whose whole point is one handle. */}
          <div
            role="slider"
            tabIndex={0}
            aria-label={t('chat.effortScale')}
            aria-valuemin={0}
            aria-valuemax={choices.length - 1}
            aria-valuenow={current}
            aria-valuetext={t(LABELS[shown])}
            onKeyDown={(event) => {
              const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
              if (step !== undefined) {
                event.preventDefault()
                move(current + step)
                return
              }

              if (event.key === 'Home') {
                event.preventDefault()
                move(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                move(choices.length - 1)
              }
            }}
            className="focus-ring mt-2.5 flex touch-none rounded-[var(--radius-control)] py-2"
          >
            {choices.map((choice, index) =>
              choice === 'ultracode' ? (
                <div key={choice} className="flex">
                  {/* What says `ultracode` is not the next notch along before
                      the caption underneath gets a chance to. */}
                  <div aria-hidden className="bg-line mx-2.5 w-px self-stretch" />
                  <Tick
                    label={t('chat.effortUltracode')}
                    note={t('chat.effortUltracodeNote')}
                    selected={index === current}
                    onSelect={() => {
                      move(index)
                    }}
                    className="w-[164px]"
                  />
                </div>
              ) : (
                <Tick
                  key={choice}
                  label={t(LABELS[choice])}
                  note=""
                  selected={index === current}
                  onSelect={() => {
                    move(index)
                  }}
                  className="min-w-0 flex-1"
                />
              )
            )}
          </div>

          {/* The way back, and only where it means something. A split is the
              exception — most conversations want one level — so undoing it has
              to be a click and not a hunt for which tick was there before. */}
          {tab === 'plan' && (
            <button
              type="button"
              disabled={planValue === null}
              onClick={() => {
                onPlanChange(null)
              }}
              className="focus-ring text-ink-faint hover:text-ink mt-1 rounded-[var(--radius-control)] disabled:opacity-40 disabled:hover:text-ink-faint"
            >
              {t('chat.effortMatchWork')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One of the two jobs, as a tab over the scale.
 *
 * It carries the level underneath its own name, so the half that is not on
 * screen still says what it is set to — which is most of why the pair is here
 * rather than one scale that silently sets whichever job is running.
 */
function JobTab({
  label,
  note,
  selected,
  onSelect
}: {
  label: string
  note: string
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`focus-ring flex-1 rounded-[var(--radius-control)] border px-2.5 py-1.5 text-left transition-colors ${
        selected
          ? 'border-accent bg-accent-bg text-ink'
          : 'border-line text-ink-faint hover:text-ink'
      }`}
    >
      <span className="block font-medium">{label}</span>
      <span className="text-ink-faint block">{note}</span>
    </button>
  )
}

/**
 * One notch: a length of the rule, the mark on it, and what it is called.
 *
 * The rule is drawn per tick rather than once behind them all, which is what
 * makes the break before `ultracode` fall out of the layout instead of being
 * positioned into it.
 */
function Tick({
  label,
  note,
  selected,
  onSelect,
  className
}: {
  label: string
  note: string
  selected: boolean
  onSelect: () => void
  className: string
}): React.JSX.Element {
  return (
    <div
      onPointerDown={onSelect}
      // `buttons` rather than a dragging flag held above: the pointer is down
      // or it is not, and the browser says which on every move. A flag would be
      // a second copy of that fact, and the copy is what gets stuck on when the
      // button comes up somewhere the scale never hears about.
      onPointerMove={(event) => {
        if (event.buttons === 1) onSelect()
      }}
      className={`relative cursor-pointer text-center ${className}`}
    >
      <div aria-hidden className="bg-line absolute top-[8px] right-0 left-0 h-px" />

      <div className="relative flex h-4 items-center justify-center">
        <span
          aria-hidden
          className={
            selected
              ? 'bg-accent ring-accent/20 size-3.5 rounded-full ring-4'
              : 'bg-line-strong size-2 rounded-full'
          }
        />
      </div>

      <div
        className={`mt-2.5 truncate px-1 text-[13px] ${selected ? 'text-ink' : 'text-ink-faint'}`}
      >
        {label}
      </div>

      {note !== '' && <div className="text-ink-faint truncate text-xs leading-5">{note}</div>}
    </div>
  )
}
