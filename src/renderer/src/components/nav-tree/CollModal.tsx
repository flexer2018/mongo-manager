/**
 * 集合创建/重命名模态：创建支持时间序列（timeField）与聚簇选项，
 * 重命名仅改名称。保存走 store 集合管理动作（成功后自动刷新树）。
 */
import { useState } from 'react'
import type { JSX } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'

interface CollModalProps {
  connId: string
  mode: 'create' | 'rename'
  db: string
  coll?: string
  onClose(): void
}

export function CollModal({ connId, mode, db, coll, onClose }: CollModalProps): JSX.Element {
  const [name, setName] = useState(mode === 'rename' ? (coll ?? '') : '')
  const [timeSeries, setTimeSeries] = useState(false)
  const [timeField, setTimeField] = useState('timestamp')
  const [clustered, setClustered] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('集合名不能为空')
      return
    }
    setError(null)
    setSaving(true)
    const store = useAppStore.getState()
    const result =
      mode === 'create'
        ? await store.createColl(connId, db, trimmed, {
            ...(timeSeries && timeField.trim() !== '' ? { timeField: timeField.trim() } : {}),
            ...(clustered ? { clustered: true } : {})
          })
        : await store.renameColl(connId, db, coll ?? '', trimmed)
    setSaving(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? '操作失败')
    }
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-8" onClick={onClose}>
      <div
        className="panel flex w-[420px] flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-semibold text-text-primary">
            {mode === 'create' ? `在 ${db} 中创建集合` : `重命名 ${db}.${coll}`}
          </span>
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
            <span className="text-[10px] text-text-muted">集合名</span>
            <input
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
              placeholder="my_collection"
              className="mono h-7 rounded border border-line bg-base px-2 text-xs text-text-primary outline-none placeholder:text-text-faint focus:border-accent-dim"
            />
          </label>
          {mode === 'create' && (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={timeSeries}
                  onChange={(event) => setTimeSeries(event.target.checked)}
                  className="size-3 accent-[rgb(var(--c-accent))]"
                />
                时间序列集合
              </label>
              {timeSeries && (
                <label className="flex flex-col gap-1 pl-5">
                  <span className="text-[10px] text-text-muted">timeField（时间字段，必填）</span>
                  <input
                    value={timeField}
                    onChange={(event) => setTimeField(event.target.value)}
                    className="mono h-7 rounded border border-line bg-base px-2 text-xs text-text-primary outline-none focus:border-accent-dim"
                  />
                </label>
              )}
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={clustered}
                  onChange={(event) => setClustered(event.target.checked)}
                  className="size-3 accent-[rgb(var(--c-accent))]"
                />
                聚簇集合（_id 聚簇索引）
              </label>
            </>
          )}
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
            {saving ? '执行中…' : mode === 'create' ? '创建' : '重命名'}
          </button>
        </div>
      </div>
    </div>
  )
}
