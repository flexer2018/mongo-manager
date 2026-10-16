/**
 * 数据库 / 集合导航树。
 *
 * 懒加载 + 内存缓存，一次 listCollections 的返回拆到分桶里。
 * 客户端访问通过注入的异步函数提供，
 * core 层保持无 Node 依赖（可在渲染进程与 vitest 中直接使用）。
 */
import { isPlainObject, OrderedDoc, Value } from './value-model'

/** admin 库的系统集合（wLTX.bu() L1552-1559） */
export const ADMIN_SYSTEM_COLLECTIONS: ReadonlySet<string> = new Set([
  'system.roles',
  'system.users',
  'system.version',
  'system.keys'
])

/** config 库的系统集合（wLTX.bu() L1561-1563） */
export const CONFIG_SYSTEM_COLLECTIONS: ReadonlySet<string> = new Set(['system.sessions'])

/** 任何库都可能出现的系统集合（wLTX.bu() L1567-1575） */
export const SYSTEM_COLLECTIONS: ReadonlySet<string> = new Set([
  'system.namespaces',
  'system.indexes',
  'system.profile',
  'system.js',
  'system.views'
])

const GRIDFS_SUFFIXES = ['.files', '.chunks']
const TYPE_TIMESERIES = 'timeseries'

/** 判断集合是否系统集合（对应 wLTX.bu()；库名为空直接判否） */
export function isSystemCollection(database: string | null | undefined, name: string): boolean {
  if (!database || !name) return false
  if (database === 'admin' && ADMIN_SYSTEM_COLLECTIONS.has(name)) return true
  if (database === 'config' && CONFIG_SYSTEM_COLLECTIONS.has(name)) return true
  if (name.startsWith('system.buckets.')) return true
  return SYSTEM_COLLECTIONS.has(name)
}

/** GridFS 集合名 → 逻辑基名；非 GridFS 返回 null（对应 nK()） */
export function gridfsBaseName(name: string): string | null {
  for (const suffix of GRIDFS_SUFFIXES) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length)
    }
  }
  return null
}

/** 集合种类（树据此给不同徽标） */
export const CollectionKind = {
  NORMAL: 'normal',
  VIEW: 'view',
  SYSTEM: 'system',
  TIMESERIES: 'timeseries',
  CLUSTERED: 'clustered'
} as const
export type CollectionKindValue = (typeof CollectionKind)[keyof typeof CollectionKind]

export interface CollectionNode {
  name: string
  kind: CollectionKindValue
  database: string
  uuid: string | null
  /** 仅视图：定义在哪个集合上 */
  viewOn: string | null
  /** 仅视图：聚合管道 */
  pipeline: Value[] | null
  options: OrderedDoc
}

export function createCollectionNode(init: Partial<CollectionNode> & { name: string }): CollectionNode {
  return {
    name: init.name,
    kind: init.kind ?? CollectionKind.NORMAL,
    database: init.database ?? '',
    uuid: init.uuid ?? null,
    viewOn: init.viewOn ?? null,
    pipeline: init.pipeline ?? null,
    options: init.options ?? {}
  }
}

/** 排序键：普通集合在前，随后视图，最后系统集合 */
export function collectionSortKey(node: CollectionNode): { rank: number; name: string } {
  const rank =
    node.kind === CollectionKind.NORMAL ||
    node.kind === CollectionKind.TIMESERIES ||
    node.kind === CollectionKind.CLUSTERED
      ? 0
      : node.kind === CollectionKind.VIEW
        ? 1
        : node.kind === CollectionKind.SYSTEM
          ? 2
          : 3
  return { rank, name: node.name }
}

/** 按 (rank, name) 元组序比较显示顺序 */
function compareNodes(a: CollectionNode, b: CollectionNode): number {
  const ka = collectionSortKey(a)
  const kb = collectionSortKey(b)
  if (ka.rank !== kb.rank) return ka.rank - kb.rank
  return ka.name < kb.name ? -1 : ka.name > kb.name ? 1 : 0
}

