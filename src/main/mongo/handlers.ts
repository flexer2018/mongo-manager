/**
 * 全部 IPC 通道注册：主进程只做薄数据库代理。
 * 统一错误回传：{ ok: true, data } | { ok: false, error }，
 * BSON 文档一律 EJSON.stringify({relaxed:false}) 过 IPC。
 */
import { ipcMain } from 'electron'
import { EJSON } from 'bson'
import type { Document, Sort, UpdateOptions } from 'mongodb'
import {
  ConnectionManager,
  addSaved,
  loadSaved,
  removeSaved,
  updateSavedColor
} from './connection-manager'
import {
  AggregateRequest,
  CollectionStats,
  CreateCollectionOptions,
  CreateIndexRequest,
  DocTarget,
  FindRequest,
  IPC,
  IpcResult,
  IndexInfo
} from '../../shared/types'

const connections = new ConnectionManager()

/** 包装 handler：把异常转成 { ok:false, error }，避免渲染进程拿到空拒绝 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function handle<T>(channel: string, fn: (...args: any[]) => Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args: any[]): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...args) }
    } catch (exc) {
      const message = exc instanceof Error ? exc.message : String(exc)
      console.error(`IPC ${channel} 失败:`, message)
      return { ok: false, error: message }
    }
  })
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** EJSON 安全序列化（ObjectId/Long/Date/Binary 保真） */
function ejson(value: unknown): string {
  return EJSON.stringify(value, { relaxed: false })
}

/** 解析渲染进程传来的 EJSON 查询/文档；空串视为空文档 */
function parseEjson(text: string | undefined): Record<string, unknown> {
  if (text === undefined || text.trim() === '') return {}
  const parsed = parseEjsonValue(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('EJSON 文本不是文档（{...}）')
  }
  return parsed as Record<string, unknown>
}

/** 解析任意 EJSON 值（可为标量，如 _id） */
function parseEjsonValue(text: string): unknown {
  try {
    return EJSON.parse(text, { relaxed: false })
  } catch {
    throw new Error(`EJSON 解析失败: ${text.slice(0, 120)}`)
  }
}

/** 解析 DocTarget 中的 _id（EJSON 值，可能是 ObjectId/数字/字符串） */
function parseId(target: DocTarget): unknown {
  if (target.id === undefined || target.id.trim() === '') {
    throw new Error('缺少 _id')
  }
  return parseEjsonValue(target.id)
}

/** 将 CreateCollectionOptions 映射为驱动 createCollection 选项 */
function buildCreateOptions(opts?: CreateCollectionOptions): Document {
  if (!opts) return {}
  const out: Document = {}
  if (opts.timeField) {
    out.timeseries = {
      timeField: opts.timeField,
      ...(opts.metaField ? { metaField: opts.metaField } : {}),
      ...(opts.granularity ? { granularity: opts.granularity } : {})
    }
  }
  if (opts.clustered) {
    out.clusteredIndex = { key: { _id: 1 }, unique: true }
  }
  if (opts.capped && opts.capped.size > 0) {
    out.capped = true
    out.size = opts.capped.size
    if (opts.capped.max && opts.capped.max > 0) out.max = opts.capped.max
  }
  return out
}

