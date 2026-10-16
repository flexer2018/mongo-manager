/**
 * 操作符与逻辑组连接词。
 *
 * 常量顺序、描述文案、适用性判定与 BSON 映射由测试固化，改动需同步更新测试。
 */
import { FieldType } from './field-types'

/** 字段操作符名（与 Java xu9t 逐一同名同序） */
export type Operator =
  | 'EQUALS'
  | 'NOT_EQUAL'
  | 'CONTAINS'
  | 'DOES_NOT_CONTAIN'
  | 'STARTS_WITH'
  | 'DOES_NOT_START_WITH'
  | 'ENDS_WITH'
  | 'DOES_NOT_END_WITH'
  | 'IS_NULL'
  | 'IS_NOT_NULL'
  | 'EXISTS'
  | 'DOES_NOT_EXIST'
  | 'IN'
  | 'NIN'
  | 'ALL'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'LELE'
  | 'LTLE'
  | 'LELT'
  | 'LTLT'
  | 'TYPE'
  | 'DOES_NOT_HAVE_TYPE'
  | 'TEXT_INDEX_SEARCH'
  | 'CUSTOM'

/** 声明顺序（fromString 依赖） */
export const OPERATOR_MEMBERS: readonly Operator[] = [
  'EQUALS',
  'NOT_EQUAL',
  'CONTAINS',
  'DOES_NOT_CONTAIN',
  'STARTS_WITH',
  'DOES_NOT_START_WITH',
  'ENDS_WITH',
  'DOES_NOT_END_WITH',
  'IS_NULL',
  'IS_NOT_NULL',
  'EXISTS',
  'DOES_NOT_EXIST',
  'IN',
  'NIN',
  'ALL',
  'GT',
  'GTE',
  'LT',
  'LTE',
  'LELE',
  'LTLE',
  'LELT',
  'LTLT',
  'TYPE',
  'DOES_NOT_HAVE_TYPE',
  'TEXT_INDEX_SEARCH',
  'CUSTOM'
]

const OPERATOR_DESCRIPTIONS: Record<Operator, string> = {
  EQUALS: 'equals',
  NOT_EQUAL: "doesn't equal",
  CONTAINS: 'contains',
  DOES_NOT_CONTAIN: "doesn't contain",
  STARTS_WITH: 'starts with',
  DOES_NOT_START_WITH: "doesn't start with",
  ENDS_WITH: 'ends with',
  DOES_NOT_END_WITH: 'does not end with',
  IS_NULL: 'is null',
  IS_NOT_NULL: "isn't null",
  EXISTS: 'exists',
  DOES_NOT_EXIST: "doesn't exist",
  IN: 'in',
  NIN: 'not in',
  ALL: 'array contains all',
  GT: '>',
  GTE: '>=',
  LT: '<',
  LTE: '<=',
  LELE: '<= ... <=',
  LTLE: '< ... <=',
  LELT: '<= ... <',
  LTLT: '< ... <',
  TYPE: 'has type',
  DOES_NOT_HAVE_TYPE: "doesn't have type",
  TEXT_INDEX_SEARCH: 'text index search',
  CUSTOM: '(custom)'
}

export function operatorDescription(op: Operator): string {
  return OPERATOR_DESCRIPTIONS[op]
}

/** 对应 getByString：按描述文案匹配 */
export function operatorFromString(text: string): Operator | null {
  for (const member of OPERATOR_MEMBERS) {
    if (OPERATOR_DESCRIPTIONS[member] === text) return member
  }
  return null
}

const RANGE_OPERATORS = new Set<Operator>(['LELE', 'LTLE', 'LELT', 'LTLT'])

const ARRAY_OPERATORS = new Set<Operator>(['EQUALS', 'NOT_EQUAL', 'IN', 'NIN', 'ALL'])

const NUMBER_OPERATORS = new Set<Operator>([
  'EQUALS',
  'NOT_EQUAL',
  'GT',
  'GTE',
  'LT',
  'LTE'
])

const TEXT_OPERATORS = new Set<Operator>([
  'EQUALS',
  'NOT_EQUAL',
  'CONTAINS',
  'DOES_NOT_CONTAIN',
  'STARTS_WITH',
  'DOES_NOT_START_WITH',
  'ENDS_WITH',
  'DOES_NOT_END_WITH',
  'GT',
  'GTE',
  'LT',
  'LTE'
])

