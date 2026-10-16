/**
 * compiler / parser 的语义验收测试。
 * UI 行为由 React 组件测试承担，此处只覆盖纯逻辑。
 */
import { describe, expect, it } from 'vitest'
import { BSONRegExp, Int32 } from 'bson'
import {
  ARRAY_ELEMENT_PLACEHOLDER,
  CompileError,
  FieldRule,
  GroupOp,
  QueryGroup,
  QueryNode,
  createFieldRule,
  createQueryGroup,
  dumps,
  escapeRegex,
  mongoOps,
  parseBson,
  parseFindFilter,
  parseShellLiteral,
  toBson,
  toFindCommand,
  toShell
} from '../src/core'

const rule = (field: string, operator: FieldRule['operator'], extra: Partial<FieldRule> = {}): FieldRule =>
  createFieldRule({ field, operator, ...extra })

const group = (children: QueryNode[], op: GroupOp = 'AND', isRoot = true): QueryGroup => {
  const g = createQueryGroup({ op, isRoot })
  g.children = children
  return g
}

const first = (tree: QueryGroup): QueryNode => tree.children[0]

// ===========================================================================
// 基础编译
// ===========================================================================

describe('基础编译', () => {
  it('单条规则：根组 $and 内联成裸文档', () => {
    expect(toBson(group([rule('a', 'EQUALS', { value: 1 })]))).toEqual({ a: 1 })
  })

  it('多条规则合并进同一文档', () => {
    expect(
      toBson(group([
        rule('a', 'EQUALS', { value: 1 }),
        rule('b', 'EQUALS', { value: 'x' })
      ]))
    ).toEqual({ a: 1, b: 'x' })
  })

  it('重复字段退回 $and', () => {
    expect(
      toBson(group([
        rule('a', 'EQUALS', { value: 1 }),
        rule('a', 'EQUALS', { value: 2 })
      ]))
    ).toEqual({ $and: [{ a: 1 }, { a: 2 }] })
  })

  it('include=false 的规则不出现在查询里', () => {
    const r = rule('a', 'EQUALS', { value: 1 })
    r.include = false
    expect(toBson(group([r]))).toEqual({})
  })

  it('to_find_command 带投影/排序/limit', () => {
    const text = toFindCommand(group([rule('age', 'GT', { value: 18 })]), 'orders', {
      projection: { name: 1 },
      sort: { age: -1 },
      limit: 25
    })
    expect(text.startsWith('db.getCollection("orders").find(')).toBe(true)
    expect(text).toContain('name: 1')
    expect(text).toContain('.sort(')
    expect(text).toContain('.limit(25)')
  })
})

// ===========================================================================
// 操作符输出表
// ===========================================================================

describe.each([
  ['EQUALS', { value: 7 }, { a: 7 }],
  ['NOT_EQUAL', { value: 7 }, { a: { $ne: 7 } }],
  ['GT', { value: 7 }, { a: { $gt: 7 } }],
  ['GTE', { value: 7 }, { a: { $gte: 7 } }],
  ['LT', { value: 7 }, { a: { $lt: 7 } }],
  ['LTE', { value: 7 }, { a: { $lte: 7 } }],
  ['CONTAINS', { value: 'bc' }, { a: { $regex: '.*bc.*', $options: 'i' } }],
  ['STARTS_WITH', { value: 'ab' }, { a: { $regex: '^ab.*', $options: 'i' } }],
  ['ENDS_WITH', { value: 'cd' }, { a: { $regex: '.*cd$', $options: 'i' } }],
  ['EXISTS', {}, { a: { $exists: true } }]
] as [FieldRule['operator'], Partial<FieldRule>, object][])(
  '操作符 %s 的输出',
  (operator, extra, expected) => {
    it(`编译为 ${JSON.stringify(expected)}`, () => {
      expect(toBson(group([rule('a', operator, extra)]))).toEqual(expected)
    })
  }
)

// ===========================================================================
// $type / null / 布尔 / 正则
// ===========================================================================

