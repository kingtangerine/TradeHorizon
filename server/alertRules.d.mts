// Types for alertRules.mjs (shared with the app).
export type AlertCondition = 'crossing' | 'greater' | 'less' | 'enterChannel' | 'exitChannel' | 'movePercent'

export interface AlertLineAnchors { readonly t1: number, readonly p1: number, readonly t2: number, readonly p2: number }

export interface AlertRuleFields {
  readonly id: string
  readonly symbol: string
  readonly targetPrice: number
  readonly direction: 'above' | 'below'
  readonly condition?: AlertCondition
  readonly upperPrice?: number
  readonly percent?: number
  readonly windowMs?: number
  readonly line?: AlertLineAnchors
  readonly frequency?: 'once' | 'everyTime'
  readonly expiresAtMs?: number
  readonly message?: string
  readonly lastTriggeredAtMs?: number
}

export interface AlertState { readonly met: boolean, readonly armed: boolean }

export const ALERT_CONDITIONS: readonly AlertCondition[]
export const EVERY_TIME_COOLDOWN_MS: number
export const MOVE_WINDOWS_MS: readonly number[]
export const MAX_MESSAGE_LENGTH: number
export function conditionOf(alert: Partial<AlertRuleFields>): AlertCondition
export function targetAt(alert: AlertRuleFields, nowMs: number): number
export function conditionMet(alert: AlertRuleFields, price: number, nowMs: number, referencePrice?: number): boolean
export function firesOnTransition(alert: AlertRuleFields): boolean
export function isExpired(alert: Partial<AlertRuleFields>, nowMs: number): boolean
export function evaluateAlert(alert: AlertRuleFields, price: number, nowMs: number, state: AlertState | undefined, referencePrice?: number): { fire: boolean, state: AlertState }
export function describeAlert(alert: AlertRuleFields): string
export function alertMessage(alert: AlertRuleFields, price: number): string
export function isValidAlert(alert: unknown): boolean
