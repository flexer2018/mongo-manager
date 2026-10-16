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
  inferSchema,
  parseFindFilter,
  parseShellLiteral,
  toBson,
  QueryGroup,
  sqlToMongo
} from '@core'
import type {
  CreateCollectionOptions,
  DatabaseSummary,
  IndexInfo,
  SavedConnection
} from '../../../shared/types'
import { backend } from '../lib/api'

/** 一个集合页签的全部独立状态 */
export interface WorkTab {
  id: string
  /** 页签所属连接，跨连接打开集合时互不干扰 */
  connId: string
  db: string
  coll: string
  /** 查询栏模式：json = filter 文档 / sql = MySQL SELECT 子集 */
  queryMode: 'json' | 'sql'
  sqlText: string
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

function makeTab(connId: string, db: string, coll: string): WorkTab {
  return {
    id: newTabId(),
    connId,
    db,
    coll,
    queryMode: 'json',
    sqlText: '',
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
    vqbOpen: true
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

  // ---- 集合页签（多开） ----
  tabs: WorkTab[]
  activeTabId: string | null
  openCollection(connId: string, db: string, coll: string): void
  setActiveTab(id: string): void
  closeTab(id: string): void
  /** 更新当前活动页签的局部状态（新建引用触发渲染） */
  patchActive(patch: Partial<WorkTab>): void
  runTab(tabId: string): Promise<void>
  /** 执行一段 SQL 文本（单行/选中执行用），不改动编辑器内容 */
  runSqlText(text: string): Promise<void>
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
  setVqbTree(tree: QueryGroup): void
  toggleVqb(): void
  importFilterToVqb(): boolean
  exportVqbToFilter(): void
}

/** VQB 树编辑后写入页签：浅拷贝根组保证 Zustand 引用变化 */
function commitTree(tab: WorkTab, tree: QueryGroup): Partial<WorkTab> {
  const clone: QueryGroup = { ...tree, children: [...tree.children] }
  return { vqbTree: clone, filterText: dumps(toBson(clone), 0) }
}

/** 集合变更后：强制重载该库的分桶缓存，并触发一次渲染 */
async function refreshDb(connId: string, db: string): Promise<void> {
  const store = useAppStore.getState()
  const entry = store.connections.find((item) => item.connId === connId)
  if (entry === undefined) return
  await entry.tree.load(db, true).catch((exc) => console.error('刷新集合失败:', exc))
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
    useAppStore.setState((state) => ({
      tabs: state.tabs.map((item) =>
        item.id === tabId
          ? { ...item, running: false, runError: exc instanceof Error ? exc.message : String(exc) }
          : item
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
  if (translated.mode === 'aggregate') {
    await runAggregate(connId, tabId, tab.db, tab.coll, translated.pipeline)
    return
  }
  useAppStore.setState((state) => ({
    tabs: state.tabs.map((item) =>
      item.id === tabId
        ? {
            ...item,
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

  tabs: [],
  activeTabId: null,

  /** 打开（或聚焦）一个集合页签，并自动运行首次查询 */
  openCollection: (connId, db, coll) => {
    const existing = get().tabs.find(
      (tab) => tab.connId === connId && tab.db === db && tab.coll === coll
    )
    if (existing !== undefined) {
      set({ activeTabId: existing.id })
      return
    }
    const tab = makeTab(connId, db, coll)
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
    void get().runTab(tab.id)
    void get().sampleForTab(tab.id)
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeTab: (id) => {
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.id !== id)
      const activeTabId =
        state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId
      return { tabs, activeTabId }
    })
  },

  patchActive: (patch) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === state.activeTabId ? { ...tab, ...patch } : tab))
    }))
  },

  runTab: async (tabId) => {
    const tab = get().tabs.find((item) => item.id === tabId)
    if (tab === undefined) return
    if (tab.queryMode === 'sql') {
      await executeSqlText(tabId, tab.sqlText)
      return
    }
    await executeFind(tabId)
  },

  runSqlText: async (text) => {
    const tabId = get().activeTabId
    if (tabId === null) return
    await executeSqlText(tabId, text)
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

  setVqbTree: (tree) => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return
    get().patchActive(commitTree(tab, tree))
  },

  toggleVqb: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return
    get().patchActive({ vqbOpen: !tab.vqbOpen })
  },

  importFilterToVqb: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined) return false
    try {
      const tree = parseFindFilter(tab.filterText || '{}')
      get().patchActive({ vqbTree: tree, vqbOpen: true })
      return true
    } catch {
      return false
    }
  },

  exportVqbToFilter: () => {
    const tab = get().tabs.find((item) => item.id === get().activeTabId)
    if (tab === undefined || tab.vqbTree === null) return
    get().patchActive(commitTree(tab, tab.vqbTree))
  }
}))
