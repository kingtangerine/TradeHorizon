// "My scripts": a small Pine-like language for the user's own indicators. It is parsed and interpreted here (no
// eval, no access to the page), works on whole series at once, and is pure so it can be tested.
//
//   indicator("EMA cross", overlay=true)
//   fastLen = input(12, "Fast length")
//   fast = ema(close, fastLen)
//   slow = ema(close, input(26, "Slow length"))
//   plot(fast, "Fast", color=#2962ff)
//   plot(slow, "Slow", color=#ff6d00, linewidth=2)
//   hline(0, "Zero")
//
// Values are numbers or series (one number per candle, NaN where there is none). Operators work on both:
// + - * / %, comparisons (1 or 0), and / or / not, cond ? a : b, and x[1] for the previous candle's value.

export const MAX_PLOTS = 8
export const MAX_HLINES = 8
export const MAX_SOURCE_LENGTH = 20_000

export interface ScriptInput {
  readonly title: string
  readonly defaultValue: number
}

export interface CompiledScript {
  readonly title: string
  readonly overlay: boolean
  readonly precision?: number
  readonly inputs: readonly ScriptInput[]
  readonly program: readonly Statement[]
}

export interface ScriptPlot {
  readonly title: string
  readonly color: string
  readonly width: number
  readonly values: Float64Array
}
export interface ScriptHline {
  readonly title: string
  readonly color: string
  readonly value: number
}
export interface ScriptResult {
  readonly plots: readonly ScriptPlot[]
  readonly hlines: readonly ScriptHline[]
}

export interface ScriptBar {
  readonly timestamp: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume?: number
}

export class ScriptError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`Line ${line}: ${message}`)
  }
}

// --- Tokens --------------------------------------------------------------------------------------------------------

type Token =
  | { kind: 'number'; value: number; line: number }
  | { kind: 'string'; value: string; line: number }
  | { kind: 'color'; value: string; line: number }
  | { kind: 'name'; value: string; line: number }
  | { kind: 'op'; value: string; line: number }
  | { kind: 'newline'; line: number }
  | { kind: 'end'; line: number }

const OPERATORS = ['==', '!=', '<=', '>=', '+', '-', '*', '/', '%', '(', ')', '[', ']', ',', '=', '<', '>', '?', ':']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let line = 1
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (char === '\n') {
      tokens.push({ kind: 'newline', line })
      line += 1
      index += 1
      continue
    }
    if (char === ' ' || char === '\t' || char === '\r') {
      index += 1
      continue
    }
    if (source.startsWith('//', index)) {
      while (index < source.length && source[index] !== '\n') index += 1
      continue
    }
    const number = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(source.slice(index, index + 40))
    if (number) {
      tokens.push({ kind: 'number', value: Number(number[0]), line })
      index += number[0].length
      continue
    }
    const color = /^#([0-9a-f]{8}|[0-9a-f]{6})\b/i.exec(source.slice(index, index + 10))
    if (color) {
      tokens.push({ kind: 'color', value: color[0], line })
      index += color[0].length
      continue
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index, index + 64))
    if (name) {
      tokens.push({ kind: 'name', value: name[0], line })
      index += name[0].length
      continue
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1)
      if (end < 0 || source.slice(index, end).includes('\n')) throw new ScriptError('the text is not closed with a quote', line)
      tokens.push({ kind: 'string', value: source.slice(index + 1, end), line })
      index = end + 1
      continue
    }
    const op = OPERATORS.find((item) => source.startsWith(item, index))
    if (op) {
      tokens.push({ kind: 'op', value: op, line })
      index += op.length
      continue
    }
    throw new ScriptError(`unexpected "${char}"`, line)
  }
  tokens.push({ kind: 'end', line })
  return tokens
}

// --- Syntax tree ---------------------------------------------------------------------------------------------------

type Node =
  | { type: 'number'; value: number }
  | { type: 'string'; value: string }
  | { type: 'name'; name: string; line: number }
  | { type: 'unary'; op: string; operand: Node }
  | { type: 'binary'; op: string; left: Node; right: Node }
  | { type: 'ternary'; condition: Node; whenTrue: Node; whenFalse: Node }
  | { type: 'history'; target: Node; offset: Node }
  | { type: 'call'; name: string; args: Node[]; named: Record<string, Node>; line: number; inputIndex?: number }

