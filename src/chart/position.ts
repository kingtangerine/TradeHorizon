export interface LongPositionMetrics {
  readonly riskDistance: number
  readonly targetDistance: number
  readonly riskAmount: number
  readonly quantity: number
  readonly rewardAmount: number
  readonly riskReward: number
  readonly targetPercent: number
  readonly stopPercent: number
}

export function calculateLongPositionMetrics(
  entry: number,
  target: number,
  stop: number,
  accountSize: number,
  riskPercent: number,
): LongPositionMetrics {
  const riskDistance = Math.abs(entry - stop)
  const targetDistance = Math.abs(target - entry)
  const riskAmount = Math.max(0, accountSize) * Math.max(0, riskPercent) / 100
  const quantity = riskDistance > 0 ? riskAmount / riskDistance : 0
  const rewardAmount = quantity * targetDistance

  return {
    riskDistance,
    targetDistance,
    riskAmount,
    quantity,
    rewardAmount,
    riskReward: riskDistance > 0 ? targetDistance / riskDistance : 0,
    targetPercent: entry !== 0 ? targetDistance / Math.abs(entry) * 100 : 0,
    stopPercent: entry !== 0 ? riskDistance / Math.abs(entry) * 100 : 0,
  }
}
