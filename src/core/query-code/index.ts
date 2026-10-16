import { CodeGenerationError } from '../value-model'
import { QuerySpec } from './code-writer'
// import { CSharpGenerator, Java2Generator, Java3Generator } from './generators-csharp-java'
import { JavaScriptGenerator, ShellGenerator } from './generators-shell-js'
import {  PythonGenerator } from './generators-scripting'

export { CodeWriter, QuerySpec } from './code-writer'
export {
  CodeGenerator,
  CREDIT_LINE,
  applyTemplate
} from './generator-base'
export {
  JsonLiteralRenderer,
  LiteralRenderer,
  PythonLiteralRenderer,
  ShellLiteralRenderer,
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
  { name: ShellGenerator.name, create: () => new ShellGenerator() },
{ name: PythonGenerator.name, create: () => new PythonGenerator() },
  { name: JavaScriptGenerator.name, create: () => new JavaScriptGenerator() },
//   { name: CSharpGenerator.name, create: () => new CSharpGenerator() },
//   { name: Java2Generator.name, create: () => new Java2Generator() },
//   { name: Java3Generator.name, create: () => new Java3Generator() },

//   { name: PhpGenerator.name, create: () => new PhpGenerator() },
//   { name: RubyGenerator.name, create: () => new RubyGenerator() }
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