export type Statement = { type: 'assign'; name: string; value: Node; line: number } | { type: 'expr'; value: Node; line: number }

class Parser {
  #tokens: Token[]
  #position = 0
  inputs: ScriptInput[] = []

  constructor(tokens: Token[]) {
    this.#tokens = tokens
  }

  get #token(): Token {
    return this.#tokens[this.#position]
  }

  #isOp(value: string): boolean {
    const token = this.#token
    return token.kind === 'op' && token.value === value
  }

  #isWord(value: string): boolean {
    const token = this.#token
    return token.kind === 'name' && token.value === value
  }

  #expectOp(value: string): void {
    if (!this.#isOp(value)) throw new ScriptError(`expected "${value}"`, this.#token.line)
    this.#position += 1
  }

  program(): Statement[] {
    const statements: Statement[] = []
    while (this.#token.kind !== 'end') {
      if (this.#token.kind === 'newline') {
        this.#position += 1
        continue
      }
      const line = this.#token.line
      const next = this.#tokens[this.#position + 1]
      const token = this.#token
      if (token.kind === 'name' && next?.kind === 'op' && next.value === '=') {
        this.#position += 2
        statements.push({ type: 'assign', name: token.value, value: this.expression(), line })
      } else {
        statements.push({ type: 'expr', value: this.expression(), line })
      }
      const after = this.#token as Token
      if (after.kind !== 'newline' && after.kind !== 'end') throw new ScriptError('expected the end of the line', this.#token.line)
      if (statements.length > 400) throw new ScriptError('the script is too long (400 statements at most)', line)
    }
    return statements
  }

  expression(): Node {
    const condition = this.#or()
    if (!this.#isOp('?')) return condition
    this.#position += 1
    const whenTrue = this.expression()
    this.#expectOp(':')
    return { type: 'ternary', condition, whenTrue, whenFalse: this.expression() }
  }

  #or(): Node {
    let left = this.#and()
    while (this.#isWord('or')) {
      this.#position += 1
      left = { type: 'binary', op: 'or', left, right: this.#and() }
    }
    return left
  }

  #and(): Node {
    let left = this.#not()
    while (this.#isWord('and')) {
      this.#position += 1
      left = { type: 'binary', op: 'and', left, right: this.#not() }
    }
    return left
  }

  #not(): Node {
    if (this.#isWord('not')) {
      this.#position += 1
      return { type: 'unary', op: 'not', operand: this.#not() }
    }
    return this.#comparison()
  }

  #comparison(): Node {
    const left = this.#sum()
    const token = this.#token
    if (token.kind === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(token.value)) {
      this.#position += 1
      return { type: 'binary', op: token.value, left, right: this.#sum() }
    }
    return left
  }

  #sum(): Node {
    let left = this.#product()
    for (let token = this.#token; token.kind === 'op' && (token.value === '+' || token.value === '-'); token = this.#token) {
      this.#position += 1
      left = { type: 'binary', op: token.value, left, right: this.#product() }
    }
    return left
  }

  #product(): Node {
    let left = this.#unary()
    for (let token = this.#token; token.kind === 'op' && ['*', '/', '%'].includes(token.value); token = this.#token) {
      this.#position += 1
      left = { type: 'binary', op: token.value, left, right: this.#unary() }
    }
    return left
  }

  #unary(): Node {
    if (this.#isOp('-')) {
      this.#position += 1
      return { type: 'unary', op: '-', operand: this.#unary() }
    }
    if (this.#isOp('+')) {
      this.#position += 1
      return this.#unary()
    }
    let node = this.#primary()
    while (this.#isOp('[')) {
      this.#position += 1
      const offset = this.expression()
      this.#expectOp(']')
      node = { type: 'history', target: node, offset }
    }
    return node
  }

  #primary(): Node {
    const token = this.#token
    if (token.kind === 'number') {
      this.#position += 1
      return { type: 'number', value: token.value }
    }
    if (token.kind === 'string' || token.kind === 'color') {
      this.#position += 1
      return { type: 'string', value: token.value }
    }
    if (token.kind === 'op' && token.value === '(') {
      this.#position += 1
      const inner = this.expression()
      this.#expectOp(')')
      return inner
    }
    if (token.kind === 'name') {
      this.#position += 1
      if (!this.#isOp('(')) return { type: 'name', name: token.value, line: token.line }
      this.#position += 1
      const args: Node[] = []
      const named: Record<string, Node> = {}
      while (!this.#isOp(')')) {
        const current = this.#token
        const next = this.#tokens[this.#position + 1]
        if (current.kind === 'name' && next?.kind === 'op' && next.value === '=') {
          this.#position += 2
          named[current.value] = this.expression()
        } else {
          args.push(this.expression())
        }
        if (this.#isOp(',')) this.#position += 1
        else if (!this.#isOp(')')) throw new ScriptError('expected "," or ")"', this.#token.line)
      }
      this.#position += 1
      const call: Node = { type: 'call', name: token.value, args, named, line: token.line }
      if (token.value === 'input') {
        const defaultValue = literalNumber(args[0] ?? named.defval)
        if (defaultValue === undefined)
          throw new ScriptError('input() needs a number as its first value, like input(14, "Length")', token.line)
        const title = literalString(args[1] ?? named.title) ?? `Input ${this.inputs.length + 1}`
        call.inputIndex = this.inputs.length
        this.inputs.push({ title, defaultValue })
      }
      return call
    }
    throw new ScriptError(token.kind === 'newline' || token.kind === 'end' ? 'the line ends too early' : 'unexpected symbol', token.line)
  }
}

function literalNumber(node: Node | undefined): number | undefined {
  if (!node) return undefined
  if (node.type === 'number') return node.value
  if (node.type === 'unary' && node.op === '-' && node.operand.type === 'number') return -node.operand.value
  return undefined
}

function literalString(node: Node | undefined): string | undefined {
  return node?.type === 'string' ? node.value : undefined
}

/** Checks the script and reads its title, pane and inputs. Throws ScriptError with the line of the first problem. */
export function compileScript(source: string): CompiledScript {
  if (source.length > MAX_SOURCE_LENGTH) throw new ScriptError(`the script is longer than ${MAX_SOURCE_LENGTH} characters`, 1)
  const parser = new Parser(tokenize(source))
  const program = parser.program()
  let title = 'My script'
  let overlay = false
  let precision: number | undefined
  let plots = 0
  let hlines = 0
  for (const statement of program) {
    const value = statement.value
    if (value.type !== 'call') continue
    if (value.name === 'indicator') {
      title = literalString(value.args[0] ?? value.named.title) ?? title
      const flag = value.named.overlay
      overlay = flag?.type === 'name' ? flag.name === 'true' : overlay
      const digits = literalNumber(value.named.precision)
      if (digits !== undefined) precision = Math.max(0, Math.min(10, Math.round(digits)))
    }
    if (value.name === 'plot' && ++plots > MAX_PLOTS) throw new ScriptError(`at most ${MAX_PLOTS} plots`, statement.line)
    if (value.name === 'hline' && ++hlines > MAX_HLINES) throw new ScriptError(`at most ${MAX_HLINES} horizontal lines`, statement.line)
  }
  // A trial run over a few candles finds unknown names and functions before the script reaches a chart.
  const sample = Array.from({ length: 30 }, (_, index) => ({
    timestamp: index * 60_000,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100.5 + index,
    volume: 10,
  }))
  const compiled = { title, overlay, precision, inputs: parser.inputs, program }
  runScript(compiled, sample)
  return compiled
}

// --- Evaluation ----------------------------------------------------------------------------------------------------

type Value = number | Float64Array | string

const PALETTE = ['#2962ff', '#ff6d00', '#089981', '#f23645', '#9c27b0', '#00bcd4', '#ffd600', '#787b86']

function series(value: Value, length: number, line: number): Float64Array {
  if (typeof value === 'string') throw new ScriptError('text cannot be used in a calculation', line)
  if (typeof value === 'number') return new Float64Array(length).fill(value)
  return value
}

function length(value: Value, line: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5000)
    throw new ScriptError('a length must be a number between 1 and 5000', line)
  return Math.round(value)
}

function map2(a: Value, b: Value, n: number, line: number, fn: (x: number, y: number) => number): Value {
  if (typeof a === 'number' && typeof b === 'number') return fn(a, b)
  const left = series(a, n, line)
  const right = series(b, n, line)
  const out = new Float64Array(n)
  for (let index = 0; index < n; index += 1) out[index] = fn(left[index], right[index])
  return out
}

function map1(a: Value, n: number, line: number, fn: (x: number) => number): Value {
  if (typeof a === 'number') return fn(a)
  const input = series(a, n, line)
  const out = new Float64Array(n)
  for (let index = 0; index < n; index += 1) out[index] = fn(input[index])
  return out
}

const truthy = (value: number) => Number.isFinite(value) && value !== 0

function windowed(src: Float64Array, len: number, fn: (slice: number[]) => number): Float64Array {
  const out = new Float64Array(src.length).fill(NaN)
  for (let index = len - 1; index < src.length; index += 1) {
    const slice: number[] = []
    let valid = true
    for (let offset = index - len + 1; offset <= index; offset += 1) {
      if (!Number.isFinite(src[offset])) {
        valid = false
        break
      }
      slice.push(src[offset])
    }
    if (valid) out[index] = fn(slice)
  }
  return out
}

function smoothing(src: Float64Array, len: number, alpha: number): Float64Array {
  const out = new Float64Array(src.length).fill(NaN)
  let previous = NaN
  let sum = 0
  let count = 0
  for (let index = 0; index < src.length; index += 1) {
    const value = src[index]
    if (!Number.isFinite(value)) continue
    if (!Number.isFinite(previous)) {
      sum += value
      count += 1
      if (count === len) {
        previous = sum / len
        out[index] = previous
      }
    } else {
      previous = alpha * value + (1 - alpha) * previous
      out[index] = previous
    }
  }
  return out
}

function trueRange(bars: readonly ScriptBar[]): Float64Array {
  return Float64Array.from(bars, (bar, index) =>
    index === 0
      ? bar.high - bar.low
      : Math.max(bar.high - bar.low, Math.abs(bar.high - bars[index - 1].close), Math.abs(bar.low - bars[index - 1].close)),
  )
}

interface Context {
  readonly bars: readonly ScriptBar[]
  readonly n: number
  readonly variables: Map<string, Value>
  readonly inputs: readonly number[]
  readonly plots: ScriptPlot[]
  readonly hlines: ScriptHline[]
}

function builtinSeries(name: string, context: Context): Float64Array | undefined {
  const { bars } = context
  switch (name) {
    case 'open':
      return Float64Array.from(bars, (bar) => bar.open)
    case 'high':
      return Float64Array.from(bars, (bar) => bar.high)
    case 'low':
      return Float64Array.from(bars, (bar) => bar.low)
    case 'close':
      return Float64Array.from(bars, (bar) => bar.close)
    case 'volume':
      return Float64Array.from(bars, (bar) => bar.volume ?? NaN)
    case 'hl2':
      return Float64Array.from(bars, (bar) => (bar.high + bar.low) / 2)
    case 'hlc3':
      return Float64Array.from(bars, (bar) => (bar.high + bar.low + bar.close) / 3)
    case 'ohlc4':
      return Float64Array.from(bars, (bar) => (bar.open + bar.high + bar.low + bar.close) / 4)
    case 'bar_index':
      return Float64Array.from(bars, (_, index) => index)
    case 'time':
      return Float64Array.from(bars, (bar) => bar.timestamp)
    default:
      return undefined
  }
}

function evaluate(node: Node, context: Context): Value {
  const n = context.n
  switch (node.type) {
    case 'number':
      return node.value
    case 'string':
      return node.value
    case 'name': {
      if (node.name === 'true') return 1
      if (node.name === 'false') return 0
      if (node.name === 'na') return NaN
      const variable = context.variables.get(node.name)
      if (variable !== undefined) return variable
      const builtin = builtinSeries(node.name, context)
      if (builtin) {
        context.variables.set(node.name, builtin)
        return builtin
      }
      throw new ScriptError(`"${node.name}" is not defined`, node.line)
    }
    case 'unary': {
      const value = evaluate(node.operand, context)
      return node.op === '-' ? map1(value, n, 0, (x) => -x) : map1(value, n, 0, (x) => (Number.isNaN(x) ? NaN : truthy(x) ? 0 : 1))
    }
    case 'binary': {
      const left = evaluate(node.left, context)
      const right = evaluate(node.right, context)
      const compare = (fn: (x: number, y: number) => boolean) => (x: number, y: number) =>
        Number.isNaN(x) || Number.isNaN(y) ? NaN : fn(x, y) ? 1 : 0
      switch (node.op) {
        case '+':
          return map2(left, right, n, 0, (x, y) => x + y)
        case '-':
          return map2(left, right, n, 0, (x, y) => x - y)
        case '*':
          return map2(left, right, n, 0, (x, y) => x * y)
        case '/':
          return map2(left, right, n, 0, (x, y) => (y === 0 ? NaN : x / y))
        case '%':
          return map2(left, right, n, 0, (x, y) => (y === 0 ? NaN : x % y))
        case '==':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x === y),
          )
        case '!=':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x !== y),
          )
        case '<':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x < y),
          )
        case '<=':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x <= y),
          )
        case '>':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x > y),
          )
        case '>=':
          return map2(
            left,
            right,
            n,
            0,
            compare((x, y) => x >= y),
          )
        case 'and':
          return map2(left, right, n, 0, (x, y) => (truthy(x) && truthy(y) ? 1 : 0))
        default:
          return map2(left, right, n, 0, (x, y) => (truthy(x) || truthy(y) ? 1 : 0))
      }
    }
    case 'ternary': {
      const condition = evaluate(node.condition, context)
      const whenTrue = evaluate(node.whenTrue, context)
      const whenFalse = evaluate(node.whenFalse, context)
      if (typeof condition === 'number') return truthy(condition) ? whenTrue : whenFalse
      const a = series(whenTrue, n, 0)
      const b = series(whenFalse, n, 0)
      return Float64Array.from(series(condition, n, 0), (value, index) => (truthy(value) ? a[index] : b[index]))
    }
    case 'history': {
      const target = evaluate(node.target, context)
      const offset = evaluate(node.offset, context)
      if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0 || offset > 5000)
        throw new ScriptError('[ ] needs a whole number of candles back, like close[1]', 0)
      if (typeof target === 'number') return target
      const src = series(target, n, 0)
      return Float64Array.from(src, (_, index) => (index - offset >= 0 ? src[index - offset] : NaN))
    }
    case 'call':
      return call(node, context)
  }
}

