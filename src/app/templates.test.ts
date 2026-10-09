import { describe, expect, it } from 'vitest'
import {
  EMPTY_TEMPLATES,
  MAX_TEMPLATES,
  defaultTemplateStyle,
  deleteTemplate,
  parseTemplates,
  rectangleStyleOf,
  saveTemplate,
  toggleDefaultTemplate,
} from './templates'

const style = rectangleStyleOf({ color: '#ff0000', fillColor: '#00ff00', fillOpacity: 40, lineWidth: 3, lineStyle: 'dashed', midline: true })

describe('rectangle templates', () => {
  it('reads template fields from a drawing style and fills the gaps', () => {
    expect(style).toEqual({ color: '#ff0000', fillColor: '#00ff00', fillOpacity: 40, lineWidth: 3, lineStyle: 'dashed', midline: true })
    expect(rectangleStyleOf({})).toEqual({ color: '#3aa9ff', fillColor: '#3aa9ff', fillOpacity: 14, lineWidth: 2, lineStyle: 'solid', midline: false })
    expect(rectangleStyleOf({ fillOpacity: 400, lineWidth: 99, color: 'red' })).toMatchObject({ fillOpacity: 100, lineWidth: 5, color: '#3aa9ff' })
  })

  it('saves a template, and saving the same name again updates it', () => {
    let state = saveTemplate(EMPTY_TEMPLATES, '  Supply zone ', style, 'a')
    expect(state.templates).toEqual([{ id: 'a', name: 'Supply zone', style }])
    const changed = { ...style, fillOpacity: 10 }
    state = saveTemplate(state, 'supply ZONE', changed, 'b')
    expect(state.templates).toEqual([{ id: 'a', name: 'Supply zone', style: changed }])
  })

  it('caps the number of templates', () => {
    let state = EMPTY_TEMPLATES
    for (let index = 0; index <= MAX_TEMPLATES; index += 1) state = saveTemplate(state, `T${index}`, style, `id${index}`)
    expect(state.templates).toHaveLength(MAX_TEMPLATES)
  })

  it('tracks a default template for new rectangles and drops it with the template', () => {
    let state = saveTemplate(EMPTY_TEMPLATES, 'A', style, 'a')
    state = toggleDefaultTemplate(state, 'a')
    expect(defaultTemplateStyle(state)).toEqual(style)
    expect(defaultTemplateStyle(toggleDefaultTemplate(state, 'a'))).toBeUndefined()
    state = deleteTemplate(state, 'a')
    expect(state).toEqual({ templates: [] })
  })

  it('ignores invalid stored data', () => {
    const parsed = parseTemplates({
      templates: [{ id: 'a', name: 'ok', style: {} }, { id: 'a', name: 'dup', style: {} }, { id: 2 }, null],
      defaultId: 'missing',
    })
    expect(parsed.templates).toHaveLength(1)
    expect(parsed.defaultId).toBeUndefined()
    expect(parseTemplates('nope')).toEqual(EMPTY_TEMPLATES)
  })
})
