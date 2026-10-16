/**
 * 反解析：BSON 查询文档 → 查询树。
 *
 * 关键语义（不要"优化"）：
 * - 多个 $and/$or 各建兄弟组、不合并；单元素 {$and:[c]} 不脱糖；嵌套不扁平化
 * - {field: {$elemMatch: {...}}} / {field: {$not: {$elemMatch: ...}}}
 *   → ELEM_MATCH / NOT_ELEM_MATCH 组，内层字段名统一改写为 <Array Element>
 * - 反向解析不认识正则操作符：{$regex:...,$options:...} 降级 CUSTOM；
 *   裸正则 /abc/i 归约 EQUALS + REGEX 类型（HEET.a() L900-1008 无 $regex 分支）
 * - 无法归约时不抛异常，降级为 CUSTOM 规则（HEET L993）
 */
import { BSONRegExp, Binary, Code, Decimal128, Int32, Long, ObjectId } from 'bson'
import { FieldType, fromMongoTypeId } from './field-types'
import {
  ARRAY_ELEMENT_PLACEHOLDER,
  FieldRule,
  QueryGroup,
  QueryNode,
  createFieldRule,
  createQueryGroup
} from './model'
import { GroupOp, Operator } from './operators'
import { OrderedDoc, Value, isPlainObject } from './value-model'
import { parseShellLiteral, toShellLiteral } from './values'

/** 逻辑连接词 → 组连接词（对应 H8if L422-442） */
const GROUP_OPS: Record<string, GroupOp> = { $and: 'AND', $or: 'OR', $nor: 'NOR' }

/** 正则类操作符取反映射（仅 UI 侧使用，parse 方向不可达） */
export const NEGATED_REGEX_OPS: Partial<Record<Operator, Operator>> = {
  CONTAINS: 'DOES_NOT_CONTAIN',
  DOES_NOT_CONTAIN: 'CONTAINS',
  STARTS_WITH: 'DOES_NOT_START_WITH',
  DOES_NOT_START_WITH: 'STARTS_WITH',
  ENDS_WITH: 'DOES_NOT_END_WITH',
  DOES_NOT_END_WITH: 'ENDS_WITH'
}

// ---------------------------------------------------------------------------
// 值类型推断（决定值编辑器显示哪种输入控件）
// ---------------------------------------------------------------------------

