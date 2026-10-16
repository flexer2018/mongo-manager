import { describe, expect, it } from 'vitest'
import { Int32, ObjectId } from 'bson'
import { toShell } from '../src/core/compiler'
import { inferValueType, mergeInnerConditions, parseBson, parseFindFilter } from '../src/core/parser'

describe('parser smoke（往返）', () => {
  it('逻辑组不合并、单元素不脱糖', () => {
    const tree = parseBson({ $and: [{ a: new Int32(1) }] })
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0].kind).toBe('group')
  })

  it('标量 / $eq / 范围 / $ne:null', () => {
    expect(parseBson({ a: new Int32(1) }).children[0]).toMatchObject({
      kind: 'rule', operator: 'EQUALS', valueType: 'NUMBER_INT'
    })
    expect(parseBson({ b: { $eq: 'x' } }).children[0]).toMatchObject({ operator: 'EQUALS' })
    const range = parseBson({ n: { $gte: new Int32(1), $lt: new Int32(9) } }).children[0]
    expect(range).toMatchObject({ operator: 'LELT', value: new Int32(1), secondValue: new Int32(9) })
    expect(parseBson({ c: { $ne: null } }).children[0]).toMatchObject({ operator: 'IS_NOT_NULL' })
  })

  it('$regex 降级 CUSTOM，裸正则 → EQUALS+REGEX', () => {
    expect(parseBson({ s: { $regex: 'a', $options: 'i' } }).children[0]).toMatchObject({
      operator: 'CUSTOM', valueType: 'OBJECT'
    })
    expect(parseBson({ s: /ab/i }).children[0]).toMatchObject({ operator: 'EQUALS', valueType: 'REGEX' })
  })

  it('$elemMatch 剥壳与内层归并', () => {
    const tree = parseBson({
      arr: { $elemMatch: { $gte: new Int32(10), name: 'x' } }
    })
    const group = tree.children[0]
    expect(group.kind).toBe('group')
    if (group.kind !== 'group') return
    expect(group.op).toBe('ELEM_MATCH')
    expect(group.field).toBe('arr')
    expect(group.children.map((c) => c.field)).toEqual(['<Array Element>', 'name'])
    // Python 语义：仅 dict+dict 才合并，标量后到者覆盖
    expect(mergeInnerConditions({ $gte: 1, $lte: 2 })).toEqual({ '<Array Element>': 2 })
  })

  it('shell 文本反解析 + 往返稳定', () => {
    const src = '{ status: "A", qty: { $gt: 10 }, tags: { $in: [ "red", "blank" ] } }'
    const tree = parseFindFilter(src)
    const shell = toShell(tree)
    const tree2 = parseFindFilter(shell)
    expect(toShell(tree2)).toBe(shell)
  })

  it('$in 保留列表结构（有意偏离）', () => {
    const rule = parseBson({ t: { $in: ['a', 'b'] } }).children[0]
    expect(rule).toMatchObject({ operator: 'IN', valueType: 'ARRAY' })
    if (rule.kind !== 'rule') return
    expect(rule.value).toEqual(['a', 'b'])
  })

  it('ObjectId 值类型推断与 $type', () => {
    expect(inferValueType(new ObjectId('0'.repeat(24)))).toBe('OBJECT_ID')
    expect(parseBson({ a: { $type: new Int32(2) } }).children[0]).toMatchObject({
      operator: 'TYPE', valueType: 'STRING'
    })
    expect(parseBson({ a: { $type: 'string' } }).children[0]).toMatchObject({
      operator: 'CUSTOM'
    })
  })
})
