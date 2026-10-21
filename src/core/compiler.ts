/**
 * 编译层：查询树 → BSON / mongosh 文本 / 完整 find 语句。
 * 归约语义与边界行为由 tests/compiler.spec.ts 固化。
 */
import { BSONRegExp } from 'bson'
import {
  ARRAY_ELEMENT_PLACEHOLDER,
  FieldRule,
  QueryGroup,
  QueryNode,
  groupIsEmpty
} from './model'
import { GroupOp, Operator, groupMongoKey, isRangeOperator, mongoOps, valueIsList } from './operators'
import { dumps, escapeRegex, parseShellLiteral } from './values'
import { typeValue, hasTypeId, mongoTypeId } from './field-types'
import { CompileError, OrderedDoc, isPlainObject, Value } from './value-model'

export { CompileError }

export interface CompileOptions {
  /** "operator" 输出 $regex + $options（默认）；"literal" 输出 /pat/i 内联正则 */
  regexStyle?: 'operator' | 'literal'
  /** 用完整元字符集转义正则（默认沿用 X6Kg.mG 的不完整集合） */
  strictRegexEscape?: boolean
  /** $type 用类型别名（如 "NumberLong"）而非类型号 */
  typeAsName?: boolean
  /** 文本输出的缩进 */
  indent?: number
}

interface ResolvedOptions {
  regexStyle: 'operator' | 'literal'
  strictRegexEscape: boolean
  typeAsName: boolean
  indent: number
}

function resolveOpts(opts?: CompileOptions): ResolvedOptions {
  const regexStyle = opts?.regexStyle ?? 'operator'
  if (regexStyle !== 'operator' && regexStyle !== 'literal') {
    throw new CompileError("regex_style 只能是 'operator' 或 'literal'")
  }
  return {
    regexStyle,
    strictRegexEscape: opts?.strictRegexEscape ?? false,
    typeAsName: opts?.typeAsName ?? false,
    indent: opts?.indent ?? 0
  }
}

/** 取用于生成键的字段路径；<Array Element> 归一为 "" */
export function stripArrayElementPlaceholder(node: QueryNode): string {
  const name = node.field.trim()
  return name === ARRAY_ELEMENT_PLACEHOLDER ? '' : name
}

// ---------------------------------------------------------------------------
// 叶子：规则行 → 条件文档
// ---------------------------------------------------------------------------

/** Python str() 的等价实现（仅覆盖正则编译用到的值类型） */
function pyStr(value: Value): string {
  if (value === null || value === undefined) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  if (typeof value === 'number') return String(value)
  return String(value)
}

/** 把用户输入归一成列表（IN / NIN / ALL） */
function asList(value: Value): Value[] {
  if (value === null || value === undefined) return []
  if (Array.isArray(value)) return [...value]
  return [value]
}

const REGEX_OPERATORS: Partial<Record<Operator, [string, string]>> = {
  CONTAINS: ['', ''],
  DOES_NOT_CONTAIN: ['', ''],
  STARTS_WITH: ['^', ''],
  DOES_NOT_START_WITH: ['^', ''],
  ENDS_WITH: ['', '$'],
  DOES_NOT_END_WITH: ['', '$']
}

function isRegexOperator(op: Operator): boolean {
  return op in REGEX_OPERATORS
}

/** 把一条规则行编译成条件文档（对应 HEET.anR()） */
export function compileRule(
  rule: FieldRule,
  options?: CompileOptions & { insideElemMatch?: boolean }
): OrderedDoc | BSONRegExp {
  const opts = resolveOpts(options)
  const op = rule.operator

  if (op === 'CUSTOM') return compileCustom(rule)

  if (op === 'TEXT_INDEX_SEARCH') return compileTextSearch(rule)

  if (op === 'TYPE' || op === 'DOES_NOT_HAVE_TYPE') {
    if (!hasTypeId(rule.valueType)) {
      throw new CompileError(`类型 ${rule.valueType} 没有 BSON 类型号，不能用于 $type`)
    }
    const alias = typeValue(rule.valueType)
    const payload: Value =
      opts.typeAsName && alias ? alias : (mongoTypeId(rule.valueType) as number)
    return op === 'TYPE' ? { $type: payload } : { $not: { $type: payload } }
  }

  if (op === 'IS_NULL') return { $eq: null }
  if (op === 'IS_NOT_NULL') return { $ne: null }

  if (op === 'EXISTS') return { $exists: true }
  if (op === 'DOES_NOT_EXIST') return { $exists: false }

  if (isRangeOperator(op)) {
    const [lowerOp, upperOp] = mongoOps(op)
    return { [lowerOp]: rule.value, [upperOp]: rule.secondValue }
  }

  if (valueIsList(op)) {
    return { [mongoOps(op)[0]]: asList(rule.value) }
  }

  if (isRegexOperator(op)) return compileRegex(rule, opts)

  const single = mongoOps(op)[0]
  return { [single || '$eq']: rule.value }
}

