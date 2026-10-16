/**
 * 查询树数据模型（纯数据，不含 UI）。
 *
 * FieldRule 为字段级条件，QueryGroup 为逻辑组容器。
 */
import { EJSON } from 'bson'
import { FieldType } from './field-types'
import { GroupOp, Operator, groupInternalName, isRangeOperator } from './operators'
import { Value } from './value-model'

/** $elemMatch 内层的字段占位符文案（Java 常量 aDG） */
export const ARRAY_ELEMENT_PLACEHOLDER = '<Array Element>'

/** 树节点公共接口（对应 _0Wf） */
export interface QueryNode {
  kind: 'rule' | 'group'
  /** 字段路径；$elemMatch 内层可用 ARRAY_ELEMENT_PLACEHOLDER */
  field: string
  /** Include 勾选框 */
  include: boolean

  identityKey(): string
  isEmpty(): boolean
}

export interface FieldRule extends QueryNode {
  kind: 'rule'
  operator: Operator
  /** 主值；范围操作符另用 secondValue */
  value: Value
  secondValue: Value
  /** 值类型；驱动 UI 值编辑器选择 */
  valueType: FieldType
  /** CUSTOM 操作符的原始 shell 片段 */
  customText: string
  /** TEXT_INDEX_SEARCH 的参数 */
  textSearch: OrderedDocValue | null
}

export interface QueryGroup extends QueryNode {
  kind: 'group'
  op: GroupOp
  children: QueryNode[]
  /** 仅 ELEM_MATCH/NOT_ELEM_MATCH 使用：目标数组字段路径 */
  field: string
  isRoot: boolean
}

type OrderedDocValue = { [key: string]: Value }

/**
 * 把独立函数绑定为节点方法。JS 方法调用不会把接收者传给首参
 * （Python 的显式 self 语义），必须用闭包捕获节点引用。
 */
function wireRule(rule: FieldRule): FieldRule {
  rule.identityKey = () => ruleIdentityKey(rule)
  rule.isEmpty = () => ruleIsEmpty(rule)
  return rule
}

function wireGroup(group: QueryGroup): QueryGroup {
  group.identityKey = () => groupIdentityKey(group)
  group.isEmpty = () => groupIsEmpty(group)
  return group
}

export function createFieldRule(init: Partial<FieldRule> = {}): FieldRule {
  return wireRule({
    kind: 'rule',
    field: init.field ?? '',
    include: init.include ?? true,
    operator: init.operator ?? 'EQUALS',
    value: init.value ?? null,
    secondValue: init.secondValue ?? null,
    valueType: init.valueType ?? 'STRING',
    customText: init.customText ?? '',
    textSearch: init.textSearch ?? null,
    identityKey: () => '',
    isEmpty: () => false
  })
}

export function createQueryGroup(init: Partial<QueryGroup> = {}): QueryGroup {
  return wireGroup({
    kind: 'group',
    field: init.field ?? '',
    include: init.include ?? true,
    op: init.op ?? 'AND',
    children: init.children ?? [],
    isRoot: init.isRoot ?? false,
    identityKey: () => '',
    isEmpty: () => false
  })
}

/** 对应 HEET.Ys()：返回字段名（去空白） */
export function ruleIdentityKey(rule: FieldRule): string {
  return rule.field.trim()
}

/** 字段名为空的行视为空，编译时跳过 */
export function ruleIsEmpty(rule: FieldRule): boolean {
  return rule.field.trim().length === 0
}

/** 范围操作符需要第二个值输入框 */
export function needsSecondValue(rule: FieldRule): boolean {
  return isRangeOperator(rule.operator)
}

/** 是否处于 $elemMatch 内层（字段名为占位符，对应 anG()） */
export function isArrayElement(rule: FieldRule): boolean {
  return rule.field.trim() === ARRAY_ELEMENT_PLACEHOLDER
}

/** 对应 Vm0I.Ys()：返回连接词内部名 */
export function groupIdentityKey(group: QueryGroup): string {
  return groupMongoKey(group.op)
}

/** mongo_key：$elemMatch 组返回 $elemMatch，其余返回内部名 */
function groupMongoKey(op: GroupOp): string {
  return op === 'ELEM_MATCH' ? '$elemMatch' : groupInternalName(op)
}

/** 对应 Vm0I.isEmpty()：非根组一律非空；根组无有效子项时为空 */
export function groupIsEmpty(group: QueryGroup): boolean {
  if (!group.isRoot) return false
  return !group.children.some((child) => child.include && !child.isEmpty())
}

export function addChild(group: QueryGroup, node: QueryNode): QueryNode {
  group.children.push(node)
  return node
}

export function insertChild(group: QueryGroup, index: number, node: QueryNode): QueryNode {
  group.children.splice(index, 0, node)
  return node
}

export function removeChild(group: QueryGroup, node: QueryNode): void {
  const index = group.children.indexOf(node)
  if (index >= 0) group.children.splice(index, 1)
}

/** 上移/下移一个子项（对应 UI 的拖拽重排序） */
export function moveChild(group: QueryGroup, node: QueryNode, delta: number): boolean {
  const index = group.children.indexOf(node)
  const target = index + delta
  if (target < 0 || target >= group.children.length) return false
  const tmp = group.children[index]
  group.children[index] = group.children[target]
  group.children[target] = tmp
  return true
}

/** 参与编译的子项：Include 为真且非空 */
export function activeChildren(group: QueryGroup): QueryNode[] {
  return group.children.filter((c) => c.include && !c.isEmpty())
}

/** 本组是否位于某个 $elemMatch 祖先之内（对应 Vm0I.anX()） */
export function insideElemMatch(group: QueryGroup): boolean {
  return !group.isRoot && (group.op === 'ELEM_MATCH' || group.op === 'NOT_ELEM_MATCH')
}

/** 深拷贝（对应 UI"复制行/复制组"）；BSON 值经 EJSON 往返保真，方法重新绑定 */
export function duplicateNode<T extends QueryNode>(node: T): T {
  const clone = EJSON.parse(EJSON.stringify(node, { relaxed: false })) as unknown as T
  return node.kind === 'rule'
    ? (wireRule(clone as unknown as FieldRule) as unknown as T)
    : (wireGroup(clone as unknown as QueryGroup) as unknown as T)
}

export interface WalkEntry {
  parent: QueryGroup
  index: number
  node: QueryNode
}

/** 深度优先遍历，产出 (父组, 下标, 节点) 三元组 */
export function* walk(root: QueryGroup): Generator<WalkEntry> {
  const stack: WalkEntry[] = root.children
    .map((child, index) => ({ parent: root, index, node: child }))
    .reverse()
  while (stack.length > 0) {
    const entry = stack.pop() as WalkEntry
    yield entry
    if (entry.node.kind === 'group') {
      const group = entry.node as QueryGroup
      const next: WalkEntry[] = group.children
        .map((child, index) => ({ parent: group, index, node: child }))
        .reverse()
      stack.push(...next)
    }
  }
}

/** 深度优先遍历，只产出节点本身（不包含根组） */
export function* iterNodes(root: QueryGroup): Generator<QueryNode> {
  for (const entry of walk(root)) yield entry.node
}
