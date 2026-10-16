import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Braces, Pencil, Plus, Table2, Trash2, X, Zap } from 'lucide-react'
import { EJSON, Int32, Long } from 'bson'
import { Value, isPlainObject } from '@core'
import { useAppStore } from '../../store/app-store'
import { VQB_FIELD_MIME } from '../vqb/VqbPanel'
import { PrettyEjson } from './PrettyJson'
import { ShellJsonDocument, mongoshText } from './ShellJsonView'
import { DocEditModal } from './DocEditModal'
import { IndexPanel } from './IndexPanel'
import { PaginationBar } from './PaginationBar'

/** 组装拖放载荷：字段名 + EJSON 序列化的单元格值（null 表示只带字段名） */
function fieldDragPayload(field: string, value: Value | null): string {
  return JSON.stringify({
    field,
    value: value === null || value === undefined ? null : EJSON.stringify(value, { relaxed: false })
  })
}

/** 值 → 展示文本 + BSON 类型（用于着色） */
function renderValue(value: Value): { text: string; kind: string } {
  if (value === null) return { text: 'null', kind: 'null' }
  if (typeof value === 'boolean') return { text: String(value), kind: 'boolean' }
  if (value instanceof Int32) return { text: String(value.valueOf()), kind: 'int' }
  if (value instanceof Long) return { text: String(value.toString()), kind: 'long' }
  if (typeof value === 'number') return { text: String(value), kind: 'double' }
  if (value instanceof Date)
    return { text: value.toISOString().replace('T', ' ').slice(0, 23), kind: 'date' }
  if (typeof value === 'string') return { text: value, kind: 'string' }
  if (Array.isArray(value)) return { text: `[${value.length}]`, kind: 'array' }
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys[0] === '$oid') return { text: String(value.$oid), kind: 'objectid' }
    return { text: `{${keys.length}}`, kind: 'object' }
  }
  return { text: String(value), kind: 'other' }
}

const KIND_COLOR: Record<string, string> = {
  string: 'text-bson-string',
  int: 'text-bson-number',
  long: 'text-bson-long',
  double: 'text-bson-double',
  boolean: 'text-bson-boolean',
  date: 'text-bson-date',
  null: 'text-bson-null',
  objectid: 'text-bson-objectid',
  array: 'text-bson-array',
  object: 'text-bson-object'
}

/** 表格布局常量：列数上限 / 最小列宽（性能与可读性的平衡点） */
const MAX_COLUMNS = 50
const HEADER_HEIGHT = 28
const COLUMN_MIN_WIDTH = 120
const ID_MIN_WIDTH = 160
const ACTIONS_WIDTH = 56

/** 从一页文档收集列名（保持出现顺序，O(n) 去重，最多 MAX_COLUMNS 列） */
function collectColumns(docs: Value[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const doc of docs) {
    if (!isPlainObject(doc)) continue
    for (const key of Object.keys(doc)) {
      if (seen.has(key)) continue
      seen.add(key)
      columns.push(key)
      if (columns.length >= MAX_COLUMNS) return columns
    }
  }
  return columns
}

function Cell({ doc, column }: { doc: Value; column: string }): JSX.Element {
  const raw: Value | null = isPlainObject(doc)
    ? ((doc as Record<string, Value>)[column] ?? null)
    : null
  const info = raw !== null ? renderValue(raw) : null
  return (
    <div
      className="cursor-grab truncate px-2 py-1 active:cursor-grabbing"
      title={info?.text === undefined ? `${column}（拖入 VQB 字段栏）` : `${info?.text}（拖入 VQB 字段栏）`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy'
        event.dataTransfer.setData(VQB_FIELD_MIME, fieldDragPayload(column, raw))
      }}
    >
      <span className={info !== null ? (KIND_COLOR[info.kind] ?? '') : 'text-text-faint'}>
        {info?.text ?? ''}
      </span>
    </div>
  )
}

