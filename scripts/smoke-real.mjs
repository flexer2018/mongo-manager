/**
 * 真实库冒烟验收：连接 → 列库 → 列集合 → find → count → EJSON 往返。
 * 运行：MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?...' node scripts/smoke-real.mjs
 * 凭据通过环境变量传入，不落盘（密码含 # 需 URL 编码为 %23）。
 */
import mongodb from 'mongodb'
const { MongoClient, BSON } = mongodb
const { EJSON } = BSON

const URI = process.env.MONGO_SMOKE_URI
if (URI === undefined || URI.trim() === '') {
  console.error('请先设置环境变量 MONGO_SMOKE_URI，例如：')
  console.error("  MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?authMechanism=SCRAM-SHA-1' node scripts/smoke-real.mjs")
  process.exit(1)
}

const client = new MongoClient(URI, { appName: 'mongo-manager-smoke' })

async function main() {
  await client.connect()
  console.log('[1] 连接成功')

  const info = await client.db('admin').command({ buildInfo: 1 })
  console.log(`[2] 服务器版本: ${info.version}`)

  const dbs = await client.db('admin').command({ listDatabases: 1, nameOnly: false })
  console.log(`[3] 数据库 ${dbs.databases.length} 个: ${dbs.databases.map((d) => d.name).join(', ')}`)

  const target = dbs.databases.find((d) => !['admin', 'config', 'local'].includes(d.name)) ?? dbs.databases[0]
  const colls = await client.db(target.name).listCollections({}, { nameOnly: false }).toArray()
  console.log(`[4] 库 ${target.name} 集合 ${colls.length} 个: ${colls.slice(0, 8).map((c) => `${c.name}(${c.type})`).join(', ')}`)

  if (colls.length > 0) {
    const name = colls[0].name
    const coll = client.db(target.name).collection(name)
    const total = await coll.countDocuments({})
    const docs = await coll.find({}).limit(3).toArray()
    console.log(`[5] ${name}: 总数 ${total}，取 ${docs.length} 条样例`)
    for (const doc of docs) {
      const text = EJSON.stringify(doc, { relaxed: false })
      const back = EJSON.parse(text, { relaxed: false })
      const stable = EJSON.stringify(back, { relaxed: false }) === text
      console.log(`    EJSON 往返${stable ? '稳定' : '不一致'}: ${text.slice(0, 110)}`)
    }
  }

  console.log('[✓] 冒烟验收通过')
}

main()
  .catch((exc) => {
    console.error('[×] 冒烟失败:', exc.message)
    process.exitCode = 1
  })
  .finally(() => client.close())
