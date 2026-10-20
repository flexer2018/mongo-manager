/**
 * 受限 shell 字面量解析（供 CUSTOM 操作符使用，绝不 eval）。
 * 白名单构造器 + 递归下降解析。
 */
import {
  BSONRegExp,
  Binary,
  Decimal128,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  UUID
} from 'bson'
import { ShellLiteralError, pythonFloatRepr, Value } from './value-model'

type CallFactory = (args: Value[]) => Value

/** BKAH 注册表：白名单构造器名 → 实现（键匹配是精确大小写） */
const ALLOWED_CALLS: Record<string, CallFactory> = {
  ObjectId: (args) => {
    if (args.length === 0) throw new ShellLiteralError('ObjectId() 需要 1 个参数')
    const text = args[0]
    if (typeof text !== 'string') throw new ShellLiteralError('ObjectId() 参数必须是字符串')
    try {
      return new ObjectId(text)
    } catch {
      throw new ShellLiteralError(`非法 ObjectId: ${text}`)
    }
  },
  ISODate: mkDatetime,
  Date: mkDatetime,
  NumberLong: (args) => {
    return toBsonInt(args[0], 'NumberLong')
  },
  NumberInt: (args) => {
    const value = toBsonInt(args[0], 'NumberInt')
    return new Int32(value.toNumber())
  },
  NumberDouble: (args) => Number(args[0]),
  Number: (args) => Number(args[0]),
  NumberDecimal: (args) => {
    let text = args[0]
    if (typeof text === 'number') text = pythonFloatRepr(text)
    else if (text instanceof Int32 || text instanceof Long) text = String(text.valueOf())
    try {
      return Decimal128.fromString(String(text))
    } catch (exc) {
      throw new ShellLiteralError(`NumberDecimal() 参数错误: ${String(exc)}`)
    }
  },
  UUID: (args) => {
    const text = args[0]
    if (typeof text !== 'string') throw new ShellLiteralError('UUID() 参数必须是字符串')
    try {
      return new UUID(text)
    } catch {
      throw new ShellLiteralError(`非法 UUID: ${text}`)
    }
  },
  BinData: (args) => {
    if (args.length < 2) throw new ShellLiteralError('BinData() 需要 2 个参数')
    const subtype = toInt(args[0])
    const hex = String(args[1])
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) {
      throw new ShellLiteralError(`非法十六进制: ${hex}`)
    }
    const raw = new Uint8Array(hex.length / 2)
    for (let i = 0; i < raw.length; i++) raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
    return new Binary(raw, subtype)
  },
  MinKey: (args) => {
    if (args.length > 0) throw new ShellLiteralError('MinKey() 不接受参数')
    return new MinKey()
  },
  MaxKey: (args) => {
    if (args.length > 0) throw new ShellLiteralError('MaxKey() 不接受参数')
    return new MaxKey()
  },
  Timestamp: (args) => {
    if (args.length !== 2) {
      throw new ShellLiteralError('Timestamp() 需要 2 个参数：Timestamp(time, inc)')
    }
    return new Timestamp({ t: toInt(args[0]), i: toInt(args[1]) })
  },
  Symbol: (args) => args[0],
  Code: (args) => args[0],
  BsonUndefined: () => null,
  Undefined: () => null
}

function toInt(value: Value): number {
  if (value instanceof Int32) return value.valueOf()
  if (value instanceof Long) return value.toNumber()
  if (typeof value === 'number') return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.trunc(parsed)
  }
  throw new ShellLiteralError(`无法转换为整数: ${String(value)}`)
}

/** Python int(args[0])：字符串按十进制精确解析，避免 double 精度丢失 */
function toBsonInt(value: Value, label: string): Long {
  if (value instanceof Long) return value
  if (value instanceof Int32) return Long.fromNumber(value.valueOf())
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ShellLiteralError(`非法数字 ${String(value)}`)
    return Long.fromNumber(Math.trunc(value))
  }
  if (typeof value === 'string') {
    if (/^[+-]?\d+$/.test(value.trim())) {
      try {
        return Long.fromString(value.trim())
      } catch {
        /* fallthrough */
      }
    }
  }
  throw new ShellLiteralError(`${label}() 参数错误: ${String(value)}`)
}

