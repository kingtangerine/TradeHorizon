import { describe, expect, it } from 'vitest'
import { alertMessage, conditionMet, describeAlert, evaluateAlert, isValidAlert, targetAt, type AlertRuleFields } from './alertRules.ts'

const base: AlertRuleFields = { id: 'a', symbol: 'BTCUSDT', targetPrice: 100, direction: 'above' }

describe('alert rules', () => {
  it('fires a crossing only when the price comes from the other side', () => {
    let step = evaluateAlert(base, 105, 0, undefined)
    expect(step.fire).toBe(false) // no previous price yet
    step = evaluateAlert(base, 99, 1, step.state)
    step = evaluateAlert(base, 101, 2, step.state)
    expect(step.fire).toBe(true)
  })

  it('fires "greater than" at once when it already holds', () => {
    expect(evaluateAlert({ ...base, condition: 'greater' }, 101, 0, undefined).fire).toBe(true)
    expect(evaluateAlert({ ...base, condition: 'less' }, 101, 0, undefined).fire).toBe(false)
  })

  it('checks channels both ways', () => {
    const channel: AlertRuleFields = { ...base, condition: 'enterChannel', upperPrice: 110 }
    expect(conditionMet(channel, 105, 0)).toBe(true)
    expect(conditionMet({ ...channel, condition: 'exitChannel' }, 111, 0)).toBe(true)
    expect(conditionMet({ ...channel, condition: 'exitChannel' }, 105, 0)).toBe(false)
  })

  it('measures % moves against the price a window ago', () => {
    const move: AlertRuleFields = { ...base, condition: 'movePercent', percent: 3, windowMs: 3_600_000 }
    expect(conditionMet(move, 103, 0, 100)).toBe(true)
    expect(conditionMet(move, 102, 0, 100)).toBe(false)
    expect(conditionMet({ ...move, direction: 'below' }, 96, 0, 100)).toBe(true)
    expect(conditionMet(move, 103, 0, undefined)).toBe(false)
  })

  it('follows a trend line, extended past its points', () => {
    const line: AlertRuleFields = { ...base, line: { t1: 0, p1: 100, t2: 10, p2: 200 } }
    expect(targetAt(line, 5)).toBe(150)
    expect(targetAt(line, 20)).toBe(300)
    expect(conditionMet(line, 251, 15)).toBe(true)
  })

  it('re-arms "every time" alerts after the condition is false again, once a minute at most', () => {
    const every: AlertRuleFields = { ...base, condition: 'greater', frequency: 'everyTime' }
    let step = evaluateAlert(every, 101, 0, undefined)
    expect(step.fire).toBe(true)
    step = evaluateAlert({ ...every, lastTriggeredAtMs: 0 }, 102, 1_000, step.state)
    expect(step.fire).toBe(false) // still above: not re-armed
    step = evaluateAlert({ ...every, lastTriggeredAtMs: 0 }, 99, 2_000, step.state)
    step = evaluateAlert({ ...every, lastTriggeredAtMs: 0 }, 101, 3_000, step.state)
    expect(step.fire).toBe(false) // cooling down
    step = evaluateAlert({ ...every, lastTriggeredAtMs: 0 }, 101, 61_000, step.state)
    expect(step.fire).toBe(true)
  })

  it('never fires after it expires', () => {
    expect(evaluateAlert({ ...base, condition: 'greater', expiresAtMs: 10 }, 150, 20, undefined).fire).toBe(false)
  })

  it('describes alerts and uses the custom message', () => {
    expect(describeAlert({ ...base, condition: 'enterChannel', upperPrice: 90 })).toBe('Entering 90 – 100')
    expect(describeAlert({ ...base, condition: 'movePercent', percent: 2.5, windowMs: 900_000, direction: 'below' })).toBe('Moving down 2.5% in 15m')
    expect(describeAlert({ ...base, line: { t1: 0, p1: 1, t2: 1, p2: 2 } })).toBe('Crossing up trend line')
    expect(alertMessage({ ...base, message: '  Take profit!  ' }, 101)).toBe('Take profit!')
    expect(alertMessage(base, 101)).toBe('Crossing up 100: price 101.')
  })

  it('rejects incomplete conditions', () => {
    expect(isValidAlert({ ...base, condition: 'enterChannel' })).toBe(false)
    expect(isValidAlert({ ...base, condition: 'movePercent', percent: 2 })).toBe(false)
    expect(isValidAlert(base)).toBe(true)
  })
})
