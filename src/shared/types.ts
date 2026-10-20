/**
 * 主进程 / 渲染进程共享类型与 IPC 通道名。
 * 所有 BSON 文档在 IPC 上以 EJSON 字符串传递（见 core/ejson.ts）。
 */

/** 保存的连接（持久化到 userData/saved-connections.json） */
export interface SavedConnection {
  id: string
  name: string
  uri: string
  createdAt: number
  /** 连接标识色（树上区分用），可空 */
  color?: string
}

export interface ConnectResult {
  connId: string
  version: string
  /** URI 中隐含的默认库（可能为空串） */
  defaultDb: string
}

export interface DatabaseSummary {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface FindRequest {
  connId: string
  db: string
  coll: string
  /** EJSON 字符串；空串表示 {} */
  filter: string
  projection?: string
  sort?: string
  skip?: number
  limit: number
}

export interface FindResult {
  /** 每条文档一个 EJSON 字符串 */
  docs: string[]
  count: number
  elapsedMs: number
}

/** SQL 聚合（GROUP BY/COUNT 等）→ aggregate 管道执行请求；pipeline 为 EJSON 字符串 */
export interface AggregateRequest {
  connId: string
  db: string
  coll: string
  pipeline: string
}

export type AggregateResult = FindResult

/** _id 定位请求：id 为 _id 值的 EJSON 字符串（如 {"$oid":"..."} 或 1） */
export interface DocTarget {
  connId: string
  db: string
  coll: string
  id: string
}

export interface CreateCollectionOptions {
  /** 时间序列集合：timeField 必填，metaField/granularity 可选 */
  timeField?: string
  metaField?: string
  granularity?: 'seconds' | 'minutes' | 'hours'
  /** 聚簇集合：以 _id 聚簇 */
  clustered?: boolean
  /** 有序集合最大文档数（capped） */
  capped?: { size: number; max?: number }
}

export interface CreateIndexRequest {
  connId: string
  db: string
  coll: string
  /** 索引键 EJSON，如 {"field": 1} 或 {"loc": "2dsphere"} */
  keys: string
  /** 索引选项 EJSON，如 {"unique": true, "name": "my_idx"}；空串忽略 */
  options?: string
}

export interface IndexInfo {
  name: string
  keys: string
  unique: boolean
  sparse: boolean
  /** 原始 EJSON 字符串 */
  raw: string
}

/** 集合统计摘要（来自 collStats 命令） */
export interface CollectionStats {
  ns: string
  count: number
  size: number
  storageSize: number
  avgObjSize: number
  nindexes: number
  totalIndexSize: number
  capped: boolean
  /** 完整 collStats 输出（EJSON 字符串），供弹窗展示细节 */
  raw: string
  /** 单个集合读取失败时的错误信息（库级批量统计中用于占位展示） */
  error?: string
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** filter 更新的执行结果 */
export interface UpdateByFilterResult {
  matchedCount: number
  modifiedCount: number
  /** upsert 新插入文档的 _id（EJSON 字符串）；未 upsert 为 null */
  upsertedId: string | null
}

/** 渲染进程唯一可用的数据访问契约（preload 经 contextBridge 暴露） */
export interface MongoApi {
  listSaved(): Promise<IpcResult<SavedConnection[]>>
  saveConnection(name: string, uri: string): Promise<IpcResult<SavedConnection[]>>
  removeSaved(id: string): Promise<IpcResult<SavedConnection[]>>
  /** 按 URI 回写连接标识色（持久化） */
  saveConnColor(uri: string, color: string): Promise<IpcResult<SavedConnection[]>>

  connect(uri: string): Promise<IpcResult<ConnectResult>>
  disconnect(connId: string): Promise<IpcResult<true>>

  listDatabases(connId: string): Promise<IpcResult<DatabaseSummary[]>>
  /** listCollections 原始文档（EJSON 字符串数组），由渲染进程用 core/db-tree 分桶 */
  listCollections(connId: string, db: string): Promise<IpcResult<string[]>>

