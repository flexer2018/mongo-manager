/**
 * 集合统计弹窗：读取 collStats 摘要（文档数 / 体积 / 索引），
 * 底部可展开查看完整原始输出。
 */
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { EJSON } from 'bson'
import { X } from 'lucide-react'
import type { CollectionStats } from '../../../../shared/types'
import { backend } from '../../lib/api'

interface CollStatsModalProps {
  connId: string
  db: string
  coll: string
  onClose(): void
}

/** 字节数 → 可读大小 */
function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** power
  return `${power === 0 ? value.toFixed(0) : value.toFixed(2)} ${units[power]}`
}

export function CollStatsModal({ connId, db, coll, onClose }: CollStatsModalProps): JSX.Element {
  const [stats, setStats] = useState<CollectionStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    // 任何异常（含 IPC 方法缺失的同步异常）都收敛成弹窗内的错误文案，
    // 不能让异常冒泡到 React —— 否则整个应用会被卸载成白屏
    const load = async (): Promise<void> => {
      try {
        const data = await backend.collStats(connId, db, coll)
        if (!alive) return
        setStats({
          ns: typeof data.ns === 'string' && data.ns !== '' ? data.ns : `${db}.${coll}`,
          count: Number(data.count) || 0,
          size: Number(data.size) || 0,
          storageSize: Number(data.storageSize) || 0,
          avgObjSize: Number(data.avgObjSize) || 0,
          nindexes: Number(data.nindexes) || 0,
          totalIndexSize: Number(data.totalIndexSize) || 0,
          capped: data.capped === true,
          raw: typeof data.raw === 'string' ? data.raw : ''
        })
      } catch (exc) {
        if (alive) setError(exc instanceof Error ? exc.message : String(exc))
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [connId, db, coll])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const rows =
    stats === null
      ? []
      : [
          { label: '命名空间', value: stats.ns },
          { label: '文档数', value: stats.count.toLocaleString() },
          { label: '数据大小', value: fmtBytes(stats.size) },
          { label: '存储大小', value: fmtBytes(stats.storageSize) },
          { label: '平均文档大小', value: fmtBytes(stats.avgObjSize) },
          { label: '索引数量', value: String(stats.nindexes) },
          { label: '索引总大小', value: fmtBytes(stats.totalIndexSize) },
          { label: '上限集合', value: stats.capped ? '是' : '否' }
        ]

  let rawText = ''
  if (stats !== null) {
    try {
      rawText = JSON.stringify(EJSON.parse(stats.raw, { relaxed: true }), null, 2)
    } catch {
      rawText = stats.raw
    }
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-8"
      onClick={onClose}
    >
      <div
        className="panel flex w-[520px] max-w-full flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="truncate text-xs font-semibold text-text-primary">
            集合统计 · {db}.{coll}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto p-3">
          {stats === null && error === null && (
            <div className="py-6 text-center text-[11px] text-text-muted">读取集合统计中…</div>
          )}
          {error !== null && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {error}
            </div>
          )}
          {rows.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {rows.map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-[10px] text-text-muted">{row.label}</span>
                  <span className="mono min-w-0 truncate text-[11px] text-text-primary">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          )}
          {rawText !== '' && (
            <details className="rounded border border-line bg-base">
              <summary className="cursor-pointer px-2 py-1 text-[10px] text-text-muted">
                原始输出
              </summary>
              <pre className="mono max-h-64 overflow-auto px-2 pb-2 text-[10px] leading-4 text-text-secondary">
                {rawText}
              </pre>
            </details>
          )}
        </div>

        <div className="flex h-12 shrink-0 items-center justify-end border-t border-line px-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-line px-3 py-1 text-xs text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}
