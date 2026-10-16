/**
 * 二期 CRUD 冒烟验收：在专用临时库 mm_smoke_test_db 中验证
 * 集合创建/重命名/删除、索引创建/列表/删除、文档插入/替换/删除。
 * 全程不触碰真实业务数据，结束后 dropDatabase 自清理。
 * 运行：MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?...' node scripts/smoke-crud.mjs
 * 凭据通过环境变量传入，不落盘（密码含 # 需 URL 编码为 %23）。
 */
import mongodb from 'mongodb'
const { MongoClient, BSON } = mongodb
const { EJSON, Int32 } = BSON

const URI = process.env.MONGO_SMOKE_URI
if (URI === undefined || URI.trim() === '') {
  console.error('请先设置环境变量 MONGO_SMOKE_URI，例如：')
  console.error("  MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?authMechanism=SCRAM-SHA-1' node scripts/smoke-crud.mjs")
  process.exit(1)
}

const DB = 'mm_smoke_test_db'
const COLL = 'mm_smoke_test'
const RENAMED = 'mm_smoke_test_renamed'

const client = new MongoClient(URI, { appName: 'mongo-manager-crud-smoke' })

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`验收失败 [${label}] ${detail}`)
  console.log(`[✓] ${label}${detail !== '' ? ` — ${detail}` : ''}`)
}

async function main() {
  await client.connect()
  console.log('[1] 连接成功')
  const db = client.db(DB)

  // 确保起点干净
  await db.dropDatabase().catch(() => {})

  // ---- 集合创建 ----
  await db.createCollection(COLL)
  let names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  check('创建集合', names.includes(COLL), COLL)

  // ---- 重命名 ----
  await db.collection(COLL).rename(RENAMED, { dropTarget: false })
  names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  check('重命名集合', !names.includes(COLL) && names.includes(RENAMED), `${COLL} → ${RENAMED}`)
  await db.collection(RENAMED).rename(COLL, { dropTarget: false })

  // ---- 索引 ----
  const indexName = await db.collection(COLL).createIndex({ score: 1, tag: 1 }, { name: 'score_tag_idx' })
  check('创建复合索引', indexName === 'score_tag_idx', indexName)
  const indexes = await db.collection(COLL).listIndexes().toArray()
  check('列出索引', indexes.some((i) => i.name === 'score_tag_idx'), indexes.map((i) => i.name).join(', '))
  await db.collection(COLL).createIndex({ email: 1 }, { unique: true, name: 'email_unique' })
  await db.collection(COLL).dropIndex('score_tag_idx')
  const afterDrop = await db.collection(COLL).listIndexes().toArray()
  check('删除索引', !afterDrop.some((i) => i.name === 'score_tag_idx') && afterDrop.some((i) => i.name === 'email_unique'))

  // ---- 文档插入（含服务端生成的 _id 与 BSON 类型保真）----
  const coll = db.collection(COLL)
  const doc = { name: '冒烟测试', score: new Int32(95), tags: ['a', 'b'], nested: { ok: true } }
  const insertResult = await coll.insertOne(doc)
  const inserted = await coll.findOne({ _id: insertResult.insertedId })
  // 注：Node 驱动默认 promoteValues:true，int32 反序列化为普通 number，两者都算类型正确
  check(
    '插入文档',
    inserted !== null &&
      inserted.name === '冒烟测试' &&
      (inserted.score instanceof Int32 || inserted.score === 95)
  )
  const ejsonText = EJSON.stringify(inserted, { relaxed: false })
  const roundTrip = EJSON.stringify(EJSON.parse(ejsonText, { relaxed: false }), { relaxed: false })
  check('EJSON 往返稳定', roundTrip === ejsonText, ejsonText.slice(0, 100))

  // ---- 文档替换（保留 _id）----
  const replacement = { name: '已修改', score: new Int32(100), extra: 'x' }
  await coll.replaceOne({ _id: insertResult.insertedId }, replacement)
  const replaced = await coll.findOne({ _id: insertResult.insertedId })
  check('替换文档', replaced !== null && replaced.name === '已修改' && String(replaced._id) === String(insertResult.insertedId))

  // ---- unique 索引生效 ----
  let uniqueRejected = false
  try {
    await coll.insertOne({ email: null, name: 'dup1' })
    await coll.insertOne({ email: null, name: 'dup2' })
  } catch {
    uniqueRejected = true
  }
  check('unique 索引拒绝重复', uniqueRejected)

  // ---- 文档删除 ----
  const deleteResult = await coll.deleteOne({ _id: insertResult.insertedId })
  const gone = await coll.findOne({ _id: insertResult.insertedId })
  check('删除文档', deleteResult.deletedCount === 1 && gone === null)

  // ---- 删除集合 ----
  await db.dropCollection(COLL)
  names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  check('删除集合', !names.includes(COLL))

  // ---- 自清理 ----
  await db.dropDatabase()
  const dbs = await client.db('admin').command({ listDatabases: 1, nameOnly: true })
  check('临时库自清理', !dbs.databases.some((d) => d.name === DB))

  console.log('[✓] CRUD 冒烟验收全部通过')
}

main()
  .catch((exc) => {
    console.error('[×] 冒烟失败:', exc.message)
    process.exitCode = 1
  })
  .finally(() => client.close())
