import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { JSX } from 'react'
import { Plus, Trash2, CornerDownRight, Play } from 'lucide-react'
import {
  ARRAY_ELEMENT_PLACEHOLDER,
  FieldRule,
  GroupOp,
  Operator,
  QueryGroup,
  QueryNode,
  Value,
  createFieldRule,
  createQueryGroup,
  OPERATOR_MEMBERS,
  operatorDescription,
  applicableOperator
} from '@core'
import { useAppStore } from '../../store/app-store'

const GROUP_OPS: GroupOp[] = ['AND', 'OR', 'NOR']
const VALUE_PLACEHOLDER = 'null'

function operatorChoices(fieldType: string | null): Operator[] {
  return OPERATOR_MEMBERS.filter((op) => applicableOperator(op, fieldType as never))
}

/** 字段下拉渲染上限：schema 字段可能上千，原生 select 全量渲染会卡死 */
const FIELD_LIST_MAX = 200

/**
 * 可输入过滤的字段 combobox：过滤 + 上限渲染 + 支持手输任意字段名。
 * 下拉经 portal 渲染到 body（fixed 定位），避免被 VQB 面板的
 * overflow 滚动容器裁剪。
 */
function FieldCombo({
  value,
  options,
  onChange
}: {
  value: string
  options: string[]
  onChange(field: string): void
}): JSX.Element {
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const filter = (query ?? '').toLowerCase()
  const list = useMemo(
    () =>
      options
        .filter((name) => filter === '' || name.toLowerCase().includes(filter))
        .slice(0, FIELD_LIST_MAX),
    [options, filter]
  )
  const hidden = options.length - list.length

  const openWithRect = (): void => {
    const el = inputRef.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    setRect({ top: box.bottom + 4, left: box.left, width: box.width })
    setOpen(true)
  }

  const commit = (field: string): void => {
    onChange(field)
    setQuery(null)
    setOpen(false)
  }

  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={inputRef}
        value={query ?? value}
        onChange={(event) => {
          setQuery(event.target.value)
          onChange(event.target.value)
          openWithRect()
        }}
        onFocus={openWithRect}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        placeholder="（字段，输入过滤）"
        className="mono h-6 w-full rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
      />
      {open &&
        rect !== null &&
        createPortal(
          <div
            className="fixed z-[100] max-h-56 overflow-y-auto rounded border border-line bg-elevated shadow-xl"
            style={{ top: rect.top, left: rect.left, width: Math.max(rect.width, 220) }}
          >
            {value !== '' && !list.includes(value) && (
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(value)}
                className="flex h-6 w-full items-center px-2 text-left text-[11px] text-warning hover:bg-hover"
              >
                {value}（自定义）
              </button>
            )}
            {list.map((name) => (
              <button
                key={name}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => commit(name)}
                className={`mono flex h-6 w-full items-center truncate px-2 text-left text-[11px] transition-colors duration-fast ${
                  name === value
                    ? 'bg-active text-accent'
                    : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                }`}
              >
                {name}
              </button>
            ))}
            {list.length === 0 && value !== '' && (
              <div className="px-2 py-1 text-[10px] text-text-faint">按 Enter 使用自定义字段</div>
            )}
            {hidden > 0 && (
              <div className="border-t border-line px-2 py-1 text-[10px] text-text-faint">
                其余 {hidden} 个字段已省略，请继续输入过滤
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}

function RuleRow({
  rule,
  parent,
  schemaNames
}: {
  rule: FieldRule
  parent: QueryGroup
  schemaNames: string[]
}): JSX.Element {
  const setVqbTree = useAppStore((s) => s.setVqbTree)

  const commit = (): void => {
    const state = useAppStore.getState()
    const tree = state.tabs.find((t) => t.id === state.activeTabId)?.vqbTree ?? null
    if (tree !== null) setVqbTree(tree)
  }

  const update = (patch: Partial<FieldRule>): void => {
    Object.assign(rule, patch)
    commit()
  }

  const remove = (): void => {
    const index = parent.children.indexOf(rule)
    if (index >= 0) parent.children.splice(index, 1)
    commit()
  }

  const fieldType = useMemo(() => {
    const tab = useAppStore.getState().tabs.find((item) => item.id === useAppStore.getState().activeTabId)
    const schema = tab?.schema ?? null
    return schema !== null ? schema.typeOf(rule.field) : null
  }, [rule.field])
  const choices = operatorChoices(fieldType)
  const isCustom = rule.operator === 'CUSTOM'
  const isTextual = rule.operator === 'TEXT_INDEX_SEARCH'

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <FieldCombo
        value={rule.field}
        options={schemaNames}
        onChange={(field) => update({ field })}
      />

      <select
        value={rule.operator}
        onChange={(event) => update({ operator: event.target.value as Operator })}
        className="h-6 w-28 shrink-0 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none focus:border-accent-dim"
      >
        {choices.map((op) => (
          <option key={op} value={op}>
            {operatorDescription(op)}
          </option>
        ))}
      </select>

      {!isTextual && (
        <input
          value={valueToText(rule.value)}
          onChange={(event) => update({ value: textToValue(event.target.value) })}
          placeholder={VALUE_PLACEHOLDER}
          className="mono h-6 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
        />
      )}
      {isCustom && (
        <input
          value={rule.customText}
          onChange={(event) => update({ customText: event.target.value })}
          placeholder='自定义条件文本，如 { $size: 3 }'
          className="mono h-6 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-warning outline-none placeholder:text-text-faint focus:border-accent-dim"
        />
      )}

      <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-text-muted">
        <input
          type="checkbox"
          checked={rule.include}
          onChange={(event) => update({ include: event.target.checked })}
          className="size-3 accent-[#00d26a]"
        />
        Include
      </label>
      <button
        type="button"
        onClick={remove}
        className="shrink-0 cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-danger"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function valueToText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value)
}

/** 白名单值解析：数字/布尔/null/JSON 数组；其余按字符串 */
function textToValue(text: string): Value {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^-?\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number.parseFloat(trimmed)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed) as Value
    } catch {
      return trimmed
    }
  }
  return trimmed
}

