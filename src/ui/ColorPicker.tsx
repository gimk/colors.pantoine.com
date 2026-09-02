import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { converter } from 'culori'
import { clamp } from '../color/curve'
import {
  CHROMA_JND,
  formatColor,
  gamutLabel,
  mapToGamut,
  normalizeHue,
  type Gamut,
  type Oklch,
} from '../color/oklch'
import {
  axisMaxChroma,
  boundaryChromaAt,
  cuspFor,
  fromSlicePoint,
  gamutBoundary,
  hueStops,
  sliceCells,
  toSlicePoint,
} from '../color/slice'
import { NumberField } from './NumberField'

/**
 * A picker that works the way the rest of the tool does.
 *
 * The system picker is sRGB hex and nothing else, so on a P3 or Rec. 2020
 * document it cannot express the colour being designed for — and its HSV
 * square implies a rectangular gamut, moving perceived lightness and chroma
 * together on every drag. This draws the constant-hue slice instead, with
 * the gamut as the curved wedge it is, so running out of chroma at high
 * lightness is something you see rather than something that surprises you.
 */

/** Tall enough for the wedge to read as a wedge; the width is measured. */
const PLOT_H = 240
const HUE_H = 30
const FALLBACK_W = 380
/** Flush padding: 0.5px inset aligns the 1px boundary frame edge-to-edge. */
const PAD = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 }

/**
 * Rects are laid edge to edge, and at fractional widths the rasteriser
 * leaves a hairline of background between them. Overlapping each into its
 * neighbour by a fraction of a pixel closes the seams without shifting
 * anything perceptibly.
 */
const OVERLAP = 0.5

const NUDGE = { l: 0.01, c: 0.005, h: 1 }
const COARSE = 5

const toRgb = converter('rgb')
const toHsv = converter('hsv')
const toHsl = converter('hsl')
const toOklch = converter('oklch')

let offscreenCanvas: HTMLCanvasElement | null = null

function generateSliceDataUrl(h: number, axis: number): string {
  if (typeof document === 'undefined') return ''
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas')
  }
  const W = 160
  const H = 120
  if (offscreenCanvas.width !== W || offscreenCanvas.height !== H) {
    offscreenCanvas.width = W
    offscreenCanvas.height = H
  }
  const ctx = offscreenCanvas.getContext('2d')
  if (!ctx) return ''

  const imgData = ctx.createImageData(W, H)
  const data = imgData.data

  for (let y = 0; y < H; y++) {
    const l = 1 - (y + 0.5) / H
    const rowOffset = y * W * 4
    for (let x = 0; x < W; x++) {
      const c = ((x + 0.5) / W) * axis
      const rgb = toRgb({ mode: 'oklch', l, c, h })
      const idx = rowOffset + x * 4
      data[idx] = Math.min(255, Math.max(0, Math.round((rgb?.r ?? 0) * 255)))
      data[idx + 1] = Math.min(255, Math.max(0, Math.round((rgb?.g ?? 0) * 255)))
      data[idx + 2] = Math.min(255, Math.max(0, Math.round((rgb?.b ?? 0) * 255)))
      data[idx + 3] = 255
    }
  }

  ctx.putImageData(imgData, 0, 0)
  return offscreenCanvas.toDataURL()
}

export type ColorPickerModel = 'oklch' | 'hsv' | 'hsl'

type Props = {
  color: Oklch
  gamut: Gamut
  model?: ColorPickerModel
  onChange: (color: Oklch) => void
}

