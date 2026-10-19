/**
 * MySQL 标准语法 SELECT 子集 → MongoDB 查询翻译（纯逻辑，无依赖）。
 *
 * 支持：SELECT 列 | 聚合 | * FROM 表 WHERE 条件 [GROUP BY 列] ORDER BY … LIMIT …
 * WHERE：= != <> < <= > >=、IN/NOT IN、(NOT) LIKE、BETWEEN/NOT BETWEEN、
 *        IS NULL/IS NOT NULL、AND/OR/NOT 任意嵌套与括号。
 * 聚合：COUNT(*) / COUNT(col) / SUM / AVG / MIN / MAX，配合 GROUP BY（无 GROUP BY
 *       时全表聚合成单行）；ORDER BY 仅可引用分组字段或聚合别名。
 * 不支持（显式报错）：JOIN / 子查询 / DISTINCT / HAVING。
 * LIKE 默认按 MySQL 语义不区分大小写（$options: 'i'）。
 */

export type SqlValue = string | number | boolean | null

export type SqlCmpOp = '=' | '!=' | '<' | '<=' | '>' | '>='

export type AggFunc = 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'

/** SELECT 输出项：普通列或聚合表达式 */
export interface SelectItem {
  kind: 'column' | 'aggregate'
  /** 列名；聚合参数（COUNT(*) 时为 '*'） */
  field: string
  func?: AggFunc
  /** 输出列名（无 AS 时列名即别名；聚合默认 func_field 形态） */
  alias: string
}

export type SqlExpr =
  | { kind: 'cmp'; op: SqlCmpOp; field: string; value: SqlValue }
  | { kind: 'in'; field: string; values: SqlValue[]; negated: boolean }
  | { kind: 'like'; field: string; pattern: string; negated: boolean }
  | { kind: 'between'; field: string; low: SqlValue; high: SqlValue; negated: boolean }
  | { kind: 'isnull'; field: string; negated: boolean }
  | { kind: 'and'; children: SqlExpr[] }
  | { kind: 'or'; children: SqlExpr[] }
  | { kind: 'not'; child: SqlExpr }

export interface SqlSelect {
  table: string
  /** null = SELECT * */
  items: SelectItem[] | null
  where: SqlExpr | null
  groupBy: string[] | null
  orderBy: { field: string; desc: boolean }[]
  limit: number | null
  offset: number | null
}

export type SqlToMongoResult =
  | {
      mode: 'find'
      /** FROM 后的集合名 */
      table: string
      filter: Record<string, unknown>
      /** null = 不设 projection */
      projection: Record<string, number> | null
      sort: Record<string, number> | null
      skip: number | null
      limit: number | null
    }
  | { mode: 'aggregate'; table: string; pipeline: Record<string, unknown>[] }

interface Token {
  kind: 'ident' | 'string' | 'number' | 'op'
  /** 关键字统一大写，标识符保留原样 */
  text: string
}

const KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'ORDER', 'BY', 'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT',
  'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'TRUE', 'FALSE', 'ASC', 'DESC', 'AS', 'DISTINCT',
  'GROUP', 'HAVING'
])

const AGG_FUNCS = new Set(['count', 'sum', 'avg', 'min', 'max'])

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_$\u4e00-\u9fa5]/.test(ch)
}
function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_$\u4e00-\u9fa5]/.test(ch)
}

