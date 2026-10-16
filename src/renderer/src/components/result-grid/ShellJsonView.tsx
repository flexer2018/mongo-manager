import type { JSX } from 'react'
import {
  Binary,
  BSONRegExp,
  Code,
  Decimal128,
  Int32,
  Long,
  ObjectId,
  Timestamp
} from 'bson'
import { Value, isPlainObject } from '@core'

/**
 * mongosh 字面量渲染：
 *   ObjectId("…") / NumberInt(…) / NumberLong("…") / ISODate("…") / NumberDecimal("…")
 * 键带引号 `"key" : value`，4 空格缩进。
 * mongoshText 供复制；ShellJson 供着色显示，两者形态一致。
 */
const INDENT = '    '

function floatRepr(n: number): string {
  // double 语义：整数值也带 .0（如 2582672652.0）
  return Number.isInteger(n) && Math.abs(n) < 1e21 ? `${n}.0` : String(n)
}

/** BSON 字面量的「类型名 + 参数」结构：类型名与参数分开着色 */
interface BsonParts {
  type: string
  arg: string
  /** 参数值着色类（类型名固定紫色） */
  argCls: string
}

function bsonParts(value: Value): BsonParts | null {
  if (value instanceof ObjectId)
    return { type: 'ObjectId', arg: `"${value.toHexString()}"`, argCls: 'text-bson-objectid' }
  if (value instanceof Int32)
    return { type: 'NumberInt', arg: String(value.valueOf()), argCls: 'text-bson-number' }
  if (value instanceof Long)
    return { type: 'NumberLong', arg: `"${value.toString()}"`, argCls: 'text-bson-number' }
  if (value instanceof Decimal128)
    return { type: 'NumberDecimal', arg: `"${value.toString()}"`, argCls: 'text-bson-number' }
  if (value instanceof Date)
    return { type: 'ISODate', arg: `"${value.toISOString()}"`, argCls: 'text-bson-array' }
  if (value instanceof Timestamp)
    return { type: 'Timestamp', arg: `{ t: ${value.t}, i: ${value.i} }`, argCls: 'text-bson-date' }
  if (value instanceof Binary)
    return { type: 'BinData', arg: `${value.sub_type}, "${value.toString('base64')}"`, argCls: 'text-bson-binary' }
  return null
}

function bsonToText(value: Value): string | null {
  const parts = bsonParts(value)
  if (parts !== null) return `${parts.type}(${parts.arg})`
  if (value instanceof BSONRegExp) return `/${value.pattern}/${value.options}`
  if (value instanceof Code) return value.code
  return null
}

function leafText(value: Value): string {
  const bson = bsonToText(value)
  if (bson !== null) return bson
  if (value === null) return 'null'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return floatRepr(value)
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** mongosh 风格纯文本（复制用），indent 为空格数 */
export function mongoshText(value: Value, depth = 0, indent = 4): string {
  const pad = indent === 0 ? '' : INDENT.repeat(depth)
  const innerPad = indent === 0 ? '' : INDENT.repeat(depth + 1)
  const nl = indent === 0 ? ' ' : '\n'

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map((item) => innerPad + mongoshText(item, depth + 1, indent))
    return `[${nl}${items.join(`,${nl}`)}${nl}${pad}]`
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '{}'
    const items = entries.map(
      ([key, item]) => `${innerPad}"${key}" : ${mongoshText(item, depth + 1, indent)}`
    )
    return `{${nl}${items.join(`,${nl}`)}${nl}${pad}}`
  }
  return leafText(value)
}

// ---------------------------------------------------------------------------
// 着色渲染（显示用）
// ---------------------------------------------------------------------------

function Leaf({ value }: { value: Value }): JSX.Element {
  // BSON 构造函数形态：类型名紫色，参数值用各自类型色，括号弱化
  const parts = bsonParts(value)
  if (parts !== null) {
    return (
      <span>
        <span className="text-bson-date">{parts.type}</span>
        <span className="text-text-faint">(</span>
        <span className={`break-all ${parts.argCls}`}>{parts.arg}</span>
        <span className="text-text-faint">)</span>
      </span>
    )
  }
  if (value instanceof BSONRegExp) {
    return (
      <span>
        <span className="text-bson-regex">/{value.pattern}/</span>
        <span className="text-bson-null">{value.options}</span>
      </span>
    )
  }
  if (value instanceof Code) {
    return <span className="text-bson-date break-all">{value.code}</span>
  }
  if (value === null) return <span className="text-bson-null">null</span>
  if (typeof value === 'boolean') return <span className="text-bson-boolean">{String(value)}</span>
  if (typeof value === 'number') return <span className="text-bson-number">{floatRepr(value)}</span>
  return (
    <span className="text-bson-string break-all">
      {'"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'}
    </span>
  )
}

function ShellJson({ value, depth }: { value: Value; depth: number }): JSX.Element {
  const pad = INDENT.repeat(depth)
  const innerPad = INDENT.repeat(depth + 1)

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-bson-array">[]</span>
    return (
      <>
        <span className="text-bson-array">[</span>
        {'\n'}
        {value.map((item, index) => (
          <span key={index}>
            {innerPad}
            <ShellJson value={item} depth={depth + 1} />
            {index < value.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        <span className="text-bson-array">]</span>
      </>
    )
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return <span className="text-bson-object">{'{}'}</span>
    return (
      <>
        <span className="text-bson-object">{'{'}</span>
        {'\n'}
        {entries.map(([key, item], index) => (
          <span key={`${key}:${index}`}>
            {innerPad}
            <span className="text-bson-long">{`"${key}"`}</span>
            <span className="text-text-muted"> : </span>
            <ShellJson value={item} depth={depth + 1} />
            {index < entries.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        <span className="text-bson-object">{'}'}</span>
      </>
    )
  }

  return <Leaf value={value} />
}

/** mongosh 风格文档渲染 */
export function ShellJsonDocument({ doc }: { doc: Value }): JSX.Element {
  return <ShellJson value={doc} depth={0} />
}