/** 宽松 ISO-8601 解析（2024-01-01、带 Z、带偏移、带毫秒都接受） */
function mkDatetime(args: Value[]): Date {
  if (args.length === 0) throw new ShellLiteralError('ISODate() 需要 1 个参数')
  const raw = args[0]
  if (raw instanceof Date) return raw
  if (typeof raw === 'number' || raw instanceof Int32 || raw instanceof Long) {
    const ms =
      typeof raw === 'number' ? raw : raw instanceof Int32 ? raw.valueOf() : raw.toNumber()
    if (!Number.isFinite(ms)) throw new ShellLiteralError('非法时间戳')
    return new Date(ms)
  }
  if (typeof raw !== 'string') {
    throw new ShellLiteralError('ISODate() 参数必须是字符串或时间戳')
  }
  let candidate = raw.trim()
  if (candidate.endsWith('Z')) candidate = candidate.slice(0, -1) + '+00:00'
  const parsed = new Date(candidate)
  if (Number.isNaN(parsed.getTime())) throw new ShellLiteralError(`非法日期: ${raw}`)
  return parsed
}

// --- 词法分析 ---------------------------------------------------------------

interface Token {
  kind: 'regex' | 'string' | 'number' | 'ident' | 'punct'
  text: string
}

const TOKEN_RE = new RegExp(
  [
    '(?<ws>\\s+)',
    '(?<comment>//[^\\n]*|/\\*[\\s\\S]*?\\*/)',
    '(?<regex>/(?:\\\\[\\s\\S]|\\[(?:\\\\[\\s\\S]|[^\\]\\\\\\n])*\\]|[^/\\\\\\n])+/[imxs]*)',
    '(?<string>"(?:\\\\[\\s\\S]|[^"\\\\])*"|\'(?:\\\\[\\s\\S]|[^\'\\\\])*\')',
    '(?<number>-?(?:0[xX][0-9a-fA-F]+|\\d+\\.?\\d*(?:[eE][+-]?\\d+)?|\\.\\d+(?:[eE][+-]?\\d+)?)n?)',
    '(?<ident>[A-Za-z_$][A-Za-z0-9_$]*)',
    '(?<punct>[{}\\[\\](),:.;=])'
  ].join('|'),
  'y'
)

const KEYWORDS: Record<string, Value> = {
  true: true,
  false: false,
  null: null,
  undefined: null,
  NaN: NaN,
  Infinity: Infinity
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let pos = 0
  while (pos < source.length) {
    TOKEN_RE.lastIndex = pos
    const match = TOKEN_RE.exec(source)
    if (match === null) {
      throw new ShellLiteralError(`无法解析的字符 ${JSON.stringify(source[pos])}（位置 ${pos}）`)
    }
    pos = TOKEN_RE.lastIndex
    const groups = match.groups as Record<string, string | undefined>
    const kind = (['regex', 'string', 'number', 'ident', 'punct'] as const).find(
      (k) => groups[k] !== undefined
    )
    if (kind === undefined) continue // ws / comment
    tokens.push({ kind, text: match[0] })
  }
  return tokens
}

class LiteralParser {
  private pos = 0

  constructor(private tokens: Token[]) {}

  parse(): Value {
    const value = this.parseValue()
    if (this.pos !== this.tokens.length) {
      throw new ShellLiteralError(`记号 ${JSON.stringify(this.tokens[this.pos].text)} 处有多余内容`)
    }
    return value
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null
  }

  private next(): Token {
    const token = this.peek()
    if (token === null) throw new ShellLiteralError('表达式意外结束')
    this.pos += 1
    return token
  }

  private expect(text: string): void {
    const token = this.next()
    if (token.text !== text) {
      throw new ShellLiteralError(`期望 ${JSON.stringify(text)}，实际得到 ${JSON.stringify(token.text)}`)
    }
  }

  private parseValue(): Value {
    const token = this.peek()
    if (token === null) throw new ShellLiteralError('表达式意外结束')
    if (token.text === '{' || token.text === '[') return this.parseContainer()
    if (token.kind === 'regex') {
      this.next()
      return parseRegexLiteral(token.text)
    }
    if (token.kind === 'string') {
      this.next()
      return decodeJsString(token.text)
    }
    if (token.kind === 'number') {
      this.next()
      return decodeNumber(token.text)
    }
    if (token.kind === 'ident') return this.parseIdent()
    throw new ShellLiteralError(`不支持的记号 ${JSON.stringify(token.text)}`)
  }