function GroupBlock({
  group,
  parent,
  depth,
  schemaNames
}: {
  group: QueryGroup
  parent: QueryGroup | null
  depth: number
  schemaNames: string[]
}): JSX.Element {
  const setVqbTree = useAppStore((s) => s.setVqbTree)
  const isElemMatch = group.op === 'ELEM_MATCH' || group.op === 'NOT_ELEM_MATCH'

  const mutate = (): void => {
    const state = useAppStore.getState()
    const tree = state.tabs.find((t) => t.id === state.activeTabId)?.vqbTree ?? null
    if (tree !== null) setVqbTree(tree)
  }

  const addRule = (): void => {
    const field = isElemMatch ? ARRAY_ELEMENT_PLACEHOLDER : ''
    const rule = createFieldRule({ field, operator: 'EQUALS', value: null })
    group.children.push(rule)
    mutate()
  }

  const addGroup = (): void => {
    const child = createQueryGroup({ op: 'AND' })
    child.children = [createFieldRule({ field: isElemMatch ? ARRAY_ELEMENT_PLACEHOLDER : '' })]
    group.children.push(child)
    mutate()
  }

  const remove = (): void => {
    if (parent === null) return
    const index = parent.children.indexOf(group)
    if (index >= 0) parent.children.splice(index, 1)
    mutate()
  }

  return (
    <div
      className={`rounded border border-line bg-base/60 ${depth === 0 ? '' : 'ml-4 mt-0.5'}`}
      style={depth === 0 ? undefined : { borderLeft: '2px solid #34455c' }}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        {isElemMatch ? (
          <input
            value={group.field}
            onChange={(event) => {
              group.field = event.target.value
              mutate()
            }}
            className="mono h-6 w-32 rounded border border-line bg-base px-1 text-[11px] text-sky-300 outline-none focus:border-accent-dim"
          />
        ) : (
          <CornerDownRight size={12} className="text-text-faint" />
        )}
        <select
          value={group.op}
          onChange={(event) => {
            group.op = event.target.value as GroupOp
            mutate()
          }}
          className="h-6 rounded border border-line bg-base px-1 text-[10px] font-semibold uppercase text-accent outline-none focus:border-accent-dim"
        >
          {GROUP_OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
          <option value="ELEM_MATCH">ELEM_MATCH</option>
          <option value="NOT_ELEM_MATCH">NOT_ELEM_MATCH</option>
        </select>
        <div className="flex-1" />
        {parent !== null && (
          <button
            type="button"
            onClick={remove}
            className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>

      <div className="px-1.5 pb-1.5">
        {group.children.map((child) =>
          child.kind === 'rule' ? (
            <RuleRow
              key={child.identityKey()}
              rule={child as unknown as FieldRule}
              parent={group}
              schemaNames={schemaNames}
            />
          ) : (
            <GroupBlock
              key={child.identityKey()}
              group={child as unknown as QueryGroup}
              parent={group}
              depth={depth + 1}
              schemaNames={schemaNames}
            />
          )
        )}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={addRule}
            className="flex cursor-pointer items-center gap-1 text-[10px] text-text-muted transition-colors duration-fast hover:text-accent"
          >
            <Plus size={10} /> 条件
          </button>
          <button
            type="button"
            onClick={addGroup}
            className="flex cursor-pointer items-center gap-1 text-[10px] text-text-muted transition-colors duration-fast hover:text-accent"
          >
            <Plus size={10} /> 条件组
          </button>
        </div>
      </div>
    </div>
  )
}

/** 可视化查询构建器：递归组 + 规则行；与查询栏 filter 自动双向同步 */
export function VqbPanel(): JSX.Element | null {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const importFilterToVqb = useAppStore((s) => s.importFilterToVqb)
  const exportVqbToFilter = useAppStore((s) => s.exportVqbToFilter)
  const setVqbTree = useAppStore((s) => s.setVqbTree)
  const vqbTree = activeTab?.vqbTree ?? null
  const vqbOpen = activeTab?.vqbOpen ?? false
  const schemaNames = useMemo(
    () => (activeTab?.schema !== null && activeTab?.schema !== undefined ? activeTab.schema.names() : []),
    [activeTab]
  )

  // 首次打开时建一棵带空规则的树（副作用放 useEffect，不在渲染期写 store）
  useEffect(() => {
    if (vqbOpen && vqbTree === null) {
      const root = createQueryGroup({ op: 'AND', isRoot: true })
      root.children = [createFieldRule({ field: '' })]
      setVqbTree(root)
    }
  }, [vqbOpen, vqbTree, setVqbTree])

  if (!vqbOpen) return null

  const tree = vqbTree
  if (tree === null) return null

  return (
    <div className="flex h-full w-[45%] min-w-[360px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-7 shrink-0 items-center gap-2 px-2 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          可视化查询构建
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (!importFilterToVqb()) window.alert('filter 不是合法查询文档，无法导入')
          }}
          className="cursor-pointer text-[10px] text-text-muted transition-colors duration-fast hover:text-text-primary"
        >
          ← 从 filter 导入
        </button>
        <button
          type="button"
          onClick={exportVqbToFilter}
          className="cursor-pointer text-[10px] text-text-muted transition-colors duration-fast hover:text-text-primary"
        >
          导出到 filter →
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 pt-1">
        <GroupBlock group={tree} parent={null} depth={0} schemaNames={schemaNames} />
      </div>
      <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-t border-line px-2">
        <button
          type="button"
          disabled={activeTab?.running ?? false}
          onClick={() => {
            if (activeTab === null) return
            exportVqbToFilter()
            void useAppStore.getState().runTab(activeTab.id)
          }}
          className="flex h-6 cursor-pointer items-center gap-1 rounded bg-accent px-3 text-[10px] font-semibold text-[rgb(var(--c-on-accent))] transition-colors duration-fast hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={11} /> 执行查询
        </button>
      </div>
    </div>
  )
}
