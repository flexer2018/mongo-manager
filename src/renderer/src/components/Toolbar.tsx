import { useState } from 'react'
import type { JSX } from 'react'
import {
  Braces,
  ChevronDown,
  Database,
  Loader2,
  Moon,
  Plug,
  PlugZap,
  Settings,
  Sun,
  Terminal
} from 'lucide-react'
import { useAppStore } from '../store/app-store'
import { ConnectDialog } from './ConnectDialog'

/** 顶部工具条：应用标识 + 连接状态灯 + 连接管理入口 + 主题切换 */
export function Toolbar(): JSX.Element {
  const connections = useAppStore((s) => s.connections)
  const activeConn = useAppStore((s) => s.connections.find((c) => c.connId === s.activeConnId) ?? null)
  const connecting = useAppStore((s) => s.connecting)
  const saved = useAppStore((s) => s.saved)
  const connect = useAppStore((s) => s.connect)
  const disconnect = useAppStore((s) => s.disconnect)
  const openQueryEditor = useAppStore((s) => s.openQueryEditor)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  const connected = connections.length > 0

  return (
    <header className="no-drag flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
      <div className="flex items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded bg-accent/15 text-accent">
          <Database size={13} />
        </span>
        <span className="text-[13px] font-semibold tracking-wide text-text-primary">
          Mongo Manager
        </span>
      </div>

      {/* 连接状态灯（绿=已连，呼吸动画） */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((open) => !open)}
          className="flex h-7 cursor-pointer items-center gap-2 rounded border border-line bg-elevated px-2.5 text-2xs text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
        >
          <span
            className={`size-2 rounded-full ${
              connecting
                ? 'animate-pulse bg-warning'
                : connected
                  ? 'animate-pulse shadow-[0_0_6px_rgba(0,210,106,0.8)]'
                  : 'bg-text-faint'
            }`}
            style={connected ? { backgroundColor: activeConn?.color } : undefined}
          />
          <span className="max-w-52 truncate">
            {connecting
              ? '连接中…'
              : connected
                ? `已连接 ${connections.length} 个 · MongoDB ${activeConn?.version ?? ''}`
                : '未连接'}
          </span>
          <ChevronDown size={12} className="text-text-muted" />
        </button>

        {pickerOpen && (
          <div className="absolute left-0 top-8 z-50 w-72 rounded-md border border-line bg-elevated py-1 shadow-xl">
            {saved.length === 0 && (
              <div className="px-3 py-2 text-2xs text-text-muted">还没有保存的连接</div>
            )}
            {saved.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPickerOpen(false)
                  void connect(item.uri, item.name, item.color)
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-2xs text-text-secondary transition-colors duration-fast hover:bg-hover hover:text-text-primary"
              >
                <Plug size={12} className="shrink-0 text-accent-dim" />
                <span className="flex-1 truncate">{item.name}</span>
                {item.color !== undefined && (
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                )}
              </button>
            ))}
            <div className="my-1 border-t border-line" />
            <button
              type="button"
              onClick={() => {
                setPickerOpen(false)
                setDialogOpen(true)
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-2xs text-text-secondary transition-colors duration-fast hover:bg-hover hover:text-text-primary"
            >
              <Settings size={12} />
              管理连接…
            </button>
          </div>
        )}
      </div>

      

      {/* 独立查询编辑器：与集合页签同级的 SQL / mongosh 编辑框 */}
      <button
        type="button"
        disabled={!connected}
        title="新增 SQL 查询编辑器页签"
        onClick={() => openQueryEditor('sql')}
        className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-2xs transition-colors duration-fast ${
          connected
            ? 'cursor-pointer border-line bg-elevated text-text-secondary hover:border-accent-dim hover:text-accent'
            : 'cursor-not-allowed border-line bg-elevated text-text-faint'
        }`}
      >
        <Braces size={12} />
        SQL 查询
      </button>
      <button
        type="button"
        disabled={!connected}
        title="新增 mongosh 查询编辑器页签"
        onClick={() => openQueryEditor('shell')}
        className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-2xs transition-colors duration-fast ${
          connected
            ? 'cursor-pointer border-line bg-elevated text-text-secondary hover:border-accent-dim hover:text-accent'
            : 'cursor-not-allowed border-line bg-elevated text-text-faint'
        }`}
      >
        <Terminal size={12} />
        Shell 查询
      </button>
<div className="flex-1" />
      <button
        type="button"
        onClick={toggleTheme}
        title={theme === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
        className="flex size-7 cursor-pointer items-center justify-center rounded border border-line bg-elevated text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
      >
        {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
      </button>

      {connecting && <Loader2 size={14} className="animate-spin text-accent" />}
      <button
        type="button"
        disabled={!connected}
        title={activeConn !== null ? `断开「${activeConn.name}」` : undefined}
        onClick={() => void disconnect()}
        className={`flex h-7 items-center gap-1.5 rounded border px-2.5 text-2xs transition-colors duration-fast ${
          connected
            ? 'cursor-pointer border-line bg-elevated text-text-secondary hover:border-danger/50 hover:text-danger'
            : 'cursor-not-allowed border-line bg-elevated text-text-faint'
        }`}
      >
        <PlugZap size={12} />
        断开
      </button>

      {dialogOpen && <ConnectDialog onClose={() => setDialogOpen(false)} />}
    </header>
  )
}
