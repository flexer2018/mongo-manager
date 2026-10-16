/**
 * 索引管理面板：当前集合的索引列表 / 创建 / 删除。
 * 打开或集合切换时自动加载；_id_ 索引不可删除（主进程同样拦截）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Plus, RefreshCw, Trash2, X } from 'lucide-react'
import type { IndexInfo } from '../../../../shared/types'
import { useAppStore } from '../../store/app-store'

/** 创建索引小模态：keys 与 options 均为 EJSON（兼容 shell 语法） */
function CreateIndexModal({
  db,
  coll,
  onClose
}: {
  db: string
  coll: string
  onClose(): void
}): JSX.Element {
  const [keys, setKeys] = useState('{ field: 1 }')
  const [options, setOptions] = useState('{ name: "field_1" }')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setError(null)
    setSaving(true)
    const store = useAppStore.getState()
    const connId = store.connId
    if (connId === null) {
      setSaving(false)
      setError('未连接')
      return
    }
    const result = await store.createIdx(connId, db, coll, keys.trim(), options.trim())
    setSaving(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? '创建失败')
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-8" onClick={onClose}>
      <div
        className="panel flex w-[480px] flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-semibold text-text-primary">在 {db}.{coll} 上创建索引</span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted">索引键（如 {'{ field: 1 }'}、{'{ loc: "2dsphere" }'}）</span>
            <textarea
              value={keys}
              onChange={(event) => setKeys(event.target.value)}
              spellCheck={false}
              className="mono h-16 w-full resize-none rounded border border-line bg-base p-2 text-[11px] leading-5 text-text-primary outline-none focus:border-accent-dim"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-text-muted">
              选项（可选：{'{ unique: true, sparse: true, name: "..." }'}）
            </span>
            <textarea
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              spellCheck={false}
              className="mono h-16 w-full resize-none rounded border border-line bg-base p-2 text-[11px] leading-5 text-text-primary outline-none focus:border-accent-dim"
            />
          </label>
          {error !== null && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {error}
            </div>
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-line px-3 py-1 text-xs text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="cursor-pointer rounded bg-accent px-3 py-1 text-xs font-medium text-[rgb(var(--c-on-accent))] transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '创建中…' : '创建索引'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function IndexPanel({ db, coll }: { db: string; coll: string }): JSX.Element {
  const connId = useAppStore((s) => s.connId)
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    if (connId === null) return
    setIndexes(null)
    setError(null)
    try {
      setIndexes(await useAppStore.getState().listIdx(connId, db, coll))
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
    }
  }, [connId, db, coll])

  useEffect(() => {
    void reload()
  }, [reload])

  const drop = (name: string): void => {
    if (!window.confirm(`确认删除索引 ${name}？`)) return
    const store = useAppStore.getState()
    if (connId === null) return
    void store.dropIdx(connId, db, coll, name).then((result) => {
      if (result.ok) {
        void reload()
      } else {
        setError(result.error ?? '删除失败')
      }
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex h-6 cursor-pointer items-center gap-1 rounded bg-accent px-2 text-[10px] font-semibold text-[rgb(var(--c-on-accent))] transition-colors duration-fast hover:bg-accent-bright"
        >
          <Plus size={11} /> 创建索引
        </button>
        <button
          type="button"
          title="刷新"
          onClick={() => void reload()}
          className="cursor-pointer p-1 text-text-muted transition-colors duration-fast hover:text-text-primary"
        >
          <RefreshCw size={12} />
        </button>
        <span className="ml-auto text-[10px] text-text-faint">
          {indexes !== null ? `${indexes.length} 个索引` : '加载中…'}
        </span>
      </div>
      {error !== null && (
        <div className="shrink-0 border-b border-line bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {error}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex h-7 items-center border-b border-line bg-panel px-2 text-[10px] font-medium text-text-muted">
          <div className="w-56 shrink-0">名称</div>
          <div className="min-w-0 flex-1">键</div>
          <div className="w-16 shrink-0 text-center">唯一</div>
          <div className="w-16 shrink-0 text-center">稀疏</div>
          <div className="w-10 shrink-0" />
        </div>
        {(indexes ?? []).map((index) => (
          <div
            key={index.name}
            className="group flex h-7 items-center border-b border-line/40 text-[11px] transition-colors duration-fast hover:bg-hover"
          >
            <div className="w-56 shrink-0 truncate px-2 font-medium text-text-primary" title={index.name}>
              {index.name}
            </div>
            <div className="mono min-w-0 flex-1 truncate px-2 text-text-secondary" title={index.keys}>
              {index.keys}
            </div>
            <div className="w-16 shrink-0 text-center">
              {index.unique ? <span className="text-accent">✓</span> : <span className="text-text-faint">—</span>}
            </div>
            <div className="w-16 shrink-0 text-center">
              {index.sparse ? <span className="text-accent">✓</span> : <span className="text-text-faint">—</span>}
            </div>
            <div className="flex w-10 shrink-0 justify-end pr-1">
              {index.name !== '_id_' && (
                <button
                  type="button"
                  title="删除索引"
                  onClick={() => drop(index.name)}
                  className="cursor-pointer p-0.5 text-text-faint opacity-0 transition-all duration-fast group-hover:opacity-100 hover:text-danger"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        ))}
        {indexes !== null && indexes.length === 0 && (
          <div className="py-10 text-center text-2xs text-text-muted">该集合暂无索引</div>
        )}
      </div>
      {creating && <CreateIndexModal db={db} coll={coll} onClose={() => setCreating(false)} />}
    </div>
  )
}