export function ColorPicker({
  color,
  gamut,
  model = 'oklch',
  onChange,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<SVGSVGElement>(null)
  const stripRef = useRef<SVGSVGElement>(null)

  // Measured on the wrapper, never on the svgs, so the viewBox this drives
  // cannot feed back into the width it is measured from.
  const [viewW, setViewW] = useState(FALLBACK_W)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0].contentRect.width)
      if (next > 0) setViewW(next)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const plotW = Math.max(1, viewW - PAD.left - PAD.right)
  const plotH = PLOT_H - PAD.top - PAD.bottom
  const axis = axisMaxChroma(gamut)

  const cells = sliceCells(color.h, gamut)
  const boundary = gamutBoundary(color.h, gamut)
  const cusp = cuspFor(color.h, gamut)

  const [sliceUrl, setSliceUrl] = useState<string>('')

  useLayoutEffect(() => {
    setSliceUrl(generateSliceDataUrl(color.h, axis))
  }, [color.h, axis])

  /**
   * The painted body is hundreds of rects, and an unmemoised map would hand
   * React a fresh element for each one on every pointer move. Keyed on the
   * cell array, which `sliceCells` returns unchanged while the hue holds
   * still, so a lightness or chroma drag re-renders the marker alone.
   */
  const cellEls = useMemo(
    () =>
      cells.map((cell, i) => (
        <rect
          key={i}
          x={PAD.left + cell.x * plotW}
          y={PAD.top + cell.y * plotH}
          width={cell.w * plotW + OVERLAP}
          height={cell.h * plotH + OVERLAP}
          fill={cell.color}
        />
      )),
    [cells, plotW, plotH],
  )

  /**
   * The strip previews the hue circle at the lightness and chroma in hand,
   * so it has to be rebuilt as those change — quantised, because a fiftieth
   * of a lightness step is past what 72 patches can show and this way a fine
   * drag stops rebuilding it at all.
   */
  const stripL = Math.round(color.l * 50) / 50
  const stripC = Math.round(color.c * 100) / 100
  const stops = useMemo(() => hueStops(stripL, stripC, gamut), [stripL, stripC, gamut])
  const stopEls = useMemo(() => {
    const w = plotW / stops.length
    return stops.map((stop, i) => (
      <rect
        key={stop.h}
        x={PAD.left + i * w}
        y={0}
        width={w + OVERLAP}
        height={HUE_H}
        fill={stop.color}
      />
    ))
  }, [stops, plotW])

  const edgePath = useMemo(
    () =>
      boundary
        .map(
          (p, i) =>
            `${i === 0 ? 'M' : 'L'}${(PAD.left + (p.c / axis) * plotW).toFixed(2)} ` +
            `${(PAD.top + (1 - p.l) * plotH).toFixed(2)}`,
        )
        .join(' '),
    [boundary, axis, plotW, plotH],
  )

  const activeHsvHueRef = useRef<number>(0)
  const activeHslHueRef = useRef<number>(0)

  const hsv = useMemo(() => {
    const raw = toHsv({ mode: 'oklch', ...color })
    if (raw?.h != null && !isNaN(raw.h)) {
      activeHsvHueRef.current = raw.h
    }
    return {
      h: activeHsvHueRef.current,
      s: clamp(raw?.s ?? 0, 0, 1),
      v: clamp(raw?.v ?? 0, 0, 1),
    }
  }, [color])

  const hsl = useMemo(() => {
    const raw = toHsl({ mode: 'oklch', ...color })
    if (raw?.h != null && !isNaN(raw.h)) {
      activeHslHueRef.current = raw.h
    }
    return {
      h: activeHslHueRef.current,
      s: clamp(raw?.s ?? 0, 0, 1),
      l: clamp(raw?.l ?? 0, 0, 1),
    }
  }, [color])

  let markerX = 0
  let markerY = 0
  let hueMarkerX = 0

  if (model === 'oklch') {
    const point = toSlicePoint(color, gamut)
    markerX = PAD.left + clamp(point.x, 0, 1) * plotW
    markerY = PAD.top + clamp(point.y, 0, 1) * plotH
    hueMarkerX = PAD.left + (normalizeHue(color.h) / 360) * plotW
  } else if (model === 'hsv') {
    markerX = PAD.left + hsv.s * plotW
    markerY = PAD.top + (1 - hsv.v) * plotH
    hueMarkerX = PAD.left + (normalizeHue(hsv.h) / 360) * plotW
  } else {
    markerX = PAD.left + hsl.s * plotW
    markerY = PAD.top + (1 - hsl.l) * plotH
    hueMarkerX = PAD.left + (normalizeHue(hsl.h) / 360) * plotW
  }

  // Where an out-of-gamut request will actually land. Taken exactly rather
  // than off the quantised wedge: it sits on the edge by definition, and a
  // degree of error is visible there.
  const ceiling = boundaryChromaAt(color.l, color.h, gamut)
  const clipped = color.c - ceiling > CHROMA_JND
  const landsX = PAD.left + clamp(ceiling / axis, 0, 1) * plotW

  const cuspAt = {
    x: PAD.left + clamp(cusp.c / axis, 0, 1) * plotW,
    y: PAD.top + (1 - cusp.l) * plotH,
  }

  const resolved = mapToGamut(color, gamut)

  const emitOklch = (converted: ReturnType<typeof toOklch>) => {
    onChange({
      l: clamp(converted?.l ?? 0, 0, 1),
      c: Math.max(0, converted?.c ?? 0),
      h: converted?.h != null && !isNaN(converted.h) ? converted.h : color.h,
    })
  }

  /**
   * Client pixels to unit space, clamped into the drawn area.
   */
  const unitAt = (
    svg: SVGSVGElement,
    clientX: number,
    clientY: number,
    height: number,
    padTop = 0,
    padBottom = 0,
  ) => {
    const rect = svg.getBoundingClientRect()
    const vx = ((clientX - rect.left) / rect.width) * viewW
    const vy = ((clientY - rect.top) / rect.height) * height
    return {
      x: clamp((vx - PAD.left) / plotW, 0, 1),
      y: clamp((vy - padTop) / (height - padTop - padBottom), 0, 1),
    }
  }

  const pickPlot = (clientX: number, clientY: number) => {
    const svg = plotRef.current
    if (!svg) return
    const { x, y } = unitAt(svg, clientX, clientY, PLOT_H, PAD.top, PAD.bottom)

    if (model === 'oklch') {
      const next = fromSlicePoint(x, y, gamut)
      onChange({ ...color, l: next.l, c: next.c })
    } else if (model === 'hsv') {
      const s = x
      const v = 1 - y
      emitOklch(toOklch({ mode: 'hsv', h: hsv.h, s, v }))
    } else {
      const s = x
      const l = 1 - y
      emitOklch(toOklch({ mode: 'hsl', h: hsl.h, s, l }))
    }
  }

  const pickHue = (clientX: number, clientY: number) => {
    const svg = stripRef.current
    if (!svg) return
    const { x } = unitAt(svg, clientX, clientY, HUE_H, PAD.top, PAD.bottom)
    const newH = x * 360

    if (model === 'oklch') {
      onChange({ ...color, h: newH })
    } else if (model === 'hsv') {
      activeHsvHueRef.current = newH
      emitOklch(toOklch({ mode: 'hsv', h: newH, s: hsv.s, v: hsv.v }))
    } else {
      activeHslHueRef.current = newH
      emitOklch(toOklch({ mode: 'hsl', h: newH, s: hsl.s, l: hsl.l }))
    }
  }

  /**
   * Pointer down picks the point under the cursor and starts a drag on window,
   * applying a global cursor lock so the cursor never blinks or flickers.
   */
  const beginDrag =
    (which: 'plot' | 'hue') =>
    (event: React.PointerEvent<SVGSVGElement>) => {
      event.preventDefault()
      const picker = which === 'plot' ? pickPlot : pickHue
      picker(event.clientX, event.clientY)

      const className = which === 'plot' ? 'is-dragging-plot' : 'is-dragging-hue'
      document.body.classList.add(className)

      const onMove = (e: PointerEvent) => {
        e.preventDefault()
        picker(e.clientX, e.clientY)
      }

      const onUp = () => {
        document.body.classList.remove(className)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

  const onPlotKey = (event: React.KeyboardEvent<SVGCircleElement>) => {
    const scale = event.shiftKey ? COARSE : 1

    if (model === 'oklch') {
      let next: Oklch | null = null
      if (event.key === 'ArrowUp') next = { ...color, l: color.l + NUDGE.l * scale }
      else if (event.key === 'ArrowDown') next = { ...color, l: color.l - NUDGE.l * scale }
      else if (event.key === 'ArrowRight') next = { ...color, c: color.c + NUDGE.c * scale }
      else if (event.key === 'ArrowLeft') next = { ...color, c: color.c - NUDGE.c * scale }
      if (!next) return
      event.preventDefault()
      onChange({ ...next, l: clamp(next.l, 0, 1), c: clamp(next.c, 0, axis) })
    } else if (model === 'hsv') {
      let nextS = hsv.s
      let nextV = hsv.v
      if (event.key === 'ArrowUp') nextV = clamp(hsv.v + 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowDown') nextV = clamp(hsv.v - 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowRight') nextS = clamp(hsv.s + 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowLeft') nextS = clamp(hsv.s - 0.01 * scale, 0, 1)
      else return
      event.preventDefault()
      emitOklch(toOklch({ mode: 'hsv', h: hsv.h, s: nextS, v: nextV }))
    } else {
      let nextS = hsl.s
      let nextL = hsl.l
      if (event.key === 'ArrowUp') nextL = clamp(hsl.l + 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowDown') nextL = clamp(hsl.l - 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowRight') nextS = clamp(hsl.s + 0.01 * scale, 0, 1)
      else if (event.key === 'ArrowLeft') nextS = clamp(hsl.s - 0.01 * scale, 0, 1)
      else return
      event.preventDefault()
      emitOklch(toOklch({ mode: 'hsl', h: hsl.h, s: nextS, l: nextL }))
    }
  }

  const onHueKey = (event: React.KeyboardEvent<SVGGElement>) => {
    const scale = event.shiftKey ? COARSE : 1
    let delta = 0
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') delta = NUDGE.h * scale
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') delta = -NUDGE.h * scale
    else return
    event.preventDefault()

    if (model === 'oklch') {
      onChange({ ...color, h: normalizeHue(color.h + delta) })
    } else if (model === 'hsv') {
      const newH = normalizeHue(hsv.h + delta)
      activeHsvHueRef.current = newH
      emitOklch(toOklch({ mode: 'hsv', h: newH, s: hsv.s, v: hsv.v }))
    } else {
      const newH = normalizeHue(hsl.h + delta)
      activeHslHueRef.current = newH
      emitOklch(toOklch({ mode: 'hsl', h: newH, s: hsl.s, l: hsl.l }))
    }
  }

  const readL = (color.l * 100).toFixed(1)
  const readC = color.c.toFixed(3)
  const readH = normalizeHue(color.h).toFixed(1)

  return (
    <div className="cpick" ref={wrapRef}>
      <svg
        ref={plotRef}
        className="cpick__plot"
        viewBox={`0 0 ${viewW} ${PLOT_H}`}
        role="group"
        aria-label={
          model === 'oklch'
            ? `Lightness and chroma at hue ${readH}`
            : model === 'hsv'
              ? `Saturation and value at hue ${hsv.h.toFixed(1)}`
              : `Saturation and lightness at hue ${hsl.h.toFixed(1)}`
        }
        onPointerDown={beginDrag('plot')}
      >
        <defs>
          {model === 'oklch' && (
            <clipPath id="cpick-wedge">
              <path d={`${edgePath} L ${PAD.left} ${PAD.top} L ${PAD.left} ${PAD.top + plotH} Z`} />
            </clipPath>
          )}

          {model === 'hsv' && (
            <>
              <linearGradient id="hsv-x" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#ffffff" />
                <stop offset="100%" stopColor={`hsl(${hsv.h}, 100%, 50%)`} />
              </linearGradient>
              <linearGradient id="hsv-y" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#000000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000000" stopOpacity="1" />
              </linearGradient>
            </>
          )}

          {model === 'hsl' && (
            <>
              <linearGradient id="hsl-x" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#808080" />
                <stop offset="100%" stopColor={`hsl(${hsl.h}, 100%, 50%)`} />
              </linearGradient>
              <linearGradient id="hsl-y" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                <stop offset="50%" stopColor="#ffffff" stopOpacity="0" />
                <stop offset="50.001%" stopColor="#000000" stopOpacity="0" />
                <stop offset="100%" stopColor="#000000" stopOpacity="1" />
              </linearGradient>
            </>
          )}
        </defs>

        {model === 'oklch' && (
          <>
            {sliceUrl ? (
              <image
                href={sliceUrl}
                x={PAD.left}
                y={PAD.top}
                width={plotW}
                height={plotH}
                preserveAspectRatio="none"
                clipPath="url(#cpick-wedge)"
              />
            ) : (
              <g className="cpick__cells">{cellEls}</g>
            )}

            {/* The exact edge, over the continuous gradient. */}
            <path className="cpick__edge" d={edgePath} />

            {/* Cusp marker */}
            <circle className="cpick__cusp" cx={cuspAt.x} cy={cuspAt.y} r={4}>
              <title>{`Most saturated ${gamutLabel(gamut)} colour at this hue — L ${(cusp.l * 100).toFixed(0)}, C ${cusp.c.toFixed(3)}`}</title>
            </circle>

            {/* Out of gamut indicator */}
            {clipped && (
              <>
                <line
                  className="cpick__spill"
                  x1={landsX}
                  y1={markerY}
                  x2={markerX}
                  y2={markerY}
                />
                <circle className="cpick__lands" cx={landsX} cy={markerY} r={5}>
                  <title>{`Where this resolves in ${gamutLabel(gamut)} — C ${ceiling.toFixed(3)}`}</title>
                </circle>
              </>
            )}
          </>
        )}

        {model === 'hsv' && (
          <>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="url(#hsv-x)" />
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="url(#hsv-y)" />
          </>
        )}

        {model === 'hsl' && (
          <>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="url(#hsl-x)" />
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="url(#hsl-y)" />
          </>
        )}

        <rect
          className="cpick__frame"
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
        />

        {/* Two rings, light over dark */}
        <circle className="cpick__halo" cx={markerX} cy={markerY} r={8} />
        <circle
          className="cpick__marker"
          cx={markerX}
          cy={markerY}
          r={7}
          tabIndex={0}
          role="slider"
          aria-label={
            model === 'oklch'
              ? 'Lightness and chroma'
              : model === 'hsv'
                ? 'Saturation and value'
                : 'Saturation and lightness'
          }
          aria-valuetext={
            model === 'oklch'
              ? `Lightness ${readL} percent, chroma ${readC}`
              : model === 'hsv'
                ? `Saturation ${(hsv.s * 100).toFixed(0)} percent, value ${(hsv.v * 100).toFixed(0)} percent`
                : `Saturation ${(hsl.s * 100).toFixed(0)} percent, lightness ${(hsl.l * 100).toFixed(0)} percent`
          }
          onKeyDown={onPlotKey}
        />
      </svg>

      <svg
        ref={stripRef}
        className="cpick__hue"
        viewBox={`0 0 ${viewW} ${HUE_H}`}
        role="group"
        aria-label="Hue"
        onPointerDown={beginDrag('hue')}
      >
        <defs>
          <linearGradient id="hue-rainbow" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#ff0000" />
            <stop offset="16.66%" stopColor="#ffff00" />
            <stop offset="33.33%" stopColor="#00ff00" />
            <stop offset="50%" stopColor="#00ffff" />
            <stop offset="66.66%" stopColor="#0000ff" />
            <stop offset="83.33%" stopColor="#ff00ff" />
            <stop offset="100%" stopColor="#ff0000" />
          </linearGradient>
        </defs>

        {model === 'oklch' ? (
          stopEls
        ) : (
          <rect x={PAD.left} y={0.5} width={plotW} height={HUE_H - 1} fill="url(#hue-rainbow)" />
        )}

        <rect
          className="cpick__frame"
          x={PAD.left}
          y={0.5}
          width={plotW}
          height={HUE_H - 1}
        />
        <g
          tabIndex={0}
          role="slider"
          aria-label="Hue"
          aria-valuenow={Number(readH)}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuetext={`${readH} degrees`}
          onKeyDown={onHueKey}
        >
          <line className="cpick__halo" x1={hueMarkerX} y1={0} x2={hueMarkerX} y2={HUE_H} />
          <line className="cpick__marker" x1={hueMarkerX} y1={0} x2={hueMarkerX} y2={HUE_H} />
          <title>{`Hue ${readH}°`}</title>
        </g>
      </svg>

      <div className="cpick__fields">
        {model === 'oklch' && (
          <>
            <NumberField
              label="L"
              title="Lightness, 0 to 100 — perceptual, so equal steps look equal"
              value={color.l * 100}
              min={0}
              max={100}
              step={1}
              decimals={1}
              onCommit={(value) => onChange({ ...color, l: value / 100 })}
            />
            <NumberField
              label="C"
              title={`Chroma. ${gamutLabel(gamut)} reaches ${axis.toFixed(2)} at its widest, and far less at most hues`}
              value={color.c}
              min={0}
              max={axis}
              step={0.005}
              decimals={3}
              onCommit={(value) => onChange({ ...color, c: value })}
            />
            <NumberField
              label="H"
              title="Hue angle, 0 to 360"
              value={normalizeHue(color.h)}
              min={0}
              max={360}
              step={1}
              decimals={1}
              onCommit={(value) => onChange({ ...color, h: value })}
            />
          </>
        )}

        {model === 'hsv' && (
          <>
            <NumberField
              label="H"
              title="Hue angle, 0 to 360"
              value={normalizeHue(hsv.h)}
              min={0}
              max={360}
              step={1}
              decimals={1}
              onCommit={(value) => {
                activeHsvHueRef.current = value
                emitOklch(toOklch({ mode: 'hsv', h: value, s: hsv.s, v: hsv.v }))
              }}
            />
            <NumberField
              label="S"
              title="Saturation, 0 to 100 percent"
              value={hsv.s * 100}
              min={0}
              max={100}
              step={1}
              decimals={1}
              onCommit={(value) => {
                const s = value / 100
                emitOklch(toOklch({ mode: 'hsv', h: hsv.h, s, v: hsv.v }))
              }}
            />
            <NumberField
              label="V"
              title="Value / Brightness, 0 to 100 percent"
              value={hsv.v * 100}
              min={0}
              max={100}
              step={1}
              decimals={1}
              onCommit={(value) => {
                const v = value / 100
                emitOklch(toOklch({ mode: 'hsv', h: hsv.h, s: hsv.s, v }))
              }}
            />
          </>
        )}

        {model === 'hsl' && (
          <>
            <NumberField
              label="H"
              title="Hue angle, 0 to 360"
              value={normalizeHue(hsl.h)}
              min={0}
              max={360}
              step={1}
              decimals={1}
              onCommit={(value) => {
                activeHslHueRef.current = value
                emitOklch(toOklch({ mode: 'hsl', h: value, s: hsl.s, l: hsl.l }))
              }}
            />
            <NumberField
              label="S"
              title="Saturation, 0 to 100 percent"
              value={hsl.s * 100}
              min={0}
              max={100}
              step={1}
              decimals={1}
              onCommit={(value) => {
                const s = value / 100
                emitOklch(toOklch({ mode: 'hsl', h: hsl.h, s, l: hsl.l }))
              }}
            />
            <NumberField
              label="L"
              title="Lightness, 0 to 100 percent"
              value={hsl.l * 100}
              min={0}
              max={100}
              step={1}
              decimals={1}
              onCommit={(value) => {
                const l = value / 100
                emitOklch(toOklch({ mode: 'hsl', h: hsl.h, s: hsl.s, l }))
              }}
            />
          </>
        )}
      </div>

      <div className="cpick__out">
        <span className="cpick__preview" style={{ background: resolved.displayColor }}>
          {/* The same corner-label convention the ramp chips use, and in the
              corner because it has to cost no layout: the dialog is centred,
              so a notice that joined the flow as the marker crossed the edge
              would re-centre the modal mid-drag. */}
          {clipped && (
            <span
              className="cpick__clipped"
              title={`${gamutLabel(gamut)} cannot show this chroma — it resolves to ${ceiling.toFixed(3)}, hue held`}
            >
              {gamutLabel(gamut)} clipped
            </span>
          )}
        </span>
        <span className="cpick__values">
          <code>{formatColor(color, 'oklch')}</code>
          <code className="cpick__hex">{resolved.hex}</code>
        </span>
      </div>

    </div>
  )
}