function call(node: Extract<Node, { type: 'call' }>, context: Context): Value {
  const n = context.n
  const line = node.line
  const arg = (index: number, name?: string): Value => {
    const source = node.args[index] ?? (name ? node.named[name] : undefined)
    if (!source) throw new ScriptError(`${node.name}() is missing a value`, line)
    return evaluate(source, context)
  }
  const optional = (index: number, name: string): Value | undefined => {
    const source = node.args[index] ?? node.named[name]
    return source ? evaluate(source, context) : undefined
  }
  const src = (index = 0) => series(arg(index, 'source'), n, line)
  const len = (index = 1) => length(arg(index, 'length'), line)
  switch (node.name) {
    case 'indicator':
      return 0
    case 'input':
      return context.inputs[node.inputIndex ?? -1] ?? Number.NaN
    case 'sma':
      return windowed(src(), len(), (slice) => slice.reduce((sum, value) => sum + value, 0) / slice.length)
    case 'sum':
      return windowed(src(), len(), (slice) => slice.reduce((sum, value) => sum + value, 0))
    case 'ema': {
      const l = len()
      return smoothing(src(), l, 2 / (l + 1))
    }
    case 'rma': {
      const l = len()
      return smoothing(src(), l, 1 / l)
    }
    case 'wma':
      return windowed(src(), len(), (slice) => {
        let weight = 0
        let total = 0
        slice.forEach((value, index) => {
          total += value * (index + 1)
          weight += index + 1
        })
        return total / weight
      })
    case 'vwma': {
      const s = src()
      const l = len()
      const volume = builtinSeries('volume', context)!
      const weighted = windowed(
        Float64Array.from(s, (value, index) => value * volume[index]),
        l,
        (slice) => slice.reduce((a, b) => a + b, 0),
      )
      const volumes = windowed(volume, l, (slice) => slice.reduce((a, b) => a + b, 0))
      return Float64Array.from(weighted, (value, index) => (volumes[index] ? value / volumes[index] : NaN))
    }
    case 'stdev':
      return windowed(src(), len(), (slice) => {
        const mean = slice.reduce((a, b) => a + b, 0) / slice.length
        return Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length)
      })
    case 'highest':
      return windowed(src(), len(), (slice) => Math.max(...slice))
    case 'lowest':
      return windowed(src(), len(), (slice) => Math.min(...slice))
    case 'change':
    case 'mom': {
      const s = src()
      const back = node.args[1] || node.named.length ? len() : 1
      return Float64Array.from(s, (value, index) => (index - back >= 0 ? value - s[index - back] : NaN))
    }
    case 'roc': {
      const s = src()
      const back = len()
      return Float64Array.from(s, (value, index) =>
        index - back >= 0 && s[index - back] !== 0 ? ((value - s[index - back]) / s[index - back]) * 100 : NaN,
      )
    }
    case 'rsi': {
      const s = src()
      const l = len()
      const up = new Float64Array(n).fill(NaN)
      const down = new Float64Array(n).fill(NaN)
      for (let index = 1; index < n; index += 1) {
        const delta = s[index] - s[index - 1]
        up[index] = Math.max(delta, 0)
        down[index] = Math.max(-delta, 0)
      }
      const avgUp = smoothing(up, l, 1 / l)
      const avgDown = smoothing(down, l, 1 / l)
      return Float64Array.from(avgUp, (value, index) =>
        Number.isNaN(value) ? NaN : avgDown[index] === 0 ? 100 : 100 - 100 / (1 + value / avgDown[index]),
      )
    }
    case 'tr':
      return trueRange(context.bars)
    case 'atr': {
      const l = length(arg(0, 'length'), line)
      return smoothing(trueRange(context.bars), l, 1 / l)
    }
    case 'cum': {
      let total = 0
      return Float64Array.from(src(), (value) => (Number.isFinite(value) ? (total += value) : total))
    }
    case 'crossover':
    case 'crossunder':
    case 'cross': {
      const a = series(arg(0), n, line)
      const b = series(arg(1), n, line)
      return Float64Array.from(a, (value, index) => {
        if (index === 0) return 0
        const up = a[index - 1] <= b[index - 1] && value > b[index]
        const downwards = a[index - 1] >= b[index - 1] && value < b[index]
        return (node.name === 'crossover' ? up : node.name === 'crossunder' ? downwards : up || downwards) ? 1 : 0
      })
    }
    case 'abs':
      return map1(arg(0), n, line, Math.abs)
    case 'sqrt':
      return map1(arg(0), n, line, Math.sqrt)
    case 'log':
      return map1(arg(0), n, line, Math.log)
    case 'exp':
      return map1(arg(0), n, line, Math.exp)
    case 'floor':
      return map1(arg(0), n, line, Math.floor)
    case 'ceil':
      return map1(arg(0), n, line, Math.ceil)
    case 'round': {
      const digits = optional(1, 'precision')
      const scale = typeof digits === 'number' ? 10 ** Math.round(digits) : 1
      return map1(arg(0), n, line, (x) => Math.round(x * scale) / scale)
    }
    case 'max':
      return map2(arg(0), arg(1), n, line, Math.max)
    case 'min':
      return map2(arg(0), arg(1), n, line, Math.min)
    case 'pow':
      return map2(arg(0), arg(1), n, line, Math.pow)
    case 'avg':
      return node.args
        .map((item) => evaluate(item, context))
        .reduce((total, value) => map2(total, value, n, line, (x, y) => x + y), 0 as Value) as number | Float64Array
    case 'nz': {
      const replacement = optional(1, 'replacement') ?? 0
      return map2(arg(0), replacement, n, line, (x, y) => (Number.isFinite(x) ? x : y))
    }
    case 'na':
      return map1(arg(0), n, line, (x) => (Number.isFinite(x) ? 0 : 1))
    case 'plot': {
      if (context.plots.length >= MAX_PLOTS) throw new ScriptError(`at most ${MAX_PLOTS} plots`, line)
      const values = series(arg(0, 'series'), n, line)
      const title = optional(1, 'title')
      const color = optional(2, 'color')
      const width = optional(3, 'linewidth')
      context.plots.push({
        title: typeof title === 'string' ? title.slice(0, 40) : `Plot ${context.plots.length + 1}`,
        color:
          typeof color === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) ? color : PALETTE[context.plots.length % PALETTE.length],
        width: typeof width === 'number' ? Math.max(1, Math.min(4, width)) : 1.5,
        values: Float64Array.from(values),
      })
      return 0
    }
    case 'hline': {
      if (context.hlines.length >= MAX_HLINES) throw new ScriptError(`at most ${MAX_HLINES} horizontal lines`, line)
      const value = arg(0, 'price')
      if (typeof value !== 'number') throw new ScriptError('hline() needs a fixed number, like hline(70)', line)
      const title = optional(1, 'title')
      const color = optional(2, 'color')
      context.hlines.push({ value, title: typeof title === 'string' ? title : '', color: typeof color === 'string' ? color : '#787b86' })
      return 0
    }
    default:
      throw new ScriptError(`unknown function ${node.name}()`, line)
  }
}