/** 词法：标识符（含 a.b 点路径与反引号）、字符串、数字、运算符；支持 -- 与 行注释 */
function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i += 1
      continue
    }
    if (ch === '-' && src[i + 1] === '-') {
      while (i < src.length && src[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end < 0) throw new Error('SQL 注释未闭合')
      i = end + 2
      continue
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1)
      if (end < 0) throw new Error('反引号未闭合')
      tokens.push({ kind: 'ident', text: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    if (ch === "'" || ch === '"') {
      let text = ''
      let j = i + 1
      while (j < src.length) {
        if (src[j] === '\\' && j + 1 < src.length) {
          text += src[j + 1]
          j += 2
          continue
        }
        if (src[j] === ch) {
          if (src[j + 1] === ch) {
            text += ch
            j += 2
            continue
          }
          break
        }
        text += src[j]
        j += 1
      }
      if (j >= src.length) throw new Error('字符串未闭合')
      tokens.push({ kind: 'string', text })
      i = j + 1
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i))
      if (match === null) throw new Error(`无法解析的数字: ${src.slice(i, i + 12)}`)
      tokens.push({ kind: 'number', text: match[0] })
      i += match[0].length
      continue
    }
    if (isIdentStart(ch)) {
      let text = ''
      let j = i
      while (j < src.length && (isIdentPart(src[j]) || (src[j] === '.' && isIdentStart(src[j + 1] ?? '')))) {
        text += src[j]
        j += 1
      }
      const upper = text.toUpperCase()
      tokens.push({ kind: KEYWORDS.has(upper) ? 'op' : 'ident', text: KEYWORDS.has(upper) ? upper : text })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (['<=', '>=', '!=', '<>'].includes(two)) {
      tokens.push({ kind: 'op', text: two })
      i += 2
      continue
    }
    if ('=<>(),.*'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch })
      i += 1
      continue
    }
    throw new Error(`无法识别的字符: "${ch}"`)
  }
  return tokens
}