export function inferValueType(value: Value): FieldType {
  if (value === null) return 'NULL'
  // bool 先于数字判定（Python 的 bool 是 int 子类）
  if (typeof value === 'boolean') return 'BOOLEAN'
  // TS 值模型：Python int ≙ Int32 | Long；普通 number ≙ float
  if (value instanceof Int32) return 'NUMBER_INT'
  if (value instanceof Long) return 'NUMBER_LONG'
  if (typeof value === 'number') return 'NUMBER'
  if (typeof value === 'string') return 'STRING'
  if (value instanceof Date) return 'ISODATE'
  if (isPlainObject(value)) return 'OBJECT'
  if (Array.isArray(value)) return 'ARRAY'
  if (value instanceof ObjectId) return 'OBJECT_ID'
  if (value instanceof Decimal128) return 'NUMBER_DECIMAL'
  if (value instanceof BSONRegExp) return 'REGEX'
  if (value instanceof Code) return 'CODE'
  if (value instanceof Binary) return 'BINARY'
  return 'UNKNOWN'
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/** 把一个 BSON 查询文档还原成查询树（根组 is_root=True，不做"单组提升"）。 */
export function parseBson(doc: OrderedDoc, rootOp: GroupOp = 'AND'): QueryGroup {
  const root = createQueryGroup({ op: rootOp, isRoot: true })
  root.children = reduceDoc(doc)
  return root
}

/** 从 shell 文本或文档还原查询树；文本必须是查询文档 {...}，不含 find(...) 外壳。 */
export function parseFindFilter(
  source: string | OrderedDoc,
  rootOp: GroupOp = 'AND'
): QueryGroup {
  if (isPlainObject(source)) return parseBson(source, rootOp)
  const parsed = parseShellLiteral(source)
  if (!isPlainObject(parsed)) {
    throw new Error('查询文本必须解析成一个文档（{...}）')
  }
  return parseBson(parsed, rootOp)
}

// ---------------------------------------------------------------------------
// 归约
// ---------------------------------------------------------------------------

/** 逐 key 归约，返回兄弟节点列表（对应 H8if.a(Vm0I, Document, List)）；[] 表示无子节点。 */
function reduceDoc(doc: OrderedDoc | null): QueryNode[] {
  if (!doc || Object.keys(doc).length === 0) return []
  const nodes: QueryNode[] = []
  for (const [key, value] of Object.entries(doc)) {
    const groupOp = GROUP_OPS[key]
    // 条件是 "$and".equals(key) && value instanceof List；不是 List 落到叶子分支
    if (groupOp !== undefined && Array.isArray(value)) {
      const child = reduceLogical(groupOp, value)
      if (child !== null) nodes.push(child)
      continue
    }
    const reduced = reduceField(key, value)
    if (reduced !== null) nodes.push(reduced)
  }
  return nodes
}

/** 归约 {$and: [...]} / {$or: [...]} / {$nor: [...]} 的三个对称分支。 */
function reduceLogical(op: GroupOp, items: readonly Value[]): QueryGroup | null {
  const children: QueryNode[] = []
  for (const item of items) {
    if (!isPlainObject(item)) continue
    children.push(...reduceDoc(item))
  }
  if (children.length === 0) return null
  const group = createQueryGroup({ op })
  group.children = children
  return group
}

/** 顶层特殊操作符（$text / $where / $expr）——当前无调用点，保留模块面。 */
export function reduceTopLevelSpecial(key: string, value: Value): FieldRule {
  if (key === '$text' && isPlainObject(value)) {
    return createFieldRule({
      field: ARRAY_ELEMENT_PLACEHOLDER,
      operator: 'TEXT_INDEX_SEARCH',
      textSearch: {
        search: value.$search ?? '',
        language: value.$language ?? null,
        case_sensitive: Boolean(value.$caseSensitive ?? false),
        diacritic_sensitive: Boolean(value.$diacriticSensitive ?? false)
      }
    })
  }
  // $where / $expr 等没有字段路径可挂，降级为 CUSTOM
  return createFieldRule({
    field: '',
    operator: 'CUSTOM',
    customText: toShellLiteral({ [key]: value }),
    valueType: 'OBJECT'
  })
}

/**
 * 归约一条 {field: cond}。分支顺序不可调整：短路 if 链，先命中先返回，
 * 顺序敏感行为由测试固化。
 */
function reduceField(fieldName: string, cond: Value): QueryNode | null {
  const path = fieldName.trim()

  // --- $elemMatch 剥壳（先于叶子判定） ---
  if (isPlainObject(cond) && Object.keys(cond).length === 1) {
    if ('$elemMatch' in cond) {
      return reduceElemMatch(path, 'ELEM_MATCH', cond.$elemMatch)
    }
    const notValue = cond.$not
    if (isPlainObject(notValue) && Object.keys(notValue).length === 1 && '$elemMatch' in notValue) {
      return reduceElemMatch(path, 'NOT_ELEM_MATCH', notValue.$elemMatch)
    }
  }

  // --- $not.field 前缀写法 ---
  if (path.startsWith('$not.')) {
    return reduceField(path.slice('$not.'.length), { $not: cond })
  }

  // --- $text：H8if L475 是 return 而非 continue，命中后同文档剩余 key 全部丢弃 ---
  if (isPlainObject(cond) && Object.keys(cond).length === 1 && '$text' in cond) {
    return reduceText(path, cond.$text)
  }

  // 以下严格对应 HEET.a(String, Object, Set) L900-1008 的顺序
  if (isPlainObject(cond)) return reduceDocumentCondition(path, cond)
  return reduceScalarCondition(path, cond)
}

/** cond 是 Document —— 对应 HEET.a() L900-1000 的顺序 if 链。 */
function reduceDocumentCondition(path: string, cond: OrderedDoc): FieldRule {
  const keys = Object.keys(cond)

  // L903-906：{} 空条件文档 → EQUALS + UNKNOWN
  if (keys.length === 0) {
    return createFieldRule({ field: path, operator: 'EQUALS', valueType: 'UNKNOWN' })
  }
  // L907-908：{$eq: v}
  if (keys.length === 1 && '$eq' in cond) return makeRule(path, 'EQUALS', cond.$eq)
  // L910-913：{$ne: null} 特例 → "不为空"
  if (keys.length === 1 && '$ne' in cond && cond.$ne === null) {
    return createFieldRule({ field: path, operator: 'IS_NOT_NULL', valueType: 'UNKNOWN' })
  }
  // L914-915：{$ne: v}
  if (keys.length === 1 && '$ne' in cond) return makeRule(path, 'NOT_EQUAL', cond.$ne)

  // 范围算子（L917-951）：else-if 链，优先级 $gt>$lt>$lte>$gte，死代码分支忠实保留
  if ('$gt' in cond) {
    if ('$lt' in cond) return makeRange(path, 'LTLT', cond.$gt, cond.$lt)
    if ('$lte' in cond) return makeRange(path, 'LTLE', cond.$gt, cond.$lte)
    return makeRule(path, 'GT', cond.$gt)
  }
  if ('$lt' in cond) {
    if ('$gte' in cond) return makeRange(path, 'LELT', cond.$gte, cond.$lt)
    return makeRule(path, 'LT', cond.$lt)
  }
  if ('$lte' in cond) {
    if ('$gte' in cond) return makeRange(path, 'LELE', cond.$gte, cond.$lte)
    return makeRule(path, 'LTE', cond.$lte)
  }
  if ('$gte' in cond) {
    if ('$lt' in cond) return makeRange(path, 'LELT', cond.$gte, cond.$lt)
    if ('$lte' in cond) return makeRange(path, 'LELE', cond.$gte, cond.$lte)
    return makeRule(path, 'GTE', cond.$gte)
  }

  // L953-961：$in / $nin / $all
  if (keys.length === 1) {
    const listOps: [string, Operator][] = [['$in', 'IN'], ['$nin', 'NIN'], ['$all', 'ALL']]
    for (const [key, operator] of listOps) {
      if (key in cond) return makeStringifiedRule(path, operator, cond[key])
    }
  }

  // L962-966：{$type: <Number>} —— 只认数字类型号，字符串别名不支持
  if (keys.length === 1 && '$type' in cond) {
    const resolved = typeFromNumber(cond.$type)
    if (resolved !== null) {
      return createFieldRule({ field: path, operator: 'TYPE', valueType: resolved })
    }
    return makeCustom(path, cond)
  }

  // L967-974：{$exists: true/false} —— 必须是真正的布尔值
  if (keys.length === 1 && '$exists' in cond) {
    const flag = cond.$exists
    if (flag === true) return createFieldRule({ field: path, operator: 'EXISTS' })
    if (flag === false) return createFieldRule({ field: path, operator: 'DOES_NOT_EXIST' })
    return makeCustom(path, cond)
  }

  // L975-991：$not —— 只认 {$eq:...} / {$type:<Number>} / 裸正则
  if (keys.length === 1 && '$not' in cond) return reduceNot(path, cond.$not)

  // L993 兜底：任何未列举的 $key（含 $regex/$options/$mod/$size）→ CUSTOM
  return makeCustom(path, cond)
}

/** cond 不是 Document —— 对应 HEET.a() L1001-1007。 */
function reduceScalarCondition(path: string, cond: Value): FieldRule {
  // L995-999：裸正则 /abc/i → EQUALS + REGEX
  if (isRegexLiteral(cond)) {
    return createFieldRule({ field: path, operator: 'EQUALS', value: cond, valueType: 'REGEX' })
  }
  // L1004-1006：null → IS_NULL
  if (cond === null) {
    return createFieldRule({ field: path, operator: 'IS_NULL', valueType: 'UNKNOWN' })
  }
  // L1007：列表 → EQUALS（保留列表结构，见 makeStringifiedRule 的有意偏离说明）
  if (Array.isArray(cond)) return makeStringifiedRule(path, 'EQUALS', cond)
  return makeRule(path, 'EQUALS', cond)
}

/** {field: {$text: {$search: "..."}}} —— 对应 H8if L467-483；仅 $search 为字符串才成立。 */
function reduceText(path: string, value: Value): FieldRule {
  if (isPlainObject(value) && typeof value.$search === 'string') {
    return createFieldRule({
      field: path,
      operator: 'TEXT_INDEX_SEARCH',
      value: value.$search,
      textSearch: {
        search: value.$search,
        language: value.$language ?? null,
        case_sensitive: Boolean(value.$caseSensitive ?? false),
        diacritic_sensitive: Boolean(value.$diacriticSensitive ?? false)
      }
    })
  }
  return makeCustom(path, value)
}

/**
 * {field: {$not: <cond>}} —— 取反映射。
 * 只认三种形态；没有 {$not:{$gt}} → LTE 的取反映射（未实现，测试固化）。
 */
function reduceNot(path: string, inner: Value): FieldRule {
  // L986-991：裸正则（pattern/options 被丢弃）
  if (isRegexLiteral(inner)) {
    return createFieldRule({ field: path, operator: 'NOT_EQUAL', value: inner, valueType: 'REGEX' })
  }
  if (isPlainObject(inner) && Object.keys(inner).length === 1) {
    if ('$eq' in inner) return makeRule(path, 'NOT_EQUAL', inner.$eq)
    if ('$type' in inner) {
      const resolved = typeFromNumber(inner.$type)
      if (resolved !== null) {
        return createFieldRule({
          field: path,
          operator: 'DOES_NOT_HAVE_TYPE',
          valueType: resolved
        })
      }
    }
  }
  return makeCustom(path, { $not: inner })
}

/** 裸正则字面量判定（对应 HEET.aJ()：bson.Regex 与原生 re.Pattern 都算） */
function isRegexLiteral(value: Value): boolean {
  return value instanceof BSONRegExp || value instanceof RegExp
}

/** $type 的值 → FieldType；只认数字（bool 排除），未命中类型号返回 UNKNOWN（规则仍是 TYPE）。 */
function typeFromNumber(value: Value): FieldType | null {
  if (typeof value === 'boolean') return null
  if (value instanceof Int32) return fromMongoTypeId(value.valueOf())
  if (value instanceof Long) return fromMongoTypeId(value.toNumber())
  // EJSON 往返后 int32 退化为普通 number；整数值视为 Python int，小数拒绝
  if (typeof value === 'number' && Number.isInteger(value)) return fromMongoTypeId(value)
  return null
}

/** 列表/嵌套文档 stringify 并剥掉外层方括号（HEET.c() L1067-1071；当前无调用点，保留）。 */
export function stringifyScalar(value: Value): string {
  if (Array.isArray(value)) {
    const text = toShellLiteral([...value])
    return text.startsWith('[') && text.endsWith(']') ? text.slice(1, -1) : text
  }
  return toShellLiteral(value)
}

/**
 * $in / $nin / $all 以及列表标量的构造。
 * 有意偏离：不把列表 stringify 成字符串（那会产生语义损坏的往返），
 * 保留列表结构，类型推断为 ARRAY。
 */
function makeStringifiedRule(path: string, operator: Operator, value: Value): FieldRule {
  return createFieldRule({
    field: path,
    operator,
    value: Array.isArray(value) ? [...value] : value,
    valueType: inferValueType(value),
    include: true
  })
}

/** 双算子范围 → 范围规则。 */
function makeRange(path: string, operator: Operator, lower: Value, upper: Value): FieldRule {
  const rule = makeRule(path, operator, lower)
  rule.secondValue = upper
  return rule
}

/** 兜底：降级为 CUSTOM 行（HEET.a() L993）；不产生 error，值为整段条件的文本形式。 */
function makeCustom(path: string, value: Value): FieldRule {
  return createFieldRule({
    field: path,
    operator: 'CUSTOM',
    customText: toShellLiteral(value),
    valueType: 'OBJECT'
  })
}

/** {field: {$elemMatch: {...}}} → ELEM_MATCH / NOT_ELEM_MATCH 组。 */
function reduceElemMatch(path: string, op: GroupOp, inner: Value): QueryNode | null {
  if (!isPlainObject(inner)) {
    return createFieldRule({
      field: path,
      operator: 'CUSTOM',
      customText: toShellLiteral({ $elemMatch: inner }),
      valueType: 'ARRAY'
    })
  }
  const group = createQueryGroup({ op, field: path })
  for (const [key, value] of Object.entries(mergeInnerConditions(inner))) {
    const reduced = reduceField(key, value)
    if (reduced !== null) group.children.push(reduced)
  }
  return group.children.length > 0 ? group : null
}

/**
 * 把 $elemMatch 内层按"目标字段"归并条件：以 $ 开头的键是作用于元素自身的
 * 查询算子，统一挂到 <Array Element> 占位字段上；其余键是元素内的真实字段路径。
 * 归并键合并时后者覆盖前者（{**existing, **value}）。
 */
export function mergeInnerConditions(inner: OrderedDoc): OrderedDoc {
  const merged: OrderedDoc = {}
  for (const [key, value] of Object.entries(inner)) {
    let path = key.trim()
    let val = value
    if (path.startsWith('$not.')) {
      path = path.slice('$not.'.length)
      val = { $not: value }
    } else if (path.startsWith('$')) {
      path = ARRAY_ELEMENT_PLACEHOLDER
    }
    const existing = merged[path]
    if (isPlainObject(existing) && isPlainObject(val)) {
      merged[path] = { ...existing, ...val }
    } else {
      merged[path] = val
    }
  }
  return merged
}

/** 构造一条规则并推断值类型。 */
function makeRule(path: string, operator: Operator, value: Value, valueType?: FieldType): FieldRule {
  return createFieldRule({
    field: path,
    operator,
    value,
    valueType: valueType ?? inferValueType(value),
    include: true
  })
}