/** CUSTOM：用户写的原生 shell 片段 → 受限解析为真实 BSON 值 */
function compileCustom(rule: FieldRule): OrderedDoc {
  const text = (rule.customText ?? '').trim()
  if (!text) throw new CompileError('CUSTOM 操作符的值片段为空')
  let parsed: Value
  try {
    parsed = parseShellLiteral(text)
  } catch (exc) {
    throw new CompileError(`CUSTOM 片段解析失败: ${String(exc instanceof Error ? exc.message : exc)}`)
  }
  return { $eq: parsed }
}

/** TEXT_INDEX_SEARCH → $text（对应 ntjY.apq()） */
function compileTextSearch(rule: FieldRule): OrderedDoc {
  const params = rule.textSearch ?? {}
  const search = params['search']
  if (!search) throw new CompileError('text index search 的搜索词为空')
  const spec: OrderedDoc = { $search: search }
  const language = params['language']
  if (language) spec['$language'] = language
  if (params['case_sensitive']) spec['$caseSensitive'] = true
  if (params['diacritic_sensitive']) spec['$diacriticSensitive'] = true
  return { $text: spec }
}

/** 正则类操作符（对应 HEET.anR() L828-890：一律带 i 标志 + 通配锚定） */
function compileRegex(rule: FieldRule, opts: ResolvedOptions): OrderedDoc | BSONRegExp {
  const [prefix, suffix] = REGEX_OPERATORS[rule.operator] as [string, string]
  const raw = rule.value === null || rule.value === undefined ? '' : pyStr(rule.value)
  const escaped = escapeRegex(raw, opts.strictRegexEscape)

  let pattern: string
  if (prefix && suffix) pattern = `${prefix}${escaped}${suffix}`
  else if (prefix) pattern = `${prefix}${escaped}.*`
  else if (suffix) pattern = `.*${escaped}${suffix}`
  else pattern = `.*${escaped}.*`

  if (opts.regexStyle === 'literal') {
    const literal = new BSONRegExp(pattern, 'i')
    return isNegatedOp(rule.operator) ? { $not: literal } : literal
  }

  const spec: OrderedDoc = { $regex: pattern, $options: 'i' }
  return isNegatedOp(rule.operator) ? { $not: spec } : spec
}

function isNegatedOp(op: Operator): boolean {
  return (
    op === 'DOES_NOT_CONTAIN' ||
    op === 'DOES_NOT_START_WITH' ||
    op === 'DOES_NOT_END_WITH' ||
    op === 'DOES_NOT_HAVE_TYPE'
  )
}

// ---------------------------------------------------------------------------
// 组：容器 → 条件文档
// ---------------------------------------------------------------------------

/** Python 字典真值：空 {} 为假 */
function truthy(part: unknown): boolean {
  if (part === null || part === undefined) return false
  if (isPlainObject(part)) return Object.keys(part).length > 0
  return true
}

/** 把一个组编译成条件文档；返回 null 表示该组被排除/为空 */
export function compileGroup(
  group: QueryGroup,
  options?: CompileOptions & { insideElemMatch?: boolean }
): OrderedDoc | null {
  const opts = resolveOpts(options)
  // 直接用传入的组判定（不经 group.isEmpty()）：浅拷贝出来的组，其方法闭包可能指向旧对象
  if (!group.include || groupIsEmpty(group)) {
    return group.isRoot ? {} : null
  }

  const childInElemMatch = group.op === 'ELEM_MATCH' || group.op === 'NOT_ELEM_MATCH'
  const parts: (OrderedDoc | BSONRegExp)[] = []
  for (const child of activeNodes(group)) {
    let part: OrderedDoc | BSONRegExp | null
    if (child.kind === 'rule') {
      part = compileRuleChild(child as FieldRule, childInElemMatch, opts)
    } else {
      part = compileGroup(child as QueryGroup, {
        regexStyle: opts.regexStyle,
        strictRegexEscape: opts.strictRegexEscape,
        typeAsName: opts.typeAsName,
        indent: opts.indent,
        insideElemMatch: childInElemMatch
      })
    }
    if (truthy(part)) parts.push(part as OrderedDoc | BSONRegExp)
  }

  if (group.op === 'ELEM_MATCH' || group.op === 'NOT_ELEM_MATCH') {
    return wrapElemMatch(group, parts)
  }

  if (group.op === 'AND' && group.isRoot && !hasDuplicateKeys(group)) {
    // 根组 AND 且子项键不重复：直接摊平（对应 Vm0I.anR() L936-944）
    return mergeInplace(parts)
  }

  if (parts.length === 0) return {}
  return { [groupMongoKey(group.op)]: parts }
}