/** Runs a compiled script over candles. `inputs` replaces the defaults of input() by position. */
export function runScript(script: CompiledScript, bars: readonly ScriptBar[], inputs: readonly number[] = []): ScriptResult {
  const context: Context = {
    bars,
    n: bars.length,
    variables: new Map(),
    inputs: script.inputs.map((input, index) => (Number.isFinite(inputs[index]) ? inputs[index] : input.defaultValue)),
    plots: [],
    hlines: [],
  }
  for (const statement of script.program) {
    try {
      const value = evaluate(statement.value, context)
      if (statement.type === 'assign') {
        if (builtinSeries(statement.name, context) || ['true', 'false', 'na'].includes(statement.name))
          throw new ScriptError(`"${statement.name}" is a built-in name`, statement.line)
        context.variables.set(statement.name, value)
      }
    } catch (error) {
      if (error instanceof ScriptError)
        throw error.line === 0 ? new ScriptError(error.message.replace(/^Line 0: /, ''), statement.line) : error
      throw new ScriptError(error instanceof Error ? error.message : String(error), statement.line)
    }
  }
  return { plots: context.plots, hlines: context.hlines }
}

export const EXAMPLE_SCRIPT = `// My script: two moving averages and where they cross.
indicator("EMA cross", overlay=true)
fastLength = input(12, "Fast length")
slowLength = input(26, "Slow length")
fast = ema(close, fastLength)
slow = ema(close, slowLength)
plot(fast, "Fast", color=#2962ff)
plot(slow, "Slow", color=#ff6d00)
`

export const SCRIPT_HELP = [
  'Prices: open high low close volume hl2 hlc3 ohlc4, bar_index, time; close[1] is the previous candle',
  'Averages: sma ema rma wma vwma (source, length)',
  'Oscillators: rsi(source, length), atr(length), tr(), stdev, change, roc, mom',
  'Ranges: highest lowest sum (source, length), cum(source)',
  'Signals: crossover crossunder cross (a, b); and or not; cond ? a : b',
  'Maths: abs sqrt log exp pow round floor ceil max min avg nz na',
  'Setup: indicator("Name", overlay=true), input(14, "Length"), plot(series, "Title", color=#2962ff, linewidth=2), hline(70, "Upper")',
]
