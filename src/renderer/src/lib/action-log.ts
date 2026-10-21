/**
 * 内建操作日志（排查用）：环形缓冲 + 订阅式读取。
 *
 * 目的：用户按自己的操作复现问题时，把这一段日志整段复制出来即可还原
 * 「谁在什么时候把 filter / VQB 树改成了什么」的时序，无需打开 DevTools。
 */
import { useSyncExternalStore } from 'react'

export interface LogEntry {
  /** 自增序号 */
  seq: number
  /** 距页面启动的毫秒数 */
  at: number
  /** 来源模块：store / vqb / editor / error */
  scope: string
  text: string
}

/** 保留最近多少条（够还原一次复现流程，又不至于吃内存） */
const MAX_ENTRIES = 800
const startedAt = Date.now()

let seq = 0
let entries: LogEntry[] = []
let visible = false
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** 单行化 + 截断：日志一条一行，便于对比时序 */
export function oneLine(text: string, max = 320): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…(共 ${flat.length} 字)` : flat
}

/** 把任意值压成一行短文本（BSON 值 / 树结构都能用） */
export function briefValue(value: unknown): string {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return oneLine(String(text), 400)
  } catch {
    return oneLine(String(value))
  }
}

/** 记录一条操作日志 */
export function logAction(scope: string, text: string, extra?: unknown): void {
  seq += 1
  const line = extra === undefined ? text : `${text} │ ${briefValue(extra)}`
  const next = entries.concat({ seq, at: Date.now() - startedAt, scope, text: line })
  entries = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next
  // 同时打到控制台，习惯 DevTools 的可以直接看
  console.debug(`[${scope}] ${line}`)
  emit()
}

/** 查询树的最小结构（只读，避免 core 类型依赖） */
interface TreeNodeLike {
  kind?: string
  field?: string
  op?: string
  operator?: string
  include?: boolean
  children?: TreeNodeLike[]
}

/** 紧凑描述一棵查询树：AND[ gid:EQUALS crawled:EQUALS[排除] ] */
export function describeTree(nodes: readonly TreeNodeLike[] | null | undefined): string {
  if (nodes === null || nodes === undefined) return '无树'
  const parts = nodes.map((node) => {
    if (node.kind === 'group') {
      const head = node.field ? `${node.op}(${node.field})` : String(node.op ?? 'GROUP')
      return `${head}{${describeTree(node.children)}}`
    }
    const name = node.field && node.field.trim() !== '' ? node.field : '<空字段>'
    // 与编译层的判定对齐：include 只要不是 true 就不参与编译（compiler.activeNodes）
    return `${name}:${node.operator ?? '?'}${node.include !== true ? '[排除]' : ''}`
  })
  return `[${parts.join(' ')}]`
}

function formatAt(ms: number): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0')
  const date = new Date(startedAt + ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3
  )}`
}

/** 订阅日志条目（组件内使用） */
export function useLogEntries(): LogEntry[] {
  return useSyncExternalStore(subscribe, () => entries)
}

/** 订阅面板开关状态 */
export function useLogVisible(): boolean {
  return useSyncExternalStore(subscribe, () => visible)
}

export function setLogVisible(next: boolean): void {
  if (visible === next) return
  visible = next
  emit()
}

export function toggleLogVisible(): void {
  setLogVisible(!visible)
}

export function clearLog(): void {
  entries = []
  logAction('log', '日志已清空')
}

/** 导出全部日志文本（复制 / 贴给开发者用） */
export function actionLogText(): string {
  const header = `Mongo Manager 操作日志（共 ${entries.length} 条）`
  const body = entries.map((entry) => `${formatAt(entry.at)} [${entry.scope}] ${entry.text}`)
  return [header, ...body].join('\n')
}

/** 记录未捕获异常 / Promise 拒绝，复现时也能看到 */
export function installGlobalErrorLog(): void {
  window.addEventListener('error', (event) => {
    logAction('error', oneLine(event.message || String(event.error)))
  })
  window.addEventListener('unhandledrejection', (event) => {
    logAction('error', oneLine(String(event.reason)))
  })
  logAction('log', '操作日志已就绪（Ctrl+Shift+L 打开面板）')
}