/** JSON 视图：默认 mongosh 风格，可切 EJSON */
function JsonView(): JSX.Element {
  const docs = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.docs ?? [])
  const [style, setStyle] = useState<'mongosh' | 'ejson'>('mongosh')
  const texts = useMemo(
    () => docs.map((doc) => EJSON.stringify(doc, { relaxed: false })),
    [docs]
  )
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-6 shrink-0 items-center gap-1 border-b border-line px-2">
        <button
          type="button"
          onClick={() => setStyle('mongosh')}
          className={`h-5 cursor-pointer rounded px-1.5 text-[10px] transition-colors duration-fast ${
            style === 'mongosh' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          mongosh
        </button>
        <button
          type="button"
          onClick={() => setStyle('ejson')}
          className={`h-5 cursor-pointer rounded px-1.5 text-[10px] transition-colors duration-fast ${
            style === 'ejson' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          EJSON
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {docs.length === 0 && <div className="p-2 text-2xs text-text-muted">— 无结果 —</div>}
        {docs.map((doc, index) => (
          <div key={index} className="mb-3">
            <div className="mb-0.5 text-[10px] text-text-faint">Document {index + 1}</div>
            <pre className="mono whitespace-pre text-[11px] leading-5 select-text">
              {style === 'mongosh' ? (
                <ShellJsonDocument doc={doc} />
              ) : (
                <PrettyEjson ejson={texts[index]} pretty />
              )}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 文档详情：居中模态弹窗，mongosh（默认）/ EJSON 双风格 + 复制 + 编辑 + 上下条切换 */
function DocModal({
  doc,
  index,
  total,
  onNavigate,
  onClose,
  onEdit
}: {
  doc: Value
  index: number
  total: number
  onNavigate(delta: number): void
  onClose(): void
  onEdit(doc: Value): void
}): JSX.Element {
  const [copied, setCopied] = useState(false)
  const [style, setStyle] = useState<'mongosh' | 'ejson'>('mongosh')
  // 自动换行：长字段值（长字符串/长 ObjectId 串）不横向滚动，折行展示
  const [wrap, setWrap] = useState(false)
  const ejsonText = useMemo(() => EJSON.stringify(doc, { relaxed: false }), [doc])
  const copyText = style === 'mongosh' ? mongoshText(doc) : ejsonText

  // 模态打开期间 ←/→ 键切换上一条/下一条
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'ArrowLeft') onNavigate(-1)
      else if (event.key === 'ArrowRight') onNavigate(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNavigate])

  const copy = (): void => {
    void navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-8" onClick={onClose}>
      <div
        className="panel flex max-h-full w-[880px] max-w-[92vw] flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-text-primary">文档详情</span>
            <span className="text-[10px] text-text-muted">
              第 {index + 1} / {total} 条
            </span>
            <button
              type="button"
              title="上一条（←）"
              disabled={index <= 0}
              onClick={() => onNavigate(-1)}
              className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors duration-fast enabled:hover:border-accent-dim enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <button
              type="button"
              title="下一条（→）"
              disabled={index >= total - 1}
              onClick={() => onNavigate(1)}
              className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors duration-fast enabled:hover:border-accent-dim enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStyle('mongosh')}
              className={`h-6 cursor-pointer rounded border px-2 text-[10px] transition-colors duration-fast ${
                style === 'mongosh'
                  ? 'border-accent-dim bg-accent-subtle text-accent'
                  : 'border-line text-text-secondary hover:text-text-primary'
              }`}
            >
              mongosh
            </button>
            <button
              type="button"
              onClick={() => setStyle('ejson')}
              className={`h-6 cursor-pointer rounded border px-2 text-[10px] transition-colors duration-fast ${
                style === 'ejson'
                  ? 'border-accent-dim bg-accent-subtle text-accent'
                  : 'border-line text-text-secondary hover:text-text-primary'
              }`}
            >
              EJSON
            </button>
            <button
              type="button"
              onClick={() => setWrap(!wrap)}
              title="切换自动换行"
              className={`h-6 cursor-pointer rounded border px-2 text-[10px] transition-colors duration-fast ${
                wrap
                  ? 'border-accent-dim bg-accent-subtle text-accent'
                  : 'border-line text-text-secondary hover:text-text-primary'
              }`}
            >
              自动换行
            </button>
            <button
              type="button"
              onClick={copy}
              className="cursor-pointer rounded border border-line px-2 py-0.5 text-[10px] text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
            >
              {copied ? '已复制' : '复制'}
            </button>
            <button
              type="button"
              onClick={() => onEdit(doc)}
              className="cursor-pointer rounded border border-line px-2 py-0.5 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent"
            >
              编辑
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <pre
            className={`mono text-[11px] leading-5 select-text ${
              wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
            }`}
          >
            {style === 'mongosh' ? <ShellJsonDocument doc={doc} /> : <PrettyEjson ejson={ejsonText} pretty />}
          </pre>
        </div>
      </div>
    </div>
  )
}

/** 结果区：虚拟化表格 / JSON 双视图，行点击打开详情，行内可编辑/删除，可插入文档 */
export function ResultGrid(): JSX.Element {
  const docs = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.docs ?? [])
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const [mode, setMode] = useState<'table' | 'json' | 'indexes'>('table')
  const [drawerIndex, setDrawerIndex] = useState<number | null>(null)
  const [editor, setEditor] = useState<{ mode: 'edit' | 'insert'; doc: Value | null } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const drawerDoc = drawerIndex !== null ? (docs[drawerIndex] ?? null) : null

  const columns = useMemo(() => collectColumns(docs), [docs])

  const deleteRow = (doc: Value): void => {
    const id = (doc as Record<string, unknown>)._id
    if (id === undefined) {
      window.alert('该文档没有 _id，无法定位删除')
      return
    }
    if (!window.confirm('确认删除该文档？此操作不可撤销。')) return
    void useAppStore.getState().deleteDoc(EJSON.stringify(id))
  }
  const rowVirtualizer = useVirtualizer({
    count: docs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 28,
    overscan: 12,
    scrollMargin: HEADER_HEIGHT
  })

  // 表头与数据行共享同一网格模板：每列最小宽（_id 更宽），空间富余时均分拉伸，
  // 不足时按最小宽撑开总宽 → 产生原生水平滚动条
  const gridTemplate = useMemo(
    () =>
      columns
        .map((column) => `minmax(${column === '_id' ? ID_MIN_WIDTH : COLUMN_MIN_WIDTH}px, 1fr)`)
        .concat(`${ACTIONS_WIDTH}px`)
        .join(' '),
    [columns]
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <button
          type="button"
          onClick={() => setMode('table')}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] transition-colors duration-fast ${
            mode === 'table' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Table2 size={11} /> 表格
        </button>
        <button
          type="button"
          onClick={() => setMode('json')}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] transition-colors duration-fast ${
            mode === 'json' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Braces size={11} /> JSON
        </button>
        <button
          type="button"
          onClick={() => setMode('indexes')}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] transition-colors duration-fast ${
            mode === 'indexes' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Zap size={11} /> 索引
        </button>
        {mode !== 'indexes' && (
          <div className="ml-auto">
            <button
              type="button"
              onClick={() => setEditor({ mode: 'insert', doc: null })}
              className="flex h-6 cursor-pointer items-center gap-1 rounded bg-accent px-2 text-[10px] font-semibold text-[rgb(var(--c-on-accent))] transition-colors duration-fast hover:bg-accent-bright"
            >
              <Plus size={11} /> 插入文档
            </button>
          </div>
        )}
      </div>

      {mode === 'indexes' && activeTab !== null ? (
        <IndexPanel db={activeTab.db} coll={activeTab.coll} />
      ) : (
        <>
          {mode === 'json' ? (
            <JsonView />
          ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* 单一滚动容器承担双向滚动；w-max + min-w-full 让内容宽与容器宽取大者 */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
            <div className="w-max min-w-full">
              {/* 吸顶表头：与数据行共享 gridTemplate，纵向滚动时固定，横向随内容同步 */}
              <div
                className="sticky top-0 z-10 grid h-7 items-center border-b border-line bg-panel text-[10px] font-medium text-text-muted"
                style={{ gridTemplateColumns: gridTemplate }}
              >
                {columns.map((column) => (
                  <div
                    key={column}
                    className="min-w-0 cursor-grab truncate px-2 active:cursor-grabbing"
                    title={`${column}（拖入 VQB 字段栏）`}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'copy'
                      event.dataTransfer.setData(VQB_FIELD_MIME, fieldDragPayload(column, null))
                    }}
                  >
                    {column}
                  </div>
                ))}
                <div />
              </div>
              <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const doc = docs[virtualRow.index]
                  return (
                    <div
                      key={virtualRow.key}
                      onClick={() => setDrawerIndex(virtualRow.index)}
                      className="group absolute left-0 grid w-full cursor-pointer items-center border-b border-line/40 text-left transition-colors duration-fast hover:bg-hover"
                      style={{
                        height: virtualRow.size,
                        gridTemplateColumns: gridTemplate,
                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`
                      }}
                    >
                      {columns.map((column) => (
                        <div key={column} className="min-w-0 border-l border-line/20 first:border-l-0">
                          <Cell doc={doc} column={column} />
                        </div>
                      ))}
                      {/* 操作列：横向滚动时吸附在右侧，避免被滚出视口 */}
                      <div className="sticky right-0 flex items-center justify-end gap-0.5 bg-base pr-1 opacity-0 transition-opacity duration-fast group-hover:bg-hover group-hover:opacity-100">
                        <button
                          type="button"
                          title="编辑文档"
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditor({ mode: 'edit', doc })
                          }}
                          className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          title="删除文档"
                          onClick={(event) => {
                            event.stopPropagation()
                            deleteRow(doc)
                          }}
                          className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-danger"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
              {docs.length === 0 && (
                <div className="py-10 text-center text-2xs text-text-muted">无数据</div>
              )}
            </div>
          </div>
        </div>
          )}
          {activeTab !== null && <PaginationBar tab={activeTab} />}
        </>
      )}

      {drawerDoc !== null && drawerIndex !== null && (
        <DocModal
          doc={drawerDoc}
          index={drawerIndex}
          total={docs.length}
          onNavigate={(delta) => {
            const next = drawerIndex + delta
            if (next >= 0 && next < docs.length) setDrawerIndex(next)
          }}
          onClose={() => setDrawerIndex(null)}
          onEdit={(doc) => {
            setDrawerIndex(null)
            setEditor({ mode: 'edit', doc })
          }}
        />
      )}
      {editor !== null && (
        <DocEditModal
          mode={editor.mode}
          doc={editor.doc}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
