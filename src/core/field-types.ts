/**
 * FieldType —— 字段类型体系。
 *
 * - description → UI 显示名；value → shell/查询类型别名；mongoTypeId → $type 类型号。
 * - 未列出的常量没有 $type 类型号，用 null 表达"无类型号"。
 */

/** FieldType 枚举名（46 个，声明顺序与 Java 侧常量一致） */
export type FieldTypeName =
  | 'NULL'
  | 'OBJECT_ID'
  | 'DBREF'
  | 'OBJECT'
  | 'ARRAY'
  | 'STRING'
  | 'NUMBER'
  | 'NUMBER_INT'
  | 'NUMBER_LONG'
  | 'NUMBER_DECIMAL'
  | 'BOOLEAN'
  | 'DATE'
  | 'TIMESTAMP'
  | 'CODE'
  | 'CODE_WITH_SCOPE'
  | 'REGEX'
  | 'BINARY'
  | 'HEXADECIMAL'
  | 'SYMBOL'
  | 'MIN_KEY'
  | 'MAX_KEY'
  | 'MIN_KEY_BRACE'
  | 'MAX_KEY_BRACE'
  | 'UNDEFINED'
  | 'ISODATE'
  | 'LUUID'
  | 'CSUUID'
  | 'JUUID'
  | 'PYUUID'
  | 'UUID'
  | 'NAN'
  | 'INFINITY'
  | 'PLUS_INFINITY'
  | 'MINUS_INFINITY'
  | 'FUNCTION'
  | 'CODEWSCOPE'
  | 'TRUE'
  | 'FALSE'
  | 'UNKNOWN'
  | 'MIXED'
  | 'DOCUMENT'
  | 'COLLECTION'
  | 'TIMESERIES_COLLECTION'
  | 'CLUSTERED_COLLECTION'
  | 'MULTIPLE'
  | 'ARRAY_DOCUMENT'
  | 'ALL_TEXT_FIELDS'

export type FieldType = FieldTypeName

interface MemberDef {
  name: FieldTypeName
  description: string | null
  value: string | null
}

const RAW_MEMBERS: [FieldTypeName, string?, string?][] = [
  ['NULL', 'Null', 'null'],
  ['OBJECT_ID', 'ObjectId', 'ObjectId'],
  ['DBREF', 'Reference', 'DBRef'],
  ['OBJECT', 'Object'],
  ['ARRAY', 'Array'],
  ['STRING', 'String'],
  ['NUMBER', 'Double'],
  ['NUMBER_INT', 'Int32', 'NumberInt'],
  ['NUMBER_LONG', 'Int64', 'NumberLong'],
  ['NUMBER_DECIMAL', 'Decimal128', 'NumberDecimal'],
  ['BOOLEAN', 'Bool'],
  ['DATE', 'Date', 'Date'],
  ['TIMESTAMP', 'Timestamp', 'Timestamp'],
  ['CODE', 'Code'],
  ['CODE_WITH_SCOPE', 'Code (with scope)'],
  ['REGEX', 'RegEx'],
  ['BINARY', 'Binary', 'BinData'],
  ['HEXADECIMAL', 'HexaDecimal', 'HexData'],
  ['SYMBOL', 'Symbol', 'Symbol'],
  ['MIN_KEY', 'Min key', 'MinKey'],
  ['MAX_KEY', 'Max key', 'MaxKey'],
  ['MIN_KEY_BRACE', 'MinKey()', 'MinKey()'],
  ['MAX_KEY_BRACE', 'MaxKey()', 'MaxKey()'],
  ['UNDEFINED', 'Undefined', 'undefined'],
  ['ISODATE', 'ISO Date', 'ISODate'],
  ['LUUID', 'LUUID', 'LUUID'],
  ['CSUUID', 'CSUUID', 'CSUUID'],
  ['JUUID', 'JUUID', 'JUUID'],
  ['PYUUID', 'PYUUID', 'PYUUID'],
  ['UUID', 'UUID', 'UUID'],
  ['NAN', 'nan', 'nan'],
  ['INFINITY', 'infinity', 'infinity'],
  ['PLUS_INFINITY', '+infinity', '+infinity'],
  ['MINUS_INFINITY', '-infinity', '-infinity'],
  ['FUNCTION', 'function', 'function'],
  ['CODEWSCOPE', 'CodeWScope', 'CodeWScope'],
  ['TRUE', 'true', 'true'],
  ['FALSE', 'false', 'false'],
  ['UNKNOWN', 'Unknown'],
  ['MIXED', 'Mixed'],
  ['DOCUMENT', 'Document'],
  ['COLLECTION', 'Collection'],
  ['TIMESERIES_COLLECTION', 'CollectionTimeseries'],
  ['CLUSTERED_COLLECTION', 'CollectionClustered'],
  ['MULTIPLE', '...'],
  ['ARRAY_DOCUMENT'],
  ['ALL_TEXT_FIELDS']
]

/** 按声明顺序的成员表（fromDescription/fromValue/fromMongoTypeId 依赖此顺序） */
export const FIELD_TYPE_MEMBERS: readonly MemberDef[] = RAW_MEMBERS.map(
  ([name, description, value]) => ({ name, description: description ?? null, value: value ?? null })
)

const MEMBER_BY_NAME = new Map<string, MemberDef>(FIELD_TYPE_MEMBERS.map((m) => [m.name, m]))

