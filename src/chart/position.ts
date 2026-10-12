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

export interface DcaPositionMetrics extends LongPositionMetrics {
  /** Quantity bought at the entry price. */
  readonly baseQuantity: number
  /** Quantity bought at the DCA price (0 until the DCA is marked as triggered). */
  readonly dcaQuantity: number
  readonly totalQuantity: number
  /** Volume-weighted entry: the entry price until the DCA fills, then the blend of both fills. */
  readonly averageEntry: number
}

/**
 * Position with one extra buy (DCA) between entry and stop.
 * The risk budget covers both fills, so the entry order is sized as if the DCA will trigger:
 * q1 * (|entry - stop| + multiplier * |dca - stop|) = risk amount. Until the DCA is marked as
 * triggered only the entry order is live; afterwards the average entry, risk and reward use both.
 */
export function calculateDcaPositionMetrics(
  entry: number,
  dca: number,
  target: number,
  stop: number,
  accountSize: number,
  riskPercent: number,
  sizeMultiplier: number,
  triggered: boolean,
): DcaPositionMetrics {
  const multiplier = Math.max(0, sizeMultiplier)
  const riskAmount = Math.max(0, accountSize) * Math.max(0, riskPercent) / 100
  const plannedRisk = Math.abs(entry - stop) + multiplier * Math.abs(dca - stop)
  const baseQuantity = plannedRisk > 0 ? riskAmount / plannedRisk : 0
  const dcaQuantity = triggered ? baseQuantity * multiplier : 0
  const totalQuantity = baseQuantity + dcaQuantity
  const averageEntry = totalQuantity > 0 ? (entry * baseQuantity + dca * dcaQuantity) / totalQuantity : entry

  const riskDistance = Math.abs(averageEntry - stop)
  const targetDistance = Math.abs(target - averageEntry)
  return {
    riskDistance,
    targetDistance,
    riskAmount: totalQuantity * riskDistance,
    quantity: totalQuantity,
    rewardAmount: totalQuantity * targetDistance,
    riskReward: riskDistance > 0 ? targetDistance / riskDistance : 0,
    targetPercent: averageEntry !== 0 ? targetDistance / Math.abs(averageEntry) * 100 : 0,
    stopPercent: averageEntry !== 0 ? riskDistance / Math.abs(averageEntry) * 100 : 0,
    baseQuantity,
    dcaQuantity,
    totalQuantity,
    averageEntry,
  }
}
