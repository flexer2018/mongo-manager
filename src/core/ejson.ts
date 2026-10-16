/**
 * EJSON 边界封装（对应计划中的 core/ejson.ts）。
 *
 * 渲染进程与主进程之间的所有查询/文档统一以 EJSON 字符串过 IPC，
 * 在边界处转换，避免结构化克隆丢掉 ObjectId / Long / Date 等 BSON 语义。
 */
import { EJSON } from 'bson'
import { OrderedDoc, Value } from './value-model'

/** EJSON 文本 → BSON 值（固定 relaxed:false，$numberLong 等不被退化为 number） */
export function ejsonParse(text: string): Value {
  return EJSON.parse(text, { relaxed: false })
}

/** BSON 值 → EJSON 文本（canonical：保留类型信息，用于 IPC 与缓存） */
export function ejsonSerialize(value: Value): string {
  return EJSON.stringify(value, { relaxed: false })
}

/** BSON 值 → EJSON 文本（relaxed：贴近 JSON 直觉，用于展示） */
export function ejsonStringifyRelaxed(value: Value): string {
  return EJSON.stringify(value, { relaxed: true })
}

/** 文档级便捷封装 */
export function serializeDoc(doc: OrderedDoc): string {
  return ejsonSerialize(doc)
}

export function deserializeDoc(text: string): OrderedDoc {
  const value = ejsonParse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('EJSON 文本不是文档（{...}）')
  }
  return value as OrderedDoc
}

/** 深拷贝：经 EJSON 规范形往返，ObjectId / Long / Date 等保持语义 */
export function deepCloneValue<T>(value: T): T {
  return EJSON.parse(EJSON.stringify(value, { relaxed: false })) as T
}
