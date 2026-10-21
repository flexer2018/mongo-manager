/**
 * 全局状态：连接 / 导航树 / 多集合页签 / 主题。
 * 每个 tab 持有独立的查询参数、结果、Schema 采样与 VQB 树；
 * 查询语义（编译/反解析/分桶/采样推断）全部在渲染进程用 core 完成——
 * 纯计算，不走 IPC，UI 不会被网络与编译阻塞。
 */
import { EJSON } from 'bson'
import { create } from 'zustand'
import {
  DatabaseTree,
  Schema,
  Value,
  dumps,
  generateShellCommand,
  inferSchema,
  mongoFilterToSql,
  parseFindFilter,
  parseShellCommand,
  parseShellLiteral,
  rebindNode,
  toBson,
  toShellLiteral,
  QueryGroup,
  sqlToMongo
} from '@core'
import type { FieldRule, OrderedDoc, QueryNode, ShellCommandParts } from '@core'
import type {
  CollectionStats,
  CreateCollectionOptions,
  DatabaseSummary,
  IndexInfo,
  SavedConnection
} from '../../../shared/types'
import { backend } from '../lib/api'
import { describeTree, logAction, oneLine } from '../lib/action-log'

/** 一个集合页签的全部独立状态 */
export interface WorkTab {
  id: string
  /**
   * 页签类型：collection = 绑定集合 / sql = 独立 SQL 编辑器 /
   * shell = 独立 mongosh 编辑器 / db-stats = 库级集合统计表格
   */
  kind: 'collection' | 'sql' | 'shell' | 'db-stats'
  /** 页签所属连接，跨连接打开集合时互不干扰 */
  connId: string
  db: string
  coll: string
  /** 查询栏模式：json = filter 文档 / sql = MySQL SELECT 子集 / shell = 完整 mongosh 命令 */
  queryMode: 'json' | 'sql' | 'shell'
  sqlText: string
  /** Shell 模式编辑框内容：完整 mongosh 命令（find / deleteMany 等） */
  shellText: string
  filterText: string
  projectionText: string
  sortText: string
  skip: number
  limit: number
  docs: Value[]
  resultCount: number
  totalCount: number | null
  elapsedMs: number
  running: boolean
  runError: string | null
  schema: Schema | null
  sampling: boolean
  vqbTree: QueryGroup | null
  vqbOpen: boolean
  /** db-stats 页签：该库所有集合的统计行 */
  statsRows: CollectionStats[]
  /** db-stats 页签：统计数据写入时间（0 表示尚未读取），用于展示与缓存判断 */
  statsLoadedAt: number
}

export type ThemeName = 'dark' | 'light'

/** 连接颜色预置色盘：树上用颜色区分不同连接 */
export const CONN_COLORS = [
  '#4f8cff',
  '#22c55e',
  '#eab308',
  '#f97316',
  '#ec4899',
  '#a855f7',
  '#14b8a6',
  '#ef4444'
] as const

/** 一个已建立连接在渲染进程的独立状态（树 / 库列表 / 展开状态） */
export interface ConnEntry {
  connId: string
  /** 建立连接用的 URI，用于同一连接去重 */
  uri: string
  /** 连接显示名：来自保存列表或 URI 主机部分 */
  name: string
  /** 主题色：树上区分不同连接（取自 CONN_COLORS） */
  color: string
  version: string
  defaultDb: string
  tree: DatabaseTree
  databases: DatabaseSummary[]
  expandedDbs: string[]
}

