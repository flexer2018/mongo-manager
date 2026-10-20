/**
 * 库级集合统计表格：列出当前库所有集合的文档数、体积与索引信息，
 * 表头可切换排序，底部给出合计；单个集合读取失败时保留占位行并标注错误。
 */
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import type { CollectionStats } from '../../../../shared/types'
import type { WorkTab } from '../../store/app-store'
import { useAppStore } from '../../store/app-store'
import { fmtBytes } from '../../lib/format'

type SortKey = 'name' | 'count' | 'size' | 'storageSize' | 'avgObjSize' | 'nindexes' | 'totalIndexSize'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'name', label: '集合', numeric: false },
  { key: 'count', label: '文档数', numeric: true },
  { key: 'size', label: '数据大小', numeric: true },
  { key: 'storageSize', label: '存储大小', numeric: true },
  { key: 'avgObjSize', label: '平均文档', numeric: true },
  { key: 'nindexes', label: '索引数', numeric: true },
  { key: 'totalIndexSize', label: '索引大小', numeric: true }
]

/** ns（db.coll）→ 集合名：库名不含 '.'，集合名可以含，故只去掉库名前缀 */
function collOf(ns: string, db: string): string {
  return ns.startsWith(`${db}.`) ? ns.slice(db.length + 1) : ns
}

export function DbStatsPanel({ tab }: { tab: WorkTab }): JSX.Element {
  const reload = useAppStore((s) => s.loadDbStats)
  const openCollection = useAppStore((s) => s.openCollection)
  const [sortKey, setSortKey] = useState<SortKey>('size')
  const [asc, setAsc] = useState(false)

  const rows = useMemo(() => {
    const cell = (row: CollectionStats): string | number =>
      sortKey === 'name' ? collOf(row.ns, tab.db) : row[sortKey]
    return [...tab.statsRows].sort((a, b) => {
      const left = cell(a)
      const right = cell(b)
      const diff =
        typeof left === 'string' || typeof right === 'string'
          ? String(left).localeCompare(String(right))
          : left - right
      return asc ? diff : -diff
    })
  }, [tab.statsRows, tab.db, sortKey, asc])

  const total = useMemo(
    () =>
      tab.statsRows.reduce(
        (acc, row) => ({
          count: acc.count + row.count,
          size: acc.size + row.size,
          storageSize: acc.storageSize + row.storageSize,
          nindexes: acc.nindexes + row.nindexes,
          totalIndexSize: acc.totalIndexSize + row.totalIndexSize
        }),
        { count: 0, size: 0, storageSize: 0, nindexes: 0, totalIndexSize: 0 }
      ),
    [tab.statsRows]
  )

  const toggleSort = (key: SortKey): void => {
    if (key === sortKey) {
      setAsc((prev) => !prev)
      return
    }
    setSortKey(key)
    setAsc(key === 'name')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <span className="shrink-0 text-[11px] text-text-primary">集合统计</span>
        <span className="mono max-w-60 truncate text-[10px] text-text-faint">{tab.db}</span>
        <div className="flex-1" />
        <span className="shrink-0 text-[10px] text-text-muted">
          {tab.running ? '读取中…' : `${tab.statsRows.length} 个集合`}
        </span>
        {!tab.running && tab.statsLoadedAt > 0 && (
          <span className="shrink-0 text-[10px] text-text-faint">
            更新于 {new Date(tab.statsLoadedAt).toLocaleTimeString()}
          </span>
        )}
        <button
          type="button"
          disabled={tab.running}
          title="重新读取集合统计（忽略缓存）"
          onClick={() => void reload(tab.id, { force: true })}
          className="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border border-line bg-elevated px-2 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw size={11} className={tab.running ? 'animate-spin' : undefined} />
          刷新
        </button>
      </div>

      {tab.runError !== null && (
        <div className="shrink-0 border-b border-line bg-danger/10 px-2 py-1 text-[10px] text-danger">
          {tab.runError}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className={`border-b border-line px-2 py-1 font-normal ${
                    col.numeric ? 'text-right' : 'text-left'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleSort(col.key)}
                    className="cursor-pointer text-[10px] uppercase tracking-wider text-text-muted transition-colors duration-fast hover:text-text-primary"
                  >
                    {col.label}
                    {sortKey === col.key ? (asc ? ' ▲' : ' ▼') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const failed = row.error !== undefined
              const name = collOf(row.ns, tab.db)
              return (
                <tr key={row.ns} className="transition-colors duration-fast hover:bg-hover">
                  <td className="max-w-0 truncate border-b border-line/60 px-2 py-1">
                    <span
                      title="双击打开集合"
                      onDoubleClick={() => openCollection(tab.connId, tab.db, name)}
                      className="mono cursor-pointer text-text-primary transition-colors duration-fast hover:text-accent"
                    >
                      {name}
                    </span>
                    {row.capped && (
                      <span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[9px] leading-4 text-amber-300">
                        capped
                      </span>
                    )}
                    {failed && (
                      <span
                        title={row.error}
                        className="ml-1.5 inline-flex align-middle text-warning"
                      >
                        <AlertTriangle size={10} />
                      </span>
                    )}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : row.count.toLocaleString()}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : fmtBytes(row.size)}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : fmtBytes(row.storageSize)}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : fmtBytes(row.avgObjSize)}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : String(row.nindexes)}
                  </td>
                  <td className="mono border-b border-line/60 px-2 py-1 text-right text-text-secondary">
                    {failed ? '—' : fmtBytes(row.totalIndexSize)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-text-muted">
            {tab.running
              ? '读取中…'
              : tab.runError === null
                ? '当前数据库没有集合'
                : '没有可展示的统计数据'}
          </div>
        )}
      </div>

      <div className="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-panel px-2 text-[10px] text-text-muted">
        <span>合计 {rows.length} 个集合</span>
        <span>文档 {total.count.toLocaleString()}</span>
        <span>数据 {fmtBytes(total.size)}</span>
        <span>存储 {fmtBytes(total.storageSize)}</span>
        <span>
          索引 {total.nindexes} 个 · {fmtBytes(total.totalIndexSize)}
        </span>
      </div>
    </div>
  )
}
