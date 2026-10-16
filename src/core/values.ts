/**
 * 值字面量的渲染方向：TS 值 → mongosh 字面量文本。
 *
 * 解析方向（CUSTOM 白名单解析器）见 ./shell-parser。
 */
import {
  BSONRegExp,
  Binary,
  Code,
  DBRef,
  Decimal128,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp
} from 'bson'
import { isPlainObject, OrderedDoc, pythonFloatRepr, Value } from './value-model'

export { ShellLiteralError } from './value-model'
export { parseShellLiteral } from './shell-parser'

// ---------------------------------------------------------------------------
// 正则转义
// ---------------------------------------------------------------------------

/** 正则元字符转义集合（注意不转义 ] } -，既有行为，测试固化） */
const REGEX_SPECIALS = new Set('$()*+./?[\\^{|'.split(''))

export function escapeRegex(text: string, strict = false): string {
  if (strict) {
    // Python re.escape：仅字母/数字/下划线不转义
    return [...text].map((ch) => (/[a-zA-Z0-9_]/.test(ch) ? ch : '\\' + ch)).join('')
  }
  return [...text].map((ch) => (REGEX_SPECIALS.has(ch) ? '\\' + ch : ch)).join('')
}

// ---------------------------------------------------------------------------
// TS 值 → mongosh 字面量
// ---------------------------------------------------------------------------

function jsonQuote(text: string): string {
  return JSON.stringify(text)
}

/** 日期统一渲染成 UTC ISO-8601 毫秒串 */
export function formatDatetimeUtc(value: Date): string {
  return value.toISOString()
}

function uuidString(buffer: Uint8Array): string {
  const hex = [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function toShellLiteral(value: Value): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (value instanceof Int32) return String(value.valueOf())
  // Timestamp 继承自 Long，必须先于 Long 判定，否则退化为裸 64 位数字（类型丢失）
  if (value instanceof Timestamp) return `Timestamp(${value.t}, ${value.i})`
  if (value instanceof Long) return value.toString()
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
    return pythonFloatRepr(value)
  }
  if (typeof value === 'string') return jsonQuote(value)
  if (value instanceof Date) return `ISODate(${jsonQuote(formatDatetimeUtc(value))})`
  if (value instanceof ObjectId) return `ObjectId(${jsonQuote(value.toString())})`
  if (value instanceof BSONRegExp) {
    const raw = value.options ?? ''
    const options = [...'imsx'].filter((ch) => raw.includes(ch)).join('')
    return `/${value.pattern}/${options}`
  }
  if (value instanceof Decimal128) return `NumberDecimal(${jsonQuote(value.toString())})`
  if (value instanceof Binary) {
    if (value.sub_type === 4) return `UUID(${jsonQuote(uuidString(value.buffer))})`
    const hex = [...value.buffer].map((b) => b.toString(16).padStart(2, '0')).join('')
    return `BinData(${value.sub_type}, ${jsonQuote(hex)})`
  }
  if (value instanceof Code) return `Code(${jsonQuote(value.toString())})`
  if (value instanceof DBRef) {
    return `DBRef(${jsonQuote(value.collection)}, ${toShellLiteral(value.oid as Value)})`
  }
  if (isPlainObject(value)) return dumps(value)
  if (Array.isArray(value)) {
    return '[' + value.map((item) => toShellLiteral(item)).join(', ') + ']'
  }
  return jsonQuote(String(value))
}

// ---------------------------------------------------------------------------
// 文档 → mongosh 文本（多行输出，属有意改进）
// ---------------------------------------------------------------------------

function isQueryOpKey(key: string): boolean {
  return key.startsWith('$')
}

export function dumps(doc: unknown, indent = 0): string {
  const pad = ' '.repeat(indent)
  const innerPad = ' '.repeat(indent + 2)
  if (isPlainObject(doc)) {
    const entries = Object.entries(doc as OrderedDoc)
    if (entries.length === 0) return '{}'
    const parts = entries.map(
      ([key, val]) => `${innerPad}${renderKey(key)}: ${dumps(val, indent + 2)}`
    )
    return '{\n' + parts.join(',\n') + `\n${pad}}`
  }
  if (Array.isArray(doc)) {
    if (doc.length === 0) return '[]'
    const parts = doc.map((item) => `${innerPad}${dumps(item, indent + 2)}`)
    return '[\n' + parts.join(',\n') + `\n${pad}]`
  }
  return toShellLiteral(doc as Value)
}

/** 键的渲染：含空格/点/开头数字的字段名必须加引号 */
export function renderKey(key: unknown): string {
  const text = typeof key === 'string' ? key : String(key)
  if (isQueryOpKey(text)) return text
  if (text === '') return '""'
  // 对应 Python fullmatch(r"[A-Za-z_$一-鿿][\w.$-]*")；Python 的 \w 是 Unicode 感知
  if (/^[A-Za-z_$\u4e00-\u9fff][\p{L}\p{N}_.$-]*$/u.test(text)) return text
  return jsonQuote(text)
}