  private parseIdent(): Value {
    const token = this.next()
    if (token.text in KEYWORDS) return KEYWORDS[token.text]
    const nxt = this.peek()
    if (nxt !== null && nxt.text === '(') return this.parseCall(token.text)
    throw new ShellLiteralError(`无法解析的标识符 ${JSON.stringify(token.text)}（不支持变量引用）`)
  }

  private parseCall(name: string): Value {
    const factory = ALLOWED_CALLS[name]
    if (factory === undefined) {
      throw new ShellLiteralError(
        `不支持的构造器 ${name}()；CUSTOM 只允许：${Object.keys(ALLOWED_CALLS).sort().join(', ')}`
      )
    }
    this.expect('(')
    // 兼容历史导出格式 Timestamp(t: <n>, i: <n>)；不是该形态则走通用位置参数解析
    if (name === 'Timestamp') {
      const labeled = this.tryParseLabeledTimestamp()
      if (labeled !== null) return labeled
    }
    const args: Value[] = []
    const head = this.peek()
    if (head !== null && head.text === ')') {
      this.next()
    } else {
      for (;;) {
        args.push(this.parseValue())
        const nxt = this.next()
        if (nxt.text === ')') break
        if (nxt.text !== ',') {
          throw new ShellLiteralError(`参数列表里期望 ',' 或 ')'，得到 ${JSON.stringify(nxt.text)}`)
        }
      }
    }
    try {
      return factory(args)
    } catch (exc) {
      if (exc instanceof ShellLiteralError) throw exc
      throw new ShellLiteralError(`${name}() 参数错误: ${String(exc)}`)
    }
  }

  /**
   * 尝试解析 Timestamp(t: <n>, i: <n>) 带标签参数形态。
   * 失败（首记号不是 t 或中途格式不符）时回退游标并返回 null，交还给通用解析。
   */
  private tryParseLabeledTimestamp(): Value | null {
    const start = this.pos
    const head = this.peek()
    if (head === null || head.text !== 't') return null
    try {
      this.next()
      this.expect(':')
      const t = toInt(this.parseValue())
      this.expect(',')
      const iKey = this.next()
      if (iKey.text !== 'i') throw new ShellLiteralError('期望标签 i')
      this.expect(':')
      const i = toInt(this.parseValue())
      this.expect(')')
      return new Timestamp({ t, i })
    } catch {
      this.pos = start
      return null
    }
  }

  private parseContainer(): Value {
    const token = this.next()
    if (token.text === '[') {
      const items: Value[] = []
      const head = this.peek()
      if (head !== null && head.text === ']') {
        this.next()
        return items
      }
      for (;;) {
        items.push(this.parseValue())
        const nxt = this.next()
        if (nxt.text === ']') return items
        if (nxt.text !== ',') {
          throw new ShellLiteralError(`数组里期望 ',' 或 ']'，得到 ${JSON.stringify(nxt.text)}`)
        }
        // 容忍尾逗号：[1, 2, ]（mongosh 允许，JSON.parse 不允许）
        const after = this.peek()
        if (after !== null && after.text === ']') {
          this.next()
          return items
        }
      }
    }
    const result: { [key: string]: Value } = {}
    const head = this.peek()
    if (head !== null && head.text === '}') {
      this.next()
      return result
    }
    for (;;) {
      const keyToken = this.next()
      let key: string
      if (keyToken.kind === 'string') key = decodeJsString(keyToken.text)
      else if (keyToken.kind === 'ident' || keyToken.kind === 'number') key = keyToken.text
      else throw new ShellLiteralError(`非法的对象键 ${JSON.stringify(keyToken.text)}`)
      this.expect(':')
      result[key] = this.parseValue()
      const nxt = this.next()
      if (nxt.text === '}') return result
      if (nxt.text !== ',') {
        throw new ShellLiteralError(`对象里期望 ',' 或 '}'，得到 ${JSON.stringify(nxt.text)}`)
      }
      // 容忍尾逗号：{ a: 1, }（mongosh 允许，JSON.parse 不允许）
      const after = this.peek()
      if (after !== null && after.text === '}') {
        this.next()
        return result
      }
    }
  }
}

