import { describe, expect, it } from 'vitest'
import { likeToRegex, parseSqlSelect, sqlToMongo } from '../src/core/sql'
import { mongoFilterToSql } from '../src/core/sql-reverse'
import { EJSON } from 'bson'
import type { SqlToMongoResult } from '../src/core/sql'

function find(sql: string): Extract<SqlToMongoResult, { mode: 'find' }> {
  const result = sqlToMongo(sql)
  if (result.mode !== 'find') throw new Error(`期望 find，实际为 ${result.mode}`)
  return result
}

function aggregate(sql: string): Record<string, unknown>[] {
  const result = sqlToMongo(sql)
  if (result.mode !== 'aggregate') throw new Error(`期望 aggregate，实际为 ${result.mode}`)
  return result.pipeline
}

describe('parseSqlSelect', () => {
  it('解析完整 SELECT 子集', () => {
    const stmt = parseSqlSelect(
      'SELECT name, age FROM `users` WHERE age > 25 ORDER BY age DESC, name ASC LIMIT 50 OFFSET 100'
    )
    expect(stmt.table).toBe('users')
    expect(stmt.items?.map((item) => item.field)).toEqual(['name', 'age'])
    expect(stmt.orderBy).toEqual([
      { field: 'age', desc: true },
      { field: 'name', desc: false }
    ])
    expect(stmt.limit).toBe(50)
    expect(stmt.offset).toBe(100)
  })

  it('解析 MySQL 风格 LIMIT offset, count', () => {
    const stmt = parseSqlSelect('SELECT * FROM t LIMIT 100, 20')
    expect(stmt.limit).toBe(20)
    expect(stmt.offset).toBe(100)
  })

  it('解析聚合输出项与 GROUP BY', () => {
    const stmt = parseSqlSelect('SELECT status, count(*) AS cnt FROM t GROUP BY status')
    expect(stmt.groupBy).toEqual(['status'])
    expect(stmt.items?.[1]).toEqual({ kind: 'aggregate', field: '*', func: 'COUNT', alias: 'cnt' })
  })

  it('拒绝非 SELECT 语句', () => {
    expect(() => parseSqlSelect('DELETE FROM t')).toThrow('仅支持 SELECT')
  })

  it('拒绝 JOIN 与 DISTINCT', () => {
    expect(() => parseSqlSelect('SELECT DISTINCT a FROM t')).toThrow()
    expect(() => parseSqlSelect('SELECT * FROM a JOIN b ON a.id = b.id')).toThrow()
  })
})

describe('sqlToMongo find 形态', () => {
  it('比较运算符映射', () => {
    const result = find("SELECT * FROM t WHERE a = 1 AND b != 2 AND c >= 3 AND d <> 'x'")
    expect(EJSON.stringify(result.filter)).toBe(
      EJSON.stringify({ a: 1, b: { $ne: 2 }, c: { $gte: 3 }, d: { $ne: 'x' } })
    )
  })

  it('IN / BETWEEN / IS NULL / LIKE 映射', () => {
    const result = find(
      "SELECT * FROM t WHERE status IN ('a','b') AND age BETWEEN 18 AND 30 AND note IS NULL AND name LIKE '张%'"
    )
    const filter = result.filter as Record<string, Record<string, unknown>>
    expect(filter.status.$in).toEqual(['a', 'b'])
    expect(filter.age.$gte).toBe(18)
    expect(filter.age.$lte).toBe(30)
    expect(filter.note).toBeNull()
    expect(filter.name.$regex).toBe('^张.*$')
    expect(filter.name.$options).toBe('i')
  })

  it('NOT IN / NOT BETWEEN / IS NOT NULL', () => {
    const result = find('SELECT * FROM t WHERE a NOT IN (1,2) AND b NOT BETWEEN 1 AND 2 AND c IS NOT NULL')
    const filter = result.filter as Record<string, Record<string, unknown>>
    expect(filter.a.$nin).toEqual([1, 2])
    expect(filter.b.$not).toEqual({ $gte: 1, $lte: 2 })
    expect(filter.c).toEqual({ $ne: null })
  })

  it('OR 与括号嵌套 → $or / $and', () => {
    const result = find('SELECT * FROM t WHERE (a = 1 OR b = 2) AND c = 3')
    expect(result.filter.$or).toEqual([{ a: 1 }, { b: 2 }])
    expect(result.filter.c).toBe(3)
  })

  it('NOT → $nor', () => {
    const result = find('SELECT * FROM t WHERE NOT a = 1')
    expect(result.filter.$nor).toEqual([{ a: 1 }])
  })

  it('同字段多条件合并为操作符文档', () => {
    const result = find('SELECT * FROM t WHERE a > 1 AND a < 9 AND b = 1')
    expect(result.filter.a).toEqual({ $gt: 1, $lt: 9 })
    expect(result.filter.b).toBe(1)
  })

  it('显式列 → projection（排除 _id）', () => {
    const result = find('SELECT name, age FROM t')
    expect(result.projection).toEqual({ name: 1, age: 1, _id: 0 })
    expect(result.sort).toBeNull()
  })

  it('ORDER BY → sort', () => {
    const result = find('SELECT * FROM t ORDER BY a DESC, b')
    expect(result.sort).toEqual({ a: -1, b: 1 })
  })

  it('LIKE 特殊字符正则转义', () => {
    expect(likeToRegex('50%_off.v1')).toBe('^50.*.off\\.v1$')
  })
})