export function registerMongoHandlers(): void {
  handle(IPC.listSaved, async () => loadSaved())
  handle(IPC.saveConnection, async (name: string, uri: string) => addSaved(name, uri))
  handle(IPC.removeSaved, async (id: string) => removeSaved(id))
  handle(IPC.saveConnColor, async (uri: string, color: string) => updateSavedColor(uri, color))

  handle(IPC.connect, async (uri: string) => connections.connect(uri))

  handle(IPC.disconnect, async (connId: string) => {
    await connections.disconnect(connId)
    return true as const
  })

  handle(IPC.listDatabases, async (connId: string) => {
    const client = connections.client(connId)
    const admin = client.db('admin')
    const info = await admin.command({ listDatabases: 1, nameOnly: false })
    const databases = (info.databases ?? []) as {
      name: string
      sizeOnDisk?: number
      empty?: boolean
    }[]
    return databases.map((db) => ({
      name: String(db.name),
      sizeOnDisk: Number(db.sizeOnDisk ?? 0),
      empty: Boolean(db.empty ?? false)
    }))
  })

  handle(IPC.listCollections, async (connId: string, db: string) => {
    const colls = await connections
      .client(connId)
      .db(db)
      .listCollections({}, { nameOnly: false, authorizedCollections: true })
      .toArray()
    return colls.map((coll) => ejson(coll))
  })

  handle(IPC.find, async (req: FindRequest) => {
    const started = Date.now()
    const filter = parseEjson(req.filter)
    const projection = req.projection ? parseEjson(req.projection) : undefined
    const sort = req.sort ? parseEjson(req.sort) : undefined
    const cursor = connections
      .client(req.connId)
      .db(req.db)
      .collection(req.coll)
      .find(filter as Document, {
        projection: projection as Document,
        sort: sort as Sort,
        skip: req.skip,
        limit: req.limit
      })
    const docs = await cursor.toArray()
    return {
      docs: docs.map((doc) => ejson(doc)),
      count: docs.length,
      elapsedMs: Date.now() - started
    }
  })

  handle(IPC.count, async (connId: string, db: string, coll: string, filterText: string) => {
    const filter = parseEjson(filterText)
    return connections.client(connId).db(db).collection(coll).countDocuments(filter)
  })

  handle(IPC.aggregate, async (req: AggregateRequest) => {
    const started = Date.now()
    const parsed = EJSON.parse(req.pipeline, { relaxed: false })
    if (!Array.isArray(parsed)) throw new Error('aggregate 管道必须是数组')
    const docs = await connections
      .client(req.connId)
      .db(req.db)
      .collection(req.coll)
      .aggregate(parsed as Document[], { allowDiskUse: true })
      .toArray()
    return {
      docs: docs.map((doc) => ejson(doc)),
      count: docs.length,
      elapsedMs: Date.now() - started
    }
  })

  handle(
    IPC.sampleSchema,
    async (connId: string, db: string, coll: string, sampleSize: number) => {
      const size = Math.max(1, Math.min(Number(sampleSize) || 200, 2000))
      const docs = await connections
        .client(connId)
        .db(db)
        .collection(coll)
        .aggregate([{ $sample: { size } }])
        .toArray()
      return docs.map((doc) => ejson(doc))
    }
  )

  // ---- 文档 CRUD（二期）----

  handle(IPC.insertOne, async (connId: string, db: string, coll: string, docText: string) => {
    const doc = parseEjson(docText)
    const collection = connections.client(connId).db(db).collection(coll)
    const result = await collection.insertOne(doc as Document)
    const inserted = await collection.findOne({ _id: result.insertedId })
    return ejson(inserted ?? { _id: result.insertedId })
  })

  handle(IPC.replaceOne, async (target: DocTarget, docText: string) => {
    const id = parseId(target)
    const doc = parseEjson(docText)
    // 替换文档不允许携带 _id：始终保留原 _id，防止用户改写造成错位
    delete doc._id
    const collection = connections.client(target.connId).db(target.db).collection(target.coll)
    const result = await collection.replaceOne({ _id: id } as Document, doc as Document)
    if (result.matchedCount === 0) {
      throw new Error('文档不存在或已被删除（_id 未匹配）')
    }
    const updated = await collection.findOne({ _id: id } as Document)
    return ejson(updated ?? {})
  })

  handle(IPC.deleteOne, async (target: DocTarget) => {
    const id = parseId(target)
    const result = await connections
      .client(target.connId)
      .db(target.db)
      .collection(target.coll)
      .deleteOne({ _id: id } as Document)
    if (result.deletedCount === 0) {
      throw new Error('文档不存在或已被删除（_id 未匹配）')
    }
    return true as const
  })

  handle(
    IPC.deleteByFilter,
    async (
      connId: string,
      db: string,
      coll: string,
      filterText: string,
      op: 'deleteOne' | 'deleteMany'
    ) => {
      const filter = parseEjson(filterText)
      const collection = connections.client(connId).db(db).collection(coll)
      const result =
        op === 'deleteOne'
          ? await collection.deleteOne(filter as Document)
          : await collection.deleteMany(filter as Document)
      return result.deletedCount
    }
  )

  handle(
    IPC.updateByFilter,
    async (
      connId: string,
      db: string,
      coll: string,
      filterText: string,
      updateText: string,
      op: 'updateOne' | 'updateMany',
      optionsText?: string
    ) => {
      const filter = parseEjson(filterText)
      // update 既可以是更新文档，也可以是聚合管道数组，故用任意值解析
      const update = parseEjsonValue(updateText)
      const options =
        optionsText !== undefined && optionsText.trim() !== ''
          ? (parseEjson(optionsText) as UpdateOptions)
          : {}
      const collection = connections.client(connId).db(db).collection(coll)
      const target = update as Document | Document[]
      const result =
        op === 'updateOne'
          ? await collection.updateOne(filter as Document, target as Document, options)
          : await collection.updateMany(filter as Document, target as Document, options)
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
        upsertedId:
          result.upsertedId === undefined || result.upsertedId === null
            ? null
            : ejson(result.upsertedId)
      }
    }
  )

  // ---- 集合管理（二期）----

  handle(
    IPC.createCollection,
    async (connId: string, db: string, name: string, opts?: CreateCollectionOptions) => {
      if (!name.trim()) throw new Error('集合名不能为空')
      await connections
        .client(connId)
        .db(db)
        .createCollection(name.trim(), buildCreateOptions(opts))
      return true as const
    }
  )

  handle(IPC.dropCollection, async (connId: string, db: string, name: string) => {
    const dropped = await connections.client(connId).db(db).dropCollection(name)
    if (!dropped) throw new Error(`集合 ${db}.${name} 不存在`)
    return true as const
  })

  handle(IPC.renameCollection, async (connId: string, db: string, oldName: string, newName: string) => {
    if (!newName.trim()) throw new Error('新集合名不能为空')
    await connections
      .client(connId)
      .db(db)
      .collection(oldName)
      .rename(newName.trim(), { dropTarget: false })
    return true as const
  })

  // ---- 索引管理（二期）----

  handle(IPC.listIndexes, async (connId: string, db: string, coll: string) => {
    const indexes = await connections
      .client(connId)
      .db(db)
      .collection(coll)
      .listIndexes()
      .toArray()
    return indexes.map((idx): IndexInfo => {
      const options = (idx as Document).unique || (idx as Document).sparse
      return {
        name: String(idx.name ?? ''),
        keys: ejson(idx.key ?? {}),
        unique: Boolean(options && (idx as Document).unique),
        sparse: Boolean(options && (idx as Document).sparse),
        raw: ejson(idx)
      }
    })
  })

  handle(IPC.createIndex, async (req: CreateIndexRequest) => {
    const keys = parseEjson(req.keys) as Document
    if (Object.keys(keys).length === 0) throw new Error('索引键不能为空')
    const options = req.options && req.options.trim() !== '' ? parseEjson(req.options) : {}
    const name = await connections
      .client(req.connId)
      .db(req.db)
      .collection(req.coll)
      .createIndex(keys, options)
    return name
  })

  handle(IPC.dropIndex, async (connId: string, db: string, coll: string, name: string) => {
    if (!name || name === '_id_') throw new Error('_id 索引不可删除')
    await connections.client(connId).db(db).collection(coll).dropIndex(name)
    return true as const
  })

  // ---- 集合统计 ----

  handle(IPC.collStats, async (connId: string, db: string, coll: string) => {
    const database = connections.client(connId).db(db)
    // 视图等不支持 collStats 的集合回退到 $collStats 聚合
    const stats =
      (await database.command({ collStats: coll }).catch(async () => {
        const [doc] = await database
          .collection(coll)
          .aggregate([{ $collStats: { storageStats: {} } }])
          .toArray()
        return { ...(doc ?? {}), ...((doc?.storageStats as Document | undefined) ?? {}) }
      })) as Document
    const num = (value: unknown): number => {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return {
      ns: String(stats.ns ?? `${db}.${coll}`),
      count: num(stats.count),
      size: num(stats.size),
      storageSize: num(stats.storageSize),
      avgObjSize: num(stats.avgObjSize),
      nindexes: num(stats.nindexes),
      totalIndexSize: num(stats.totalIndexSize),
      capped: Boolean(stats.capped),
      raw: ejson(stats)
    } satisfies CollectionStats
  })
}

export async function closeAllConnections(): Promise<void> {
  await connections.closeAll()
}