function decodeJsString(token: string): string {
  let body = token.slice(1, -1)
  if (token[0] === "'") {
    // 单引号形式转成 JSON 双引号形式，避免重复实现转义表
    body = body.replace(/\\'/g, "'").replace(/"/g, '\\"')
  }
  try {
    return JSON.parse(`"${body}"`)
  } catch {
    throw new ShellLiteralError(`非法字符串 ${token}`)
  }
}

function decodeNumber(token: string): Value {
  const text = token.endsWith('n') ? token.slice(0, -1) : token
  if (text.toLowerCase().replace(/^-+/, '').startsWith('0x')) {
    // Python int(text, 16)：JS parseInt 对 0x 前缀同样按 16 进制解析
    const parsed = parseInt(text, 16)
    if (Number.isNaN(parsed)) throw new ShellLiteralError(`非法数字 ${token}`)
    return parsed >= (-2) ** 31 && parsed < 2 ** 31 ? new Int32(parsed) : Long.fromNumber(parsed)
  }
  if (/[.eE]/.test(text)) {
    const parsed = Number(text)
    // Python float("1e999") → inf 是合法的；只有 NaN 视为非法
    if (Number.isNaN(parsed)) throw new ShellLiteralError(`非法数字 ${token}`)
    return parsed
  }
  const parsed = Number(text)
  if (Number.isNaN(parsed)) throw new ShellLiteralError(`非法数字 ${token}`)
  // Python int 任意精度 → TS 侧按范围落到 Int32 / Long
  return Number.isSafeInteger(parsed) && parsed >= (-2) ** 31 && parsed < 2 ** 31
    ? new Int32(parsed)
    : Long.fromString(text)
}

