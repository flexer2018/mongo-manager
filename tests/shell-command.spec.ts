import { describe, expect, it } from 'vitest'
import { Int32 } from 'bson'
import { availableLanguages, generateFindCode, generateShellCommand } from '../src/core/query-code'
import {
  parseFindFilter,
  parseShellCommand,
  parseShellLiteral,
  toBson,
  toShellLiteral
} from '../src/core'

const tree = parseFindFilter('{ domains: "www.cshuixue.com" }')
const query = toBson(tree)

describe('generateShellCommand', () => {
  it('find：完整 db.getCollection 形态，含 limit', () => {
    const out = generateShellCommand('web', 'web_content_p10_0001', 'find', query, { limit: 100 })
    expect(out).toContain('db = db.getSiblingDB("web");')
    expect(out).toContain('db.getCollection("web_content_p10_0001").find({')
    expect(out).toContain('domains: "www.cshuixue.com"')
    expect(out).toContain('.limit(100);')
  })

  it('find：带 projection 时作为第二参数', () => {
    const out = generateShellCommand('web', 'c', 'find', query, { projection: { title: 1 } })
    expect(out).toContain('.find({')
    expect(out).toContain(', ')
    expect(out).toContain('title: 1')
  })

  it('deleteMany / deleteOne / countDocuments：仅带 filter', () => {
    expect(generateShellCommand('web', 'c', 'deleteMany', query)).toContain(
      'db.getCollection("c").deleteMany({\n  domains: "www.cshuixue.com"\n});'
    )
    expect(generateShellCommand('web', 'c', 'deleteOne', query)).toContain('.deleteOne({')
    expect(generateShellCommand('web', 'c', 'countDocuments', query)).toContain(
      '.countDocuments({'
    )
  })
})

describe('parseShellCommand', () => {
  it('find 命令：filter + projection + 链式 sort/skip/limit', () => {
    const parts = parseShellCommand(
      'db.getCollection("web_content_p10_0001").find({\n  domains: "www.cshuixue.com"\n}, {title: 1}).sort({ts: -1}).skip(20).limit(50);'
    )
    expect(parts.op).toBe('find')
    expect(parts.coll).toBe('web_content_p10_0001')
    expect(parts.filter).toEqual({ domains: 'www.cshuixue.com' })
    expect(parts.projection).toEqual({ title: new Int32(1) })
    expect(parts.sort).toEqual({ ts: new Int32(-1) })
    expect(parts.skip).toBe(20)
    expect(parts.limit).toBe(50)
  })

  it('deleteMany 命令（含 BSON 构造器与嵌套括号字符串）', () => {
    const parts = parseShellCommand(
      'db.c.deleteMany({ status: "off(", ts: ISODate("2024-01-01") })'
    )
    expect(parts.op).toBe('deleteMany')
    expect(parts.coll).toBe('c')
    expect(parts.projection).toBeNull()
    expect((parts.filter as Record<string, unknown>).status).toBe('off(')
  })

  it('db.c.find 短形态 / findOne 等价 find / countDocuments', () => {
    expect(parseShellCommand('db.c.find({})').op).toBe('find')
    expect(parseShellCommand('db.c.findOne({a: 1})').op).toBe('find')
    expect(parseShellCommand('db["c"].countDocuments({})').op).toBe('countDocuments')
  })

  it('updateMany：filter + 更新操作符文档 + 选项', () => {
    const parts = parseShellCommand(
      `db.getCollection("mf_tweet_202610").updateMany({
        keyword_processed: true,
        keyword_matched: false
      }, {'$unset': {keyword_processed: null}})`
    )
    expect(parts.op).toBe('updateMany')
    expect(parts.coll).toBe('mf_tweet_202610')
    expect(parts.filter).toEqual({ keyword_processed: true, keyword_matched: false })
    expect(parts.update).toEqual({ $unset: { keyword_processed: null } })
    expect(parts.options).toBeNull()

    const withOptions = parseShellCommand('db.c.updateMany({a: 1}, {$set: {b: 2}}, {upsert: true})')
    expect(withOptions.options).toEqual({ upsert: true })
    expect(parseShellCommand('db.c.updateOne({a: 1}, {$inc: {n: 1}})').op).toBe('updateOne')
  })

  it('update 文档必须是操作符形态，选项未知时报错', () => {
    expect(() => parseShellCommand('db.c.updateMany({}, {a: 1})')).toThrow(/更新操作符/)
    expect(() => parseShellCommand('db.c.updateMany({})')).toThrow(/两个参数/)
    expect(() => parseShellCommand('db.c.updateMany({}, {$set: {a: 1}}, {abc: 1})')).toThrow(
      /不支持的选项/
    )
  })

  it('不支持的操作报错、正常命令可通过', () => {
    expect(() => parseShellCommand('db.c.insertOne({a: 1})')).toThrow(/不支持的命令/)
    expect(() => parseShellCommand('db.c.find({})')).not.toThrow()
  })
})

describe('language registry', () => {
  it('注册名使用生成器实例名（LABELS 可匹配）', () => {
    expect(availableLanguages()).toEqual(['MongoDB Shell', 'Python', 'JavaScript (Node.js)'])
  })

  it('generateFindCode 按实例名解析语言', () => {
    const out = generateFindCode('web', 'c', query, { language: 'MongoDB Shell', limit: 100 })
    expect(out).toContain('db.getCollection("c").find({')
  })
})

describe('shell roundtrip', () => {
  it('generateShellCommand 产物可被 parseShellCommand 还原', () => {
    const cmd = generateShellCommand('web', 'c', 'find', toBson(tree), {
      projection: { title: 1 },
      sort: { ts: -1 },
      skip: 10,
      limit: 20
    })
    const parts = parseShellCommand(cmd)
    expect(parts.op).toBe('find')
    expect(parts.filter).toEqual({ domains: 'www.cshuixue.com' })
    // toShellLiteral 将整数渲染为 1.0（mongosh 浮点语法），回解析为普通 number
    expect(parts.projection).toEqual({ title: 1 })
    expect(parts.skip).toBe(10)
    expect(parts.limit).toBe(20)
  })

  it('toShellLiteral / parseShellLiteral 保持 BSON 类型', () => {
    const id = parseShellLiteral('ObjectId("64b000000000000000000000")')
    expect(toShellLiteral(id)).toBe('ObjectId("64b000000000000000000000")')
    const doc = parseShellLiteral('{ _id: ObjectId("64b000000000000000000000") }')
    expect(toShellLiteral(doc)).toBe(
      '{\n  _id: ObjectId("64b000000000000000000000")\n}'
    )
  })
})