describe('$type、null 与正则', () => {
  it('TYPE 按类型号输出', () => {
    expect(toBson(group([rule('a', 'TYPE', { valueType: 'NUMBER' })]))).toEqual({ a: { $type: 1 } })
    expect(toBson(group([rule('a', 'TYPE', { valueType: 'STRING' })]))).toEqual({ a: { $type: 2 } })
  })

  it('typeAsName 时用类型别名', () => {
    expect(
      toBson(group([rule('a', 'TYPE', { valueType: 'NUMBER_LONG' })]), { typeAsName: true })
    ).toEqual({ a: { $type: 'NumberLong' } })
  })

  it('TYPE 用没有类型号的 FieldType 抛 CompileError', () => {
    expect(() => toBson(group([rule('a', 'TYPE', { valueType: 'MIXED' })]))).toThrow(CompileError)
    expect(() =>
      toBson(group([rule('a', 'DOES_NOT_HAVE_TYPE', { valueType: 'MIXED' })]))
    ).toThrow(CompileError)
  })

  it('IS_NULL / IS_NOT_NULL', () => {
    expect(toBson(group([rule('a', 'IS_NULL')]))).toEqual({ a: null })
    expect(toBson(group([rule('a', 'IS_NOT_NULL')]))).toEqual({ a: { $ne: null } })
  })

  it('布尔值经 EQUALS 输出', () => {
    expect(toBson(group([rule('a', 'EQUALS', { value: true })]))).toEqual({ a: true })
    expect(toBson(group([rule('a', 'EQUALS', { value: false })]))).toEqual({ a: false })
  })

  it('regexStyle=literal 输出内联正则', () => {
    expect(
      toBson(group([rule('a', 'CONTAINS', { value: 'bc' })]), { regexStyle: 'literal' })
    ).toEqual({ a: new BSONRegExp('.*bc.*', 'i') })
  })

  it('默认（不完整）转义集：$ 转义、] 不转义', () => {
    // strictRegexEscape=false：沿用 X6Kg.mG 的不完整元字符集合
    expect(toBson(group([rule('a', 'CONTAINS', { value: 'a.c$' })]))).toEqual({
      a: { $regex: '.*a\\.c\\$.*', $options: 'i' }
    })
    expect(toBson(group([rule('a', 'CONTAINS', { value: 'a]b' })]))).toEqual({
      a: { $regex: '.*a]b.*', $options: 'i' }
    })
  })

  it('strictRegexEscape 用完整元字符集', () => {
    expect(
      toBson(group([rule('a', 'CONTAINS', { value: 'a.c$' })]), { strictRegexEscape: true })
    ).toEqual({
      a: { $regex: '.*a\\.c\\$.*', $options: 'i' }
    })
  })
})

// ===========================================================================
// 范围与列表操作符
// ===========================================================================

