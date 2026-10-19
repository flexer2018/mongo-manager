import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EJSON, Int32, Long, ObjectId } from 'bson'
import type { JSX } from 'react'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  Code2,
  GripVertical,
  Plus,
  Trash2,
  CornerDownRight,
  Play,
  X
} from 'lucide-react'
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
  applicableOperator,
  isRangeOperator,
  parseShellLiteral,
  dumps,
  isPlainObject
} from '@core'
import { useAppStore } from '../../store/app-store'
import { ConfirmDialog } from '../ConfirmDialog'

const GROUP_OPS: GroupOp[] = ['AND', 'OR', 'NOR']
const VALUE_PLACEHOLDER = 'null'

/** 结果表格 → VQB 字段栏拖放的 MIME 类型（载荷：{field, value: EJSON 文本|null}） */
export const VQB_FIELD_MIME = 'application/x-vqb-field'

/**
 * 同一父组内的子节点排序：把 from 位置的节点移到 to 位置（to 语义为目标行
 * 当前位置）。from < to 时删除后目标左移一位，插入 to-1 正好落到原目标行处。
 */
function moveChild(parent: QueryGroup, from: number, to: number): void {
  const count = parent.children.length
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) return
  const [node] = parent.children.splice(from, 1)
  parent.children.splice(from < to ? to - 1 : to, 0, node)
}

/** HTML5 DnD 上下文：拖动源（父组 + 位置）；只允许同一父组内拖动排序 */
let dragCtx: { parent: QueryGroup; index: number } | null = null

function operatorChoices(fieldType: string | null): Operator[] {
  return OPERATOR_MEMBERS.filter((op) => applicableOperator(op, fieldType as never))
}

/** 字段下拉渲染上限：schema 字段可能上千，原生 select 全量渲染会卡死 */
const FIELD_LIST_MAX = 200

/** 分段参数输入：skip/limit 数字框；proj/sort 支持从结果表格拖入字段名 */
function SegmentInput({
  label,
  value,
  onChange,
  width,
  numeric,
  onDropField
}: {
  label: string
  value: string
  onChange(value: string): void
  width: string
  numeric?: boolean
  /** 拖入字段时的处理（proj：加入/移除；sort：1 → -1 → 移除循环） */
  onDropField?(field: string): void
}): JSX.Element {
  const [dropHover, setDropHover] = useState(false)
  return (
    <label className="flex shrink-0 items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <input
        value={value}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(event) => onChange(event.target.value)}
        onDragOver={
          onDropField
            ? (event) => {
                if (!event.dataTransfer.types.includes(VQB_FIELD_MIME)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
                setDropHover(true)
              }
            : undefined
        }
        onDragLeave={() => setDropHover(false)}
        onDrop={
          onDropField
            ? (event) => {
                setDropHover(false)
                const payload = event.dataTransfer.getData(VQB_FIELD_MIME)
                if (payload === '') return
                event.preventDefault()
                event.stopPropagation()
                try {
                  const parsed = JSON.parse(payload) as { field: string }
                  onDropField(parsed.field)
                } catch {
                  /* 非法载荷忽略 */
                }
              }
            : undefined
        }
        title={
          onDropField
            ? '可从结果表格拖入字段名（再拖一次可切换/移除）'
            : undefined
        }
        className={`mono h-6 rounded border bg-base px-1.5 text-[11px] text-text-primary outline-none transition-colors duration-fast placeholder:text-text-faint focus:border-accent-dim ${width} ${
          dropHover ? 'border-accent bg-hover' : 'border-line'
        }`}
      />
    </label>
  )
}

/** 解析 proj/sort 文本（容错：空/非法返回空文档） */
function parsePartDoc(text: string): Record<string, Value> {
  if (text.trim() === '') return {}
  try {
    const parsed = parseShellLiteral(text)
    return isPlainObject(parsed) ? { ...parsed } : {}
  } catch {
    return {}
  }
}

/** chip 展示文本：proj 用 1/0，sort 用 ↑/↓；复杂表达式不可循环切换 */
function chipLabel(kind: 'proj' | 'sort', field: string, value: Value): { text: string; cyclable: boolean } {
  if (kind === 'sort') {
    if (value === 1) return { text: `${field} ↑`, cyclable: true }
    if (value === -1) return { text: `${field} ↓`, cyclable: true }
    return { text: `${field}: ${dumps(value, 0)}`, cyclable: false }
  }
  if (value === 1) return { text: `${field} 1`, cyclable: true }
  if (value === 0) return { text: `${field} 0`, cyclable: true }
  return { text: `${field}: ${dumps(value, 0)}`, cyclable: false }
}

