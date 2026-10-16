/**
 * 通栏状态栏：连接状态 + 服务器版本 | 当前集合 | 结果统计。
 * 数据全部来自 store 现有字段，不发起任何请求。
 */
import type { JSX } from 'react'
import { Database, Server } from 'lucide-react'
import { useAppStore } from '../store/app-store'

export function StatusBar(): JSX.Element {
  const connId = useAppStore((s) => s.connId)
  const connVersion = useAppStore((s) => s.connVersion)
  const connecting = useAppStore((s) => s.connecting)
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)

  return (
    <div className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-panel px-2 text-[10px] text-text-muted">
      {connId === null ? (
        <span className="flex items-center gap-1.5">
          <span
            className={`size-1.5 rounded-full ${
              connecting ? 'animate-pulse bg-warning' : 'bg-text-faint'
            }`}
          />
          {connecting ? '连接中…' : '未连接'}
        </span>
      ) : (
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <Server size={10} className="text-text-faint" />
          MongoDB {connVersion}
        </span>
      )}

      <span className="h-3 w-px bg-line" />

      {activeTab !== null ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <Database size={10} className="shrink-0 text-text-faint" />
          <span className="mono truncate">
            {activeTab.db} <span className="text-text-faint">›</span>{' '}
            <span className="text-accent-dim">{activeTab.coll}</span>
          </span>
        </span>
      ) : (
        <span>就绪 — 在左侧选择一个集合开始</span>
      )}

      <div className="flex-1" />

      {activeTab !== null && (
        <span className="flex items-center gap-3">
          {activeTab.running && <span className="animate-pulse text-warning">查询中…</span>}
          <span>本页 {activeTab.resultCount} 条</span>
          {activeTab.totalCount !== null && <span>共 {activeTab.totalCount} 条</span>}
          <span>{activeTab.elapsedMs} ms</span>
        </span>
      )}
    </div>
  )
}