describe('范围与列表操作符', () => {
  it('LTLT 生成单文档双键', () => {
    expect(
      toBson(group([rule('a', 'LTLT', { value: 1, secondValue: 9 })]))
    ).toEqual({ a: { $gt: 1, $lt: 9 } })
  })

  it('LELE / LTLE / LELT', () => {
    expect(toBson(group([rule('a', 'LELE', { value: 1, secondValue: 9 })]))).toEqual({
      a: { $gte: 1, $lte: 9 }
    })
    expect(toBson(group([rule('a', 'LTLE', { value: 1, secondValue: 9 })]))).toEqual({
      a: { $gt: 1, $lte: 9 }
    })
    expect(toBson(group([rule('a', 'LELT', { value: 1, secondValue: 9 })]))).toEqual({
      a: { $gte: 1, $lt: 9 }
    })
  })

  it('IN / NIN / ALL', () => {
    expect(toBson(group([rule('a', 'IN', { value: [1, 2] })]))).toEqual({ a: { $in: [1, 2] } })
    expect(toBson(group([rule('a', 'NIN', { value: [1] })]))).toEqual({ a: { $nin: [1] } })
    expect(toBson(group([rule('a', 'ALL', { value: [1] })]))).toEqual({ a: { $all: [1] } })
    expect(mongoOps('IN')).toEqual(['$in'])
    expect(mongoOps('LTLT')).toEqual(['$gt', '$lt'])
  })

  it('$elemMatch 组输出嵌套文档', () => {
    const elem = createQueryGroup({ op: 'ELEM_MATCH', field: 'items' })
    elem.children = [rule(ARRAY_ELEMENT_PLACEHOLDER, 'EQUALS', { value: 'x' })]
    expect(toBson(group([elem]))).toEqual({ items: { $elemMatch: { $eq: 'x' } } })
  })

  it('NOT_ELEM_MATCH 输出 $not + $elemMatch', () => {
    const elem = createQueryGroup({ op: 'NOT_ELEM_MATCH', field: 'tags' })
    elem.children = [rule(ARRAY_ELEMENT_PLACEHOLDER, 'EQUALS', { value: 'x' })]
    expect(toBson(group([elem]))).toEqual({ tags: { $not: { $elemMatch: { $eq: 'x' } } } })
  })

  it('$text 输出 $text 文档', () => {
    const r = rule('body', 'TEXT_INDEX_SEARCH')
    r.textSearch = { search: 'coffee', language: null, case_sensitive: false, diacritic_sensitive: false }
    expect(toBson(group([r]))).toEqual({ body: { $text: { $search: 'coffee' } } })
  })

  it('$text 带语言与大小写选项', () => {
    const r = rule('body', 'TEXT_INDEX_SEARCH')
    r.textSearch = { search: 'café', language: 'fr', case_sensitive: true, diacritic_sensitive: true }
    expect(toBson(group([r]))).toEqual({
      body: {
        $text: {
          $search: 'café',
          $language: 'fr',
          $caseSensitive: true,
          $diacriticSensitive: true
        }
      }
    })
  })
})

// ===========================================================================
// 错误路径
// ===========================================================================

describe('错误路径', () => {
  it('CUSTOM 缺文本时抛 CompileError', () => {
    expect(() => toBson(group([rule('a', 'CUSTOM')]))).toThrow(CompileError)
  })

  it('compile_options 拒绝未知 regexStyle', () => {
    expect(() => toBson(group([]), { regexStyle: 'bogus' as never })).toThrow(CompileError)
  })
})

// ===========================================================================
// escape_regex / parse_shell_literal / dumps
// ===========================================================================

describe('escape_regex', () => {
  it('字面量无元字符', () => {
    expect(escapeRegex('abc')).toBe('abc')
  })

  it('点号转义', () => {
    expect(escapeRegex('a.c')).toBe('a\\.c')
  })

  it('星号转义', () => {
    expect(escapeRegex('a*b')).toBe('a\\*b')
  })

  it('加号与问号转义', () => {
    expect(escapeRegex('a+b?')).toBe('a\\+b\\?')
  })

  it('美元与插入符转义', () => {
    expect(escapeRegex('$a^')).toBe('\\$a\\^')
  })
})

describe('parse_shell_literal', () => {
  it('解析简单文档', () => {
    expect(parseShellLiteral('{ a: 1, b: "x" }')).toEqual({ a: new Int32(1), b: 'x' })
  })

  it('无花括号的裸标识符被拒绝（白名单解析，绝不 eval）', () => {
    expect(() => parseShellLiteral('a: 1')).toThrow()
  })

  it('数字（int/float）', () => {
    expect(parseShellLiteral('{ a: 1, b: 2.5 }')).toEqual({ a: new Int32(1), b: 2.5 })
  })

  it('ObjectId 字面量', () => {
    const doc = parseShellLiteral('{ a: ObjectId("64b000000000000000000001") }')
    expect((doc as Record<string, unknown>).a).not.toBeNull()
  })

  it('嵌套数组与文档', () => {
    expect(parseShellLiteral('{ a: [1, {b: 2}] }')).toEqual({
      a: [new Int32(1), { b: new Int32(2) }]
    })
  })

  it('未闭合输入抛错', () => {
    expect(() => parseShellLiteral('{ a: 1')).toThrow()
  })

  it('多余内容抛错', () => {
    expect(() => parseShellLiteral('{ a: 1 } x')).toThrow()
  })

  it('非法词法元素抛错', () => {
    expect(() => parseShellLiteral('{ a: @bad }')).toThrow()
  })
})

