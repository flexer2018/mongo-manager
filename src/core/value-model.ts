import {
  BSONRegExp,
  Binary,
  Code,
  DBRef,
  Decimal128,
  Int32,
  Long,
  MaxKey,
  MinKey,
  ObjectId,
  Timestamp
} from 'bson'

/**
 * TS 侧值模型（对应 Python 侧的"Python/BSON 值"）：
 * - Int32 / Long  ↔ Python 的 int（int32 范围内 / 超出）
 * - number        ↔ Python 的 float（double）
 * - Date          ↔ datetime.datetime
 * - 普通对象       ↔ dict（JS 字符串键保持插入序，与 dict 一致）
 */
export type BsonValue =
  | ObjectId
  | Int32
  | Long
  | Decimal128
  | Binary
  | Code
  | DBRef
  | MaxKey
  | MinKey
  | Timestamp
  | BSONRegExp

export interface OrderedDoc {
  [key: string]: Value
}

export type Value =
  | string
  | number
  | boolean
  | null
  | Date
  | BsonValue
  | OrderedDoc
  | Value[]

const BSON_CLASSES: (new (...args: never[]) => unknown)[] = [
  ObjectId,
  Int32,
  Long,
  Decimal128,
  Binary,
  Code,
  DBRef,
  MaxKey,
  MinKey,
  Timestamp,
  BSONRegExp
]

export function isBsonValue(value: unknown): value is BsonValue {
  return BSON_CLASSES.some((cls) => value instanceof cls)
}

/** 普通有序文档（对应 Python 的 dict；排除 Array / Date / RegExp / bson 类型） */
export function isPlainObject(value: unknown): value is OrderedDoc {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof RegExp) &&
    !isBsonValue(value)
  )
}

/**
 * Python `repr(float)` 的等价实现：
 * - 绝对值在 [1e-4, 1e16) 内用最短往返十进制，整数补 ".0"
 * - 否则用指数形式，指数至少 2 位（"1e-05" / "1e+16"）
 */
export function pythonFloatRepr(value: number): string {
  if (value === 0) return Object.is(value, -0) ? '-0.0' : '0.0'
  const abs = Math.abs(value)
  if (abs >= 1e16 || abs < 1e-4) {
    let s = value.toExponential()
    s = s.replace(/e([+-])(\d{1,2})$/, (_m, sign: string, digits: string) => {
      return `e${sign}${digits.padStart(2, '0')}`
    })
    return s
  }
  let s = String(value)
  if (!s.includes('.') && !s.includes('e') && !s.includes('E')) s += '.0'
  return s
}

export class CompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompileError'
  }
}

export class ShellLiteralError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShellLiteralError'
  }
}

export class CodeGenerationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodeGenerationError'
  }
}