const APPLICABLE_FOR_ALL = new Set<Operator>([
  'EQUALS',
  'NOT_EQUAL',
  'IS_NULL',
  'IS_NOT_NULL',
  'EXISTS',
  'DOES_NOT_EXIST',
  'TYPE',
  'DOES_NOT_HAVE_TYPE',
  'CUSTOM'
])

const NO_VALUE_OPERATORS = new Set<Operator>([
  'IS_NULL',
  'IS_NOT_NULL',
  'EXISTS',
  'DOES_NOT_EXIST'
])

const LIST_VALUE_OPERATORS = new Set<Operator>(['IN', 'NIN', 'ALL'])

/** piNO 的纯字符串形态：正则类 + 列表类 + custom */
const RAW_TEXT_OPERATORS = new Set<Operator>([
  'CONTAINS',
  'DOES_NOT_CONTAIN',
  'STARTS_WITH',
  'DOES_NOT_START_WITH',
  'ENDS_WITH',
  'DOES_NOT_END_WITH',
  'IN',
  'NIN',
  'ALL',
  'CUSTOM'
])

const NEGATED_OPERATORS = new Set<Operator>([
  'DOES_NOT_CONTAIN',
  'DOES_NOT_START_WITH',
  'DOES_NOT_END_WITH',
  'DOES_NOT_HAVE_TYPE'
])

/** 单算子 → MongoDB 操作符名 */
const SINGLE_MONGO_OPS: Partial<Record<Operator, string>> = {
  EQUALS: '$eq',
  NOT_EQUAL: '$ne',
  GT: '$gt',
  GTE: '$gte',
  LT: '$lt',
  LTE: '$lte',
  IN: '$in',
  NIN: '$nin',
  ALL: '$all',
  IS_NULL: '$eq',
  IS_NOT_NULL: '$ne',
  EXISTS: '$exists',
  DOES_NOT_EXIST: '$exists'
}

/** 范围操作符 → (下界算子, 上界算子) */
const RANGE_BSON: Partial<Record<Operator, [string, string]>> = {
  LTLT: ['$gt', '$lt'],
  LTLE: ['$gt', '$lte'],
  LELT: ['$gte', '$lt'],
  LELE: ['$gte', '$lte']
}

export function isRangeOperator(op: Operator): boolean {
  return RANGE_OPERATORS.has(op)
}

export function isArrayOperator(op: Operator): boolean {
  return ARRAY_OPERATORS.has(op)
}

export function isNumberOperator(op: Operator): boolean {
  return NUMBER_OPERATORS.has(op) || isRangeOperator(op)
}

export function isTextOperator(op: Operator): boolean {
  return TEXT_OPERATORS.has(op) || isRangeOperator(op)
}

export function appliesToAllTypes(op: Operator): boolean {
  return APPLICABLE_FOR_ALL.has(op)
}

/** 是否需要值输入框 */
export function needsValue(op: Operator): boolean {
  return !NO_VALUE_OPERATORS.has(op)
}

/** 值是多元素列表（IN/NIN/ALL） */
export function valueIsList(op: Operator): boolean {
  return LIST_VALUE_OPERATORS.has(op)
}

/** 禁用类型选择、纯字符串形态 */
export function valueIsRawText(op: Operator): boolean {
  return RAW_TEXT_OPERATORS.has(op)
}

/** 展开出的 MongoDB 操作符名（范围操作符返回 2 个） */
export function mongoOps(op: Operator): string[] {
  const range = RANGE_BSON[op]
  if (range) return range
  const single = SINGLE_MONGO_OPS[op]
  return single ? [single] : []
}

/** 是否用 $not 包裹 */
export function isNegated(op: Operator): boolean {
  return NEGATED_OPERATORS.has(op)
}

/** 逻辑组连接词（与 Java aLlv 同名同序） */
export type GroupOp = 'AND' | 'OR' | 'NOR' | 'ELEM_MATCH' | 'NOT_ELEM_MATCH'

interface GroupDef {
  description: string
  internalName: string
  isElemMatch: boolean
  firstLabel: string
  combinationLabel: string
}