class SqlParser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token | null {
    return this.tokens[this.pos + offset] ?? null
  }

  private isOp(text: string, offset = 0): boolean {
    const token = this.peek(offset)
    return token !== null && token.kind === 'op' && token.text === text
  }

  private eatOp(text: string): boolean {
    if (this.isOp(text)) {
      this.pos += 1
      return true
    }
    return false
  }

  private expectOp(text: string): void {
    if (!this.eatOp(text)) throw new Error(`期望 "${text}"，实际为 "${this.peek()?.text ?? 'EOF'}"`)
  }

  private eatIdent(): string {
    const token = this.peek()
    if (token === null || token.kind !== 'ident') {
      throw new Error(`期望标识符，实际为 "${token?.text ?? 'EOF'}"`)
    }
    this.pos += 1
    return token.text
  }

  private eatNumber(): number {
    const token = this.peek()
    if (token === null || token.kind !== 'number') throw new Error('期望数字')
    this.pos += 1
    return Number.parseFloat(token.text)
  }

  private eatLiteral(): SqlValue {
    if (this.isOp('NULL')) {
      this.pos += 1
      return null
    }
    if (this.isOp('TRUE')) {
      this.pos += 1
      return true
    }
    if (this.isOp('FALSE')) {
      this.pos += 1
      return false
    }
    if (this.isOp('-')) {
      this.pos += 1
      return -this.eatNumber()
    }
    if (this.isOp('+')) {
      this.pos += 1
      return this.eatNumber()
    }
    const token = this.peek()
    if (token !== null && token.kind === 'string') {
      this.pos += 1
      return token.text
    }
    if (token !== null && token.kind === 'number') return this.eatNumber()
    throw new Error(`期望字面量，实际为 "${token?.text ?? 'EOF'}"`)
  }

  parse(): SqlSelect {
    this.expectOp('SELECT')
    let items: SelectItem[] | null = null
    if (this.eatOp('*')) {
      items = null
    } else {
      if (this.isOp('DISTINCT')) throw new Error('暂不支持 DISTINCT')
      items = this.parseSelectItems()
    }
    this.expectOp('FROM')
    const table = this.eatIdent()

    let where: SqlExpr | null = null
    if (this.eatOp('WHERE')) where = this.parseOr()

    let groupBy: string[] | null = null
    if (this.eatOp('GROUP')) {
      this.expectOp('BY')
      groupBy = [this.eatIdent()]
      while (this.eatOp(',')) groupBy.push(this.eatIdent())
    }
    if (this.eatOp('HAVING')) throw new Error('暂不支持 HAVING 子句')

    const orderBy: { field: string; desc: boolean }[] = []
    if (this.eatOp('ORDER')) {
      this.expectOp('BY')
      do {
        const field = this.eatIdent()
        const desc = this.eatOp('DESC') ? true : this.eatOp('ASC') ? false : false
        orderBy.push({ field, desc })
      } while (this.eatOp(','))
    }

    let limit: number | null = null
    let offset: number | null = null
    if (this.eatOp('LIMIT')) {
      const first = this.eatNumber()
      if (this.eatOp(',')) {
        // MySQL 风格 LIMIT offset, count
        offset = first
        limit = this.eatNumber()
      } else {
        limit = first
        if (this.eatOp('OFFSET')) offset = this.eatNumber()
      }
    }

    if (this.peek() !== null) {
      throw new Error(`多余的输入: "${this.peek()?.text}"`)
    }
    return { table, items, where, groupBy, orderBy, limit, offset }
  }

  /** 解析 SELECT 输出项：普通列 / 聚合函数（含 AS 别名） */
  private parseSelectItems(): SelectItem[] {
    const items: SelectItem[] = []
    do {
      const token = this.peek()
      const next = this.peek(1)
      if (
        token !== null &&
        token.kind === 'ident' &&
        AGG_FUNCS.has(token.text.toLowerCase()) &&
        next !== null &&
        next.kind === 'op' &&
        next.text === '('
      ) {
        const func = token.text.toUpperCase() as AggFunc
        this.pos += 2
        let field = '*'
        if (!this.eatOp('*')) field = this.eatIdent()
        this.expectOp(')')
        let alias = field === '*' ? func.toLowerCase() : `${func.toLowerCase()}_${field}`
        if (this.eatOp('AS')) alias = this.eatIdent()
        items.push({ kind: 'aggregate', field, func, alias })
        continue
      }
      const field = this.eatIdent()
      let alias = field
      if (this.eatOp('AS')) alias = this.eatIdent()
      items.push({ kind: 'column', field, alias })
    } while (this.eatOp(','))
    return items
  }

  private parseOr(): SqlExpr {
    const children = [this.parseAnd()]
    while (this.eatOp('OR')) children.push(this.parseAnd())
    return children.length === 1 ? children[0] : { kind: 'or', children }
  }

  private parseAnd(): SqlExpr {
    const children = [this.parseNot()]
    while (this.eatOp('AND')) children.push(this.parseNot())
    return children.length === 1 ? children[0] : { kind: 'and', children }
  }

  private parseNot(): SqlExpr {
    if (this.eatOp('NOT')) return { kind: 'not', child: this.parseNot() }
    if (this.isOp('(')) {
      this.pos += 1
      const inner = this.parseOr()
      this.expectOp(')')
      return inner
    }
    return this.parsePredicate()
  }

  private parsePredicate(): SqlExpr {
    const field = this.eatIdent()
    let negated = false
    if (this.eatOp('NOT')) negated = true

    if (this.eatOp('IN')) {
      this.expectOp('(')
      const values: SqlValue[] = [this.eatLiteral()]
      while (this.eatOp(',')) values.push(this.eatLiteral())
      this.expectOp(')')
      return { kind: 'in', field, values, negated }
    }
    if (this.eatOp('LIKE')) {
      const token = this.peek()
      if (token === null || token.kind !== 'string') throw new Error('LIKE 需要字符串模式')
      this.pos += 1
      return { kind: 'like', field, pattern: token.text, negated }
    }
    if (this.eatOp('BETWEEN')) {
      const low = this.eatLiteral()
      this.expectOp('AND')
      const high = this.eatLiteral()
      return { kind: 'between', field, low, high, negated }
    }
    if (this.eatOp('IS')) {
      const isNot = this.eatOp('NOT')
      this.expectOp('NULL')
      return { kind: 'isnull', field, negated: isNot }
    }
    if (negated) throw new Error('NOT 后只允许 IN / LIKE / BETWEEN')
    for (const op of ['=', '!=', '<>', '<=', '>=', '<', '>'] as const) {
      if (this.eatOp(op)) {
        const normalized = (op === '<>' ? '!=' : op) as SqlCmpOp
        return { kind: 'cmp', op: normalized, field, value: this.eatLiteral() }
      }
    }
    throw new Error(`字段 "${field}" 后缺少比较运算符`)
  }
}