describe('dumps', () => {
  it('数字按 Python float 语义渲染（1 → "1.0"）', () => {
    expect(dumps({ a: 1 }, 0)).toBe('{\n  a: 1.0\n}')
  })

  it('嵌套文档多行缩进', () => {
    const text = dumps({ a: { b: 1 } }, 0)
    expect(text).toContain('{\n')
    expect(text).toContain('a: {')
    expect(text).toContain('b: 1.0')
  })

  it('数组逐元素', () => {
    expect(dumps([1, 'x'], 0)).toBe('[\n  1.0,\n  "x"\n]')
  })
})

// ===========================================================================
// 反解析
// ===========================================================================

describe('parse：逻辑组', () => {
  it('$and/$or/$nor 各建兄弟组、不合并', () => {
    const tree = parseBson({
      $and: [{ a: 1 }],
      $or: [{ b: 2 }],
      $nor: [{ c: 3 }]
    })
    expect(tree.children).toHaveLength(3)
    expect(tree.children.map((c) => (c.kind === 'group' ? c.op : null))).toEqual([
      'AND', 'OR', 'NOR'
    ])
  })

  it('{$and:[c]} 单元素不脱糖', () => {
    const tree = parseBson({ $and: [{ a: 1 }] })
    expect(tree.children[0].kind).toBe('group')
    expect(tree.children).toHaveLength(1)
  })

  it('嵌套组不扁平化', () => {
    const tree = parseBson({ $and: [{ $or: [{ a: 1 }] }] })
    const outer = tree.children[0]
    expect(outer.kind).toBe('group')
    if (outer.kind !== 'group') return
    expect(outer.op).toBe('AND')
    expect(outer.children[0].kind).toBe('group')
  })

  it('$and 非 List 落到叶子分支（field="$and" 的普通规则）', () => {
    const tree = parseBson({ $and: 1, $nor: [] } as never)
    expect(tree.children).toHaveLength(1)
    expect(tree.children[0]).toMatchObject({ kind: 'rule', field: '$and', operator: 'EQUALS' })
  })
})

describe('parse：标量与条件', () => {
  it('标量 → EQUALS', () => {
    const node = first(parseBson({ a: 1 }))
    expect(node).toMatchObject({ kind: 'rule', operator: 'EQUALS', value: 1 })
  })

  it('{$ne:null} → IS_NOT_NULL', () => {
    expect(first(parseBson({ a: { $ne: null } }))).toMatchObject({ operator: 'IS_NOT_NULL' })
  })

  it('$text：$search 字符串成立', () => {
    const node = first(parseBson({ body: { $text: { $search: 'x' } } }))
    expect(node).toMatchObject({ operator: 'TEXT_INDEX_SEARCH' })
    if (node.kind !== 'rule') return
    expect(node.textSearch).toMatchObject({ search: 'x', language: null })
  })

  it('$text 不支持形态降级 CUSTOM', () => {
    expect(first(parseBson({ body: { $text: 42 } }))).toMatchObject({ operator: 'CUSTOM' })
  })
})

describe('parse：$elemMatch', () => {
  it('普通字段递归展开', () => {
    const node = first(parseBson({ items: { $elemMatch: { price: { $gt: 5 } } } }))
    expect(node.kind).toBe('group')
    if (node.kind !== 'group') return
    expect(node.field).toBe('items')
    expect(node.children[0]).toMatchObject({ kind: 'rule', field: 'price', operator: 'GT' })
  })

  it('裸算子归到占位字段', () => {
    const node = first(parseBson({ tags: { $elemMatch: { $eq: 'x' } } }))
    if (node.kind !== 'group') return
    expect(node.op).toBe('ELEM_MATCH')
    expect(node.children[0]).toMatchObject({
      field: ARRAY_ELEMENT_PLACEHOLDER,
      operator: 'EQUALS',
      value: 'x'
    })
  })

  it('$not+$elemMatch → NOT_ELEM_MATCH 组', () => {
    const node = first(parseBson({ tags: { $not: { $elemMatch: { x: 'y' } } } }))
    expect(node).toMatchObject({ kind: 'group', op: 'NOT_ELEM_MATCH', field: 'tags' })
  })

  it('非文档内层降级 CUSTOM + ARRAY', () => {
    expect(first(parseBson({ tags: { $elemMatch: 5 } }))).toMatchObject({
      kind: 'rule',
      operator: 'CUSTOM',
      valueType: 'ARRAY'
    })
    // 文档内层即使全是裸算子也建组（<Array Element> 承载条件）
    const node = first(parseBson({ tags: { $elemMatch: { $gt: 5 } } }))
    expect(node).toMatchObject({ kind: 'group', op: 'ELEM_MATCH', field: 'tags' })
  })
})