const GROUP_DEFS: Record<GroupOp, GroupDef> = {
  AND: {
    description: 'Match all ($and)',
    internalName: '$and',
    isElemMatch: false,
    firstLabel: 'Where',
    combinationLabel: 'And'
  },
  OR: {
    description: 'Match any ($or)',
    internalName: '$or',
    isElemMatch: false,
    firstLabel: 'Either',
    combinationLabel: 'Or'
  },
  NOR: {
    description: 'Match none ($nor)',
    internalName: '$nor',
    isElemMatch: false,
    firstLabel: 'Neither',
    combinationLabel: 'Nor'
  },
  ELEM_MATCH: {
    description: 'Has array element(s) matching',
    internalName: '$elemMatch',
    isElemMatch: true,
    firstLabel: 'With',
    combinationLabel: 'And'
  },
  NOT_ELEM_MATCH: {
    description: 'Has no array element matching',
    internalName: '$notElemMatch',
    isElemMatch: true,
    firstLabel: 'Neither',
    combinationLabel: 'Nor'
  }
}

export const GROUP_OP_MEMBERS: readonly GroupOp[] = [
  'AND',
  'OR',
  'NOR',
  'ELEM_MATCH',
  'NOT_ELEM_MATCH'
]

export function groupDescription(op: GroupOp): string {
  return GROUP_DEFS[op].description
}

export function groupInternalName(op: GroupOp): string {
  return GROUP_DEFS[op].internalName
}

export function groupIsElemMatch(op: GroupOp): boolean {
  return GROUP_DEFS[op].isElemMatch
}

/** 组内第一行前面的标签：Where / Either / Neither / With */
export function groupFirstLabel(op: GroupOp): string {
  return GROUP_DEFS[op].firstLabel
}

/** 后续行前面的标签：And / Or / Nor */
export function groupCombinationLabel(op: GroupOp): string {
  return GROUP_DEFS[op].combinationLabel
}

/** 对应 getByString：先按描述，失败再走 v1 文本兼容表 */
export function groupOpFromString(text: string): GroupOp | null {
  for (const member of GROUP_OP_MEMBERS) {
    if (GROUP_DEFS[member].description === text) return member
  }
  const legacy: Record<string, GroupOp> = {
    'Match all of ($and)': 'AND',
    'Match any of ($or)': 'OR',
    'Match none of ($nor)': 'NOR',
    'Has array element(s) matching': 'ELEM_MATCH',
    'Has no array elements matching': 'NOT_ELEM_MATCH'
  }
  return legacy[text] ?? null
}

export function groupOpFromInternalName(text: string): GroupOp | null {
  for (const member of GROUP_OP_MEMBERS) {
    if (GROUP_DEFS[member].internalName === text) return member
  }
  return null
}

/** 编译成 BSON 时实际使用的键名（$notElemMatch 由 compiler 展开为 $not+$elemMatch） */
export function groupMongoKey(op: GroupOp): string {
  return op === 'ELEM_MATCH' ? '$elemMatch' : groupInternalName(op)
}

const NUMERIC_FIELD_TYPES = new Set<FieldType>([
  'NUMBER',
  'NUMBER_INT',
  'NUMBER_LONG',
  'NUMBER_DECIMAL',
  'HEXADECIMAL',
  'BINARY'
])

const COMPARISON_COMPATIBLE = new Set<FieldType>([
  'BOOLEAN',
  'DATE',
  'ISODATE',
  'SYMBOL',
  'REGEX',
  'OBJECT_ID',
  'TIMESTAMP'
])

/**
 * 操作符对某字段类型是否适用（HEET.a(gFXJ, xu9t) L508-518）。
 * field_type 未知（null）时按"全部放行"处理。
 */
export function applicableOperator(op: Operator, fieldType: FieldType | null): boolean {
  if (appliesToAllTypes(op)) return true
  if (fieldType === null) return true
  if (isNumberOperator(op) && NUMERIC_FIELD_TYPES.has(fieldType)) return true
  if (isTextOperator(op) && fieldType === 'STRING') return true
  if (isArrayOperator(op) && fieldType === 'ARRAY') return true
  if (isNumberOperator(op) && COMPARISON_COMPATIBLE.has(fieldType)) return true
  return false
}