/**
 * proj/sort 图形化编辑器：字段渲染为 chip（点击循环切换、× 移除、支持拖入字段），
 * 原始文本输入按需展开作为辅助编辑。
 */
function PartEditor({
  label,
  kind,
  text,
  entries,
  onRawChange,
  onDropField,
  onCycle,
  onRemove
}: {
  label: string
  kind: 'proj' | 'sort'
  text: string
  entries: [string, Value][]
  onRawChange(value: string): void
  onDropField(field: string): void
  onCycle(field: string): void
  onRemove(field: string): void
}): JSX.Element {
  const [dropHover, setDropHover] = useState(false)
  const [rawOpen, setRawOpen] = useState(false)
  return (
    <div
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(VQB_FIELD_MIME)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setDropHover(true)
      }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(event) => {
        setDropHover(false)
        const payload = event.dataTransfer.getData(VQB_FIELD_MIME)
        if (payload === '') return
        event.preventDefault()
        event.stopPropagation()
        try {
          const parsed = JSON.parse(payload) as { field: string }
          onDropField(parsed.field)
        } catch {
          /* 非法载荷忽略 */
        }
      }}
      className={`flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded border px-1 py-0.5 ${
        dropHover ? 'border-accent bg-hover' : 'border-transparent'
      }`}
    >
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      {entries.map(([field, value]) => {
        const info = chipLabel(kind, field, value)
        return (
          <span
            key={field}
            className="flex h-5 shrink-0 items-center gap-1 rounded border border-line bg-base pl-1.5 pr-0.5 text-[10px] text-text-primary"
          >
            <button
              type="button"
              title={info.cyclable ? '点击切换' : '复杂表达式：请展开原始文本编辑'}
              onClick={() => {
                if (info.cyclable) onCycle(field)
              }}
              className={`max-w-[160px] cursor-pointer truncate ${info.cyclable ? 'hover:text-accent' : 'cursor-default'}`}
            >
              {info.text}
            </button>
            <button
              type="button"
              title="移除"
              onClick={() => onRemove(field)}
              className="ml-0.5 cursor-pointer border-l border-line p-0.5 pl-1 text-text-faint transition-colors duration-fast hover:text-danger"
            >
              <X size={9} />
            </button>
          </span>
        )
      })}
      {entries.length === 0 && !rawOpen && (
        <span className="text-[10px] text-text-faint">拖入字段，或点击 </span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        title="切换原始文本编辑"
        onClick={() => setRawOpen(!rawOpen)}
        className={`shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-fast ${
          rawOpen ? 'text-accent' : 'text-text-faint hover:text-text-primary'
        }`}
      >
        <Code2 size={10} />
      </button>
      {rawOpen && (
        <input
          value={text}
          onChange={(event) => onRawChange(event.target.value)}
          placeholder={kind === 'proj' ? '{ field: 1, other: 0 }' : '{ field: 1, other: -1 }'}
          className="mono h-6 w-44 min-w-0 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
        />
      )}
    </div>
  )
}

/**
 * 可输入过滤的字段 combobox：过滤 + 上限渲染 + 支持手输任意字段名。
 * 下拉经 portal 渲染到 body（fixed 定位），避免被 VQB 面板的
 * overflow 滚动容器裁剪。
 */
