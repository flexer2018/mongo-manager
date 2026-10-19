import { CodeGenerationError } from '../value-model'
import { CodeWriter, QuerySpec } from './code-writer'
import { ShellLiteralRenderer, quoteText } from './renderers'
// import { CSharpGenerator, Java2Generator, Java3Generator } from './generators-csharp-java'
import { JavaScriptGenerator, ShellGenerator } from './generators-shell-js'
import {  PythonGenerator } from './generators-scripting'

export { CodeWriter, QuerySpec } from './code-writer'
export { CodeGenerator, CREDIT_LINE } from './generator-base'
export {
  ConfigurableJsonRenderer,
  JsonLiteralRenderer,
  LiteralRenderer,
  PythonLiteralRenderer,
  ShellLiteralRenderer,
  applyTemplate,
  formatDatetime,
  indentBlock,
  quoteText
} from './renderers'
// export {
//   CSharpGenerator,
//   Java2Generator,
//   Java3Generator
// } from './generators-csharp-java'
// 暂时不需要,因为我不用
export { JavaScriptGenerator, ShellGenerator } from './generators-shell-js'
export { PythonGenerator} from './generators-scripting'

export { PhpGenerator, RubyGenerator } from './generators-scripting'

/** 按 Java 侧 N8Kp 静态块的注册顺序 */
export const GENERATORS: { name: string; create: () => { generate(spec: QuerySpec): string } }[] = [
  { name: new ShellGenerator().name, create: () => new ShellGenerator() },
  { name: new PythonGenerator().name, create: () => new PythonGenerator() },
  { name: new JavaScriptGenerator().name, create: () => new JavaScriptGenerator() }
]

/** 返回全部可用语言名 */
export function availableLanguages(): string[] {
  return GENERATORS.map((g) => g.name)
}

/** 宽松匹配语言名（对应 SqlFormat.fromString） */
function resolveLanguage(language: string): string {
  const exact = GENERATORS.find((g) => g.name === language)
  if (exact) return exact.name
  const lowered = language.trim().toLowerCase()
  const found = GENERATORS.find((g) => g.name.toLowerCase() === lowered)
  if (found) return found.name
  throw new CodeGenerationError(
    `不受支持的语言: ${JSON.stringify(language)}。可用: ${availableLanguages().join(', ')}`
  )
}

/** 把一次 find 查询渲染成指定语言的代码 */
export function generateCode(spec: QuerySpec, language: string): string {
  const key = resolveLanguage(language)
  const entry = GENERATORS.find((g) => g.name === key)
  return (entry as { create: () => { generate(spec: QuerySpec): string } }).create().generate(spec)
}

/** 便捷入口：直接给数据库/集合与查询文档 */
export function generateFindCode(
  database: string,
  collection: string,
  query: unknown = null,
  options: {
    language?: string
    projection?: unknown
    sort?: unknown
    skip?: number
    limit?: number
    allowDiskUse?: boolean
    collation?: unknown
    hint?: unknown
  } = {}
): string {
  const spec = new QuerySpec(
    database,
    collection,
    query,
    options.projection ?? null,
    options.sort ?? null,
    options.skip ?? 0,
    options.limit ?? 0,
    options.allowDiskUse ?? false,
    options.collation ?? null,
    options.hint ?? null
  )
  return generateCode(spec, options.language ?? 'Python')
}

/** mongosh 命令的操作类型（Query Code 面板的命令切换） */
export type ShellOp = 'find' | 'deleteOne' | 'deleteMany' | 'countDocuments'

/** 生成完整形态的 mongosh 单条命令：db.getCollection("coll").<op>({...}) */
export function generateShellCommand(
  database: string,
  collection: string,
  op: ShellOp,
  query: unknown,
  options: { projection?: unknown; sort?: unknown; skip?: number; limit?: number } = {}
): string {
  const writer = new CodeWriter()
  const renderer = new ShellLiteralRenderer()
  writer.np(`db = db.getSiblingDB(${quoteText(database)});`)
  const coll = `db.getCollection(${quoteText(collection)})`
  const filter = renderer.render(query)
  if (op === 'find') {
    const projection =
      options.projection !== null &&
      options.projection !== undefined &&
      typeof options.projection === 'object' &&
      Object.keys(options.projection as object).length > 0
        ? renderer.render(options.projection)
        : null
    writer.no(`${coll}.find(`)
    if (projection !== null) {
      writer.no(filter)
      writer.no(', ')
      writer.no(projection)
    } else {
      writer.no(filter)
    }
    writer.no(')')
    if (
      options.sort !== null &&
      options.sort !== undefined &&
      typeof options.sort === 'object' &&
      Object.keys(options.sort as object).length > 0
    ) {
      writer.no(`.sort(${renderer.render(options.sort, true)})`)
    }
    if ((options.skip ?? 0) > 0) writer.no(`.skip(${options.skip})`)
    if ((options.limit ?? 0) > 0) writer.no(`.limit(${options.limit})`)
    writer.np(';')
  } else {
    writer.no(`${coll}.${op}(`)
    writer.no(filter)
    writer.np(');')
  }
  return writer.aKq()
}
