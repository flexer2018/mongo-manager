import { CodeWriter, QuerySpec } from './code-writer'
import { JsonLiteralRenderer, LiteralRenderer } from './renderers'
import { CodeGenerationError } from '../value-model'

/** 生成代码页签尾注 */
export const CREDIT_LINE = ' Created with Mongo Manager - free & open-source MongoDB GUI'

/** 模板占位替换，等价 Python str.format 的 {{ }} 转义语义 */
export function applyTemplate(
  tpl: string,
  params: Record<string, string | number>
): string {
  let out = ''
  let i = 0
  while (i < tpl.length) {
    const c = tpl[i]
    if (c === '{') {
      if (tpl[i + 1] === '{') {
        out += '{'
        i += 2
        continue
      }
      const close = tpl.indexOf('}', i)
      if (close > i) {
        const key = tpl.slice(i + 1, close)
        if (key in params) {
          out += String(params[key])
          i = close + 1
          continue
        }
      }
      out += c
      i += 1
      continue
    }
    if (c === '}' && tpl[i + 1] === '}') {
      out += '}'
      i += 2
      continue
    }
    out += c
    i += 1
  }
  return out
}

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

/** 供 JsonLiteralRenderer 子类定制模板的便捷基类 */
export abstract class ConfigurableJsonRenderer extends JsonLiteralRenderer {
  protected t(tpl: string, params: Record<string, string | number>): string {
    return applyTemplate(tpl, params)
  }
}
