import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Layers,
  Pencil,
  PlugZap,
  Plus,
  Table2,
  Trash2
} from 'lucide-react'
import { CollectionKind, CollectionNode } from '@core'
import { useAppStore } from '../../store/app-store'
import type { ConnEntry } from '../../store/app-store'
import { CONN_COLORS } from '../../store/app-store'
import { ConfirmDialog } from '../ConfirmDialog'
import { CollModal } from './CollModal'

/** 集合类型徽标：普通 c / 视图 v / 系统 s / 时间序列 ts / 聚簇 cl */
const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  normal: { label: 'c', cls: 'bg-accent/10 text-accent-dim' },
  view: { label: 'v', cls: 'bg-violet-500/15 text-violet-300' },
  system: { label: 's', cls: 'bg-zinc-500/15 text-zinc-400' },
  timeseries: { label: 'ts', cls: 'bg-sky-500/15 text-sky-300' },
  clustered: { label: 'cl', cls: 'bg-amber-500/15 text-amber-300' }
}

function CollectionRow({
  connId,
  color,
  node,
  db,
  onRename
}: {
  connId: string
  color: string
  node: CollectionNode
  db: string
  onRename(coll: string): void
}): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const openCollection = useAppStore((s) => s.openCollection)
  const isActive =
    activeTab !== null &&
    activeTab.connId === connId &&
    activeTab.db === db &&
    activeTab.coll === node.name
  const badge = KIND_BADGE[node.kind] ?? KIND_BADGE.normal
  const isSystem = node.kind === CollectionKind.SYSTEM

  const [confirmDrop, setConfirmDrop] = useState(false)

  const drop = (): void => {
    setConfirmDrop(true)
  }

  return (
    <div
      className={`group flex h-6 w-full items-center rounded pr-1 text-xs transition-colors duration-fast ${
        isActive ? 'bg-active' : 'hover:bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={() => openCollection(connId, db, node.name)}
        className={`flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 pl-7 text-left transition-colors duration-fast ${
          isActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <Table2 size={11} className="shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1 truncate" style={{ color }}>
          {node.name}
        </span>
        {node.kind !== CollectionKind.NORMAL && (
          <span className={`rounded px-1 text-[9px] leading-4 ${badge.cls}`}>{badge.label}</span>
        )}
      </button>
      {!isSystem && (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
          <button
            type="button"
            title="重命名集合"
            onClick={(event) => {
              event.stopPropagation()
              onRename(node.name)
            }}
            className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-accent"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title="删除集合"
            onClick={(event) => {
              event.stopPropagation()
              drop()
            }}
            className="cursor-pointer p-0.5 text-text-faint transition-colors duration-fast hover:text-danger"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {confirmDrop && (
        <ConfirmDialog
          title="删除集合"
          message={`确认删除集合 ${db}.${node.name}？其中的所有文档将永久丢失。`}
          danger
          confirmText="删除"
          confirmKeyword="delete"
          onConfirm={() => {
            setConfirmDrop(false)
            void useAppStore.getState().dropColl(connId, db, node.name)
          }}
          onClose={() => setConfirmDrop(false)}
        />
      )}
    </div>
  )
}

function DbRow({ connId, entry, name }: { connId: string; entry: ConnEntry; name: string }): JSX.Element {
  const expanded = entry.expandedDbs.includes(name)
  const toggleDb = useAppStore((s) => s.toggleDb)
  const nodes = useMemo(
    () => (entry.tree !== null ? collectionsOfLocal(entry.tree, name) : []),
    [entry.tree, name, entry.expandedDbs]
  )
  const [filter, setFilter] = useState('')
  const [modal, setModal] = useState<{ mode: 'create' | 'rename'; coll?: string } | null>(null)
  const visible = nodes.filter((node) => node.name.includes(filter))

  return (
    <div>
      <div className="group flex h-6 w-full items-center rounded transition-colors duration-fast hover:bg-hover">
        <button
          type="button"
          onClick={() => void toggleDb(connId, name)}
          className="flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 text-left text-xs text-text-primary transition-colors duration-fast"
        >
          {expanded ? (
            <ChevronDown size={12} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronRight size={12} className="shrink-0 text-text-muted" />
          )}
          {expanded ? (
            <FolderOpen size={12} className="shrink-0 text-accent-dim" />
          ) : (
            <FolderClosed size={12} className="shrink-0 text-accent-dim" />
          )}
          <span className="min-w-0 flex-1 truncate" style={{ color: entry.color }}>
            {name}
          </span>
          <span className="text-[10px] text-text-faint">{nodes.length}</span>
        </button>
        <button
          type="button"
          title="创建集合"
          onClick={() => setModal({ mode: 'create' })}
          className="mr-1 cursor-pointer p-0.5 text-text-faint opacity-0 transition-all duration-fast group-hover:opacity-100 hover:text-accent"
        >
          <Plus size={12} />
        </button>
      </div>

      {expanded && (
        <div>
          {nodes.length > 6 && (
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="过滤集合…"
              className="mx-2 mb-1 h-5 w-[calc(100%-16px)] rounded border border-line bg-base px-1.5 text-[10px] text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
            />
          )}
          {visible.map((node) => (
            <CollectionRow
              key={node.name}
              connId={connId}
              color={entry.color}
              node={node}
              db={name}
              onRename={(coll) => setModal({ mode: 'rename', coll })}
            />
          ))}
          {visible.length === 0 && (
            <div className="px-7 py-1 text-[10px] text-text-faint">无匹配集合</div>
          )}
        </div>
      )}

      {modal !== null && (
        <CollModal
          connId={connId}
          mode={modal.mode}
          db={name}
          coll={modal.coll}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

/** 连接分组：颜色点（可换色）+ 连接名 + 服务器版本 + 断开按钮，其下挂该连接的库列表 */
function ConnGroup({ entry }: { entry: ConnEntry }): JSX.Element {
  const activeConnId = useAppStore((s) => s.activeConnId)
  const setActiveConn = useAppStore((s) => s.setActiveConn)
  const setConnColor = useAppStore((s) => s.setConnColor)
  const disconnect = useAppStore((s) => s.disconnect)
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const isActive = activeConnId === entry.connId

  // 点击色盘外部（含失焦）自动关闭
  useEffect(() => {
    if (!pickerOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (pickerRef.current !== null && !pickerRef.current.contains(event.target as Node)) {
        setPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [pickerOpen])

  const [confirmDrop, setConfirmDrop] = useState(false)

  const drop = (): void => {
    setConfirmDrop(true)
  }

  return (
    <div className="mb-1">
      <div
        className={`group flex h-6 w-full items-center rounded px-2 transition-colors duration-fast ${
          isActive ? 'bg-active' : 'hover:bg-hover'
        }`}
      >
        <div className="relative shrink-0" ref={pickerRef}>
          <button
            type="button"
            title="连接颜色"
            onClick={() => setPickerOpen((open) => !open)}
            className={`block size-1.5 cursor-pointer rounded-full ${
              isActive ? 'animate-pulse' : ''
            }`}
            style={{ backgroundColor: entry.color }}
          />
          {pickerOpen && (
            <div className="absolute left-0 top-4 z-50 flex gap-1 rounded-md border border-line bg-elevated p-1.5 shadow-xl">
              {CONN_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  title={color}
                  onClick={() => {
                    setConnColor(entry.connId, color)
                    setPickerOpen(false)
                  }}
                  className="size-3.5 cursor-pointer rounded-full transition-transform duration-fast hover:scale-110"
                  style={{
                    backgroundColor: color,
                    outline:
                      color === entry.color ? `1px solid ${color}` : undefined,
                    outlineOffset: 1
                  }}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setActiveConn(entry.connId)}
          title="设为活动连接（新页签默认使用）"
          className={`flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-1.5 text-left text-xs transition-colors duration-fast ${
            isActive ? 'text-accent' : 'text-text-primary'
          }`}
        >
          <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
          <span className="shrink-0 text-[10px] text-text-faint">v{entry.version}</span>
        </button>
        <button
          type="button"
          title="断开该连接"
          onClick={drop}
          className="shrink-0 cursor-pointer p-0.5 text-text-faint opacity-0 transition-all duration-fast group-hover:opacity-100 hover:text-danger"
        >
          <PlugZap size={11} />
        </button>
      </div>

      <div>
        {entry.databases.map((db) => (
          <DbRow key={db.name} connId={entry.connId} entry={entry} name={db.name} />
        ))}
        {entry.databases.length === 0 && (
          <div className="px-7 py-1 text-[10px] text-text-faint">未加载到数据库</div>
        )}
      </div>
      {confirmDrop && (
        <ConfirmDialog
          title="断开连接"
          message={`确认断开连接「${entry.name}」？其打开的页签将一并关闭。`}
          danger
          confirmText="断开"
          onConfirm={() => {
            setConfirmDrop(false)
            void disconnect(entry.connId)
          }}
          onClose={() => setConfirmDrop(false)}
        />
      )}
    </div>
  )
}

// 局部助手，避免在组件外引用 store
function collectionsOfLocal(tree: NonNullable<ReturnType<typeof useAppStore.getState>['connections'][number]['tree']>, db: string): CollectionNode[] {
  const node = tree.node(db)
  if (node === null) return []
  const contents = node.contents
  return [...contents.collections, ...contents.views, ...contents.system]
}

/** 左侧导航栏：连接 → 库 → 集合 三级懒加载树，支持同时显示多个连接 */
export function NavTree(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  const collectionError = useAppStore((s) => s.collectionError)

  if (connections.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Layers size={22} className="text-text-faint" />
        <div className="text-2xs text-text-muted">
          连接一个 MongoDB 实例后
          <br />
          数据库与集合会在这里展开
          <br />
          支持同时连接多个实例
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line px-2 text-[10px] uppercase tracking-wider text-text-muted">
        连接 · 数据库
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {connections.map((entry) => (
          <ConnGroup key={entry.connId} entry={entry} />
        ))}
      </div>
      {collectionError !== null && (
        <div className="shrink-0 border-t border-line bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {collectionError}
        </div>
      )}
    </div>
  )
}
