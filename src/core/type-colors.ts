/**
 * 字段类型 → 颜色。
 *
 * 分类复用 parser.inferValueType 的 FieldType，再归并成少数几个图例类型。
 * 磁盘读写不属 core 职责，经 toDict / fromDict 由主进程或渲染进程负责持久化。
 */
import { FieldType } from './field-types'
import { inferValueType } from './parser'
import { Value } from './value-model'

/** 图例类型 → 默认配色（浅色底，黑字可读） */
export const DEFAULT_COLORS: Record<string, string> = {
  string: '#C7F2C0', // 绿：字符串
  number: '#CFE3FF', // 蓝：数值
  boolean: '#FFE9A8', // 黄：布尔
  date: '#E2D5FF', // 紫：日期
  null: '#FFC4C4', // 红：null
  objectid: '#B7E9EB', // 青：ObjectId
  array: '#FFDCB8', // 橙：数组
  object: '#E4E4E4', // 灰：子文档
  binary: '#D9C7B8', // 褐：二进制
  regex: '#F7C8DE', // 粉：正则
  other: '#FFFFFF' // 白：其他 / 未知
}

/** 图例类型的显示名（面板里那一列） */
export const DEFAULT_LABELS: Record<string, string> = {
  string: 'String',
  number: 'Number',
  boolean: 'Boolean',
  date: 'Date',
  null: 'Null',
  objectid: 'ObjectId',
  array: 'Array',
  object: 'Object',
  binary: 'Binary',
  regex: 'RegEx',
  other: '其他'
}

/** 图例顺序（面板从上到下 = 插入顺序） */
export const PALETTE_TYPES: readonly string[] = Object.keys(DEFAULT_COLORS)

/** 每个图例类型包含哪些 FieldType（先到先得，见反向表构造） */
const FIELD_TYPES_BY_KIND: Record<string, readonly FieldType[]> = {
  string: [
    'STRING', 'SYMBOL', 'CODE', 'CODE_WITH_SCOPE', 'CODEWSCOPE', 'FUNCTION',
    'ALL_TEXT_FIELDS', 'LUUID', 'CSUUID', 'JUUID', 'PYUUID', 'UUID'
  ],
  number: [
    'NUMBER', 'NUMBER_INT', 'NUMBER_LONG', 'NUMBER_DECIMAL',
    'NAN', 'INFINITY', 'PLUS_INFINITY', 'MINUS_INFINITY'
  ],
  boolean: ['BOOLEAN', 'TRUE', 'FALSE'],
  date: ['DATE', 'ISODATE', 'TIMESTAMP'],
  null: ['NULL', 'UNDEFINED'],
  objectid: ['OBJECT_ID'],
  array: ['ARRAY', 'ARRAY_DOCUMENT'],
  object: [
    'OBJECT', 'DOCUMENT', 'DBREF', 'MIN_KEY', 'MAX_KEY', 'MIN_KEY_BRACE', 'MAX_KEY_BRACE'
  ],
  binary: ['BINARY', 'HEXADECIMAL'],
  regex: ['REGEX'],
  other: ['UNKNOWN', 'MIXED', 'MULTIPLE', 'COLLECTION', 'TIMESERIES_COLLECTION', 'CLUSTERED_COLLECTION']
}

/** FieldType → 图例类型；未列出的（理论上不该有）落到 "other" */
export const KIND_BY_FIELD_TYPE: Record<string, string> = {}
for (const [kind, fieldTypes] of Object.entries(FIELD_TYPES_BY_KIND)) {
  for (const fieldType of fieldTypes) {
    if (!(fieldType in KIND_BY_FIELD_TYPE)) KIND_BY_FIELD_TYPE[fieldType] = kind
  }
}

/** 把一个 BSON 值归到图例类型（string / number / …） */
export function valueKind(value: Value): string {
  // 裸字节数组在表格里按 binary 着色
  if (value instanceof Uint8Array) return 'binary'
  return KIND_BY_FIELD_TYPE[inferValueType(value)] ?? 'other'
}