describe('parse：shell 文本', () => {
  it('解析 { age: { $gt: 18 } }', () => {
    const node = first(parseFindFilter('{ age: { $gt: 18 } }'))
    expect(node).toMatchObject({ kind: 'rule', field: 'age', operator: 'GT', value: new Int32(18) })
  })

  it('非文档结果抛 ValueError', () => {
    expect(() => parseFindFilter('42')).toThrow(/文档/)
  })
})

// ===========================================================================
// 往返
// ===========================================================================

const ROUNDTRIP_DOCS: object[] = [
  { a: 1 },
  { a: { $ne: 1 } },
  { a: { $gt: 1, $lte: 9 } },
  { a: { $in: [1, 2, 3] } },
  { a: { $exists: true } },
  { a: { $type: 2 } },
  { a: { $not: { $regex: '.*x.*', $options: 'i' } } },
  { $or: [{ a: 1 }, { b: 2 }] },
  { $nor: [{ a: 1 }] },
  { $and: [{ a: 1 }, { a: { $lt: 9 } }] },
  { tags: { $elemMatch: { $eq: 'x' } } },
  { items: { $elemMatch: { price: { $gte: 10, $lte: 20 } } } },
  { tags: { $not: { $elemMatch: { $eq: 'x' } } } }
]

describe.each(ROUNDTRIP_DOCS.map((doc, i) => [i, doc] as const))('roundtrip #%i', (_i, doc) => {
  it(`往返稳定且不丢语义：${JSON.stringify(doc)}`, () => {
    const firstBson = toBson(parseBson(doc as never))
    const secondBson = toBson(parseBson(firstBson))
    expect(firstBson).toEqual(secondBson)
    expect(firstBson).toEqual(doc)
  })
})

describe('往返特例', () => {
  it('{$eq:1} 规范化为裸值', () => {
    const once = toBson(parseBson({ a: { $eq: 1 } }))
    expect(once).toEqual({ a: 1 })
    expect(once).toEqual(toBson(parseBson(once)))
  })

  it('CUSTOM 往返稳定', () => {
    const doc = { a: { $mod: [2, 0] } }
    const once = toBson(parseBson(doc))
    expect(once).toEqual(doc)
    expect(once).toEqual(toBson(parseBson(once)))
  })

  it('$text 往返稳定', () => {
    const doc = { $text: { $search: 'coffee' } }
    const once = toBson(parseBson(doc))
    expect(once).toEqual(doc)
    expect(once).toEqual(toBson(parseBson(once)))
  })

  it('$regex 往返稳定为 CUSTOM（不规范化）', () => {
    const source = { a: { $regex: 'b', $options: 'i' } }
    const once = toBson(parseBson(source))
    expect(once).toEqual(toBson(parseBson(once)))
    expect((once.a as Record<string, unknown>)['$regex']).toBe('b')
  })

  it('已知不对称：CONTAINS 导出后无法读回正则操作符', () => {
    const exported = toBson(group([rule('a', 'CONTAINS', { value: 'b' })]))
    expect(exported).toEqual({ a: { $regex: '.*b.*', $options: 'i' } })
    expect(first(parseBson(exported))).toMatchObject({ kind: 'rule', operator: 'CUSTOM' })
  })
})

// ===========================================================================
// HEET.a() 归约表逐条对照
// ===========================================================================

