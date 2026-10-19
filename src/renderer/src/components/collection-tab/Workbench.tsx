import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Braces, Table2, Terminal, Wand2, X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'
import { QueryBar } from '../query-bar/QueryBar'
import { VqbPanel } from '../vqb/VqbPanel'
import { ResultGrid } from '../result-grid/ResultGrid'
import { QueryCodePanel } from '../query-code/QueryCodePanel'

/** 集合工作区：多 tab 页签 + 左右查询区（VQB | 编辑器，35vh）+ 结果区（≥40vh）；navToggle 渲染在页签栏行首 */
export function Workbench({ navToggle }: { navToggle?: JSX.Element }): JSX.Element {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const toggleVqb = useAppStore((s) => s.toggleVqb)
  const connections = useAppStore((s) => s.connections)
  const [view, setView] = useState<'results' | 'code'>('results')
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null
  const connColors = useMemo(
    () => new Map(connections.map((conn) => [conn.connId, conn.color])),
    [connections]
  )

  if (activeTab === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 bg-base">
        <div className="mono text-sm text-text-faint">db.{"{"}collection{"}"}.find({"{"} ... {"}"})</div>
        <div className="text-2xs text-text-muted">
          在左侧选择一个集合开始查询；支持多集合页签并行浏览
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 集合页签栏（多开）：行首为导航栏开关，右侧为统计与模式切换 */}
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-panel px-1.5">
        {navToggle}
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`group flex h-6 shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 text-[10px] transition-colors duration-fast ${
              tab.id === activeTabId
                ? 'bg-active text-accent'
                : 'text-text-muted hover:bg-hover hover:text-text-primary'
            }`}
          >
            {tab.kind === 'collection' ? (
              <span className="mono max-w-44 truncate">
                {tab.db}.
                <span className="font-semibold" style={{ color: connColors.get(tab.connId) }}>
                  {tab.coll}
                </span>
              </span>
            ) : (
              <span className="flex max-w-44 items-center gap-1 truncate">
                {tab.kind === 'sql' ? <Braces size={10} /> : <Terminal size={10} />}
                <span style={{ color: connColors.get(tab.connId) }}>
                  {tab.kind === 'sql' ? 'SQL 查询' : 'Shell 查询'}
                </span>
                <span className="truncate text-text-faint">{tab.db}</span>
              </span>
            )}
            {tab.running && <span className="size-1.5 animate-pulse rounded-full bg-warning" />}
            <X
              size={11}
              className="text-text-faint opacity-0 transition-opacity duration-fast hover:text-danger group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
            />
          </button>
        ))}

        {/* 页签栏右侧：运行统计 + 可视化构建（模式切换在查询区三段 Tab） */}
        <div className="flex-1" />
        <span className="shrink-0 text-[10px] text-text-muted">
          {activeTab.running
            ? '查询中…'
            : `${activeTab.resultCount} 条 · ${activeTab.elapsedMs} ms`}
          {activeTab.totalCount !== null && ` / 总 ${activeTab.totalCount}`}
        </span>
        <button
          type="button"
          onClick={toggleVqb}
          className={`flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded border px-2 text-[10px] transition-colors duration-fast ${
            activeTab.vqbOpen
              ? 'border-accent-dim bg-accent-subtle text-accent'
              : 'border-line bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <Wand2 size={11} />
          可视化构建
        </button>
      </div>

      {/* 查询区：左 VQB / 右编辑器，占视口 35%；独立查询编辑器不显示 VQB */}
      <div className="flex h-[35vh] min-h-[220px] shrink-0 border-b border-line">
        {activeTab.kind === 'collection' && <VqbPanel />}
        <QueryBar />
      </div>

      {/* 结果视图切换 */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line bg-panel px-2">
        <button
          type="button"
          onClick={() => setView('results')}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] transition-colors duration-fast ${
            view === 'results' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Table2 size={11} /> 结果
        </button>
        <button
          type="button"
          onClick={() => setView('code')}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] transition-colors duration-fast ${
            view === 'code' ? 'bg-active text-accent' : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Braces size={11} /> Query Code
        </button>
      </div>

      {/* 数据区：占视口 ≥40%，吃掉剩余空间 */}
      <div className="flex min-h-[40vh] flex-1 flex-col overflow-hidden">
        {view === 'results' ? <ResultGrid /> : <QueryCodePanel />}
      </div>
    </div>
  )
}