/** 还原成 create 命令文档（对应 wxe2.aPy()） */
export function createCommand(node: CollectionNode): OrderedDoc {
  const document: OrderedDoc = { create: node.name }
  if (node.viewOn !== null) document.viewOn = node.viewOn
  if (node.pipeline !== null) document.pipeline = node.pipeline
  Object.assign(document, node.options)
  return document
}

export interface DatabaseContents {
  database: string
  collections: CollectionNode[]
  views: CollectionNode[]
  system: CollectionNode[]
  /** 与视图同名的普通集合（冲突对） */
  conflicts: CollectionNode[]
  uuids: Record<string, string>
  /** 成对出现的 GridFS 基名（fs.files + fs.chunks → {"fs"}） */
  gridfsBases: Set<string>
  loaded: boolean
  error: string | null
}

export function createDatabaseContents(database = ''): DatabaseContents {
  return {
    database,
    collections: [],
    views: [],
    system: [],
    conflicts: [],
    uuids: {},
    gridfsBases: new Set(),
    loaded: false,
    error: null
  }
}

export function contentsIsEmpty(contents: DatabaseContents): boolean {
  return !(contents.collections.length || contents.views.length || contents.system.length)
}

/** 按显示顺序返回全部节点：普通 → 视图 → 系统 */
export function allNodes(contents: DatabaseContents): CollectionNode[] {
  return [...contents.collections, ...contents.views, ...contents.system].sort(compareNodes)
}

export function findCollection(contents: DatabaseContents, name: string): CollectionNode | null {
  return allNodes(contents).find((node) => node.name === name) ?? null
}

export interface DatabaseNode {
  name: string
  contents: DatabaseContents
}

export function createDatabaseNode(name: string): DatabaseNode {
  return { name, contents: createDatabaseContents(name) }
}

export type ListCollectionsDoc = Record<string, unknown>
export type ListCollectionsFn = (database: string) => Promise<ListCollectionsDoc[]>
export type ListDatabaseNamesFn = () => Promise<string[]>

/** 把 listCollections 的原始返回统一成 {name,type,options,info} */
function normalizeInfo(info: unknown): ListCollectionsDoc {
  if (isPlainObject(info)) {
    const document: ListCollectionsDoc = { ...info }
    if (!('type' in document)) document.type = 'collection'
    if (!('options' in document)) document.options = {}
    if (!('info' in document)) document.info = {}
    return document
  }
  return { name: '', type: 'collection', options: {}, info: {} }
}

/** 分桶（对应 wLTX.o(String, List) L1097-1167） */
export function ingestContents(
  contents: DatabaseContents,
  database: string,
  documents: readonly ListCollectionsDoc[]
): void {
  contents.database = database
  contents.collections = []
  contents.views = []
  contents.system = []
  contents.conflicts = []
  contents.uuids = {}
  contents.gridfsBases = new Set()

  // GridFS 配对：同名基名出现两次以上才算成对（对应 hashMap 计数）
  const pairCounts: Record<string, number> = {}

  for (const raw of documents) {
    const document = normalizeInfo(raw)
    const name = String(document.name ?? '')
    if (!name) continue
    const kind = String(document.type ?? 'collection') || 'collection'
    const options = isPlainObject(document.options) ? document.options : {}
    const info = isPlainObject(document.info) ? document.info : {}
    let uuid: string | null = null
    if (info.uuid !== undefined && info.uuid !== null) {
      uuid = String(info.uuid)
      contents.uuids[name] = uuid
    }

    const node = createCollectionNode({ name, database, uuid, options: { ...options } })

    if (kind === 'view') {
      node.kind = CollectionKind.VIEW
      node.viewOn = typeof options.viewOn === 'string' ? options.viewOn : null
      node.pipeline = Array.isArray(options.pipeline) ? [...(options.pipeline as Value[])] : null
      contents.views.push(node)
      continue
    }

    if (isSystemCollection(database, name)) {
      node.kind = CollectionKind.SYSTEM
      contents.system.push(node)
      continue
    }

    if (kind === TYPE_TIMESERIES) {
      node.kind = CollectionKind.TIMESERIES
    } else if ('clusteredIndex' in options) {
      node.kind = CollectionKind.CLUSTERED
    }
    contents.collections.push(node)

    const base = gridfsBaseName(name)
    if (base !== null) pairCounts[base] = (pairCounts[base] ?? 0) + 1
  }

  // 成对的 GridFS 集合仍各自保留为节点，UI 可据此合并显示
  contents.gridfsBases = new Set(
    Object.entries(pairCounts)
      .filter(([, count]) => count >= 2)
      .map(([base]) => base)
  )

  contents.collections.sort(compareNodes)
  contents.views.sort(compareNodes)
  contents.system.sort(compareNodes)
}