describe('sqlToMongo aggregate 形态', () => {
  it('GROUP BY + COUNT(*) 完整管道', () => {
    const pipeline = aggregate(
      'SELECT status, count(*) AS cnt FROM ZwUsers WHERE age > 18 GROUP BY status ORDER BY cnt DESC LIMIT 10'
    )
    expect(pipeline[0]).toEqual({ $match: { age: { $gt: 18 } } })
    expect(pipeline[1]).toEqual({ $group: { _id: '$status', cnt: { $sum: 1 } } })
    expect(pipeline[2]).toEqual({ $project: { status: '$_id', cnt: 1, _id: 0 } })
    expect(pipeline[3]).toEqual({ $sort: { cnt: -1 } })
    expect(pipeline[4]).toEqual({ $limit: 10 })
  })

  it('多字段 GROUP BY → 复合 _id', () => {
    const pipeline = aggregate('SELECT a, b, count(*) FROM t GROUP BY a, b')
    const group = pipeline[0].$group as Record<string, unknown>
    expect(group._id).toEqual({ a: '$a', b: '$b' })
    expect(group['count']).toEqual({ $sum: 1 })
    const project = pipeline[1].$project as Record<string, unknown>
    expect(project.a).toBe('$_id.a')
    expect(project.b).toBe('$_id.b')
  })

  it('无 GROUP BY 的全表聚合 → _id: null', () => {
    const pipeline = aggregate('SELECT count(*) AS total FROM t')
    const group = pipeline[0].$group as Record<string, unknown>
    expect(group._id).toBeNull()
    expect(group.total).toEqual({ $sum: 1 })
  })

  it('SUM/AVG/MIN/MAX 与 COUNT(col) 排除非空', () => {
    const pipeline = aggregate('SELECT sum(age) AS s, avg(age) AS a, min(age) AS mn, max(age) AS mx, count(age) AS c FROM t')
    const group = pipeline[0].$group as Record<string, Record<string, unknown>>
    expect(group.s).toEqual({ $sum: '$age' })
    expect(group.a).toEqual({ $avg: '$age' })
    expect(group.mn).toEqual({ $min: '$age' })
    expect(group.mx).toEqual({ $max: '$age' })
    expect(group.c).toEqual({ $sum: { $cond: [{ $ifNull: ['$age', false] }, 1, 0] } })
  })

  it('普通列不在 GROUP BY 中时报错', () => {
    expect(() => sqlToMongo('SELECT a, count(*) FROM t GROUP BY b')).toThrow('GROUP BY')
  })

  it('ORDER BY 引用非分组字段时报错', () => {
    expect(() => sqlToMongo('SELECT a, count(*) AS c FROM t GROUP BY a ORDER BY x')).toThrow('ORDER BY')
  })

  it('HAVING 显式不支持', () => {
    expect(() => sqlToMongo('SELECT a, count(*) AS c FROM t GROUP BY a HAVING c > 1')).toThrow('HAVING')
  })
})

describe('mongoFilterToSql 反向展示', () => {
  it('标量与操作符映射', () => {
    const sql = mongoFilterToSql({ a: 1, b: { $gte: 2, $lte: 9 }, c: { $in: ['x', 'y'] } }, 't')
    expect(sql).toBe("SELECT * FROM t\nWHERE a = 1\n  AND b BETWEEN 2 AND 9\n  AND c IN ('x', 'y')")
  })

  it('$or / $nor / $regex 锚定模式', () => {
    const sql = mongoFilterToSql({ $or: [{ a: 1 }, { b: 2 }], name: { $regex: '^张.*$' } }, 't')
    expect(sql).toContain('((a = 1) OR (b = 2))')
    expect(sql).toContain("name LIKE '张%'")
  })

  it('ObjectId EJSON 形态 → 字符串字面量', () => {
    const sql = mongoFilterToSql({ _id: { $oid: '618c6c0ce1ee3cdce8171a18' } }, 't')
    expect(sql).toBe("SELECT * FROM t\nWHERE _id = '618c6c0ce1ee3cdce8171a18'")
  })

  it('不可表达形态返回 null（$elemMatch）', () => {
    expect(mongoFilterToSql({ tags: { $elemMatch: { $gte: 1 } } }, 't')).toBeNull()
  })
})