function newTabId(): string {
  return `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

function makeTab(
  kind: WorkTab['kind'],
  connId: string,
  db: string,
  coll: string,
  text = ''
): WorkTab {
  return {
    id: newTabId(),
    kind,
    connId,
    db,
    coll,
    queryMode: kind === 'sql' ? 'sql' : kind === 'shell' ? 'shell' : 'json',
    sqlText: kind === 'sql' ? text : '',
    shellText: kind === 'shell' ? text : '',
    filterText: '{}',
    projectionText: '',
    sortText: '',
    skip: 0,
    limit: 100,
    docs: [],
    resultCount: 0,
    totalCount: null,
    elapsedMs: 0,
    running: false,
    runError: null,
    schema: null,
    sampling: false,
    vqbTree: null,
    vqbOpen: true,
    statsRows: [],
    statsLoadedAt: 0
  }
}

function loadTheme(): ThemeName {
  try {
    const saved = localStorage.getItem('mm-theme')
    return saved === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

/** shell 语法文本 → 规范 EJSON（主进程 EJSON.parse 可直接消费） */
function toEjsonText(text: string): string {
  const parsed = parseShellLiteral(text.trim() === '' ? '{}' : text)
  return EJSON.stringify(parsed, { relaxed: false })
}

/** 从 URI 截取连接显示名（host:port），密码等敏感部分不进入名称 */
function connNameFromUri(uri: string): string {
  const rest = uri.includes('://') ? uri.slice(uri.indexOf('://') + 3) : uri
  const at = rest.lastIndexOf('@')
  const hostPart = (at >= 0 ? rest.slice(at + 1) : rest).split('?')[0]
  return hostPart === '' ? `连接 ${Date.now() % 1000}` : hostPart
}

/** 为新连接挑选色盘颜色：优先未被占用的，否则轮换 */
function pickConnColor(connections: ConnEntry[]): string {
  const used = new Set(connections.map((item) => item.color))
  const available = CONN_COLORS.find((color) => !used.has(color))
  return available ?? CONN_COLORS[connections.length % CONN_COLORS.length]
}

interface AppState {
  // ---- 主题 ----
  theme: ThemeName
  toggleTheme(): void

  // ---- 连接 ----
  saved: SavedConnection[]
  connections: ConnEntry[]
  activeConnId: string | null
  connecting: boolean
  connError: string | null

  loadSaved(): Promise<void>
  saveConnection(name: string, uri: string): Promise<void>
  removeSaved(id: string): Promise<void>
  connect(uri: string, name?: string, color?: string): Promise<void>
  /** 断开指定连接；缺省断开当前活动连接 */
  disconnect(connId?: string): Promise<void>
  setActiveConn(connId: string): void
  /** 修改连接主题色（树上标识用） */
  setConnColor(connId: string, color: string): void

  // ---- 导航树 ----
  collectionError: string | null
  loadDatabases(connId: string): Promise<void>
  toggleDb(connId: string, db: string): Promise<void>
  /** 重新拉取库的集合列表（外部新建 / 删除集合后无需断开连接） */
  refreshCollections(connId: string, db: string): Promise<void>

  // ---- 集合页签（多开） ----
  tabs: WorkTab[]
  activeTabId: string | null
  openCollection(connId: string, db: string, coll: string): void
  /**
   * 新增独立查询编辑器页签（SQL / mongosh），可重复添加。
   * target 用于从导航树右键指定连接/库/集合；缺省取活动连接与当前页签上下文。
   */
  openQueryEditor(kind: 'sql' | 'shell', target?: { connId: string; db: string; coll: string }): void
  /** 新增（或聚焦）库级集合统计页签：表格展示该库所有集合的统计 */
  openDbStats(connId: string, db: string): void
  /**
   * 读取 db-stats 页签的统计数据：默认优先命中缓存（有效期见 DB_STATS_TTL_MS），
   * options.force 为 true 时强制重新拉取（刷新按钮用）。
   */
  loadDbStats(tabId: string, options?: { force?: boolean }): Promise<void>
  setActiveTab(id: string): void
  closeTab(id: string): void
  /** 更新当前活动页签的局部状态（新建引用触发渲染） */
  patchActive(patch: Partial<WorkTab>): void
  /**
   * 按 id 更新指定页签：编辑器延迟同步文本时用，
   * 避免切换页签后回写落到新的活动页签上。
   */
  patchTab(tabId: string, patch: Partial<WorkTab>): void
  /**
   * 执行页签查询。options.resetSkip 为 true 时先把 skip 归零——
   * 查询栏/VQB 发起新查询用，避免停留在高页码而新结果不足该页数时出现空页；
   * 分页条翻页不传（翻页自己设置 skip）。
   */
  runTab(tabId: string, options?: { resetSkip?: boolean }): Promise<void>
  /** 执行一段 SQL 文本（单行/选中执行用），不改动编辑器内容；新查询回到第一页 */
  runSqlText(text: string): Promise<void>
  /** 执行一段完整 mongosh 命令（Shell 模式）：find 查询 / deleteOne / deleteMany / countDocuments */
  runShellText(text: string): Promise<void>
  sampleForTab(tabId: string): Promise<void>

  // ---- 文档 CRUD（二期）----
  /** 插入文档（shell/EJSON 文本），成功后刷新当前 tab */
  insertDoc(docText: string): Promise<{ ok: boolean; error?: string }>
  /** 按 _id（EJSON 值字符串）替换文档，成功后刷新当前 tab */
  updateDoc(id: string, docText: string): Promise<{ ok: boolean; error?: string }>
  /** 按 _id 删除文档，成功后刷新当前 tab */
  deleteDoc(id: string): Promise<{ ok: boolean; error?: string }>

  // ---- 集合管理（二期）----
  createColl(connId: string, db: string, name: string, opts?: CreateCollectionOptions): Promise<{ ok: boolean; error?: string }>
  dropColl(connId: string, db: string, name: string): Promise<{ ok: boolean; error?: string }>
  renameColl(connId: string, db: string, oldName: string, newName: string): Promise<{ ok: boolean; error?: string }>

  // ---- 索引管理（二期）----
  listIdx(connId: string, db: string, coll: string): Promise<IndexInfo[]>
  createIdx(connId: string, db: string, coll: string, keys: string, options: string): Promise<{ ok: boolean; error?: string }>
  dropIdx(connId: string, db: string, coll: string, name: string): Promise<{ ok: boolean; error?: string }>

  // ---- VQB ----
  /** 设置活动页签查询模式；首次切 SQL / Shell 时由当前查询参数生成对应文本 */
  setQueryMode(mode: WorkTab['queryMode']): void
  setVqbTree(tree: QueryGroup): void
  toggleVqb(): void
  importFilterToVqb(): boolean
  exportVqbToFilter(): void
}

/** 树里是否至少有一条真正填了字段的条件（占位空行为 false） */
function hasRealRule(nodes: QueryNode[]): boolean {
  return nodes.some((node) =>
    node.kind === 'rule'
      ? (node as FieldRule).field.trim() !== ''
      : hasRealRule((node as QueryGroup).children)
  )
}

/**
 * 列出「填了字段却不参与编译」的条件：include 非真或字段为空。
 * 编译层只按 include 过滤（compiler.activeNodes），日志层按同一标准对照排查。
 */
function describeSkipped(nodes: QueryNode[]): string[] {
  const skipped: string[] = []
  for (const node of nodes) {
    if (node.kind === 'rule') {
      const rule = node as FieldRule
      if (rule.include !== true || rule.field.trim() === '') {
        skipped.push(`${rule.field || '<空字段>'}:${rule.operator} include=${String(rule.include)}`)
      }
      continue
    }
    skipped.push(...describeSkipped((node as QueryGroup).children))
  }
  return skipped
}

/** VQB 树编辑后写入页签：浅拷贝根组保证 Zustand 引用变化 */
function commitTree(tab: WorkTab, tree: QueryGroup): Partial<WorkTab> {
  // 必须重新绑定方法：{ ...tree } 继承的 isEmpty() 闭包仍指向旧树，
  // 用它判空会漏掉后来新增的规则（导致整片条件被编译成 {}）
  const clone: QueryGroup = rebindNode({ ...tree, children: [...tree.children] })
  // 树里只有占位空行（字段还没填）时不覆盖 filter：
  // 否则 VQB 尚未从 filter 反解析出条件时，点一下勾选框就把编辑器里的查询清成 {}
  if (clone.children.length > 0 && !hasRealRule(clone.children)) {
    logAction('store', '树 → filter：只有占位空行，保留原 filter', {
      tree: describeTree(clone.children)
    })
    return { vqbTree: clone }
  }
  const text = dumps(toBson(clone), 0)
  // 填了字段却编译成空文档：条件在编译期被判为「不参与」（include 非真 / 字段空白），
  // 单独记一条错误，避免条件静默消失后只能靠猜
  if (text === '{}') {
    logAction('error', '树 → filter：有真实条件却编译成空文档（条件被判为不参与编译）', {
      tree: describeTree(clone.children),
      skipped: describeSkipped(clone.children)
    })
  }
  logAction('store', `树 → filter：${oneLine(text)}`, {
    tree: describeTree(clone.children)
  })
  return { vqbTree: clone, filterText: text }
}

/**
 * filter 文本 → 查询树（查询栏编辑 / SQL 翻译 / Shell 命令回写时同步 VQB）。
 * 返回 null 表示不需要替换：文本非法（保留旧树）或语义与当前树相同
 * （例如树编辑后回写 filter 触发的等价文本，避免打断正在编辑的 VQB 行）。
 */
function treeFromFilterText(current: QueryGroup, text: string): QueryGroup | null {
  let tree: QueryGroup
  try {
    tree = parseFindFilter(text.trim() === '' ? '{}' : text)
  } catch (exc) {
    logAction('store', `filter → 树：解析失败，保留原树（${oneLine(text, 120)}）`, {
      error: exc instanceof Error ? exc.message : String(exc)
    })
    return null
  }
  const sameDoc =
    EJSON.stringify(toBson(tree), { relaxed: false }) ===
    EJSON.stringify(toBson(current), { relaxed: false })
  if (sameDoc) {
    logAction('store', 'filter → 树：与当前树等价，保留原树', {
      tree: describeTree(current.children)
    })
    return null
  }
  logAction('store', `filter → 树：按文本重建（${oneLine(text, 120)}）`, {
    tree: describeTree(tree.children)
  })
  return tree
}

// ---- 库级集合统计缓存 ----

/** 统计缓存有效期：有效期内反复打开同一库的统计页签不再发起全量 IPC 读取 */
const DB_STATS_TTL_MS = 60_000

/** connId + db → 统计结果；页签关闭后仍保留，避免反复右键打开时重复拉取 */
const dbStatsCache = new Map<string, { rows: CollectionStats[]; at: number }>()

/** 正在读取中的页签，避免同一页签并发重复拉取 */
const dbStatsLoading = new Set<string>()

function dbStatsKey(connId: string, db: string): string {
  return `${connId}\u0000${db}`
}

/** 取未过期的缓存；不存在或已过期返回 null */
function readDbStatsCache(connId: string, db: string): { rows: CollectionStats[]; at: number } | null {
  const key = dbStatsKey(connId, db)
  const cached = dbStatsCache.get(key)
  if (cached === undefined) return null
  if (Date.now() - cached.at > DB_STATS_TTL_MS) {
    dbStatsCache.delete(key)
    return null
  }
  return cached
}

/** 集合结构变化后让该库的统计缓存失效 */
function invalidateDbStats(connId: string, db: string): void {
  dbStatsCache.delete(dbStatsKey(connId, db))
}

/** 断开连接后清理该连接的全部统计缓存 */
function clearConnDbStats(connId: string): void {
  const prefix = `${connId}\u0000`
  for (const key of [...dbStatsCache.keys()]) {
    if (key.startsWith(prefix)) dbStatsCache.delete(key)
  }
}

/**
 * 应用一次页签补丁：filter 文本变化时顺带重建查询树，
 * 让查询栏手写 / SQL 翻译 / Shell 命令回写都能反映到 VQB。
 */
function applyTabPatch(tab: WorkTab, patch: Partial<WorkTab>): WorkTab {
  const keys = Object.keys(patch)
  const patchTree = patch.vqbTree
  logAction('store', `patchActive(${tab.id}) ${keys.join(',')}`, {
    filterText: typeof patch.filterText === 'string' ? oneLine(patch.filterText, 160) : undefined,
    vqbTree:
      patchTree === undefined
        ? undefined
        : patchTree === null
          ? '无树'
          : describeTree(patchTree.children)
  })
  const next = { ...tab, ...patch }
  if (typeof patch.filterText === 'string' && next.vqbTree !== null) {
    const synced = treeFromFilterText(next.vqbTree, patch.filterText)
    if (synced !== null) next.vqbTree = synced
  }
  return next
}

/** 集合变更后：强制重载该库的分桶缓存，并触发一次渲染 */
async function refreshDb(connId: string, db: string): Promise<void> {
  invalidateDbStats(connId, db)
  const store = useAppStore.getState()
  const entry = store.connections.find((item) => item.connId === connId)
  if (entry === undefined) return
  await entry.tree.load(db, true)
  useAppStore.setState((state) => ({
    connections: state.connections.map((item) =>
      item.connId === connId ? { ...item, expandedDbs: [...item.expandedDbs] } : item
    )
  }))
  void useAppStore.getState().loadDatabases(connId)
}

/** 执行 JSON filter 查询并写入页签结果（skip/limit 读自页签当前状态） */
async function executeFind(tabId: string): Promise<void> {
  const store = useAppStore.getState()
  const tab = store.tabs.find((item) => item.id === tabId)
  if (tab === undefined) return
  const connId = tab.connId
  useAppStore.setState((state) => ({
    tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, running: true, runError: null } : item))
  }))
  try {
    // shell 语法（键可无引号）→ 规范 EJSON，类型保真（Int32/Long/ObjectId…），
    // 主进程只做 EJSON.parse，不接触 shell 文本
    const filterEjson = toEjsonText(tab.filterText || '{}')
    logAction('store', `执行 find ${tab.db}.${tab.coll}`, {
      filter: oneLine(tab.filterText, 240),
      skip: tab.skip,
      limit: tab.limit
    })
    const result = await backend.find({
      connId,
      db: tab.db,
      coll: tab.coll,
      filter: filterEjson,
      projection: tab.projectionText.trim() !== '' ? toEjsonText(tab.projectionText) : undefined,
      sort: tab.sortText.trim() !== '' ? toEjsonText(tab.sortText) : undefined,
      skip: tab.skip,
      limit: tab.limit
    })
    const docs = result.docs.map((text) => EJSON.parse(text, { relaxed: false }) as Value)
    logAction('store', `find 返回 ${result.count} 条（${result.elapsedMs}ms）`)
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? { ...item, docs, resultCount: result.count, elapsedMs: result.elapsedMs, running: false }
          : item
      )
    }))
    backend
      .count(connId, tab.db, tab.coll, filterEjson)
      .then((total) =>
        useAppStore.setState((state) => ({
          tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, totalCount: total } : item))
        }))
      )
      .catch((exc) => console.error('count 失败:', exc))
  } catch (exc) {
    const message = exc instanceof Error ? exc.message : String(exc)
    logAction('error', `find 失败：${oneLine(message)}`)
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId ? { ...item, running: false, runError: message } : item
      )
    }))
  }
}

/** 翻译并执行一段 SQL 文本（不改动编辑器内容）；聚合走 runAggregate，find 先同步分段 */
async function executeSqlText(tabId: string, sqlText: string): Promise<void> {
  const store = useAppStore.getState()
  const tab = store.tabs.find((item) => item.id === tabId)
  if (tab === undefined) return
  const connId = tab.connId
  let translated: ReturnType<typeof sqlToMongo>
  try {
    translated = sqlToMongo(sqlText)
  } catch (exc) {
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? {
              ...item,
              running: false,
              runError: `SQL 翻译失败: ${exc instanceof Error ? exc.message : String(exc)}`
            }
          : item
      )
    }))
    return
  }
  // 集合名以 SQL 语句的 FROM 为准（独立 SQL 编辑器可查询任意集合）
  const targetColl = translated.table !== '' ? translated.table : tab.coll
  if (translated.mode === 'aggregate') {
    await runAggregate(connId, tabId, tab.db, targetColl, translated.pipeline)
    return
  }
  useAppStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.id === tabId
        ? {
            ...item,
            coll: targetColl,
            filterText: JSON.stringify(translated.filter),
            projectionText: translated.projection !== null ? JSON.stringify(translated.projection) : '',
            sortText: translated.sort !== null ? JSON.stringify(translated.sort) : '',
            skip: translated.skip ?? tab.skip,
            limit: translated.limit ?? tab.limit
          }
        : item
    )
  }))
  await executeFind(tabId)
}

/** 执行 SQL 聚合管道并写入页签结果；聚合行数即为总数 */
async function runAggregate(
  connId: string,
  tabId: string,
  db: string,
  coll: string,
  pipeline: Record<string, unknown>[]
): Promise<void> {
  useAppStore.setState((state) => ({
    tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, running: true, runError: null } : item))
  }))
  try {
    const result = await backend.aggregate({
      connId,
      db,
      coll,
      pipeline: EJSON.stringify(pipeline, { relaxed: false })
    })
    const docs = result.docs.map((text) => EJSON.parse(text, { relaxed: false }) as Value)
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? { ...item, docs, resultCount: result.count, totalCount: result.count, elapsedMs: result.elapsedMs, running: false }
          : item
      )
    }))
  } catch (exc) {
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? { ...item, running: false, runError: exc instanceof Error ? exc.message : String(exc) }
          : item
      )
    }))
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  theme: loadTheme(),
  toggleTheme: () => {
    const theme: ThemeName = get().theme === 'dark' ? 'light' : 'dark'
    try {
      localStorage.setItem('mm-theme', theme)
    } catch {
      /* 忽略持久化失败 */
    }
    set({ theme })
  },

  saved: [],
  connections: [],
  activeConnId: null,
  connecting: false,
  connError: null,

  loadSaved: async () => {
    try {
      set({ saved: await backend.listSaved() })
    } catch (exc) {
      console.error('读取保存连接失败:', exc)
    }
  },

  saveConnection: async (name, uri) => {
    set({ saved: await backend.saveConnection(name, uri) })
  },

  removeSaved: async (id) => {
    set({ saved: await backend.removeSaved(id) })
  },

  connect: async (uri, name, color) => {
    // 同一 URI 已连接：直接聚焦到已有连接，避免在树上重复出现
    const existing = get().connections.find((item) => item.uri === uri)
    if (existing !== undefined) {
      set({ activeConnId: existing.connId })
      return
    }
    set({ connecting: true, connError: null })
    try {
      const result = await backend.connect(uri)
      const entry: ConnEntry = {
        connId: result.connId,
        uri,
        name: name !== undefined && name.trim() !== '' ? name.trim() : connNameFromUri(uri),
        color: color ?? pickConnColor(get().connections),
        version: result.version,
        defaultDb: result.defaultDb,
        tree: new DatabaseTree(
          async (db) => {
            const raw = await backend.listCollections(result.connId, db)
            return raw.map((text) => JSON.parse(text) as Record<string, unknown>)
          },
          async () => (await backend.listDatabases(result.connId)).map((db) => db.name)
        ),
        databases: [],
        expandedDbs: []
      }
      set((state) => ({
        connections: [...state.connections, entry],
        activeConnId: result.connId,
        connecting: false
      }))
      await get().loadDatabases(result.connId)
    } catch (exc) {
      set({ connecting: false, connError: exc instanceof Error ? exc.message : String(exc) })
    }
  },

  disconnect: async (connId) => {
    const target = connId ?? get().activeConnId
    if (target === null) return
    await backend.disconnect(target).catch((exc) => console.error('断开失败:', exc))
    clearConnDbStats(target)
    set((state) => {
      const connections = state.connections.filter((item) => item.connId !== target)
      // 关闭该连接下打开的页签，避免引用已断开的连接
      const tabs = state.tabs.filter((tab) => tab.connId !== target)
      const activeTabId =
        state.activeTabId !== null && tabs.some((tab) => tab.id === state.activeTabId)
          ? state.activeTabId
          : (tabs[tabs.length - 1]?.id ?? null)
      return {
        connections,
        tabs,
        activeTabId,
        activeConnId:
          state.activeConnId === target
            ? (connections[connections.length - 1]?.connId ?? null)
            : state.activeConnId
      }
    })
  },

  setActiveConn: (connId) => set({ activeConnId: connId }),

  setConnColor: (connId, color) => {
    set((state) => ({
      connections: state.connections.map((item) =>
        item.connId === connId ? { ...item, color } : item
      )
    }))
    // 回写到保存的连接列表（按 URI 匹配持久化），保持下次连接颜色一致
    const entry = get().connections.find((item) => item.connId === connId)
    if (entry !== undefined) {
      void backend
        .saveConnColor(entry.uri, color)
        .then((saved) => set({ saved }))
        .catch((exc) => console.error('持久化连接颜色失败:', exc))
    }
  },

  collectionError: null,

  loadDatabases: async (connId) => {
    try {
      const databases = await backend.listDatabases(connId)
      set((state) => ({
        connections: state.connections.map((item) =>
          item.connId === connId ? { ...item, databases } : item
        )
      }))
    } catch (exc) {
      console.error('列出数据库失败:', exc)
    }
  },

  toggleDb: async (connId, db) => {
    const entry = get().connections.find((item) => item.connId === connId)
    if (entry === undefined) return
    const patchDbs = (expandedDbs: string[]): void =>
      set((state) => ({
        connections: state.connections.map((item) =>
          item.connId === connId ? { ...item, expandedDbs } : item
        )
      }))
    if (entry.expandedDbs.includes(db)) {
      patchDbs(entry.expandedDbs.filter((name) => name !== db))
      return
    }
    patchDbs([...entry.expandedDbs, db])
    set({ collectionError: null })
    const node = entry.tree.node(db)
    if (node !== null && node.contents.loaded) return
    try {
      await entry.tree.load(db)
      set((state) => ({
        connections: state.connections.map((item) =>
          item.connId === connId ? { ...item, expandedDbs: [...item.expandedDbs] } : item
        )
      }))
    } catch (exc) {
      set({ collectionError: exc instanceof Error ? exc.message : String(exc) })
    }
  },

  /** 强制重新拉取集合列表：先展开该库，刷新结果立即可见 */
  refreshCollections: async (connId, db) => {
    const entry = get().connections.find((item) => item.connId === connId)
    if (entry === undefined) return
    if (!entry.expandedDbs.includes(db)) {
      set((state) => ({
        connections: state.connections.map((item) =>
          item.connId === connId ? { ...item, expandedDbs: [...item.expandedDbs, db] } : item
        )
      }))
    }
    set({ collectionError: null })
    try {
      await refreshDb(connId, db)
    } catch (exc) {
      set({ collectionError: exc instanceof Error ? exc.message : String(exc) })
    }
  },

  tabs: [],
  activeTabId: null,

  /** 打开（或聚焦）一个集合页签，并自动运行首次查询 */
  openCollection: (connId, db, coll) => {
    const existing = get().tabs.find(
      (tab) => tab.kind === 'collection' && tab.connId === connId && tab.db === db && tab.coll === coll
    )
    if (existing !== undefined) {
      logAction('store', `切到已打开的集合页签 ${db}.${coll}（${existing.id}）`)
      set({ activeTabId: existing.id })
      return
    }
    const tab = makeTab('collection', connId, db, coll)
    logAction('store', `打开集合页签 ${db}.${coll}（${tab.id}）`)
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    void get().runTab(tab.id)
    void get().sampleForTab(tab.id)
  },

  /** 新增独立查询编辑器页签：默认库取活动连接默认库，模板引用当前集合 */
  openQueryEditor: (kind, target) => {
    const { connections, tabs, activeTabId } = get()
    const connId = target?.connId ?? get().activeConnId
    if (connId === null) return
    const conn = connections.find((item) => item.connId === connId)
    const current = tabs.find((item) => item.id === activeTabId) ?? null
    const db =
      target?.db ??
      (current !== null && current.db !== ''
        ? current.db
        : (conn?.defaultDb !== '' && conn?.defaultDb !== undefined
            ? conn.defaultDb
            : (conn?.databases[0]?.name ?? 'test')))
    const coll = target?.coll ?? current?.coll ?? ''
    const text =
      kind === 'sql'
        ? `SELECT * FROM ${coll === '' ? 'collection' : coll} LIMIT 100`
        : `db.getCollection("${coll === '' ? 'collection' : coll}").find({\n})\n`
    const tab = makeTab(kind, connId, db, coll, text)
    set({
      tabs: [...tabs, tab],
      activeTabId: tab.id,
      ...(target !== undefined ? { activeConnId: connId } : {})
    })
  },

  /** 打开（或聚焦）库级集合统计页签，并读取统计数据 */
  openDbStats: (connId, db) => {
    const existing = get().tabs.find(
      (tab) => tab.kind === 'db-stats' && tab.connId === connId && tab.db === db
    )
    if (existing !== undefined) {
      set({ activeTabId: existing.id, activeConnId: connId })
      void get().loadDbStats(existing.id)
      return
    }
    const tab = makeTab('db-stats', connId, db, '')
    set((state) => ({
      tabs: [...state.tabs, tab],
      activeTabId: tab.id,
      activeConnId: connId
    }))
    void get().loadDbStats(tab.id)
  },

  /** 读取库级集合统计（running / runError 复用页签状态，供表格展示加载与错误） */
  loadDbStats: async (tabId, options) => {
    const tab = get().tabs.find((item) => item.id === tabId)
    if (tab === undefined) return
    const { connId, db } = tab
    // 同一页签已有读取在进行中：直接复用那次结果，避免重复请求
    if (dbStatsLoading.has(tabId)) return

    if (options?.force !== true) {
      const cached = readDbStatsCache(connId, db)
      if (cached !== null) {
        set((state) => ({
          tabs: state.tabs.map((item) =>
            item.id === tabId
              ? {
                  ...item,
                  statsRows: cached.rows,
                  statsLoadedAt: cached.at,
                  running: false,
                  runError: null
                }
              : item
          )
        }))
        return
      }
    }

    dbStatsLoading.add(tabId)
    set((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId ? { ...item, running: true, runError: null } : item
      )
    }))
    try {
      const rows = await backend.collStatsAll(connId, db)
      const at = Date.now()
      dbStatsCache.set(dbStatsKey(connId, db), { rows, at })
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId
            ? { ...item, statsRows: rows, statsLoadedAt: at, running: false }
            : item
        )
      }))
    } catch (exc) {
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId
            ? { ...item, running: false, runError: exc instanceof Error ? exc.message : String(exc) }
            : item
        )
      }))
    } finally {
      dbStatsLoading.delete(tabId)
    }
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeTab: (id) => {
    logAction('store', `关闭页签 ${id}`)
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId =
        state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  patchActive: (patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === state.activeTabId ? applyTabPatch(tab, patch) : tab
      )
    }))
  },

  patchTab: (tabId, patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === tabId ? applyTabPatch(tab, patch) : tab))
    }))
  },

  runTab: async (tabId, options) => {
    const tab = get().tabs.find((item) => item.id === tabId)
    if (tab === undefined) return
    if (tab.queryMode === 'shell') {
      await get().runShellText(tab.shellText)
      return
    }
    // 新查询从第一页开始：skip 归零后 executeFind/executeSqlText 读到的就是 0
    if (options?.resetSkip === true && tab.skip !== 0) {
      set((state) => ({
        tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, skip: 0 } : item))
      }))
    }
    if (tab.queryMode === 'sql') {
      await executeSqlText(tabId, tab.sqlText)
      return
    }
    await executeFind(tabId)
  },

  runSqlText: async (text) => {
    const tabId = get().activeTabId
    if (tabId === null) return
    // 新 SQL 查询从第一页开始；SQL 自带 OFFSET 时 translated.skip 会覆盖
    const tab = get().tabs.find((item) => item.id === tabId)
    if (tab !== undefined && tab.skip !== 0) {
      set((state) => ({
        tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, skip: 0 } : item))
      }))
    }
    await executeSqlText(tabId, text)
  },

  /** 执行 Shell 模式编辑框的完整 mongosh 命令 */
  runShellText: async (text) => {
    const tabId = get().activeTabId
    if (tabId === null) return
    const tab = get().tabs.find((item) => item.id === tabId)
    if (tab === undefined) return
    logAction('store', `执行 Shell 命令（${oneLine(text, 200)}）`)
    let parts: ShellCommandParts
    try {
      parts = parseShellCommand(text)
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc)
      logAction('error', `Shell 命令解析失败：${oneLine(message)}`)
      get().patchActive({
        runError: `命令解析失败: ${message}`
      })
      return
    }
    // 集合以命令中的 getCollection 为准；独立 Shell 编辑器可查询任意集合
    if (tab.kind !== 'shell' && parts.coll !== tab.coll) {
      get().patchActive({
        runError: `命令的集合 ${parts.coll} 与当前页签 ${tab.coll} 不一致`
      })
      return
    }
    const connId = tab.connId
    const coll = parts.coll
    // 独立 Shell 编辑器支持命令前缀 db.getSiblingDB("x") 指定库
    const db = tab.kind === 'shell' && parts.db !== null ? parts.db : tab.db
    const filterEjson = EJSON.stringify(parts.filter, { relaxed: false })

    if (parts.op === 'find') {
      // 命令里的查询参数写回页签状态后直接执行 find
      // 注意：不能调 runTab——Shell 模式下 runTab 会再分发回 runShellText 形成无限递归
      get().patchActive({
        db,
        coll,
        filterText: toShellLiteral(parts.filter),
        projectionText: parts.projection !== null ? toShellLiteral(parts.projection) : '',
        sortText: parts.sort !== null ? toShellLiteral(parts.sort) : '',
        skip: parts.skip ?? tab.skip,
        limit: parts.limit ?? tab.limit,
        runError: null
      })
      await executeFind(tabId)
      return
    }

    if (parts.op === 'countDocuments') {
      try {
        const total = await backend.count(connId, db, coll, filterEjson)
        window.alert(`countDocuments 匹配 ${total} 条文档`)
      } catch (exc) {
        get().patchActive({
          runError: exc instanceof Error ? exc.message : String(exc)
        })
      }
      return
    }

    if (parts.op === 'updateOne' || parts.op === 'updateMany') {
      const update = parts.update
      if (update === null) {
        get().patchActive({ runError: `${parts.op}() 缺少 update 参数` })
        return
      }
      const label =
        parts.op === 'updateMany' ? 'updateMany（更新全部匹配文档）' : 'updateOne（更新第一条匹配文档）'
      const updateEjson = EJSON.stringify(update, { relaxed: false })
      const optionsEjson =
        parts.options !== null ? EJSON.stringify(parts.options, { relaxed: false }) : ''
      const confirmed = window.confirm(
        `确认执行 ${label}？\n\nfilter：\n${toShellLiteral(parts.filter)}\n\nupdate：\n${toShellLiteral(update)}`
      )
      if (!confirmed) return
      try {
        const result = await backend.updateByFilter(
          connId,
          db,
          coll,
          filterEjson,
          updateEjson,
          parts.op,
          optionsEjson
        )
        const upserted = result.upsertedId === null ? '' : `，upsert 新文档 _id=${result.upsertedId}`
        window.alert(
          `${parts.op} 完成：匹配 ${result.matchedCount} 条，修改 ${result.modifiedCount} 条${upserted}`
        )
        get().patchActive({ runError: null })
      } catch (exc) {
        get().patchActive({
          runError: exc instanceof Error ? exc.message : String(exc)
        })
      }
      return
    }

    const label =
      parts.op === 'deleteMany'
        ? 'deleteMany（删除全部匹配文档）'
        : 'deleteOne（删除第一条匹配文档）'
    if (!window.confirm(`确认执行 ${label}？\n${toShellLiteral(parts.filter)}`)) return
    try {
      const deleted = await backend.deleteByFilter(connId, db, coll, filterEjson, parts.op)
      window.alert(`已删除 ${deleted} 条文档`)
      get().patchActive({ runError: null })
    } catch (exc) {
      get().patchActive({
        runError: exc instanceof Error ? exc.message : String(exc)
      })
    }
  },

  sampleForTab: async (tabId) => {
    const { tabs } = get()
    const tab = tabs.find((item) => item.id === tabId)
    if (tab === undefined) return
    const connId = tab.connId
    set((state) => ({
      tabs: state.tabs.map((item) => (item.id === tabId ? { ...item, sampling: true } : item))
    }))
    try {
      const raw = await backend.sampleSchema(connId, tab.db, tab.coll, 200)
      const documents = raw.map((text) => EJSON.parse(text, { relaxed: false }) as Value)
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? { ...item, schema: inferSchema(documents), sampling: false } : item
        )
      }))
    } catch (exc) {
      // $sample 在视图/系统集合上会报错等：回退用当前页文档推断，保证 VQB 字段列表可用
      console.error('schema 采样失败，回退当前页推断:', exc)
      const current = get().tabs.find((item) => item.id === tabId)
      const fallback =
        current !== undefined && current.docs.length > 0 ? inferSchema(current.docs) : null
      set((state) => ({
        tabs: state.tabs.map((item) =>
          item.id === tabId ? { ...item, schema: fallback, sampling: false } : item
        )
      }))
    }
  },

  // ---- 文档 CRUD（二期）----

  insertDoc: async (docText) => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((item) => item.id === activeTabId)
    if (tab === undefined) return { ok: false, error: '无活动集合页签' }
    const connId = tab.connId
    try {
      await backend.insertOne(connId, tab.db, tab.coll, toEjsonText(docText))
      await get().runTab(tab.id)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  updateDoc: async (id, docText) => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((item) => item.id === activeTabId)
    if (tab === undefined) return { ok: false, error: '无活动集合页签' }
    const connId = tab.connId
    try {
      await backend.replaceOne({ connId, db: tab.db, coll: tab.coll, id }, toEjsonText(docText))
      await get().runTab(tab.id)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  deleteDoc: async (id) => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((item) => item.id === activeTabId)
    if (tab === undefined) return { ok: false, error: '无活动集合页签' }
    const connId = tab.connId
    try {
      await backend.deleteOne({ connId, db: tab.db, coll: tab.coll, id })
      await get().runTab(tab.id)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  // ---- 集合管理（二期）----

  createColl: async (connId, db, name, opts) => {
    try {
      await backend.createCollection(connId, db, name, opts)
      await refreshDb(connId, db)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  dropColl: async (connId, db, name) => {
    try {
      await backend.dropCollection(connId, db, name)
      // 关闭该集合的页签，避免引用已删除的命名空间
      set((state) => {
        const tabs = state.tabs.filter(
          (tab) => !(tab.connId === connId && tab.db === db && tab.coll === name)
        )
        const activeTabId =
          state.activeTabId !== null && tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : (tabs[tabs.length - 1]?.id ?? null)
        return { tabs, activeTabId }
      })
      await refreshDb(connId, db)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  renameColl: async (connId, db, oldName, newName) => {
    try {
      await backend.renameCollection(connId, db, oldName, newName)
      // 已打开的页签跟随改名
      set((state) => ({
        tabs: state.tabs.map((tab) =>
          tab.connId === connId && tab.db === db && tab.coll === oldName
            ? { ...tab, coll: newName }
            : tab
        )
      }))
      await refreshDb(connId, db)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  // ---- 索引管理（二期）----

  listIdx: async (connId, db, coll) => backend.listIndexes(connId, db, coll),

  createIdx: async (connId, db, coll, keys, options) => {
    try {
      await backend.createIndex({
        connId,
        db,
        coll,
        keys: toEjsonText(keys),
        ...(options.trim() !== '' ? { options: toEjsonText(options) } : {})
      })
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  dropIdx: async (connId, db, coll, name) => {
    try {
      await backend.dropIndex(connId, db, coll, name)
      return { ok: true }
    } catch (exc) {
      return { ok: false, error: exc instanceof Error ? exc.message : String(exc) }
    }
  },

  // ---- VQB ----

  setQueryMode: (mode) => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined || tab.queryMode === mode) return
    logAction('store', `查询模式 ${tab.queryMode} → ${mode}`)
    if (mode === 'sql' && tab.sqlText.trim() === '') {
      // 首次切到 SQL：用当前 filter 生成等价 SELECT（不可表达则留提示）
      let doc: OrderedDoc = {}
      try {
        doc = parseShellLiteral(
          tab.filterText.trim() === '' ? '{}' : tab.filterText
        ) as OrderedDoc
      } catch {
        doc = {}
      }
      const sql = mongoFilterToSql(doc, tab.coll)
      get().patchActive({
        queryMode: 'sql',
        sqlText: sql ?? '-- 当前 filter 含 SQL 无法表达的查询形态\n-- 请直接编写 MySQL 风格 SELECT'
      })
      return
    }
    if (mode === 'shell' && tab.shellText.trim() === '') {
      // 首次切到 Shell：由当前查询参数生成完整 mongosh 命令
      const parseDoc = (text: string): Value | null => {
        if (text.trim() === '') return null
        try {
          return parseShellLiteral(text)
        } catch {
          return null
        }
      }
      const command = generateShellCommand(tab.db, tab.coll, 'find', parseDoc(tab.filterText) ?? {}, {
        projection: parseDoc(tab.projectionText) ?? undefined,
        sort: parseDoc(tab.sortText) ?? undefined,
        skip: tab.skip,
        limit: tab.limit
      })
      get().patchActive({ queryMode: 'shell', shellText: command })
      return
    }
    get().patchActive({ queryMode: mode })
  },

  setVqbTree: (tree) => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return
    logAction('store', 'setVqbTree（VQB 编辑提交）', { tree: describeTree(tree.children) })
    get().patchActive(commitTree(tab, tree))
  },

  toggleVqb: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return
    logAction('store', `VQB 面板 ${tab.vqbOpen ? '收起' : '展开'}`)
    get().patchActive({ vqbOpen: !tab.vqbOpen })
  },

  importFilterToVqb: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return false
    try {
      const tree = parseFindFilter(tab.filterText || '{}')
      logAction('store', '点击「从 filter 导入」：解析成功', { tree: describeTree(tree.children) })
      get().patchActive({ vqbTree: tree, vqbOpen: true })
      return true
    } catch (exc) {
      logAction('store', '点击「从 filter 导入」：解析失败', {
        filterText: oneLine(tab.filterText, 200),
        error: exc instanceof Error ? exc.message : String(exc)
      })
      return false
    }
  },

  exportVqbToFilter: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined || tab.vqbTree === null) return
    logAction('store', '点击「导出到 filter」')
    get().patchActive(commitTree(tab, tab.vqbTree))
  }
}))
