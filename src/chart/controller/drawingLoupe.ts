import type { Chart } from 'klinecharts'
import { LOUPE_SIZE_PX, loupeCentre, loupeSlice, type ScreenPoint } from '../loupe'
import { pressedDrawingHandle } from './libraryInternals'
import { insidePane } from './paneGeometry'

/** What the loupe needs from the controller. */
export interface DrawingLoupeDeps {
  readonly chart: Chart
  readonly host: HTMLElement
  /** True while a drawing tool is armed, so a finger on the pane places a point. */
  readonly isPlacing: () => boolean
}

/** The first colour that is not transparent, from an element up through its parents. */
function solidBackground(element: HTMLElement): string {
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const colour = getComputedStyle(current).backgroundColor
    if (colour && colour !== 'transparent' && !colour.endsWith(', 0)')) return colour
  }
  return '#131722'
}

/**
 * A round magnifier for finger drawing. A fingertip hides the candle it points at, so while a finger places a point
 * of a new drawing or drags a point of an existing one, the loupe shows the chart under the finger, enlarged, with a
 * cross at the exact spot. Touch only: a mouse pointer hides nothing.
 */
export class DrawingLoupe {
  readonly #deps: DrawingLoupeDeps
  #pointerId?: number
  #finger?: ScreenPoint
  #element?: HTMLCanvasElement
  #frame?: number

  /** Starts hidden; the loupe's element is made the first time it is needed. */
  public constructor(deps: DrawingLoupeDeps) {
    this.#deps = deps
  }

  /** A finger went down on the pane: follow it, and show the loupe at once when a tool is armed. */
  public readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') return
    if (this.#pointerId !== undefined) {
      // A second finger means a pinch, not a drawing gesture.
      this.#stop()
      return
    }
    if (!insidePane(this.#deps.chart, event.clientX, event.clientY)) return
    this.#pointerId = event.pointerId
    if (this.#deps.isPlacing()) this.#show({ x: event.clientX, y: event.clientY })
  }

  /** The finger moved: the loupe follows it while a point is being placed or dragged. */
  public readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return
    if (this.#finger || this.#deps.isPlacing() || pressedDrawingHandle(this.#deps.chart)) {
      this.#show({ x: event.clientX, y: event.clientY })
    }
  }

  /** The finger lifted (or the gesture was cancelled): the loupe goes away. */
  public readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.#pointerId) this.#stop()
  }

  /** Removes the loupe from the page. */
  public dispose(): void {
    this.#stop()
    this.#element?.remove()
    this.#element = undefined
  }

  #stop(): void {
    this.#pointerId = undefined
    this.#finger = undefined
    if (this.#frame !== undefined) cancelAnimationFrame(this.#frame)
    this.#frame = undefined
    if (this.#element) this.#element.hidden = true
  }

  #show(finger: ScreenPoint): void {
    this.#finger = finger
    // The chart redraws in the same event, so paint on the next frame, when its canvases are up to date.
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = undefined
      this.#paint()
    })
  }

  #paint(): void {
    const finger = this.#finger
    if (!finger) return
    const host = this.#deps.host
    const element = (this.#element ??= this.#createElement())
    const context = element.getContext('2d')
    if (!context) return

    const density = globalThis.devicePixelRatio || 1
    const pixels = Math.round(LOUPE_SIZE_PX * density)
    if (element.width !== pixels) {
      element.width = pixels
      element.height = pixels
    }
    const area = host.getBoundingClientRect()
    const centre = loupeCentre(finger, area)
    element.style.left = `${centre.x - LOUPE_SIZE_PX / 2}px`
    element.style.top = `${centre.y - LOUPE_SIZE_PX / 2}px`
    const lineColour = getComputedStyle(host).color
    element.style.borderColor = lineColour
    element.hidden = false

    context.setTransform(density, 0, 0, density, 0, 0)
    context.fillStyle = solidBackground(host)
    context.fillRect(0, 0, LOUPE_SIZE_PX, LOUPE_SIZE_PX)
    for (const canvas of host.querySelectorAll('canvas')) {
      const shown = canvas.getBoundingClientRect()
      if (shown.width === 0 || shown.height === 0 || canvas.width === 0 || canvas.height === 0) continue
      const slice = loupeSlice(finger, shown, { x: canvas.width / shown.width, y: canvas.height / shown.height })
      if (slice) context.drawImage(canvas, ...slice.source, ...slice.target)
    }

    // The cross marks the spot under the finger; its middle is left open so the spot itself stays visible.
    const middle = LOUPE_SIZE_PX / 2
    context.strokeStyle = lineColour
    context.globalAlpha = 0.75
    context.lineWidth = 1
    context.beginPath()
    for (const [fromX, fromY, toX, toY] of [
      [0, middle, middle - 7, middle],
      [middle + 7, middle, LOUPE_SIZE_PX, middle],
      [middle, 0, middle, middle - 7],
      [middle, middle + 7, middle, LOUPE_SIZE_PX],
    ]) {
      context.moveTo(fromX, fromY)
      context.lineTo(toX, toY)
    }
    context.stroke()
    context.globalAlpha = 1
  }

  #createElement(): HTMLCanvasElement {
    const element = document.createElement('canvas')
    element.className = 'chart-loupe'
    element.hidden = true
    element.setAttribute('aria-hidden', 'true')
    element.style.width = `${LOUPE_SIZE_PX}px`
    element.style.height = `${LOUPE_SIZE_PX}px`
    document.body.append(element)
    return element
  }
}
