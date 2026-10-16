import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import {
  ChevronDown,
  ChevronRight,
  FolderClosed,
  FolderOpen,
  Layers,
  Pencil,
  Plus,
  Table2,
  Trash2
} from 'lucide-react'
import { CollectionKind, CollectionNode } from '@core'
import { useAppStore } from '../../store/app-store'
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
  node,
  db,
  onRename
}: {
  node: CollectionNode
  db: string
  onRename(coll: string): void
}): JSX.Element {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const openCollection = useAppStore((s) => s.openCollection)
  const isActive = activeTab !== null && activeTab.db === db && activeTab.coll === node.name
  const badge = KIND_BADGE[node.kind] ?? KIND_BADGE.normal
  const isSystem = node.kind === CollectionKind.SYSTEM

  const drop = (): void => {
    if (!window.confirm(`确认删除集合 ${db}.${node.name}？其中的所有文档将永久丢失。`)) return
    void useAppStore.getState().dropColl(db, node.name)
  }

  return (
    <div
      className={`group flex h-6 w-full items-center rounded pr-1 text-xs transition-colors duration-fast ${
        isActive ? 'bg-active' : 'hover:bg-hover'
      }`}
    >
      <button
        type="button"
        onClick={() => openCollection(db, node.name)}
        className={`flex h-6 min-w-0 flex-1 cursor-pointer items-center gap-1.5 px-2 pl-7 text-left transition-colors duration-fast ${
          isActive ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        <Table2 size={11} className="shrink-0 text-text-faint" />
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
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
    </div>
  )
}

function DbRow({ name }: { name: string }): JSX.Element {
  const expanded = useAppStore((s) => s.expandedDbs.includes(name))
  const toggleDb = useAppStore((s) => s.toggleDb)
  const tree = useAppStore((s) => s.tree)
  const nodes = useMemo(
    () => (tree !== null ? collectionsOfLocal(tree, name) : []),
    [tree, name, expanded]
  )
  const [filter, setFilter] = useState('')
  const [modal, setModal] = useState<{ mode: 'create' | 'rename'; coll?: string } | null>(null)
  const visible = nodes.filter((node) => node.name.includes(filter))

  return (
    <div>
      <div className="group flex h-6 w-full items-center rounded transition-colors duration-fast hover:bg-hover">
        <button
          type="button"
          onClick={() => void toggleDb(name)}
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
          <span className="min-w-0 flex-1 truncate">{name}</span>
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
          mode={modal.mode}
          db={name}
          coll={modal.coll}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

// 局部助手，避免在组件外引用 store
function collectionsOfLocal(tree: NonNullable<ReturnType<typeof useAppStore.getState>['tree']>, db: string): CollectionNode[] {
  const node = tree.node(db)
  if (node === null) return []
  const contents = node.contents
  return [...contents.collections, ...contents.views, ...contents.system]
}

/** 左侧导航栏：连接 → 库 → 集合 三级懒加载树 */
export function NavTree(): JSX.Element {
  const connId = useAppStore((s) => s.connId)
  const databases = useAppStore((s) => s.databases)
  const collectionError = useAppStore((s) => s.collectionError)

  if (connId === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Layers size={22} className="text-text-faint" />
        <div className="text-2xs text-text-muted">
          连接一个 MongoDB 实例后
          <br />
          数据库与集合会在这里展开
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-line px-2 text-[10px] uppercase tracking-wider text-text-muted">
        数据库
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {databases.map((db) => (
          <DbRow key={db.name} name={db.name} />
        ))}
        {databases.length === 0 && (
          <div className="px-3 py-2 text-2xs text-text-muted">未加载到数据库</div>
        )}
      </div>
      {collectionError !== null && (
        <div className="shrink-0 border-t border-line bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {collectionError}
        </div>
      )}
    </div>
  )
}
