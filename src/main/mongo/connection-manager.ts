/**
 * 多连接生命周期管理 + 保存列表持久化。
 * 每个连接一个 MongoClient；connId 为自增短 id，避免把 URI 泄漏到渲染进程。
 */
import { MongoClient } from 'mongodb'
import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { SavedConnection } from '../../shared/types'

interface LiveConnection {
  client: MongoClient
  defaultDb: string
}

/** 从 URI 中手写截取默认库名。
 *  密码可能含 `#` 等特殊字符，不能用标准 RFC 解析器：
 *  去掉 scheme 后取最后一个 '@' 之后的部分，再取 '/' 到 '?' 之间。 */
export function defaultDbFromUri(uri: string): string {
  const rest = uri.includes('://') ? uri.slice(uri.indexOf('://') + 3) : uri
  const at = rest.lastIndexOf('@')
  const hostPart = at >= 0 ? rest.slice(at + 1) : rest
  const slash = hostPart.indexOf('/')
  if (slash < 0) return ''
  const tail = hostPart.slice(slash + 1)
  const q = tail.indexOf('?')
  const name = q >= 0 ? tail.slice(0, q) : tail
  return decodeURIComponent(name)
}

export class ConnectionManager {
  private readonly live = new Map<string, LiveConnection>()
  private counter = 0

  async connect(uri: string): Promise<{ connId: string; version: string; defaultDb: string }> {
    const client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      appName: 'mongo-manager'
    })
    await client.connect()
    this.counter += 1
    const connId = `c${this.counter}`
    let version = 'unknown'
    try {
      const info = await client.db('admin').command({ buildInfo: 1 })
      version = String(info.version ?? 'unknown')
    } catch (exc) {
      console.error('buildInfo 失败:', exc)
    }
    this.live.set(connId, { client, defaultDb: defaultDbFromUri(uri) })
    return { connId, version, defaultDb: this.live.get(connId)!.defaultDb }
  }

  client(connId: string): MongoClient {
    const entry = this.live.get(connId)
    if (entry === undefined) {
      throw new Error(`连接不存在或已断开: ${connId}`)
    }
    return entry.client
  }

  defaultDb(connId: string): string {
    return this.live.get(connId)?.defaultDb ?? ''
  }

  async disconnect(connId: string): Promise<void> {
    const entry = this.live.get(connId)
    if (entry === undefined) return
    this.live.delete(connId)
    await entry.client.close().catch((exc) => console.error('close 失败:', exc))
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.live.keys()].map((id) => this.disconnect(id)))
  }
}

// ---------------------------------------------------------------------------
// 保存的连接列表（userData/saved-connections.json）
// ---------------------------------------------------------------------------

function savedFilePath(): string {
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'saved-connections.json')
}

export function loadSaved(): SavedConnection[] {
  try {
    const raw = readFileSync(savedFilePath(), 'utf8')
    const data = JSON.parse(raw)
    return Array.isArray(data) ? (data as SavedConnection[]) : []
  } catch {
    return []
  }
}

export function persistSaved(list: SavedConnection[]): void {
  try {
    writeFileSync(savedFilePath(), JSON.stringify(list, null, 2), 'utf8')
  } catch (exc) {
    console.error('保存连接列表失败:', exc)
  }
}

export function addSaved(name: string, uri: string): SavedConnection[] {
  const list = loadSaved()
  const trimmed = name.trim() || `连接 ${list.length + 1}`
  const existing = list.findIndex((item) => item.name === trimmed)
  const entry: SavedConnection = {
    id: existing >= 0 ? list[existing].id : `s${Date.now().toString(36)}`,
    name: trimmed,
    uri,
    createdAt: Date.now()
  }
  if (existing >= 0) list[existing] = entry
  else list.push(entry)
  persistSaved(list)
  return list
}

export function removeSaved(id: string): SavedConnection[] {
  const list = loadSaved().filter((item) => item.id !== id)
  persistSaved(list)
  return list
}