/** Java 侧 getMongoTypeId() switch 逐字搬过来的映射表 */
export const MONGO_TYPE_IDS: Readonly<Record<string, number>> = {
  MIN_KEY: -1,
  NUMBER: 1,
  STRING: 2,
  OBJECT: 3,
  ARRAY: 4,
  BINARY: 5,
  UNDEFINED: 6,
  OBJECT_ID: 7,
  BOOLEAN: 8,
  DATE: 9,
  NULL: 10,
  REGEX: 11,
  DBREF: 12,
  CODE: 13,
  SYMBOL: 14,
  CODE_WITH_SCOPE: 15,
  NUMBER_INT: 16,
  TIMESTAMP: 17,
  NUMBER_LONG: 18,
  NUMBER_DECIMAL: 19,
  MAX_KEY: 127
}

export function description(ft: FieldType): string | null {
  return MEMBER_BY_NAME.get(ft)?.description ?? null
}

/** 类型别名（getValue()），如 NumberLong */
export function typeValue(ft: FieldType): string | null {
  return MEMBER_BY_NAME.get(ft)?.value ?? null
}

/** __str__：description 或 "(unknown)" */
export function fieldTypeName(ft: FieldType): string {
  return MEMBER_BY_NAME.get(ft)?.description ?? '(unknown)'
}

/** $type 用的 BSON 类代号；无映射返回 null（对应 Java 的 return 0） */
export function mongoTypeId(ft: FieldType): number | null {
  return ft in MONGO_TYPE_IDS ? MONGO_TYPE_IDS[ft] : null
}

export function hasTypeId(ft: FieldType): boolean {
  return ft in MONGO_TYPE_IDS
}

/** 对应 Java fromString：按 description 匹配，未命中返回 UNKNOWN */
export function fromDescription(text: string): FieldType {
  for (const m of FIELD_TYPE_MEMBERS) {
    if (m.description === text) return m.name
  }
  return 'UNKNOWN'
}

/** 对应 Java fromValue：按 value 匹配，未命中返回 null */
export function fromValue(text: string): FieldType | null {
  for (const m of FIELD_TYPE_MEMBERS) {
    if (m.value !== null && m.value === text) return m.name
  }
  return null
}

/** 对应 Java fromMongoTypeId：未命中返回 UNKNOWN */
export function fromMongoTypeId(typeId: number): FieldType {
  for (const m of FIELD_TYPE_MEMBERS) {
    if (mongoTypeId(m.name) === typeId) return m.name
  }
  return 'UNKNOWN'
}

/** 宽松解析：依次尝试枚举名 / 类型号 / description / value */
export function resolveFieldType(name: unknown): FieldType {
  if (typeof name === 'boolean') return 'UNKNOWN'
  if (typeof name === 'number' && Number.isInteger(name)) return fromMongoTypeId(name)
  const key = String(name).trim()
  if (!key) return 'UNKNOWN'
  const upper = key.toUpperCase()
  if (MEMBER_BY_NAME.has(upper)) return upper as FieldType
  if (key in MONGO_TYPE_IDS) return fromMongoTypeId(MONGO_TYPE_IDS[key])
  // 对应 Python int(key)：仅接受十进制整数字面量
  if (/^[+-]?\d+$/.test(key)) return fromMongoTypeId(Number(key))
  const byDesc = fromDescription(key)
  if (byDesc !== 'UNKNOWN') return byDesc
  return fromValue(key) ?? 'UNKNOWN'
}

/** 对应 Java selectableTypes：按 description 排序（小写序） */
const SELECTABLE_BASE: readonly FieldType[] = [
  'STRING',
  'ARRAY',
  'BINARY',
  'BOOLEAN',
  'CODE',
  'CODE_WITH_SCOPE',
  'DATE',
  'DBREF',
  'NULL',
  'NUMBER',
  'NUMBER_INT',
  'NUMBER_LONG',
  'NUMBER_DECIMAL',
  'OBJECT',
  'OBJECT_ID',
  'REGEX',
  'SYMBOL',
  'TIMESTAMP',
  'MIN_KEY',
  'MAX_KEY',
  'UNDEFINED'
]

export const SELECTABLE_TYPES: readonly FieldType[] = [...SELECTABLE_BASE].sort((a, b) => {
  const da = (description(a) ?? '').toLowerCase()
  const db = (description(b) ?? '').toLowerCase()
  return da < db ? -1 : da > db ? 1 : 0
})

/** 有 value 的类型别名，排序后收集（去重） */
export const FIELD_TYPE_VALUES: readonly string[] = [
  ...new Set(FIELD_TYPE_MEMBERS.map((m) => m.value).filter((v): v is string => v !== null))
].sort()

const IN_PLACE_EDITABLE = new Set<FieldType>([
  'OBJECT_ID',
  'DBREF',
  'STRING',
  'NUMBER',
  'NUMBER_INT',
  'NUMBER_LONG',
  'NUMBER_DECIMAL',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
  'CODE',
  'CODE_WITH_SCOPE',
  'REGEX',
  'BINARY',
  'SYMBOL'
])

/** 对应 Java isInPlaceEditable */
export function isInPlaceEditable(ft: FieldType): boolean {
  return IN_PLACE_EDITABLE.has(ft)
}
