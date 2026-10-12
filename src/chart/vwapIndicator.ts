import { registerIndicator, type KLineData } from 'klinecharts'
import { VWAP_ANCHORS, computeVwap, type VwapAnchor } from './vwap'

export const VWAP_INDICATOR_NAME = 'TH_VWAP'
export const QVWAP_INDICATOR_NAME = 'TH_QVWAP'

let registered = false

function toRows(bars: KLineData[], anchor: VwapAnchor) {
  return computeVwap(bars, anchor).map((value) => (value === undefined ? {} : { vwap: value }))
}

/** Registers the VWAP line (its anchor is passed as calcParams[0], an index into VWAP_ANCHORS) and the quarterly one. */
export function registerVwapIndicators(): void {
  if (registered) return
  registered = true
  registerIndicator({
    name: VWAP_INDICATOR_NAME,
    shortName: 'VWAP',
    precision: 2,
    calcParams: [0],
    shouldOhlc: false,
    figures: [{ key: 'vwap', title: 'VWAP: ', type: 'line' }],
    calc: (dataList, indicator) => toRows(dataList, VWAP_ANCHORS[Number(indicator.calcParams[0])] ?? 'day'),
  })
  registerIndicator({
    name: QVWAP_INDICATOR_NAME,
    shortName: 'QVWAP',
    precision: 2,
    shouldOhlc: false,
    figures: [{ key: 'vwap', title: 'QVWAP: ', type: 'line' }],
    calc: (dataList) => toRows(dataList, 'quarter'),
  })
}