/** 连接下的数据库树：懒加载 + 分桶缓存（数据获取经注入函数） */
export class DatabaseTree {
  private readonly databasesMap: Map<string, DatabaseNode> = new Map()

  constructor(
    private readonly listCollections: ListCollectionsFn | null = null,
    private readonly listDatabaseNames: ListDatabaseNamesFn | null = null
  ) {}

  /** 已加载数据库（按字典序，对应 TreeMap 语义） */
  get databaseNames(): string[] {
    return [...this.databasesMap.keys()].sort()
  }

  hasDatabase(name: string): boolean {
    return this.databasesMap.has(name)
  }

  node(name: string): DatabaseNode | null {
    return this.databasesMap.get(name) ?? null
  }

  private ensure(name: string): DatabaseNode {
    let node = this.databasesMap.get(name)
    if (node === undefined) {
      node = createDatabaseNode(name)
      this.databasesMap.set(name, node)
    }
    return node
  }

  /** 列出数据库名；无注入函数时返回本地已加载的库名 */
  async loadDatabaseNames(): Promise<string[]> {
    if (this.listDatabaseNames === null) return this.databaseNames
    try {
      const names = await this.listDatabaseNames()
      for (const name of names) this.ensure(name)
      return [...names].sort()
    } catch (exc) {
      for (const node of this.databasesMap.values()) {
        node.contents.error = String(exc)
      }
      throw exc
    }
  }

  /** 加载（或取缓存中的）一个库的集合列表；force 对应刷新动作 */
  async load(database: string, force = false): Promise<DatabaseContents> {
    const node = this.ensure(database)
    if (node.contents.loaded && !force) return node.contents
    if (this.listCollections === null) {
      node.contents.loaded = true
      return node.contents
    }
    try {
      const documents = await this.listCollections(database)
      ingestContents(node.contents, database, documents)
      node.contents.loaded = true
      node.contents.error = null
    } catch (exc) {
      node.contents.error = String(exc)
      throw exc
    }
    return node.contents
  }

  /** 离线 / 测试：直接喂 listCollections 的原始返回 */
  loadFromDocuments(database: string, documents: readonly ListCollectionsDoc[]): DatabaseContents {
    const node = this.ensure(database)
    ingestContents(node.contents, database, documents)
    node.contents.loaded = true
    node.contents.error = null
    return node.contents
  }

  /** 该库中成对出现的 GridFS 基名 */
  gridfsPairs(database: string): string[] {
    const contents = this.node(database)?.contents
    return contents ? [...contents.gridfsBases].sort() : []
  }
}

/** 字节数 → 可读大小 "1.43 MB" */
export function formatSize(size: number | null | undefined): string {
  if (size === null || size === undefined) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  if (index === 0) return `${Math.trunc(value)} ${units[index]}`
  return `${value.toFixed(2)} ${units[index]}`
}

/** datetime / ISO 字符串 → 短日期 "2026-01-02 03:04" */
export function formatTimestamp(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0')
    return `${value.getUTCFullYear()}-${p(value.getUTCMonth() + 1)}-${p(value.getUTCDate())} ` +
      `${p(value.getUTCHours())}:${p(value.getUTCMinutes())}`
  }
  return value.slice(0, 16).replace('T', ' ')
}
