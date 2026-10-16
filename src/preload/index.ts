import { contextBridge, ipcRenderer } from 'electron'
import type {
  AggregateRequest,
  CreateCollectionOptions,
  CreateIndexRequest,
  DocTarget,
  FindRequest,
  MongoApi
} from '../shared/types'
import { IPC } from '../shared/types'

/** 渲染进程唯一数据访问入口：类型化 MongoApi（window.mongoApi） */
const api: MongoApi = {
  listSaved: () => ipcRenderer.invoke(IPC.listSaved),
  saveConnection: (name, uri) => ipcRenderer.invoke(IPC.saveConnection, name, uri),
  removeSaved: (id) => ipcRenderer.invoke(IPC.removeSaved, id),

  connect: (uri) => ipcRenderer.invoke(IPC.connect, uri),
  disconnect: (connId) => ipcRenderer.invoke(IPC.disconnect, connId),

  listDatabases: (connId) => ipcRenderer.invoke(IPC.listDatabases, connId),
  listCollections: (connId, db) => ipcRenderer.invoke(IPC.listCollections, connId, db),

  find: (req: FindRequest) => ipcRenderer.invoke(IPC.find, req),
  aggregate: (req: AggregateRequest) => ipcRenderer.invoke(IPC.aggregate, req),
  count: (connId, db, coll, filter) =>
    ipcRenderer.invoke(IPC.count, connId, db, coll, filter),
  sampleSchema: (connId, db, coll, sampleSize) =>
    ipcRenderer.invoke(IPC.sampleSchema, connId, db, coll, sampleSize),

  // ---- 文档 CRUD（二期）----
  insertOne: (connId, db, coll, doc) =>
    ipcRenderer.invoke(IPC.insertOne, connId, db, coll, doc),
  replaceOne: (target: DocTarget, doc) =>
    ipcRenderer.invoke(IPC.replaceOne, target, doc),
  deleteOne: (target: DocTarget) => ipcRenderer.invoke(IPC.deleteOne, target),

  // ---- 集合管理（二期）----
  createCollection: (connId, db, name, opts?: CreateCollectionOptions) =>
    ipcRenderer.invoke(IPC.createCollection, connId, db, name, opts),
  dropCollection: (connId, db, name) =>
    ipcRenderer.invoke(IPC.dropCollection, connId, db, name),
  renameCollection: (connId, db, oldName, newName) =>
    ipcRenderer.invoke(IPC.renameCollection, connId, db, oldName, newName),

  // ---- 索引管理（二期）----
  listIndexes: (connId, db, coll) =>
    ipcRenderer.invoke(IPC.listIndexes, connId, db, coll),
  createIndex: (req: CreateIndexRequest) => ipcRenderer.invoke(IPC.createIndex, req),
  dropIndex: (connId, db, coll, name) =>
    ipcRenderer.invoke(IPC.dropIndex, connId, db, coll, name)
}

contextBridge.exposeInMainWorld('mongoApi', api)
