import {
  Binary,
  Code,
  DBRef,
  Decimal128,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp,
  BSONRegExp
} from 'bson'
import { isPlainObject, OrderedDoc, pythonFloatRepr, Value } from '../value-model'
import { toShellLiteral } from '../values'
import { applyTemplate } from './generator-base'

/** 通用字符串转义（对应各语言 ny()/nu()） */
export function quoteText(text: string, quote = '"'): string {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(quote, 'g'), '\\' + quote)
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')
  return `${quote}${escaped}${quote}`
}

/** 统一渲染成 UTC ISO-8601 毫秒串 */
export function formatDatetime(value: Date): string {
  return value.toISOString()
}

/** 缩进整块文本 */
export function indentBlock(text: string, width: number): string {
  const pad = ' '.repeat(width)
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n')
}

/** Uint8Array → base64（浏览器与 Node 通用） */
export function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function isIntLike(value: unknown): value is Int32 | Long {
  return value instanceof Int32 || value instanceof Long
}

export function intLikeValue(value: Int32 | Long): number {
  if (value instanceof Int32) return value.valueOf()
  return value.toNumber()
}

export abstract class LiteralRenderer {
  abstract render(value: unknown, sortContext?: boolean): string
}

/** mongosh 字面量：直接复用 values.toShellLiteral */
export class ShellLiteralRenderer extends LiteralRenderer {
  render(value: unknown, _sortContext = false): string {
    return toShellLiteral(value as Value)
  }
}

/** Python / pymongo 字面量（long 值在 TS 侧以 Int32/Long 表示，对应 Python 的 int） */
export class PythonLiteralRenderer extends LiteralRenderer {
  imports = new Set<string>()

  render(value: unknown, sortContext = false): string {
    if (sortContext && isPlainObject(value)) {
      const items = Object.entries(value as OrderedDoc)
        .map(([k, v]) => `(${this.render(k)}, ${this.render(v)})`)
        .join(', ')
      return items ? `[${items}]` : '[]'
    }
    return this.renderInner(value)
  }

  private renderInner(value: unknown): string {
    if (value === null || value === undefined) return 'None'
    if (typeof value === 'boolean') return value ? 'True' : 'False'
    if (isIntLike(value)) {
      const n = intLikeValue(value)
      if (n >= (-2) ** 31 && n < 2 ** 31) return String(n)
      this.imports.add('bson.int64.Int64')
      return `Int64(${n})`
    }
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'float("nan")'
      if (!Number.isFinite(value)) return value > 0 ? 'float("inf")' : 'float("-inf")'
      return pythonFloatRepr(value)
    }
    if (typeof value === 'string') return 'u' + quoteText(value)
    if (value instanceof Binary) {
      this.imports.add('bson.binary.Binary')
      const body = Array.from(value.buffer, (b) => String(b)).join(', ')
      return `Binary(bytes(bytearray([${body}])), 0)`
    }
    if (value instanceof Date) {
      this.imports.add('datetime.datetime')
      this.imports.add('bson.tz_util.FixedOffset')
      return `datetime.strptime(${quoteText(formatDatetime(value))}, "%Y-%m-%d %H:%M:%S.%f")`
    }
    if (value instanceof ObjectId) {
      this.imports.add('bson.objectid.ObjectId')
      return `ObjectId(${quoteText(value.toString())})`
    }
    if (value instanceof BSONRegExp) {
      this.imports.add('bson.regex.Regex')
      const options = value.options ?? ''
      if (options) return `Regex(u${quoteText(value.pattern)}, ${quoteText(options)})`
      return `Regex(u${quoteText(value.pattern)})`
    }
    if (value instanceof Decimal128) {
      this.imports.add('bson.decimal128.Decimal128')
      return `Decimal128(${quoteText(value.toString())})`
    }
    if (value instanceof MaxKey) {
      this.imports.add('bson.max_key.MaxKey')
      return 'MaxKey()'
    }
    if (value instanceof MinKey) {
      this.imports.add('bson.min_key.MinKey')
      return 'MinKey()'
    }
    if (value instanceof Code) {
      this.imports.add('bson.code.Code')
      return `Code(u${quoteText(value.toString())})`
    }
    if (value instanceof DBRef) {
      this.imports.add('bson.dbref.DBRef')
      return `DBRef(${quoteText(value.collection)}, ${this.renderInner(value.oid)})`
    }
    if (value instanceof Timestamp) {
      this.imports.add('bson.timestamp.Timestamp')
      return `Timestamp(${value.t}, ${value.i})`
    }
    if (isPlainObject(value)) {
      const doc = value as OrderedDoc
      if (Object.keys(doc).length === 0) return '{}'
      const inner = Object.entries(doc)
        .map(([k, v]) => `${this.render(k)}: ${this.render(v)}`)
        .join(',\n')
      return '{\n' + indentBlock(inner, 4) + '\n}'
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      const inner = value.map((v) => this.render(v)).join(',\n')
      return '[\n' + indentBlock(inner, 4) + '\n]'
    }
    return quoteText(String(value))
  }
}

