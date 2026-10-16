/**
 * window.mongoApi 的薄封装：统一解包 IpcResult，失败时抛 Error。
 */
import type {
  AggregateRequest,
  AggregateResult,
  ConnectResult,
  CreateCollectionOptions,
  CreateIndexRequest,
  DatabaseSummary,
  DocTarget,
  FindRequest,
  FindResult,
  IndexInfo,
  SavedConnection
} from '../../../shared/types'

const api = window.mongoApi

async function unwrap<T>(promise: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(result.error)
  return result.data
}

export const backend = {
  listSaved: (): Promise<SavedConnection[]> => unwrap(api.listSaved()),
  saveConnection: (name: string, uri: string): Promise<SavedConnection[]> =>
    unwrap(api.saveConnection(name, uri)),
  removeSaved: (id: string): Promise<SavedConnection[]> => unwrap(api.removeSaved(id)),
  saveConnColor: (uri: string, color: string): Promise<SavedConnection[]> =>
    unwrap(api.saveConnColor(uri, color)),

  connect: (uri: string): Promise<ConnectResult> => unwrap(api.connect(uri)),
  disconnect: (connId: string): Promise<true> => unwrap(api.disconnect(connId)),

  listDatabases: (connId: string): Promise<DatabaseSummary[]> => unwrap(api.listDatabases(connId)),
  listCollections: (connId: string, db: string): Promise<string[]> =>
    unwrap(api.listCollections(connId, db)),

  find: (req: FindRequest): Promise<FindResult> => unwrap(api.find(req)),
  aggregate: (req: AggregateRequest): Promise<AggregateResult> => unwrap(api.aggregate(req)),
  count: (connId: string, db: string, coll: string, filter: string): Promise<number> =>
    unwrap(api.count(connId, db, coll, filter)),
  sampleSchema: (connId: string, db: string, coll: string, sampleSize: number): Promise<string[]> =>
    unwrap(api.sampleSchema(connId, db, coll, sampleSize)),

  // ---- 文档 CRUD（二期）----
  insertOne: (connId: string, db: string, coll: string, doc: string): Promise<string> =>
    unwrap(api.insertOne(connId, db, coll, doc)),
  replaceOne: (target: DocTarget, doc: string): Promise<string> =>
    unwrap(api.replaceOne(target, doc)),
  deleteOne: (target: DocTarget): Promise<true> => unwrap(api.deleteOne(target)),

  // ---- 集合管理（二期）----
  createCollection: (
    connId: string,
    db: string,
    name: string,
    opts?: CreateCollectionOptions
  ): Promise<true> => unwrap(api.createCollection(connId, db, name, opts)),
  dropCollection: (connId: string, db: string, name: string): Promise<true> =>
    unwrap(api.dropCollection(connId, db, name)),
  renameCollection: (connId: string, db: string, oldName: string, newName: string): Promise<true> =>
    unwrap(api.renameCollection(connId, db, oldName, newName)),

  // ---- 索引管理（二期）----
  listIndexes: (connId: string, db: string, coll: string): Promise<IndexInfo[]> =>
    unwrap(api.listIndexes(connId, db, coll)),
  createIndex: (req: CreateIndexRequest): Promise<string> => unwrap(api.createIndex(req)),
  dropIndex: (connId: string, db: string, coll: string, name: string): Promise<true> =>
    unwrap(api.dropIndex(connId, db, coll, name))
}
