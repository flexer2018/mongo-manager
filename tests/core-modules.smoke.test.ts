import { describe, expect, it } from 'vitest'
import { Int32, ObjectId } from 'bson'
import {
  DatabaseTree,
  CollectionKind,
  isSystemCollection,
  gridfsBaseName,
  formatSize,
  allNodes,
  inferSchema,
  fieldInfoIsMixed,
  Schema,
  walkValues,
  TypePalette,
  valueKind,
  ejsonParse,
  ejsonSerialize,
  deserializeDoc,
  deepCloneValue
} from '../src/core'

describe('db-tree', () => {
  const tree = new DatabaseTree()
  tree.loadFromDocuments('app', [
    { name: 'users', type: 'collection', options: {}, info: { uuid: 'u1' } },
    { name: 'events', type: 'timeseries', options: { timeseries: { timeField: 'ts' } }, info: {} },
    { name: 'audit', type: 'view', options: { viewOn: 'users', pipeline: [{ $match: {} }] }, info: {} },
    { name: 'system.js', type: 'collection', options: {}, info: {} },
    { name: 'fs.files', type: 'collection', options: {}, info: {} },
    { name: 'fs.chunks', type: 'collection', options: {}, info: {} }
  ])

  it('分桶与徽标', () => {
    const contents = tree.node('app')!.contents
    expect(contents.collections.map((n) => n.name)).toEqual(['events', 'fs.chunks', 'fs.files', 'users'])
    expect(contents.views[0].name).toBe('audit')
    expect(contents.system[0]).toMatchObject({ name: 'system.js', kind: CollectionKind.SYSTEM })
    expect([...contents.gridfsBases]).toEqual(['fs'])
    expect(contents.uuids).toEqual({ users: 'u1' })
  })

  it('显示顺序：普通 → 视图 → 系统', () => {
    expect(allNodes(tree.node('app')!.contents).map((n) => n.name)).toEqual([
      'events', 'fs.chunks', 'fs.files', 'users', 'audit', 'system.js'
    ])
  })

  it('系统集合与 GridFS 判定', () => {
    expect(isSystemCollection('admin', 'system.users')).toBe(true)
    expect(isSystemCollection('config', 'system.sessions')).toBe(true)
    expect(isSystemCollection('app', 'system.profile')).toBe(true)
    expect(isSystemCollection('app', 'system.buckets.weather')).toBe(true)
    expect(isSystemCollection('app', 'users')).toBe(false)
    expect(gridfsBaseName('fs.files')).toBe('fs')
    expect(gridfsBaseName('fs.filesx')).toBe(null)
  })

  it('懒加载树（注入取数函数）', async () => {
    const asyncTree = new DatabaseTree(
      async (db) => (db === 'db2' ? [{ name: 'c1' }] : []),
      async () => ['db1', 'db2']
    )
    expect(await asyncTree.loadDatabaseNames()).toEqual(['db1', 'db2'])
    const contents = await asyncTree.load('db2')
    expect(contents.collections[0].name).toBe('c1')
    const cached = await asyncTree.load('db2')
    expect(cached).toBe(contents)
  })

  it('formatSize', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(1536)).toBe('1.50 KB')
    expect(formatSize(null)).toBe('-')
  })
})

describe('schema', () => {
  it('walkValues 不递归数组、嵌套文档展平', () => {
    const pairs = [...walkValues({ a: { b: new Int32(1) }, arr: ['x'], e: {} })]
    expect(pairs.map(([p]) => p)).toEqual(['a.b', 'arr', 'e'])
  })

  it('类型归并与样例去重', () => {
    const schema = inferSchema([
      { status: 'active', n: new Int32(1) },
      { status: 'closed', n: 2.5 },
      { status: 'active', n: new Int32(3) }
    ])
    expect(schema.sampleCount).toBe(3)
    expect(schema.typeOf('status')).toBe('STRING')
    // int 优先级与 number 同为 9，int 先出现且计数更多 → NUMBER_INT
    expect(schema.typeOf('n')).toBe('NUMBER_INT')
    expect(schema.suggestValues('status')).toEqual(['active', 'closed'])
    expect(schema.names()).toEqual(['n', 'status'])
  })

  it('mixed 检测', () => {
    const schema = inferSchema([{ v: 'x' }, { v: new Int32(1) }])
    expect(fieldInfoIsMixed(schema.get('v')!)).toBe(true)
  })
})

describe('type-colors', () => {
  const palette = new TypePalette()

  it('值 → 图例类型 → 颜色', () => {
    expect(valueKind('hi')).toBe('string')
    expect(valueKind(new Int32(1))).toBe('number')
    expect(valueKind(new ObjectId('0'.repeat(24)))).toBe('objectid')
    expect(valueKind(null)).toBe('null')
    expect(palette.colorFor('hi')).toBe('#C7F2C0')
    expect(palette.colorFor(new Int32(1))).toBe('#CFE3FF')
  })

  it('开关与序列化往返', () => {
    palette.setEnabled('string', false)
    expect(palette.colorFor('hi')).toBe(null)
    palette.toggle('string')
    expect(palette.colorFor('hi')).toBe('#C7F2C0')
    const restored = TypePalette.fromDict(JSON.parse(JSON.stringify(palette.toDict())))
    expect(restored.labelOf('number')).toBe('Number')
    expect(restored.colorOfKind('string')).toBe('#C7F2C0')
  })
})

describe('ejson 边界', () => {
  it('ObjectId / Date 往返保真', () => {
    const doc = { _id: new ObjectId('64b000000000000000000001'), at: new Date(Date.UTC(2026, 0, 2, 3, 4)) }
    const text = ejsonSerialize(doc)
    const back = deserializeDoc(text)
    expect((back._id as ObjectId).equals(doc._id)).toBe(true)
    expect((back.at as Date).toISOString()).toBe(doc.at.toISOString())
    const clone = deepCloneValue(doc)
    expect((clone._id as ObjectId).equals(doc._id)).toBe(true)
    expect(ejsonSerialize(ejsonParse('{"$numberLong":"42"}'))).toBe('{"$numberLong":"42"}')
  })
})
