import { useLayoutEffect, useRef, useState } from 'react'
import { toSvgPath, type Point } from '../color/bezier'
import {
  clamp,
  sampleCurve,
  type Channel,
  type Curve,
  type CurveControl,
} from '../color/curve'
import type { Swatch } from '../color/ramp'

/**
 * The graph is as wide as it is given and a fixed height tall.
 *
 * A fixed aspect ratio cannot work in a full-width dock: three panels across
 * a wide screen are 500-1000px each, and a portrait viewBox scaled to that
 * width comes out taller than the dock. So the viewBox is measured in real
 * pixels — one user unit per pixel — which keeps strokes and handles circular
 * at any width while the plot spreads into whatever space it has. Wide and
 * short also suits the curves: x is the ramp, and the ramp is what you read.
 */
const GRAPH_H = 190

/** Before measurement, and on the server, where there is nothing to measure. */
const FALLBACK_W = 520

const PAD = { top: 14, right: 14, bottom: 22, left: 42 }

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

  // Measured on the svg itself, which is safe from a feedback loop: its width
  // comes from the panel, never from the viewBox this sets.
  const [viewW, setViewW] = useState(FALLBACK_W)
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      if (next > 0) setViewW(next)
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  const plotW = viewW - PAD.left - PAD.right
  const plotH = GRAPH_H - PAD.top - PAD.bottom

  const last = Math.max(swatches.length - 1, 1)
  const lockedX = lockedIndex === undefined ? null : lockedIndex / last
  // An anchor that carries the locked base cannot move at all — there is
  // nothing else on the curve that could absorb the correction.
  const frozen: Target | null =
    lockedX === null ? null : lockedX <= 0 ? 'start' : lockedX >= 1 ? 'end' : null

  const toPx = (x: number, y: number): Point => ({
    x: PAD.left + x * plotW,
    y: PAD.top + (1 - (y - channel.min) / span) * plotH,
  })

  /** Client pixels to curve space, clamped into the channel box. */
  const fromClient = (clientX: number, clientY: number): Point => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * viewW
    const vy = ((clientY - rect.top) / rect.height) * GRAPH_H
    return {
      x: clamp((vx - PAD.left) / plotW, 0, 1),
      y: clamp(channel.max - ((vy - PAD.top) / plotH) * span, channel.min, channel.max),
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
      viewBox={`0 0 ${viewW} ${GRAPH_H}`}
      role="group"
      aria-label={`${channel.label} curve`}
    >
      {GRIDLINES.map((g) => (
        <line
          key={`v${g}`}
          className="graph__grid"
          x1={PAD.left + g * plotW}
          y1={PAD.top}
          x2={PAD.left + g * plotW}
          y2={PAD.top + plotH}
        />
      ))}
      {GRIDLINES.map((g) => (
        <line
          key={`h${g}`}
          className="graph__grid"
          x1={PAD.left}
          y1={PAD.top + g * plotH}
          x2={PAD.left + plotW}
          y2={PAD.top + g * plotH}
        />
      ))}

      <rect className="graph__frame" x={PAD.left} y={PAD.top} width={plotW} height={plotH} />

      <text className="graph__label" x={PAD.left - 6} y={PAD.top + 4} textAnchor="end">
        {show(channel.max)}
        {channel.unit}
      </text>
      <text className="graph__label" x={PAD.left - 6} y={PAD.top + plotH} textAnchor="end">
        {show(channel.min)}
        {channel.unit}
      </text>
      <text className="graph__label" x={PAD.left} y={GRAPH_H - 7}>
        first step
      </text>
      <text className="graph__label" x={PAD.left + plotW} y={GRAPH_H - 7} textAnchor="end">
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
