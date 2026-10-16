import { QuerySpec } from './code-writer'
import { CodeGenerator } from './generator-base'
import { JsonLiteralRenderer, LiteralRenderer, ShellLiteralRenderer } from './renderers'

/** mongosh 生成器 */
export class ShellGenerator extends CodeGenerator {
  name = 'MongoDB Shell'
  appFeature = 'QUERY_CODE_GENERATION_SHELL'

  protected get renderer(): LiteralRenderer {
    return new ShellLiteralRenderer()
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.no('// ' + this.name)
    this.writer.aKp()
    this.writer.np(`db = db.getSiblingDB("${spec.database}");`)
    this.writer.no(`db.getCollection("${spec.collection}").find(`)
    if (spec.hasProjection) {
      this.writer.no(this.renderQuery(spec))
      this.writer.no(', ')
      this.writer.no(this.renderProjection(spec))
    } else {
      this.writer.no(this.renderQuery(spec))
    }
    this.writer.no(')')
    if (spec.hasSort) {
      this.writer.no('.sort(')
      this.writer.no(this.renderSort(spec))
      this.writer.no(')')
    }
    if (spec.hasSkip) this.writer.no(`.skip(${spec.skip})`)
    if (spec.hasLimit) this.writer.no(`.limit(${spec.limit})`)
    if (spec.allowDiskUse) this.writer.no('.allowDiskUse(true)')
    if (spec.hasHint) this.writer.no(`.hint(${this.renderer.render(spec.hint)})`)
    this.writer.np(';')
    this.emitCredit('//')
  }
}

/** JavaScript / Node.js 驱动生成器 */
export class JavaScriptGenerator extends CodeGenerator {
  name = 'JavaScript (Node.js)'
  appFeature = 'QUERY_CODE_GENERATION_JS'

  protected get renderer(): LiteralRenderer {
    return new _JavaScriptLiteralRenderer()
  }

  protected renderImports(): string {
    const lines: string[] = []
    if (this.writer.usings.length > 0) {
      for (const m of this.writer.usings) lines.push(`var ${m} = require('${m}');`)
      lines.push('')
    }
    return lines.join('\n') + (lines.length > 0 ? '\n' : '')
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('// ' + this.name)
    this.writer.np("var mongodb = require('mongodb');")
    this.writer.np('var client = mongodb.MongoClient;')
    this.writer.np('var url = "mongodb://host:port/";')
    this.writer.no('client.connect(url, function (err, client) {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np(`var db = client.db("${spec.database}");`)
    this.writer.np(`var collection = db.collection("${spec.collection}");`)

    this.writer.np(`var query = ${this.renderQuery(spec)};`)
    if (spec.hasProjection) this.writer.np(`var projection = ${this.renderProjection(spec)};`)
    if (spec.hasSort) this.writer.np(`var sort = ${this.renderSort(spec)};`)
    if (spec.hasSkip) this.writer.np(`var skip = ${spec.skip};`)
    if (spec.hasLimit) this.writer.np(`var limit = ${spec.limit};`)

    this.writer.no('var cursor = collection.find(query)')
    if (spec.hasProjection) this.writer.no('.project(projection)')
    if (spec.hasSort) this.writer.no('.sort(sort)')
    if (spec.hasSkip) this.writer.no(`.skip(${spec.skip})`)
    if (spec.hasLimit) this.writer.no(`.limit(${spec.limit})`)
    if (spec.allowDiskUse) this.writer.no('.allowDiskUse(true)')
    if (spec.hasCollation) this.writer.no('.collation(collation)')
    if (spec.hasHint) this.writer.no(`.hint(${this.renderer.render(spec.hint)})`)
    this.writer.np(';')
    this.writer.np('cursor.forEach(function(doc) {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('console.log(doc);')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('}, function(err) {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('if (err) throw err;')
    this.writer.np('client.close();')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('});')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('});')
    this.emitCredit('//')
  }
}

export class _JavaScriptLiteralRenderer extends JsonLiteralRenderer {
  override quote = '"'
  override trueKw = 'true'
  override falseKw = 'false'
  override nullKw = 'null'
  override regexTemplate = '/{pattern}/{options}'
}
