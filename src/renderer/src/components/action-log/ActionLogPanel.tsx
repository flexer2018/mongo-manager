import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Check, Copy, ScrollText, Trash2, X } from 'lucide-react'
import {
  actionLogText,
  clearLog,
  logAction,
  oneLine,
  setLogVisible,
  useLogEntries
} from '../../lib/action-log'

const SCOPE_STYLES: Record<string, string> = {
  store: 'text-sky-300',
  vqb: 'text-accent',
  editor: 'text-warning',
  error: 'text-danger',
  log: 'text-text-faint'
}

/** 内建操作日志面板：复现问题后「复制全部」贴给开发者即可还原操作时序 */
export function ActionLogPanel(): JSX.Element | null {
  const entries = useLogEntries()
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // 有新日志时滚到底部（用户往上翻看历史时不打扰）
  useEffect(() => {
    const body = bodyRef.current
    if (body === null) return
    const nearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 80
    if (nearBottom) body.scrollTop = body.scrollHeight
  }, [entries])

  const copyAll = (): void => {
    void navigator.clipboard.writeText(actionLogText()).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="fixed bottom-6 right-3 z-[200] flex h-[420px] w-[620px] max-w-[calc(100vw-24px)] flex-col rounded-lg border border-line-strong bg-panel shadow-2xl">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-2.5">
        <ScrollText size={12} className="shrink-0 text-accent" />
        <span className="text-[11px] font-semibold text-text-primary">操作日志</span>
        <span className="text-[10px] text-text-faint">{entries.length} 条</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={copyAll}
          title="复制全部日志"
          className="flex h-6 cursor-pointer items-center gap-1 rounded border border-line bg-elevated px-2 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent"
        >
          {copied ? (
            <>
              <Check size={11} className="text-accent" /> 已复制
            </>
          ) : (
            <>
              <Copy size={11} /> 复制全部
            </>
          )}
        </button>
        <button
          type="button"
          onClick={clearLog}
          title="清空日志"
          className="flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[10px] text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text-primary"
        >
          <Trash2 size={11} /> 清空
        </button>
        <button
          type="button"
          onClick={() => setLogVisible(false)}
          title="关闭（Ctrl+Shift+L）"
          className="flex h-6 cursor-pointer items-center rounded px-1 text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text-primary"
        >
          <X size={12} />
        </button>
      </div>

      <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-2 py-1.5">
        {entries.length === 0 && (
          <div className="px-1 py-2 text-[10px] text-text-faint">还没有记录，正常操作即可产生日志</div>
        )}
        {entries.map((entry) => (
          <div key={entry.seq} className="mono flex gap-2 text-[10px] leading-4 select-text">
            <span className="shrink-0 text-text-faint">{entry.seq}</span>
            <span className="shrink-0 text-text-faint">
              {(entry.at / 1000).toFixed(3)}s
            </span>
            <span className={`w-11 shrink-0 ${SCOPE_STYLES[entry.scope] ?? 'text-text-muted'}`}>
              {entry.scope}
            </span>
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-text-secondary">
              {entry.text}
            </span>
          </div>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-line px-2.5 py-1 text-[10px] text-text-faint">
        <span>复现问题后点「复制全部」，把整段日志贴给开发者</span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => logAction('log', oneLine('手动打点'))}
          className="cursor-pointer hover:text-text-primary"
        >
          打点
        </button>
      </div>
    </div>
  )
}