/** 编译一个叶子并套上字段路径 */
function compileRuleChild(
  rule: FieldRule,
  inside: boolean,
  opts: ResolvedOptions
): OrderedDoc | BSONRegExp {
  const inner = compileRule(rule, {
    regexStyle: opts.regexStyle,
    strictRegexEscape: opts.strictRegexEscape,
    typeAsName: opts.typeAsName,
    indent: opts.indent,
    insideElemMatch: inside
  })
  const path = stripArrayElementPlaceholder(rule)
  if (path) return { [path]: unwrapEquality(inner) }
  // $elemMatch 内层的占位字段：条件直接摊平进内层文档
  return mergeInplace([isPlainObject(inner) ? inner : { $eq: inner }])
}

/** {"$eq": v} 且是唯一键时脱糖成 v */
function unwrapEquality(inner: OrderedDoc | BSONRegExp): Value {
  if (isPlainObject(inner)) {
    if (Object.keys(inner).length === 1 && '$eq' in inner) return inner['$eq'] as Value
    return { ...inner }
  }
  return inner
}

/** 对应 Vm0I.aod()：子项标识是否有重复 */
function hasDuplicateKeys(group: QueryGroup): boolean {
  const keys = activeNodes(group).map((c) => identityKey(c))
  return new Set(keys).size !== keys.length
}

function identityKey(node: QueryNode): string {
  if (node.kind === 'rule') return node.field.trim()
  const group = node as QueryGroup
  return group.op === 'ELEM_MATCH' ? '$elemMatch' : groupMongoKey(group.op)
}

/** 参与编译的子项：Include 为真且非空 */
function activeNodes(group: QueryGroup): QueryNode[] {
  return group.children.filter((child) => child.include && !nodeIsEmpty(child))
}

function nodeIsEmpty(node: QueryNode): boolean {
  if (node.kind === 'rule') return node.field.trim().length === 0
  const group = node as QueryGroup
  if (!group.isRoot) return false
  return !group.children.some((child) => child.include && !nodeIsEmpty(child))
}

/** 单键条件合并进一个文档；多键/键冲突收进 $and */
export function mergeInplace(parts: (OrderedDoc | BSONRegExp)[]): OrderedDoc {
  const merged: OrderedDoc = {}
  const overflow: (OrderedDoc | BSONRegExp)[] = []
  for (const part of parts) {
    if (isPlainObject(part) && Object.keys(part).length === 1) {
      const key = Object.keys(part)[0]
      if (key in merged) {
        overflow.push({ [key]: part[key] })
      } else {
        merged[key] = part[key]
      }
    } else {
      overflow.push(part)
    }
  }
  if (overflow.length > 0) {
    const head: (OrderedDoc | BSONRegExp)[] = Object.keys(merged).length > 0 ? [merged] : []
    merged['$and'] = head.concat(overflow)
  }
  return merged
}

/** ELEM_MATCH / NOT_ELEM_MATCH 组（对应 L987-1012；保留 $eq 简写不脱糖） */
function wrapElemMatch(group: QueryGroup, parts: (OrderedDoc | BSONRegExp)[]): OrderedDoc {
  const path = group.field.trim()
  if (!path) throw new CompileError('$elemMatch 组缺少数组字段路径')
  const inner = mergeInplace(parts)
  const spec: OrderedDoc = { $elemMatch: inner }
  if (group.op === 'NOT_ELEM_MATCH') return { [path]: { $not: spec } }
  return { [path]: spec }
}

// ---------------------------------------------------------------------------
// 对外入口
// ---------------------------------------------------------------------------

/** 把查询树编译成原生 BSON 文档 */
export function toBson(root: QueryGroup, options?: CompileOptions): OrderedDoc {
  return compileGroup(root, options) ?? {}
}

/** 把查询树编译成 mongosh 风格的查询文档文本 */
export function toShell(root: QueryGroup, options?: CompileOptions): string {
  return dumps(toBson(root, options), options?.indent ?? 0)
}

function indentAll(text: string, pad: string): string {
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n')
}

/** 生成完整 shell 语句（含 .limit() 子句） */
export function toFindCommand(
  root: QueryGroup,
  collection: string,
  options?: CompileOptions & {
    projection?: OrderedDoc | null
    sort?: unknown
    limit?: number | null
  }
): string {
  const opts = resolveOpts(options)
  const ind = opts.indent
  const pad = ' '.repeat(ind + 2)
  const lines = [`db.getCollection(${JSON.stringify(collection)}).find(`]
  lines.push(indentAll(dumps(toBson(root, options), opts.indent), pad))
  if (isTruthyIterable(options?.projection)) {
    lines[lines.length - 1] += ','
    lines.push(indentAll(dumps(options?.projection as OrderedDoc, 0), pad))
  }
  lines.push(')')
  if (isTruthyIterable(options?.sort)) {
    lines.push(' '.repeat(ind) + '.sort(' + dumps(options?.sort as Value, 0) + ')')
  }
  if (options?.limit !== undefined && options?.limit !== null) {
    lines.push(' '.repeat(ind) + `.limit(${Math.trunc(options.limit)})`)
  }
  return lines.join('\n')
}

function isTruthyIterable(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return Boolean(value)
}

export type { OrderedDoc, Value }