const HEET_A_REDUCTION_TABLE: [Record<string, unknown>, string][] = [
  [{}, 'EQUALS'],
  [{ $eq: 1 }, 'EQUALS'],
  [{ $ne: null }, 'IS_NOT_NULL'],
  [{ $ne: 1 }, 'NOT_EQUAL'],
  [{ $gt: 1 }, 'GT'],
  [{ $gt: 1, $lt: 9 }, 'LTLT'],
  [{ $gt: 1, $lte: 9 }, 'LTLE'],
  [{ $lt: 1 }, 'LT'],
  [{ $lt: 9, $gte: 1 }, 'LELT'],
  [{ $lte: 9 }, 'LTE'],
  [{ $lte: 9, $gte: 1 }, 'LELE'],
  [{ $gte: 1 }, 'GTE'],
  [{ $gte: 1, $lt: 9 }, 'LELT'],
  [{ $gte: 1, $lte: 9 }, 'LELE'],
  [{ $in: [1, 2] }, 'IN'],
  [{ $nin: [1] }, 'NIN'],
  [{ $all: [1] }, 'ALL'],
  [{ $type: 2 }, 'TYPE'],
  [{ $exists: true }, 'EXISTS'],
  [{ $exists: false }, 'DOES_NOT_EXIST'],
  [{ $not: { $eq: 1 } }, 'NOT_EQUAL'],
  [{ $not: { $type: 18 } }, 'DOES_NOT_HAVE_TYPE'],
  [{ $mod: [2, 0] }, 'CUSTOM'],
  [{ $size: 3 }, 'CUSTOM'],
  [{ $regex: 'a', $options: 'i' }, 'CUSTOM'],
  [{ $type: 'string' }, 'CUSTOM'],
  [{ $exists: 1 }, 'CUSTOM'],
  [{ $not: { $gt: 1 } }, 'CUSTOM'],
  [{ $bitsAllSet: 3 }, 'CUSTOM']
]

describe.each(HEET_A_REDUCTION_TABLE.map((row, i) => [i, row] as const))(
  'HEET.a 归约表 #%i',
  (_i, [cond, operator]) => {
    it(`${JSON.stringify(cond)} → ${operator}`, () => {
      expect(first(parseBson({ a: cond }))).toMatchObject({ kind: 'rule', operator })
    })
  }
)

describe('占位符剥离', () => {
  it('<Array Element> 在任何深度都被剥离', () => {
    const direct = group([
      (() => {
        const elem = createQueryGroup({ op: 'ELEM_MATCH', field: 'items' })
        elem.children = [rule(ARRAY_ELEMENT_PLACEHOLDER, 'EQUALS', { value: 'x' })]
        return elem
      })()
    ])
    expect(toBson(direct)).toEqual({ items: { $elemMatch: { $eq: 'x' } } })

    const indirect = group([
      (() => {
        const elem = createQueryGroup({ op: 'ELEM_MATCH', field: 'items' })
        const inner = createQueryGroup({ op: 'AND' })
        inner.children = [rule(ARRAY_ELEMENT_PLACEHOLDER, 'EQUALS', { value: 'x' })]
        elem.children = [inner]
        return elem
      })()
    ])
    expect(toBson(indirect)).toEqual({ items: { $elemMatch: { $and: [{ $eq: 'x' }] } } })
  })

  it('README 库用法示例：编译与导入', () => {
    const tree = group([
      rule('age', 'GT', { value: 18 }),
      rule('name', 'CONTAINS', { value: 'ada' }),
      rule('tags', 'IN', { value: ['a', 'b'], valueType: 'ARRAY' })
    ])
    expect(toBson(tree)).toEqual({
      age: { $gt: 18 },
      name: { $regex: '.*ada.*', $options: 'i' },
      tags: { $in: ['a', 'b'] }
    })
    expect(toBson(parseFindFilter('{ age: { $gte: 18 }, tags: { $elemMatch: { $eq: "x" } } }'))).toEqual({
      age: { $gte: new Int32(18) },
      tags: { $elemMatch: { $eq: 'x' } }
    })
  })
})

// 整数样本类型验证（Int32 纪律）
describe('值类型纪律', () => {
  it('Int32 样本推断为 NUMBER_INT 并按 int 编译', () => {
    const node = first(parseBson({ n: new Int32(5) }))
    expect(node).toMatchObject({ kind: 'rule', valueType: 'NUMBER_INT' })
    expect(toBson(group([node as FieldRule]))).toEqual({ n: new Int32(5) })
  })
})