function FieldCombo({
  value,
  options,
  onChange,
  onDropField
}: {
  value: string
  options: string[]
  onChange(field: string): void
  /** 从结果表格拖入字段：设置字段名并填充值 */
  onDropField?(field: string, value: Value | null): void
}): JSX.Element {
  const [query, setQuery] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const [dropHover, setDropHover] = useState(false)
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
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(VQB_FIELD_MIME)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setDropHover(true)
        }}
        onDragLeave={() => setDropHover(false)}
        onDrop={(event) => {
          setDropHover(false)
          const payload = event.dataTransfer.getData(VQB_FIELD_MIME)
          if (payload === '') return
          event.preventDefault()
          event.stopPropagation()
          try {
            const parsed = JSON.parse(payload) as { field: string; value: string | null }
            const dropped = parsed.value !== null ? (EJSON.parse(parsed.value) as Value) : null
            setQuery(null)
            setOpen(false)
            onDropField?.(parsed.field, dropped)
          } catch {
            /* 非法载荷忽略 */
          }
        }}
        placeholder="（字段，输入过滤）"
        className={`mono h-6 w-full rounded border bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim ${
          dropHover ? 'border-accent bg-hover' : 'border-line'
        }`}
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

  const index = parent.children.indexOf(rule)
  const move = (delta: -1 | 1): void => {
    moveChild(parent, index, index + delta)
    commit()
  }

  // 订阅 schema：采样完成后字段类型即可用于值解析（字符串字段的数字文本不转数字）
  const fieldType = useAppStore((s) => {
    const tab = s.tabs.find((item) => item.id === s.activeTabId)
    const schema = tab?.schema ?? null
    return schema !== null ? schema.typeOf(rule.field) : null
  })
  const choices = operatorChoices(fieldType)
  const isCustom = rule.operator === 'CUSTOM'
  const isTextual = rule.operator === 'TEXT_INDEX_SEARCH'
  const isRange = isRangeOperator(rule.operator)

  // 时间选择器：日期字段 / 已是 Date 值时自动出现，也可手动开关（两个值共用开关）
  const [pickerOpen, setPickerOpen] = useState(false)
  const showPicker =
    pickerOpen ||
    rule.value instanceof Date ||
    rule.secondValue instanceof Date ||
    fieldType === 'ISODATE'

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <span
        draggable
        onDragStart={(event) => {
          dragCtx = { parent, index }
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(index))
        }}
        onDragEnd={() => {
          dragCtx = null
        }}
        title="拖动调整顺序"
        className="shrink-0 cursor-grab text-text-faint transition-colors duration-fast hover:text-text-secondary active:cursor-grabbing"
      >
        <GripVertical size={11} />
      </span>
      <FieldCombo
        value={rule.field}
        options={schemaNames}
        onChange={(field) => update({ field })}
        onDropField={(field, dropped) => update({ field, value: dropped ?? null })}
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
          onChange={(event) => update({ value: textToValue(event.target.value, fieldType) })}
          placeholder={VALUE_PLACEHOLDER}
          className="mono h-6 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
        />
      )}
      {!isTextual && showPicker && (
        <input
          type="datetime-local"
          step={0.001}
          value={dateToPickerText(rule.value)}
          onChange={(event) => {
            const date = pickerTextToDate(event.target.value)
            if (date !== null) update({ value: date })
          }}
          title="选择时间（写入 ISODate）"
          className="h-6 w-28 shrink-0 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none focus:border-accent-dim"
        />
      )}
      {isRange && !isTextual && (
        <span className="shrink-0 text-[11px] text-text-faint">~</span>
      )}
      {isRange && !isTextual && (
        <input
          value={valueToText(rule.secondValue)}
          onChange={(event) => update({ secondValue: textToValue(event.target.value, fieldType) })}
          placeholder={VALUE_PLACEHOLDER}
          className="mono h-6 min-w-0 flex-1 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
        />
      )}
      {isRange && !isTextual && showPicker && (
        <input
          type="datetime-local"
          step={0.001}
          value={dateToPickerText(rule.secondValue)}
          onChange={(event) => {
            const date = pickerTextToDate(event.target.value)
            if (date !== null) update({ secondValue: date })
          }}
          title="选择上界时间（写入 ISODate）"
          className="h-6 w-28 shrink-0 rounded border border-line bg-base px-1 text-[11px] text-text-primary outline-none focus:border-accent-dim"
        />
      )}
      {!isTextual && !fieldType && (
        <button
          type="button"
          onClick={() => setPickerOpen(!pickerOpen)}
          title={pickerOpen ? '收起时间选择器' : '展开时间选择器'}
          className={`shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-fast ${
            pickerOpen ? 'text-accent' : 'text-text-faint hover:text-text-primary'
          }`}
        >
          <Calendar size={12} />
        </button>
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
        
      </label>
      <button
        type="button"
        onClick={() => move(-1)}
        disabled={index <= 0}
        title="上移"
        className="shrink-0 cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent disabled:cursor-default disabled:opacity-30"
      >
        <ChevronUp size={11} />
      </button>
      <button
        type="button"
        onClick={() => move(1)}
        disabled={index < 0 || index >= parent.children.length - 1}
        title="下移"
        className="shrink-0 cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent disabled:cursor-default disabled:opacity-30"
      >
        <ChevronDown size={11} />
      </button>
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
  if (value instanceof Date) return `ISODate("${value.toISOString()}")`
  if (value instanceof ObjectId) return `ObjectId("${value.toString()}")`
  if (Array.isArray(value)) return JSON.stringify(value)
  return String(value)
}

/** Date → datetime-local 输入值（本地时区，精确到毫秒）；非法值返回空串 */
function dateToPickerText(value: unknown): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  return (
    `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` +
    `T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}` +
    `.${pad(value.getMilliseconds(), 3)}`
  )
}