function parseRegexLiteral(token: string): BSONRegExp {
  const closing = token.lastIndexOf('/')
  const pattern = token.slice(1, closing).replace(/\\\//g, '/')
  const flags = token.slice(closing + 1)
  return new BSONRegExp(pattern, flags)
}

// --- find 命令外壳剥离 -------------------------------------------------------

/** db.getCollection("c").find( / db["c"].find( / db.c.find( 前缀（findOne 同样接受） */
const FIND_SHELL_RE =
  /^\s*db\s*\.\s*(?:getCollection\s*\(\s*(?<q1>["'])(?<n1>[^"']+)\k<q1>\s*\)|(?<n2>[A-Za-z0-9_$]+)|\[\s*(?<q2>["'])(?<n3>[^"']+)\k<q2>\s*\])\s*\.\s*(?:find|findOne)\s*\(/i

/**
 * 剥掉 db.getCollection("c").find( ... ) / db.c.find( ... ) 外壳，
 * 只留 filter 文档文本；非 find 命令原样返回。
 * 支持粘贴完整 shell 命令（含 ISODate 等 shell 构造器）到查询栏 / VQB 导入。
 */
export function stripFindShell(source: string): string {
  const match = source.match(FIND_SHELL_RE)
  if (match === null) return source
  let body = source.slice(match[0].length).trim()
  body = body.replace(/[;\s]+$/, '')
  // 容忍 .toArray() 结尾（mongosh 常见写法）
  body = body.replace(/\.toArray\s*\(\s*\)$/i, '').trim()
  if (!body.endsWith(')')) return source
  body = body.slice(0, -1).trim()
  if (!body.startsWith('{') && !body.startsWith('[')) return source
  return body
}

/** 解析一段受限 shell 字面量为 TS/BSON 值 */
export function parseShellLiteral(source: string): Value {
  if (!source || !source.trim()) throw new ShellLiteralError('片段为空')
  return new LiteralParser(tokenize(stripFindShell(source))).parse()
}

// --- 完整 mongosh 命令解析（Shell 查询模式编辑框） -----------------------------

export type ShellCommandOp =
  | 'find'
  | 'deleteOne'
  | 'deleteMany'
  | 'countDocuments'
  | 'updateOne'
  | 'updateMany'

export interface ShellCommandParts {
  op: ShellCommandOp
  /** 命令前缀 db = db.getSiblingDB("x") 指定的库；未指定为 null */
  db: string | null
  coll: string
  filter: Value
  /** 仅 find 第二参数 */
  projection: Value | null
  /** 仅 updateOne / updateMany 第二参数：更新文档（$set / $unset …）或聚合管道数组 */
  update: Value | null
  /** 仅 updateOne / updateMany 第三参数：选项文档（upsert / arrayFilters …） */
  options: Value | null
  sort: Value | null
  skip: number | null
  limit: number | null
}

const COMMAND_OPS: Record<string, ShellCommandOp> = {
  find: 'find',
  findone: 'find',
  deleteone: 'deleteOne',
  deletemany: 'deleteMany',
  countdocuments: 'countDocuments',
  updateone: 'updateOne',
  updatemany: 'updateMany'
}

/** updateOne / updateMany 第三参数支持的关键字（其余直接报错，避免静默忽略） */
const UPDATE_OPTION_KEYS = [
  'upsert',
  'arrayFilters',
  'collation',
  'hint',
  'let',
  'bypassDocumentValidation'
]

/** db = db.getSiblingDB("x"); 前缀（generateShellCommand 产物），可剥离 */
const SIBLING_DB_RE =
  /^\s*db\s*=\s*db\s*\.\s*getSiblingDB\s*\(\s*(?<q>["'])(?<name>[^"']+)\k<q>\s*\)\s*;?\s*/

/**
 * 从游标处切出一个完整值（对象 / 数组 / 构造器调用 / 标量）的记号片段。
 * 括号深度回到 0 且下一记号是 ',' 或 ')'（或结束）即为本值边界。
 */
function sliceValueTokens(tokens: Token[], from: number): { slice: Token[]; end: number } {
  let depth = 0
  let i = from
  for (;;) {
    const token = tokens[i]
    if (token === undefined) throw new ShellLiteralError('表达式意外结束')
    i += 1
    if (token.text === '{' || token.text === '[' || token.text === '(') depth += 1
    else if (token.text === '}' || token.text === ']' || token.text === ')') depth -= 1
    const nxt = tokens[i]
    if (depth <= 0 && (nxt === undefined || nxt.text === ',' || nxt.text === ')')) {
      if (depth < 0) throw new ShellLiteralError(`多余的 ${JSON.stringify(token.text)}`)
      return { slice: tokens.slice(from, i), end: i }
    }
  }
}

/** 校验 updateOne / updateMany 的 update 参数：更新操作符文档或聚合管道 */
function validateUpdateDoc(update: Value, op: string): void {
  if (Array.isArray(update)) {
    if (update.length === 0) throw new ShellLiteralError(`${op}() 的 update 管道不能为空数组`)
    return
  }
  if (typeof update !== 'object' || update === null) {
    throw new ShellLiteralError(`${op}() 的 update 必须是文档（如 { $set: { a: 1 } }）或聚合管道数组`)
  }
  const keys = Object.keys(update)
  if (keys.length === 0) {
    throw new ShellLiteralError(`${op}() 的 update 不能是空文档，至少需要一个更新操作符`)
  }
  if (!keys.every((key) => key.startsWith('$'))) {
    throw new ShellLiteralError(
      `${op}() 的 update 必须使用更新操作符（$set / $unset / $inc …），不能是整文档替换`
    )
  }
}

/** 校验 updateOne / updateMany 的选项参数：只允许已知关键字 */
function validateUpdateOptions(options: Value, op: string): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new ShellLiteralError(`${op}() 第三个参数必须是选项文档，如 { upsert: true }`)
  }
  const unknown = Object.keys(options).filter((key) => !UPDATE_OPTION_KEYS.includes(key))
  if (unknown.length > 0) {
    throw new ShellLiteralError(
      `${op}() 不支持的选项: ${unknown.join(', ')}；可用: ${UPDATE_OPTION_KEYS.join(', ')}`
    )
  }
}

/**
 * 解析完整 mongosh 命令：
 *   db.getCollection("c").find({...}, {...}).sort({...}).skip(n).limit(n)
 *   db.getCollection("c").deleteMany({...}) / deleteOne / countDocuments
 *   db.getCollection("c").updateMany({...}, {$set: {...}}, {upsert: true}) / updateOne
 * 也接受 db.c.find(...) 与 db["c"].find(...) 形态；findOne 等价 find。
 */
export function parseShellCommand(source: string): ShellCommandParts {
  const sibling = SIBLING_DB_RE.exec(source.trim())
  const db = sibling?.groups?.name ?? null
  const tokens = tokenize(
    source
      .trim()
      .replace(SIBLING_DB_RE, '')
      .replace(/[;\s]+$/, '')
  )
  let pos = 0
  const peek = (): Token | null => (pos < tokens.length ? tokens[pos] : null)
  const nextT = (): Token => {
    const token = peek()
    if (token === null) throw new ShellLiteralError('表达式意外结束')
    pos += 1
    return token
  }
  const expectT = (text: string): void => {
    const token = nextT()
    if (token.text !== text) {
      throw new ShellLiteralError(
        `期望 ${JSON.stringify(text)}，实际得到 ${JSON.stringify(token.text)}`
      )
    }
  }

  expectT('db')
  // db.coll / db["coll"] / db.getCollection("coll")：db 后的点可省略
  if ((peek()?.text ?? '') === '.') nextT()
  let coll: string
  const head = nextT()
  if (head.text === 'getCollection') {
    expectT('(')
    const str = nextT()
    if (str.kind !== 'string') throw new ShellLiteralError('getCollection() 需要字符串集合名')
    coll = decodeJsString(str.text)
    expectT(')')
  } else if (head.kind === 'ident') {
    coll = head.text
  } else if (head.kind === 'string') {
    coll = decodeJsString(head.text)
  } else if (head.text === '[') {
    const str = nextT()
    if (str.kind !== 'string') throw new ShellLiteralError('db["coll"] 需要字符串集合名')
    coll = decodeJsString(str.text)
    expectT(']')
  } else {
    throw new ShellLiteralError('无法识别的集合访问形态')
  }

  expectT('.')
  const opToken = nextT()
  const opKey = opToken.kind === 'ident' ? opToken.text.toLowerCase() : ''
  const op = COMMAND_OPS[opKey]
  if (op === undefined) {
    throw new ShellLiteralError(
      `不支持的命令 .${opToken.text}()；支持 find / findOne / deleteOne / deleteMany / updateOne / updateMany / countDocuments`
    )
  }
  expectT('(')

  const args: Value[] = []
  if ((peek()?.text ?? ')') !== ')') {
    for (;;) {
      const { slice, end } = sliceValueTokens(tokens, pos)
      pos = end
      args.push(new LiteralParser(slice).parse())
      const sep = nextT()
      if (sep.text === ')') break
      if (sep.text !== ',') {
        throw new ShellLiteralError(
          `参数列表里期望 ',' 或 ')'，得到 ${JSON.stringify(sep.text)}`
        )
      }
    }
  } else {
    nextT()
  }

  // find 的链式后缀：.sort({...}) / .skip(n) / .limit(n)；.toArray() 等无参链忽略
  let sort: Value | null = null
  let skip: number | null = null
  let limit: number | null = null
  while (peek() !== null) {
    expectT('.')
    const name = nextT().text.toLowerCase()
    expectT('(')
    if ((peek()?.text ?? ')') === ')') {
      nextT()
      continue
    }
    const { slice, end } = sliceValueTokens(tokens, pos)
    pos = end
    const value = new LiteralParser(slice).parse()
    expectT(')')
    if (name === 'sort') sort = value
    else if (name === 'skip') skip = toInt(value)
    else if (name === 'limit') limit = toInt(value)
  }

  const maxArgs = op === 'find' ? 2 : op === 'updateOne' || op === 'updateMany' ? 3 : 1
  if (args.length > maxArgs) {
    throw new ShellLiteralError(
      `${op}() 最多接受 ${maxArgs} 个参数，实际 ${args.length} 个`
    )
  }
  let update: Value | null = null
  let options: Value | null = null
  if (op === 'updateOne' || op === 'updateMany') {
    if (args.length < 2) {
      throw new ShellLiteralError(`${op}() 需要 filter 与 update 两个参数`)
    }
    update = args[1]
    validateUpdateDoc(update, op)
    options = args[2] ?? null
    if (options !== null) validateUpdateOptions(options, op)
  }
  return {
    op,
    db,
    coll,
    filter: args[0] ?? {},
    projection: op === 'find' ? (args[1] ?? null) : null,
    update,
    options,
    sort,
    skip,
    limit
  }
}
