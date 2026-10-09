// Saved rectangle looks (fill color, fill amount, line color/width/style, middle line).
// Stored per user and synced with the rest of the account's data.

export interface RectangleStyle {
  readonly color: string
  readonly lineWidth: number
  readonly lineStyle: 'solid' | 'dashed'
  readonly fillColor: string
  readonly fillOpacity: number
  readonly midline: boolean
}

export interface RectangleTemplate {
  readonly id: string
  readonly name: string
  readonly style: RectangleStyle
}

export interface TemplateState {
  readonly templates: readonly RectangleTemplate[]
  /** Template whose look new rectangles start with. */
  readonly defaultId?: string
}

export const EMPTY_TEMPLATES: TemplateState = { templates: [] }
export const MAX_TEMPLATES = 30

const HEX = /^#[0-9a-f]{6}$/i

export function templatesKey(userId: string): string {
  return `trade-horizon:user:${userId}:rect-templates:v1`
}

/** Reads the template fields out of any rectangle style, filling gaps with the tool defaults. */
export function rectangleStyleOf(style: Readonly<Record<string, unknown>>): RectangleStyle {
  const color = typeof style.color === 'string' && HEX.test(style.color) ? style.color : '#3aa9ff'
  const fillColor = typeof style.fillColor === 'string' && HEX.test(style.fillColor) ? style.fillColor : '#3aa9ff'
  const width = typeof style.lineWidth === 'number' ? Math.round(style.lineWidth) : 2
  const opacity = typeof style.fillOpacity === 'number' ? Math.round(style.fillOpacity) : 14
  return {
    color,
    fillColor,
    lineWidth: Math.min(5, Math.max(1, width)),
    lineStyle: style.lineStyle === 'dashed' ? 'dashed' : 'solid',
    fillOpacity: Math.min(100, Math.max(0, opacity)),
    midline: style.midline === true,
  }
}

export function parseTemplates(value: unknown): TemplateState {
  if (typeof value !== 'object' || value === null) return EMPTY_TEMPLATES
  const raw = value as { templates?: unknown, defaultId?: unknown }
  const templates: RectangleTemplate[] = []
  if (Array.isArray(raw.templates)) {
    for (const item of raw.templates) {
      if (typeof item !== 'object' || item === null) continue
      const { id, name, style } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof name !== 'string' || typeof style !== 'object' || style === null) continue
      if (templates.some((template) => template.id === id)) continue
      templates.push({ id, name: name.slice(0, 40), style: rectangleStyleOf(style as Record<string, unknown>) })
    }
  }
  const defaultId = typeof raw.defaultId === 'string' && templates.some((template) => template.id === raw.defaultId)
    ? raw.defaultId
    : undefined
  return { templates: templates.slice(0, MAX_TEMPLATES), ...(defaultId ? { defaultId } : {}) }
}

export function loadTemplates(userId: string): TemplateState {
  try {
    return parseTemplates(JSON.parse(localStorage.getItem(templatesKey(userId)) ?? 'null'))
  } catch {
    return EMPTY_TEMPLATES
  }
}

export function saveTemplates(userId: string, state: TemplateState): void {
  try {
    localStorage.setItem(templatesKey(userId), JSON.stringify(state))
  } catch {
    // Storage full or blocked: templates are simply not remembered.
  }
}

/** Adds a template; saving under an existing name updates that template instead of duplicating it. */
export function saveTemplate(
  state: TemplateState,
  name: string,
  style: RectangleStyle,
  id: string = crypto.randomUUID(),
): TemplateState {
  const cleanName = name.trim().slice(0, 40) || 'Rectangle template'
  const existing = state.templates.find((template) => template.name.toLowerCase() === cleanName.toLowerCase())
  if (existing) {
    return { ...state, templates: state.templates.map((template) => (template.id === existing.id ? { ...template, style } : template)) }
  }
  if (state.templates.length >= MAX_TEMPLATES) return state
  return { ...state, templates: [...state.templates, { id, name: cleanName, style }] }
}

export function deleteTemplate(state: TemplateState, id: string): TemplateState {
  const templates = state.templates.filter((template) => template.id !== id)
  const { defaultId, ...rest } = state
  return { ...rest, templates, ...(defaultId && defaultId !== id ? { defaultId } : {}) }
}

/** Marks a template as the starting look for new rectangles; passing the current default clears it. */
export function toggleDefaultTemplate(state: TemplateState, id: string): TemplateState {
  const { defaultId, ...rest } = state
  return defaultId === id ? rest : { ...rest, defaultId: id }
}

export function defaultTemplateStyle(state: TemplateState): RectangleStyle | undefined {
  return state.templates.find((template) => template.id === state.defaultId)?.style
}