/** 图例里的一行：类型 + 颜色 + 是否参与着色 */
export interface TypeColor {
  key: string
  label: string
  color: string
  enabled: boolean
}

interface PaletteJson {
  enabled: boolean
  types: Record<string, { color: string; enabled: boolean }>
}

/** 字段类型颜色表（可在多个数据页签之间共享，可 JSON 序列化） */
export class TypePalette {
  private entries: TypeColor[]

  /** 总开关（面板顶部的"启用字段着色"） */
  private globalEnabled = true

  constructor(entries?: readonly TypeColor[]) {
    this.entries = entries
      ? entries.map((entry) => ({ ...entry }))
      : TypePalette.defaultEntries()
  }

  private static defaultEntries(): TypeColor[] {
    return Object.entries(DEFAULT_COLORS).map(([key, color]) => ({
      key,
      label: DEFAULT_LABELS[key] ?? key,
      color,
      enabled: true
    }))
  }

  /** 从 JSON 还原；格式坏了保持默认（不抛异常） */
  static fromJson(text: string): TypePalette {
    try {
      const data = JSON.parse(text) as unknown
      return TypePalette.fromDict(data)
    } catch {
      return new TypePalette()
    }
  }

  static fromDict(data: unknown): TypePalette {
    const palette = new TypePalette()
    if (data === null || typeof data !== 'object') return palette
    const record = data as Partial<PaletteJson>
    palette.globalEnabled = Boolean(record.enabled ?? true)
    const stored = record.types
    if (stored !== null && typeof stored === 'object') {
      for (const entry of palette.entries) {
        const saved = (stored as Record<string, { color?: unknown; enabled?: unknown }>)[entry.key]
        if (saved === null || typeof saved !== 'object') continue
        if (typeof saved.color === 'string' && saved.color) entry.color = saved.color
        entry.enabled = Boolean(saved.enabled ?? entry.enabled)
      }
    }
    return palette
  }

  toDict(): PaletteJson {
    return {
      enabled: this.globalEnabled,
      types: Object.fromEntries(
        this.entries.map((entry) => [entry.key, { color: entry.color, enabled: entry.enabled }])
      )
    }
  }

  /** 图例行（副本，改副本不会影响配色表本身） */
  getEntries(): TypeColor[] {
    return this.entries.map((entry) => ({ ...entry }))
  }

  get(kind: string): TypeColor | null {
    return this.entries.find((entry) => entry.key === kind) ?? null
  }

  labelOf(kind: string): string {
    return this.get(kind)?.label ?? kind
  }

  kindOf(value: Value): string {
    return valueKind(value)
  }

  /** 该类型当前生效的颜色；未启用（或总开关关掉）返回 null */
  colorOfKind(kind: string): string | null {
    if (!this.globalEnabled || !kind) return null
    const entry = this.get(kind)
    return entry !== null && entry.enabled ? entry.color : null
  }

  /** 一个值对应的单元格底色；null 表示不着色 */
  colorFor(value: Value): string | null {
    return this.colorOfKind(valueKind(value))
  }

  setGlobalEnabled(enabled: boolean): void {
    this.globalEnabled = Boolean(enabled)
  }

  isEnabled(): boolean {
    return this.globalEnabled
  }

  setEnabled(kind: string, enabled: boolean): boolean {
    const entry = this.get(kind)
    if (entry === null) return false
    entry.enabled = Boolean(enabled)
    return true
  }

  setColor(kind: string, color: string): boolean {
    const entry = this.get(kind)
    if (entry === null || !color) return false
    entry.color = color
    return true
  }

  toggle(kind: string): boolean {
    const entry = this.get(kind)
    if (entry === null) return false
    entry.enabled = !entry.enabled
    return true
  }

  /** 恢复默认配色与默认勾选（总开关也打开） */
  reset(): void {
    this.entries = TypePalette.defaultEntries()
    this.globalEnabled = true
  }
}
