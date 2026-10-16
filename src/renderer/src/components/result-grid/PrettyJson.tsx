import { useState } from 'react'
import type { JSX } from 'react'

/**
 * EJSON pretty 渲染：缩进格式化 + 语法着色 + BSON 扩展键识别 + 节点折叠。
 * 输入为 EJSON.stringify(relaxed:false) 再 JSON.parse 的纯 JSON 结构；
 * $oid / $date / $numberLong 等扩展键与值染紫色，键名浅蓝，字符串绿、数值蓝。
 * 对象/数组节点（BSON inline 除外）可点击折叠为 { … n fields } 摘要，默认展开。
 */
const BSON_KEYS = new Set([
  '$oid', '$date', '$numberLong', '$numberInt', '$numberDouble', '$numberDecimal',
  '$binary', '$uuid', '$code', '$regularExpression', '$timestamp', '$symbol',
  '$ref', '$db', '$id', '$minKey', '$maxKey', '$undefined'
])

const INDENT = '  '
/** 折叠集合的元素上限：折叠状态下超出的子节点跳过渲染（大数组性能保护） */
const COLLAPSED_RENDER_LIMIT = 50

function indentOf(depth: number): string {
  return INDENT.repeat(depth)
}

/** 叶子值的着色片段 */
function Leaf({ value }: { value: unknown }): JSX.Element {
  if (value === null) return <span className="text-bson-null">null</span>
  if (typeof value === 'boolean') return <span className="text-bson-boolean">{String(value)}</span>
  if (typeof value === 'number') {
    return <span className="text-bson-number">{String(value)}</span>
  }
  return <span className="text-bson-string break-all">{'"' + String(value) + '"'}</span>
}

/** 折叠切换控件：<pre> 内 inline 元素，不破坏等宽排版 */
function Toggle({
  expanded,
  onToggle
}: {
  expanded: boolean
  onToggle(): void
}): JSX.Element {
  return (
    <span
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
      className="cursor-pointer select-none text-text-muted transition-colors duration-fast hover:text-accent"
    >
      {expanded ? '▾ ' : '▸ '}
    </span>
  )
}

/** BSON 扩展键单行形态：{ "$oid": "…" } —— 单一文本节点，避免多子节点混排异常 */
function BsonInline({ value }: { value: Record<string, unknown> }): JSX.Element | null {
  const entries = Object.entries(value)
  if (entries.length !== 1 || !BSON_KEYS.has(entries[0][0])) return null
  const [key, inner] = entries
  if (inner === undefined) return null
  const scalar = typeof inner === 'object' && inner !== null ? JSON.stringify(inner) : String(inner)
  return (
    <span className="text-bson-date">{`{ "${key}": ${scalar} }`}</span>
  )
}

function isBsonInline(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length === 1 && BSON_KEYS.has(keys[0])
}

interface RenderProps {
  value: unknown
  path: string
  depth: number
  collapsed: Set<string>
  toggle(path: string): void
}

function PrettyNode({ value, path, depth, collapsed, toggle }: RenderProps): JSX.Element {
  // BSON 扩展形态单行显示；形态异常（值缺失等）回退到普通展开渲染
  if (isBsonInline(value)) {
    const node = <BsonInline value={value} />
    if (node !== null) return node
  }

  const isExpanded = !collapsed.has(path)

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-bson-array">[]</span>
    const pad = indentOf(depth)
    const innerPad = indentOf(depth + 1)
    if (!isExpanded) {
      return (
        <span className="text-bson-array">
          <Toggle expanded={false} onToggle={() => toggle(path)} />
          [<span className="text-text-muted">{` … ${value.length} 项 `}</span>]
        </span>
      )
    }
    const items = value.slice(0, COLLAPSED_RENDER_LIMIT)
    return (
      <>
        <Toggle expanded onToggle={() => toggle(path)} />
        <span className="text-bson-array">[</span>
        {'\n'}
        {items.map((item, index) => (
          <span key={index}>
            {innerPad}
            <PrettyNode
              value={item}
              path={`${path}[${index}]`}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
            />
            {index < value.length - 1 ? ',' : ''}
            {index === items.length - 1 && value.length > items.length
              ? `\n${innerPad}${'… ' + (value.length - items.length) + ' more'}`
              : ''}
            {'\n'}
          </span>
        ))}
        {pad}
        <span className="text-bson-array">]</span>
      </>
    )
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-bson-object">{'{}'}</span>
    const pad = indentOf(depth)
    const innerPad = indentOf(depth + 1)
    if (!isExpanded) {
      return (
        <span className="text-bson-object">
          <Toggle expanded={false} onToggle={() => toggle(path)} />
          {'{'}
          <span className="text-text-muted">{` … ${entries.length} fields `}</span>
          {'}'}
        </span>
      )
    }
    return (
      <>
        <Toggle expanded onToggle={() => toggle(path)} />
        <span className="text-bson-object">{'{'}</span>
        {'\n'}
        {entries.map(([key, item], index) => (
          <span key={key + String(index)}>
            {innerPad}
            <span className={BSON_KEYS.has(key) ? 'text-bson-regex' : 'text-bson-long'}>
              {'"' + key + '"'}
            </span>
            <span className="text-text-muted">: </span>
            <PrettyNode
              value={item}
              path={`${path}.${key}`}
              depth={depth + 1}
              collapsed={collapsed}
              toggle={toggle}
            />
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

/** 文档级便捷封装：BSON 值 → 格式化着色渲染（持有折叠状态，切换文档时重置） */
export function PrettyEjson({ ejson, pretty }: { ejson: string; pretty: boolean }): JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  if (!pretty) {
    return <span className="text-text-secondary break-all">{ejson}</span>
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(ejson)
  } catch {
    return <span className="text-danger break-all">{ejson}</span>
  }
  const toggle = (path: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }
  return (
    <PrettyNode
      value={parsed}
      path="$"
      depth={0}
      collapsed={collapsed}
      toggle={toggle}
    />
  )
}