  find(req: FindRequest): Promise<IpcResult<FindResult>>
  count(connId: string, db: string, coll: string, filter: string): Promise<IpcResult<number>>
  /** 执行 aggregate 管道（EJSON 字符串），SQL 聚合查询走此通道 */
  aggregate(req: AggregateRequest): Promise<IpcResult<AggregateResult>>
  /** 随机采样文档（EJSON 字符串数组），渲染进程用 core/schema 推断 */
  sampleSchema(connId: string, db: string, coll: string, sampleSize: number): Promise<IpcResult<string[]>>

  // ---- 文档 CRUD（二期）----
  /** 插入文档（EJSON 字符串），返回插入后完整文档的 EJSON（含服务端生成的 _id） */
  insertOne(connId: string, db: string, coll: string, doc: string): Promise<IpcResult<string>>
  /** 整文档替换（保留原 _id），返回替换后的 EJSON 文档 */
  replaceOne(target: DocTarget, doc: string): Promise<IpcResult<string>>
  /** 按 _id 删除单条文档 */
  deleteOne(target: DocTarget): Promise<IpcResult<true>>
  /** 按 filter 删除文档（Shell 模式 deleteOne / deleteMany 命令），返回删除条数 */
  deleteByFilter(
    connId: string,
    db: string,
    coll: string,
    filter: string,
    op: 'deleteOne' | 'deleteMany'
  ): Promise<IpcResult<number>>

  /** 按 filter 更新文档（Shell 模式 updateOne / updateMany 命令） */
  updateByFilter(
    connId: string,
    db: string,
    coll: string,
    filter: string,
    update: string,
    op: 'updateOne' | 'updateMany',
    /** 选项 EJSON（upsert / arrayFilters …），空串表示无 */
    options?: string
  ): Promise<IpcResult<UpdateByFilterResult>>

  // ---- 集合管理（二期）----
  /** 创建集合；opts 支持 timeField（时间序列）/clustered/capped */
  createCollection(connId: string, db: string, name: string, opts?: CreateCollectionOptions): Promise<IpcResult<true>>
  dropCollection(connId: string, db: string, name: string): Promise<IpcResult<true>>
  renameCollection(connId: string, db: string, oldName: string, newName: string): Promise<IpcResult<true>>

  // ---- 索引管理（二期）----
  listIndexes(connId: string, db: string, coll: string): Promise<IpcResult<IndexInfo[]>>
  createIndex(req: CreateIndexRequest): Promise<IpcResult<string>>
  dropIndex(connId: string, db: string, coll: string, name: string): Promise<IpcResult<true>>

  /** 集合统计（collStats 命令），用于树上右键「查看集合统计」 */
  collStats(connId: string, db: string, coll: string): Promise<IpcResult<CollectionStats>>
  /** 库级批量统计：该库所有非视图集合的统计数据（树上库名右键「查看所有集合统计」） */
  collStatsAll(connId: string, db: string): Promise<IpcResult<CollectionStats[]>>
}

export const IPC = {
  listSaved: 'conn:listSaved',
  saveConnection: 'conn:save',
  removeSaved: 'conn:remove',
  saveConnColor: 'conn:saveColor',
  connect: 'conn:connect',
  disconnect: 'conn:disconnect',
  listDatabases: 'db:list',
  listCollections: 'coll:list',
  find: 'docs:find',
  count: 'docs:count',
  aggregate: 'docs:aggregate',
  sampleSchema: 'schema:sample',

  insertOne: 'docs:insertOne',
  replaceOne: 'docs:replaceOne',
  deleteOne: 'docs:deleteOne',
  deleteByFilter: 'docs:deleteByFilter',
  updateByFilter: 'docs:updateByFilter',

  createCollection: 'coll:create',
  dropCollection: 'coll:drop',
  renameCollection: 'coll:rename',

  listIndexes: 'idx:list',
  createIndex: 'idx:create',
  dropIndex: 'idx:drop',

  collStats: 'coll:stats',
  collStatsAll: 'coll:statsAll'
} as const