/** JSON 风格字面量骨架：JavaScript / C# / Java / PHP / Ruby 共用，模板属性定制差异 */
export abstract class JsonLiteralRenderer extends LiteralRenderer {
  quote = '"'
  trueKw = 'true'
  falseKw = 'false'
  nullKw = 'null'

  objectIdTemplate = 'ObjectId("{hex}")'
  dateTemplate = 'new Date("{iso}")'
  regexTemplate = '/{pattern}/{options}'
  decimalTemplate = 'NumberDecimal("{text}")'
  longTemplate = 'NumberLong({value})'
  maxKeyTemplate = 'MaxKey()'
  minKeyTemplate = 'MinKey()'
  codeTemplate = 'Code("{code}")'
  binaryTemplate = 'BinData({subtype}, "{base64}")'

  render(value: unknown, _sortContext = false): string {
    return this.renderInner(value)
  }

  protected fmt(tpl: string, params: Record<string, string | number>): string {
    return applyTemplate(tpl, params)
  }

  protected renderInner(value: unknown): string {
    if (value === null || value === undefined) return this.nullKw
    if (typeof value === 'boolean') return value ? this.trueKw : this.falseKw
    if (isIntLike(value)) {
      // TS 的 Int32/Long 天然在 int64 内，恒走普通整数字面量
      return String(intLikeValue(value))
    }
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NaN'
      if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity'
      return pythonFloatRepr(value)
    }
    if (typeof value === 'string') return quoteText(value, this.quote)
    if (value instanceof Binary) {
      return this.fmt(this.binaryTemplate, {
        subtype: 0,
        base64: toBase64(value.buffer),
        bytes: Array.from(value.buffer, (b) => String(b)).join(', ')
      })
    }
    if (value instanceof Date) {
      // Java 侧模板用 {ms}（epoch 毫秒），其余语言用 {iso}
      return this.fmt(this.dateTemplate, {
        iso: formatDatetime(value),
        ms: value.getTime()
      })
    }
    if (value instanceof ObjectId) {
      return this.fmt(this.objectIdTemplate, { hex: value.toString() })
    }
    if (value instanceof BSONRegExp) {
      return this.fmt(this.regexTemplate, {
        pattern: value.pattern,
        options: value.options ?? '',
        flags: value.options ?? ''
      })
    }
    if (value instanceof Decimal128) {
      return this.fmt(this.decimalTemplate, { text: value.toString() })
    }
    if (value instanceof MaxKey) return this.maxKeyTemplate
    if (value instanceof MinKey) return this.minKeyTemplate
    if (value instanceof Code) {
      return this.fmt(this.codeTemplate, { code: value.toString() })
    }
    if (isPlainObject(value)) {
      const doc = value as OrderedDoc
      if (Object.keys(doc).length === 0) return '{}'
      const inner = Object.entries(doc)
        .map(([k, v]) => `${this.renderInner(k)}: ${this.renderInner(v)}`)
        .join(',\n')
      return '{\n' + indentBlock(inner, 4) + '\n}'
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      const inner = value.map((v) => this.renderInner(v)).join(',\n')
      return '[\n' + indentBlock(inner, 4) + '\n]'
    }
    return quoteText(String(value), this.quote)
  }
}

export type { Value }
