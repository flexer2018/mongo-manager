import { CodeWriter, QuerySpec } from './code-writer'
import { LiteralRenderer } from './renderers'
import { CodeGenerationError } from '../value-model'

/** 生成代码页签尾注 */
export const CREDIT_LINE = ' Created with Mongo Manager - free & open-source MongoDB GUI'

export abstract class CodeGenerator {
  /** 语言显示名 */
  name = ''
  /** 许可证特性名（仅作记录，不裁剪功能） */
  appFeature = ''
  /** 文件头注释 */
  header = ''

  protected writer = new CodeWriter()

  /** 生成完整代码 */
  generate(spec: QuerySpec): string {
    this.emitFind(spec)
    return this.header + this.renderImports() + this.writer.aKq()
  }

  protected abstract emitFind(spec: QuerySpec): void

  protected abstract get renderer(): LiteralRenderer

  /** 输出署名注释 */
  protected emitCredit(prefix: string): void {
    this.writer.no(prefix + CREDIT_LINE)
    this.writer.aKp()
  }

  protected renderImports(): string {
    return ''
  }

  protected renderQuery(spec: QuerySpec): string {
    return this.renderer.render(spec.query)
  }

  protected renderProjection(spec: QuerySpec): string {
    return this.renderer.render(spec.projection)
  }

  protected renderSort(spec: QuerySpec): string {
    return this.renderer.render(spec.sort, true)
  }

  protected notImplemented(value: never): never {
    throw new CodeGenerationError(`未支持的字面量: ${String(value)}`)
  }
}
