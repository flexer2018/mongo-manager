/**
 * 集合 schema 采样：文档 → 字段路径 → 推断类型 + 样例值。
 *
 * VQB 的字段下拉框自动补全与值编辑器形态都取决于采样结果。
 * core 只接受文档数组；样例去重用 EJSON 规范形比较。
 */
import { EJSON } from 'bson'
import { FieldType } from './field-types'
import { inferValueType } from './parser'
import { isPlainObject, OrderedDoc, Value } from './value-model'

/** 推断类型时的优先级：多种类型并存时取"最具体"的那个 */
const TYPE_PRIORITY: Partial<Record<FieldType, number>> = {
  STRING: 10,
  NUMBER: 9,
  NUMBER_INT: 9,
  NUMBER_LONG: 9,
  NUMBER_DECIMAL: 9,
  ISODATE: 8,
  OBJECT_ID: 8,
  BOOLEAN: 7,
  REGEX: 4,
  BINARY: 3,
  OBJECT: 2,
  ARRAY: 2,
  NULL: 1,
  UNKNOWN: 0
}

/** 单个字段路径的采样结果 */
export interface FieldInfo {
  path: string
  fieldType: FieldType
  seenTypes: Set<FieldType>
  count: number
  samples: Value[]
}

export function fieldInfoIsMixed(info: FieldInfo): boolean {
  return info.seenTypes.size > 1
}

/** 一个集合的字段采样结果 */
export class Schema {
  readonly fields: Map<string, FieldInfo> = new Map()
  sampleCount = 0

  /** 按字典序返回全部字段路径，供字段自动补全使用 */
  names(): string[] {
    return [...this.fields.keys()].sort()
  }

  get(path: string): FieldInfo | null {
    return this.fields.get(path) ?? null
  }

  /** 取字段类型；未采样到时返回 UNKNOWN */
  typeOf(path: string): FieldType {
    return this.fields.get(path)?.fieldType ?? 'UNKNOWN'
  }

  /** 该字段的样例值（去重），用于值输入框的自动补全 */
  suggestValues(path: string, limit = 20): Value[] {
    const info = this.fields.get(path)
    if (info === undefined) return []
    const seen: Value[] = []
    for (const value of info.samples) {
      if (seen.some((existing) => sameValue(value, existing))) continue
      seen.push(value)
      if (seen.length >= limit) break
    }
    return seen
  }

  entries(): FieldInfo[] {
    return [...this.fields.values()]
  }

  get size(): number {
    return this.fields.size
  }
}

/** 样例去重的宽松相等：按 EJSON 规范形比较，BSON 类型安全 */
function sameValue(a: Value, b: Value): boolean {
  if (a === b) return true
  return EJSON.stringify(a, { relaxed: false }) === EJSON.stringify(b, { relaxed: false })
}

/** 深度优先产出 [字段路径, 叶子值]。
 *
 * 数组不递归下标（items.0 在 VQB 里没有意义），整体当作 ARRAY 值产出。
 */
export function* walkValues(
  doc: OrderedDoc,
  prefix = '',
  maxDepth = 12
): Generator<[string, Value]> {
  for (const [key, value] of Object.entries(doc)) {
    const path = prefix ? `${prefix}.${key}` : String(key)
    if (isPlainObject(value) && Object.keys(value).length > 0 && maxDepth > 0) {
      yield* walkValues(value, path, maxDepth - 1)
    } else {
      yield [path, value]
    }
  }
}

/** 从文档列表推断 schema（最多采样 sampleSize 条，嵌套深度上限 maxDepth） */
export function inferSchema(
  documents: readonly unknown[],
  sampleSize = 200,
  maxDepth = 12
): Schema {
  const schema = new Schema()
  const typeCounter: Map<string, Map<FieldType, number>> = new Map()
  const samples: Map<string, Value[]> = new Map()

  let taken = 0
  for (const doc of documents) {
    if (taken >= sampleSize) break
    if (!isPlainObject(doc)) continue
    taken += 1
    schema.sampleCount += 1
    for (const [path, value] of walkValues(doc, '', maxDepth)) {
      let counter = typeCounter.get(path)
      if (counter === undefined) {
        counter = new Map()
        typeCounter.set(path, counter)
      }
      const fieldType = inferValueType(value)
      counter.set(fieldType, (counter.get(fieldType) ?? 0) + 1)

      let bucket = samples.get(path)
      if (bucket === undefined) {
        bucket = []
        samples.set(path, bucket)
      }
      if (bucket.length < 8 && !bucket.some((old) => sameValue(value, old))) {
        bucket.push(value)
      }
    }
  }

  // max 的 key 是 (优先级, 出现次数)，平局取先出现者（对应 Python dict 插入序）
  for (const [path, counter] of typeCounter) {
    let best: FieldType = 'UNKNOWN'
    let bestKey: [number, number] = [-1, -1]
    for (const [fieldType, count] of counter) {
      const key: [number, number] = [TYPE_PRIORITY[fieldType] ?? 0, count]
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
        best = fieldType
        bestKey = key
      }
    }
    schema.fields.set(path, {
      path,
      fieldType: best,
      seenTypes: new Set(counter.keys()),
      count: [...counter.values()].reduce((sum, n) => sum + n, 0),
      samples: samples.get(path) ?? []
    })
  }
  return schema
}
