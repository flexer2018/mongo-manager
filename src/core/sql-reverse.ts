/**
 * MongoDB filter → SQL WHERE 子句的反向展示（纯逻辑）。
 * 仅覆盖可逆的常见形态：标量相等、比较操作符、$in/$nin、$regex 的
 * 锚定 % 模式、$and/$or/$nor、$exists:false → IS NULL 近似；
 * 不可表达时返回 null，调用方提示改用 JSON 视图。
 */
import { isPlainObject, OrderedDoc, Value } from './value-model'

/** EJSON/BSON 形态值 → SQL 字面量文本；不可表示返回 null */
function literalToSql(value: Value): string | null {
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value)
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (Array.isArray(value)) return null
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1 && keys[0] === '$oid' && typeof value.$oid === 'string') {
      return `'${value.$oid}'`
    }
    if (keys.length === 1 && keys[0] === '$numberInt' && typeof value.$numberInt === 'string') {
      return value.$numberInt
    }
    if (keys.length === 1 && keys[0] === '$numberLong' && typeof value.$numberLong === 'string') {
      return value.$numberLong
    }
    if (keys.length === 1 && keys[0] === '$numberDouble' && typeof value.$numberDouble === 'string') {
      return value.$numberDouble
    }
    if (keys.length === 1 && keys[0] === '$date') {
      const inner = value.$date
      if (typeof inner === 'string') return `'${inner}'`
      if (isPlainObject(inner) && typeof inner.$numberLong === 'string') {
        return `'${new Date(Number(inner.$numberLong)).toISOString()}'`
      }
    }
  }
  return null
}

/** 简单锚定正则 → LIKE 模式；复杂正则返回 null */
function regexToLike(regex: string): string | null {
  if (!regex.startsWith('^') || !regex.endsWith('$')) return null
  let out = ''
  for (let i = 1; i < regex.length - 1; i++) {
    const ch = regex[i]
    if (ch === '\\' && regex[i + 1] !== undefined) {
      const next = regex[i + 1]
      if (/[.*+?^${}()|[\]\\]/.test(next)) {
        out += next
        i += 1
        continue
      }
      return null
    }
    if (ch === '.' && regex[i + 1] === '*') {
      out += '%'
      i += 1
      continue
    }
    if (ch === '.') {
      out += '_'
      continue
    }
    if (/[.*+?^${}()|[\]\\]/.test(ch)) return null
    out += ch
  }
  return out
}

const CMP_TO_SQL: Record<string, string> = {
  $eq: '=',
  $ne: '!=',
  $gt: '>',
  $gte: '>=',
  $lt: '<',
  $lte: '<='
}

function valueToSqlText(value: Value): string | null {
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`
  if (value === null) return 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((item) => literalToSql(item))
    if (parts.some((part) => part === null)) return null
    return `(${parts.join(', ')})`
  }
  return literalToSql(value)
}

/** 操作符文档（$gte/$lte 同字段合并为 BETWEEN） */
function opsDocToSql(field: string, ops: OrderedDoc): string | null {
  const entries = Object.entries(ops)
  if (
    entries.length === 2 &&
    entries[0][0] === '$gte' &&
    entries[1][0] === '$lte'
  ) {
    const low = literalToSql(entries[0][1] as Value)
    const high = literalToSql(entries[1][1] as Value)
    if (low === null || high === null) return null
    return `${field} BETWEEN ${low} AND ${high}`
  }
  const parts: string[] = []
  for (const [op, raw] of entries) {
    if (op === '$in' || op === '$nin') {
      const list = valueToSqlText(raw as Value)
      if (list === null) return null
      parts.push(`${field} ${op === '$in' ? 'IN' : 'NOT IN'} ${list}`)
      continue
    }
    if (op === '$regex') {
      const like = regexToLike(typeof raw === 'string' ? raw : '')
      if (like === null) return null
      parts.push(`${field} LIKE '${like.replace(/'/g, "''")}'`)
      continue
    }
    if (op === '$exists') {
      if (raw === false) {
        parts.push(`${field} IS NULL`)
        continue
      }
      return null
    }
    const sqlOp = CMP_TO_SQL[op]
    if (sqlOp === undefined) return null
    const value = literalToSql(raw as Value)
    if (value === null) return null
    parts.push(`${field} ${sqlOp} ${value}`)
  }
  return parts.join(' AND ')
}

/** EJSON 单键字面量形态（{$oid:…} 等），反向时按字面量输出 */
const BSON_LITERAL_KEYS = new Set([
  '$oid', '$numberInt', '$numberLong', '$numberDouble', '$numberDecimal', '$date'
])

const LOGIC_OPS = new Set(['$and', '$or', '$nor'])

function nodeToSql(node: Value): string | null {
  if (Array.isArray(node) || !isPlainObject(node)) return null
  const entries = Object.entries(node)
  if (entries.length === 0) return null
  const parts: string[] = []
  for (const [key, value] of entries) {
    if (LOGIC_OPS.has(key)) {
      if (!Array.isArray(value)) return null
      const children = value.map((child) => nodeToSql(child as Value))
      if (children.some((child) => child === null)) return null
      if (key === '$and') {
        parts.push(children.map((child) => `(${child})`).join('\n  AND '))
      } else {
        const body = children.map((child) => `(${child})`).join(' OR ')
        parts.push(key === '$nor' ? `NOT (${body})` : `(${body})`)
      }
      continue
    }
    if (key.startsWith('$')) return null
    const text = fieldToSql(key, value)
    if (text === null) return null
    parts.push(text)
  }
  return parts.join('\n  AND ')
}

function fieldToSql(field: string, value: Value): string | null {
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 1 && BSON_LITERAL_KEYS.has(keys[0])) {
      const text = literalToSql(value)
      return text === null ? null : `${field} = ${text}`
    }
    if (keys.length > 0 && keys.every((key) => key.startsWith('$'))) {
      return opsDocToSql(field, value)
    }
    // 内嵌文档相等：不可靠，交给 JSON 视图
    return null
  }
  const valueText = valueToSqlText(value)
  if (valueText === null) return null
  return `${field} = ${valueText}`
}

/**
 * filter 文档 → SQL 语句；无法表达时返回 null。
 * 输出形如：SELECT * FROM coll WHERE a = 1 AND b > 2
 */
export function mongoFilterToSql(filter: OrderedDoc, table: string): string | null {
  const where = nodeToSql(filter)
  if (where === null) return null
  return `SELECT * FROM ${table}${where.trim() !== '' ? `\nWHERE ${where}` : ''}`
}