/** datetime-local 输入值 → 本地时区 Date；格式非法返回 null */
function pickerTextToDate(text: string): Date | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/)
  if (m === null) return null
  const ms = m[7] !== undefined ? Number(m[7].padEnd(3, '0')) : 0
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] !== undefined ? Number(m[6]) : 0,
    ms
  )
}

/** shell 构造器前缀（含合法单参/多参形式），命中才走受限 shell 解析 */
const SHELL_CONSTRUCTOR_RE =
  /^(?:ISODate|Date|ObjectId|NumberLong|NumberInt|NumberDecimal|UUID|BinData|Timestamp|MinKey|MaxKey)\s*\(\s*['"0-9tfn+\-.[]/i

/**
 * 白名单值解析：引号字符串 / shell 构造器 / 布尔 / null / 数字 / JSON 数组对象。
 * 关键：按 schema 字段类型决定数字文本的归属——字符串字段输入 "20260904"（不带引号）
 * 也必须保持字符串，否则会把文本主键当成数字导致查询不到数据。
 */
function textToValue(text: string, fieldType: string | null = null): Value {
  const trimmed = text.trim()
  // 显式引号：强制字符串（允许字符串形态的数字，如 "20260904"）
  const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed)
  if (quoted !== null) return quoted[2]
  if (SHELL_CONSTRUCTOR_RE.test(trimmed)) {
    try {
      return parseShellLiteral(trimmed) as Value
    } catch {
      /* fallthrough：非法构造器参数按字符串处理 */
    }
  }
  if (trimmed === '' || trimmed === 'null') return null
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  // schema 已知为字符串字段：文本原样保留，不做任何数字转换
  if (fieldType === 'STRING') return trimmed
  if (/^-?\d+$/.test(trimmed)) {
    const value = Number.parseInt(trimmed, 10)
    if (Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647) {
      return new Int32(value)
    }
    return Long.fromString(trimmed)
  }
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
  // 拖放排序：记录悬停目标行用于高亮（仅响应同一父组内发起的拖动）
  const [dropIndex, setDropIndex] = useState<number | null>(null)

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

  const index = parent !== null ? parent.children.indexOf(group) : -1
  const move = (delta: -1 | 1): void => {
    if (parent === null) return
    moveChild(parent, index, index + delta)
    mutate()
  }

  return (
    <div
      className={`rounded border border-line bg-base/60 ${depth === 0 ? '' : 'ml-4 mt-0.5'}`}
      style={depth === 0 ? undefined : { borderLeft: '2px solid #34455c' }}
    >
      <div className="flex items-center gap-1.5 px-1.5 py-1">
        {parent !== null && (
          <span
            draggable
            onDragStart={(event) => {
              dragCtx = { parent, index }
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', String(index))
            }}
            onDragEnd={() => {
              dragCtx = null
            }}
            title="拖动调整顺序"
            className="cursor-grab text-text-faint transition-colors duration-fast hover:text-text-secondary active:cursor-grabbing"
          >
            <GripVertical size={11} />
          </span>
        )}
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
          <>
            <button
              type="button"
              onClick={() => move(-1)}
              disabled={index <= 0}
              title="上移"
              className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent disabled:cursor-default disabled:opacity-30"
            >
              <ChevronUp size={11} />
            </button>
            <button
              type="button"
              onClick={() => move(1)}
              disabled={index < 0 || index >= parent.children.length - 1}
              title="下移"
              className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent disabled:cursor-default disabled:opacity-30"
            >
              <ChevronDown size={11} />
            </button>
            <button
              type="button"
              onClick={remove}
              className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>

      <div className="px-1.5 pb-1.5">
        {group.children.map((child, index) => (
          <div
            key={child.identityKey()}
            onDragOver={(event) => {
              if (dragCtx === null || dragCtx.parent !== group) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              setDropIndex(index)
            }}
            onDrop={(event) => {
              if (dragCtx === null || dragCtx.parent !== group) return
              event.preventDefault()
              moveChild(group, dragCtx.index, index)
              dragCtx = null
              setDropIndex(null)
              mutate()
            }}
            onDragEnd={() => {
              dragCtx = null
              setDropIndex(null)
            }}
            onDragLeave={() => {
              setDropIndex(null)
            }}
            className={dropIndex === index ? 'rounded bg-active/40' : undefined}
          >
            {child.kind === 'rule' ? (
              <RuleRow
                rule={child as unknown as FieldRule}
                parent={group}
                schemaNames={schemaNames}
              />
            ) : (
              <GroupBlock
                group={child as unknown as QueryGroup}
                parent={group}
                depth={depth + 1}
                schemaNames={schemaNames}
              />
            )}
          </div>
        ))}
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
  const patchActive = useAppStore((s) => s.patchActive)
  const vqbTree = activeTab?.vqbTree ?? null
  const vqbOpen = activeTab?.vqbOpen ?? false
  const schemaNames = useMemo(
    () => (activeTab?.schema !== null && activeTab?.schema !== undefined ? activeTab.schema.names() : []),
    [activeTab]
  )

  const setPart = (part: 'projectionText' | 'sortText' | 'skip' | 'limit', value: string): void => {
    if (activeTab === null) return
    if (part === 'skip' || part === 'limit') {
      const parsed = Number.parseInt(value, 10)
      patchActive({ [part]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })
      return
    }
    patchActive({ [part]: value })
  }

  /** 拖字段到 proj：没有则加入（{field: 1}）；已有保持不变（切换交给 chip 点击） */
  const dropToProjection = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.projectionText)
    if (field in doc) return
    doc[field] = 1
    patchActive({ projectionText: dumps(doc, 0) })
  }

  /** 拖字段到 sort：没有则加入升序 {field: 1} */
  const dropToSort = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.sortText)
    if (field in doc) return
    doc[field] = 1
    patchActive({ sortText: dumps(doc, 0) })
  }

  /** proj chip 点击：仅切换保留(1) ⇄ 排除(0)（移除只走 × 按钮，避免误删） */
  const cycleProjection = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.projectionText)
    doc[field] = doc[field] === 1 ? 0 : 1
    patchActive({ projectionText: dumps(doc, 0) })
  }

  const removeProjection = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.projectionText)
    delete doc[field]
    patchActive({ projectionText: Object.keys(doc).length === 0 ? '' : dumps(doc, 0) })
  }

  /** sort chip 点击：仅切换升序 ⇄ 降序（移除只走 × 按钮，避免误删） */
  const cycleSort = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.sortText)
    doc[field] = doc[field] === 1 ? -1 : 1
    patchActive({ sortText: dumps(doc, 0) })
  }

  const removeSort = (field: string): void => {
    if (activeTab === null) return
    const doc = parsePartDoc(activeTab.sortText)
    delete doc[field]
    patchActive({ sortText: Object.keys(doc).length === 0 ? '' : dumps(doc, 0) })
  }

  const projEntries = useMemo<[string, Value][]>(
    () => Object.entries(parsePartDoc(activeTab?.projectionText ?? '')),
    [activeTab?.projectionText]
  )
  const sortEntries = useMemo<[string, Value][]>(
    () => Object.entries(parsePartDoc(activeTab?.sortText ?? '')),
    [activeTab?.sortText]
  )
  const [notice, setNotice] = useState<string | null>(null)

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
  if (activeTab === null) return null

  return (
    <div className="flex h-full w-[45%] min-w-[360px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 px-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          可视化查询构建
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            if (!importFilterToVqb()) setNotice('filter 不是合法查询文档，无法导入')
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
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-2 py-1.5">
        <PartEditor
          label="proj"
          kind="proj"
          text={activeTab.projectionText}
          entries={projEntries}
          onRawChange={(value) => setPart('projectionText', value)}
          onDropField={dropToProjection}
          onCycle={cycleProjection}
          onRemove={removeProjection}
        />
        <PartEditor
          label="sort"
          kind="sort"
          text={activeTab.sortText}
          entries={sortEntries}
          onRawChange={(value) => setPart('sortText', value)}
          onDropField={dropToSort}
          onCycle={cycleSort}
          onRemove={removeSort}
        />
        <SegmentInput
          label="skip"
          value={String(activeTab.skip)}
          onChange={(value) => setPart('skip', value)}
          width="w-16"
          numeric
        />
        <SegmentInput
          label="limit"
          value={String(activeTab.limit)}
          onChange={(value) => setPart('limit', value)}
          width="w-16"
          numeric
        />
        <button
          type="button"
          disabled={activeTab?.running ?? false}
          onClick={() => {
            if (activeTab === null) return
            exportVqbToFilter()
            void useAppStore.getState().runTab(activeTab.id, { resetSkip: true })
          }}
          className="ml-auto flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded bg-accent px-3 text-[10px] font-semibold text-[rgb(var(--c-on-accent))] transition-colors duration-fast hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play size={11} /> 执行查询
        </button>
      </div>
      {notice !== null && (
        <ConfirmDialog
          title="提示"
          message={notice}
          confirmText="知道了"
          cancelText={null}
          onConfirm={() => setNotice(null)}
          onClose={() => setNotice(null)}
        />
      )}
    </div>
  )
}
