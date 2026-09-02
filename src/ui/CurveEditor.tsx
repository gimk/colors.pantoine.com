import { useRef } from 'react'
import { toSvgPath, type Point } from '../color/bezier'
import {
  clamp,
  sampleCurve,
  type Channel,
  type Curve,
  type CurveControl,
} from '../color/curve'
import type { Swatch } from '../color/ramp'

const VIEW_W = 340
const VIEW_H = 250
const PAD = { top: 14, right: 14, bottom: 22, left: 42 }
const PLOT_W = VIEW_W - PAD.left - PAD.right
const PLOT_H = VIEW_H - PAD.top - PAD.bottom

/** Which control the pointer or keyboard is moving. */
type Target = CurveControl

const HANDLE_NUDGE_X = 0.02
const GRIDLINES = [0.25, 0.5, 0.75]

type Props = {
  curve: Curve
  channel: Channel
  /** Rendered as dots riding the curve, each filled with the colour that
   *  step actually resolves to — the graph doubles as its own legend. */
  swatches: Swatch[]
  /** Set when the base is locked: that step's dot is pinned, and if it sits
   *  on an anchor the anchor stops being draggable. */
  lockedIndex?: number
  onChange: (curve: Curve, moved: Target) => void
}

export function CurveEditor({ curve, channel, swatches, lockedIndex, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<Target | null>(null)
  const span = channel.max - channel.min

  const last = Math.max(swatches.length - 1, 1)
  const lockedX = lockedIndex === undefined ? null : lockedIndex / last
  // An anchor that carries the locked base cannot move at all — there is
  // nothing else on the curve that could absorb the correction.
  const frozen: Target | null =
    lockedX === null ? null : lockedX <= 0 ? 'start' : lockedX >= 1 ? 'end' : null

  const toPx = (x: number, y: number): Point => ({
    x: PAD.left + x * PLOT_W,
    y: PAD.top + (1 - (y - channel.min) / span) * PLOT_H,
  })

  /** Client pixels to curve space, clamped into the channel box. */
  const fromClient = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * VIEW_W
    const vy = ((clientY - rect.top) / rect.height) * VIEW_H
    return {
      x: clamp((vx - PAD.left) / PLOT_W, 0, 1),
      y: clamp(channel.max - ((vy - PAD.top) / PLOT_H) * span, channel.min, channel.max),
    }
  }

  const move = (target: Target, next: Point) => {
    if (target === frozen) return
    switch (target) {
      // Anchors are pinned to x = 0 and x = 1, so only their height moves.
      // They stay in lockstep with the Start / End number inputs.
      case 'start':
        return onChange({ ...curve, start: next.y }, target)
      case 'end':
        return onChange({ ...curve, end: next.y }, target)
      case 'h1':
        return onChange({ ...curve, h1: next }, target)
      case 'h2':
        return onChange({ ...curve, h2: next }, target)
    }
  }

  const handlePointerDown = (target: Target) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (target === frozen) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragging.current = target
  }

  const handlePointerMove = (target: Target) => (event: React.PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== target) return
    move(target, fromClient(event.clientX, event.clientY))
  }

  const endDrag = () => {
    dragging.current = null
  }

  const handleKeyDown = (target: Target) => (event: React.KeyboardEvent<SVGCircleElement>) => {
    const isAnchor = target === 'start' || target === 'end'
    const current: Point = isAnchor
      ? { x: target === 'start' ? 0 : 1, y: curve[target] }
      : curve[target]
    const stepY = event.shiftKey ? channel.nudge * 10 : channel.nudge
    const stepX = event.shiftKey ? HANDLE_NUDGE_X * 5 : HANDLE_NUDGE_X

    let next: Point | null = null
    if (event.key === 'ArrowUp') next = { ...current, y: current.y + stepY }
    else if (event.key === 'ArrowDown') next = { ...current, y: current.y - stepY }
    else if (!isAnchor && event.key === 'ArrowLeft') next = { ...current, x: current.x - stepX }
    else if (!isAnchor && event.key === 'ArrowRight') next = { ...current, x: current.x + stepX }
    if (!next) return

    event.preventDefault()
    move(target, {
      x: clamp(next.x, 0, 1),
      y: clamp(next.y, channel.min, channel.max),
    })
  }

  const show = (v: number) => {
    const text = v.toFixed(channel.decimals)
    return text.includes('.') ? text.replace(/\.?0+$/, '') || '0' : text
  }

  const anchorStart = toPx(0, curve.start)
  const anchorEnd = toPx(1, curve.end)
  const handle1 = toPx(curve.h1.x, curve.h1.y)
  const handle2 = toPx(curve.h2.x, curve.h2.y)

  const controls: { target: Target; at: Point; anchor: boolean; title: string; value: number }[] = [
    {
      target: 'h1',
      at: handle1,
      anchor: false,
      title: `Start tangent, ${show(curve.h1.y)}${channel.unit}`,
      value: curve.h1.y,
    },
    {
      target: 'h2',
      at: handle2,
      anchor: false,
      title: `End tangent, ${show(curve.h2.y)}${channel.unit}`,
      value: curve.h2.y,
    },
    {
      target: 'start',
      at: anchorStart,
      anchor: true,
      title: `First step, ${show(curve.start)}${channel.unit}`,
      value: curve.start,
    },
    {
      target: 'end',
      at: anchorEnd,
      anchor: true,
      title: `Last step, ${show(curve.end)}${channel.unit}`,
      value: curve.end,
    },
  ]

  return (
    <svg
      ref={svgRef}
      className="graph"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="group"
      aria-label={`${channel.label} curve`}
    >
      {GRIDLINES.map((g) => (
        <line
          key={`v${g}`}
          className="graph__grid"
          x1={PAD.left + g * PLOT_W}
          y1={PAD.top}
          x2={PAD.left + g * PLOT_W}
          y2={PAD.top + PLOT_H}
        />
      ))}
      {GRIDLINES.map((g) => (
        <line
          key={`h${g}`}
          className="graph__grid"
          x1={PAD.left}
          y1={PAD.top + g * PLOT_H}
          x2={PAD.left + PLOT_W}
          y2={PAD.top + g * PLOT_H}
        />
      ))}

      <rect className="graph__frame" x={PAD.left} y={PAD.top} width={PLOT_W} height={PLOT_H} />

      <text className="graph__label" x={PAD.left - 6} y={PAD.top + 4} textAnchor="end">
        {show(channel.max)}
        {channel.unit}
      </text>
      <text className="graph__label" x={PAD.left - 6} y={PAD.top + PLOT_H} textAnchor="end">
        {show(channel.min)}
        {channel.unit}
      </text>
      <text className="graph__label" x={PAD.left} y={VIEW_H - 7}>
        first step
      </text>
      <text className="graph__label" x={PAD.left + PLOT_W} y={VIEW_H - 7} textAnchor="end">
        last step
      </text>

      {/* Tangent lines, so this reads as a curve editor rather than loose dots. */}
      <line
        className="graph__tangent"
        x1={anchorStart.x}
        y1={anchorStart.y}
        x2={handle1.x}
        y2={handle1.y}
      />
      <line
        className="graph__tangent"
        x1={anchorEnd.x}
        y1={anchorEnd.y}
        x2={handle2.x}
        y2={handle2.y}
      />

      <path
        className="graph__curve"
        d={toSvgPath(curve.start, curve.h1, curve.h2, curve.end, toPx)}
      />

      {swatches.map((swatch) => {
        const at = toPx(swatch.x, clamp(sampleCurve(curve, swatch.x), channel.min, channel.max))
        const isLocked = lockedIndex !== undefined && swatch.isBase
        return (
          <g key={swatch.index}>
            <circle
              className={`graph__dot${swatch.isBase ? ' graph__dot--base' : ''}`}
              cx={at.x}
              cy={at.y}
              r={swatch.isBase ? 6 : 4.5}
              fill={swatch.displayColor}
            >
              <title>
                {`${swatch.label} — ${swatch.hex}${isLocked ? ' — locked to the base colour' : ''}`}
              </title>
            </circle>
            {isLocked && (
              <>
                <circle className="graph__lock" cx={at.x} cy={at.y} r={10} />
                <path
                  className="graph__lock"
                  d={`M${at.x - 4} ${at.y - 10} L${at.x + 4} ${at.y - 10}`}
                />
              </>
            )}
          </g>
        )
      })}

      {controls.map(({ target, at, anchor, title, value }) => {
        const isFrozen = target === frozen
        return (
          <circle
            key={target}
            className={
              `graph__handle${anchor ? ' graph__handle--anchor' : ''}` +
              (isFrozen ? ' graph__handle--frozen' : '')
            }
            cx={at.x}
            cy={at.y}
            r={anchor ? 6 : 5}
            tabIndex={isFrozen ? -1 : 0}
            role="slider"
            aria-label={isFrozen ? `${title} — locked to the base colour` : title}
            aria-disabled={isFrozen || undefined}
            aria-valuenow={value}
            aria-valuemin={channel.min}
            aria-valuemax={channel.max}
            onPointerDown={handlePointerDown(target)}
            onPointerMove={handlePointerMove(target)}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={handleKeyDown(target)}
          >
            <title>{isFrozen ? `${title} — locked to the base colour` : title}</title>
          </circle>
        )
      })}
    </svg>
  )
}