/** LIKE 通配符 → 锚定正则（% → .*，_ → .，其余字符正则转义） */
export function likeToRegex(pattern: string): string {
  let out = ''
  for (const ch of pattern) {
    if (ch === '%') out += '.*'
    else if (ch === '_') out += '.'
    else if (/[.*+?^${}()|[\]\\]/.test(ch)) out += `\\${ch}`
    else out += ch
  }
  return `^${out}$`
}

function isPlainDoc(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeConds(list: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const extras: Record<string, unknown>[] = []
  for (const cond of list) {
    for (const [key, value] of Object.entries(cond)) {
      const existing = out[key]
      if (existing === undefined) {
        out[key] = value
        continue
      }
      // 同字段：操作符文档按键合并（$gte+$lte → BETWEEN 形态）；冲突或标量重复退回 $and
      if (isPlainDoc(existing) && isPlainDoc(value)) {
        const keys = Object.keys(value)
        if (!keys.some((opKey) => opKey in existing)) {
          out[key] = { ...existing, ...value }
          continue
        }
      }
      extras.push({ [key]: value })
    }
  }
  return extras.length > 0 ? { ...out, $and: extras } : out
}

function compileExpr(expr: SqlExpr): Record<string, unknown> {
  switch (expr.kind) {
    case 'and':
      return mergeConds(expr.children.map(compileExpr))
    case 'or':
      return { $or: expr.children.map(compileExpr) }
    case 'not':
      return { $nor: [compileExpr(expr.child)] }
    case 'cmp': {
      const mongoOp = { '=': '$eq', '!=': '$ne', '<': '$lt', '<=': '$lte', '>': '$gt', '>=': '$gte' }[expr.op]
      return expr.op === '=' ? { [expr.field]: expr.value } : { [expr.field]: { [mongoOp]: expr.value } }
    }
    case 'in':
      return { [expr.field]: { [expr.negated ? '$nin' : '$in']: expr.values } }
    case 'like': {
      const cond = { $regex: likeToRegex(expr.pattern), $options: 'i' }
      return expr.negated ? { [expr.field]: { $not: cond } } : { [expr.field]: cond }
    }
    case 'between': {
      const cond = { $gte: expr.low, $lte: expr.high }
      return expr.negated ? { [expr.field]: { $not: cond } } : { [expr.field]: cond }
    }
    case 'isnull':
      return { [expr.field]: expr.negated ? { $ne: null } : null }
  }
}

import { buildAggregatePipeline } from './sql-aggregate'

/** 解析 SQL SELECT 语句（仅支持 MySQL 标准语法的查询子集） */
export function parseSqlSelect(sql: string): SqlSelect {
  const trimmed = sql.trim().replace(/;+\s*$/, '')
  if (trimmed === '') throw new Error('SQL 为空')
  if (!/^SELECT\b/i.test(trimmed)) throw new Error('仅支持 SELECT 查询语句')
  return new SqlParser(tokenize(trimmed)).parse()
}

/** 判断 SELECT 是否为聚合形态（含聚合函数或 GROUP BY） */
export function isAggregateSelect(stmt: SqlSelect): boolean {
  if (stmt.groupBy !== null) return true
  return (stmt.items ?? []).some((item) => item.kind === 'aggregate')
}

/** 解析并翻译：聚合形态 → aggregate 管道；否则 → find 各分段 */
export function sqlToMongo(sql: string): SqlToMongoResult {
  const stmt = parseSqlSelect(sql)
  const filter = stmt.where !== null ? compileExpr(stmt.where) : {}
  if (isAggregateSelect(stmt)) {
    return { mode: 'aggregate', table: stmt.table, pipeline: buildAggregatePipeline(stmt, filter) }
  }
  const projection =
    stmt.items !== null
      ? (Object.fromEntries(
          stmt.items.filter((item) => item.kind === 'column').map((item) => [item.field, 1]).concat([['_id', 0]])
        ) as Record<string, number>)
      : null
  const sort =
    stmt.orderBy.length > 0
      ? (Object.fromEntries(stmt.orderBy.map(({ field, desc }) => [field, desc ? -1 : 1])) as Record<string, number>)
      : null
  return {
    mode: 'find',
    table: stmt.table,
    filter,
    projection,
    sort,
    skip: stmt.offset ?? null,
    limit: stmt.limit
  }
}
