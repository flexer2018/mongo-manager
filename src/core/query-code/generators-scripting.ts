import { isPlainObject, OrderedDoc } from '../value-model'
import { QuerySpec } from './code-writer'
import { CodeGenerator } from './generator-base'
import { JsonLiteralRenderer, LiteralRenderer, PythonLiteralRenderer } from './renderers'

/** Python / pymongo 生成器 */
export class PythonGenerator extends CodeGenerator {
  name = 'Python'
  appFeature = 'QUERY_CODE_GENERATION_PYTHON2'
  override header = '# Requires pymongo 3.6.0+\n'

  private literal = new PythonLiteralRenderer()

  protected get renderer(): LiteralRenderer {
    return this.literal
  }

  protected renderImports(): string {
    const modules = new Set<string>([...this.writer.imports, ...this.literal.imports])
    const sorted = [...modules].sort()
    sorted.push('pymongo.MongoClient')
    const lines = sorted.map((module) => {
      const idx = module.lastIndexOf('.')
      if (idx > 0) return `from ${module.slice(0, idx)} import ${module.slice(idx + 1)}`
      return `import ${module}`
    })
    return lines.join('\n') + '\n\n'
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('# ' + this.name)
    this.writer.np('client = MongoClient("mongodb://host:port/")')
    this.writer.np(`database = client["${spec.database}"]`)
    this.writer.np(`collection = database["${spec.collection}"]`)
    this.writer.blank()
    this.emitCredit('#')
    this.writer.aKp()

    const wroteQuery = this.emitAssignment('query', spec.query)
    let wroteProjection = false
    if (spec.hasProjection) wroteProjection = this.emitAssignment('projection', spec.projection)
    let wroteSort = false
    if (spec.hasSort) {
      this.writer.no(`sort = ${this.renderSort(spec)}`)
      this.writer.np('')
      wroteSort = true
    }
    if (spec.hasCollation) {
      this.writer.no(`collation = ${this.renderCollation(spec.collation)}`)
      this.writer.np('')
    }
    if (spec.hasHint) {
      this.writer.no(`hint = ${this.renderer.render(spec.hint)}`)
      this.writer.np('')
    }

    const args = ['query']
    if (wroteProjection) args.push('projection = projection')
    if (wroteSort) args.push('sort = sort')
    if (spec.hasSkip) args.push(`skip = ${spec.skip}`)
    if (spec.hasLimit) args.push(`limit = ${spec.limit}`)
    if (spec.allowDiskUse) args.push('allow_disk_use = True')
    if (spec.hasCollation) args.push('collation = collation')
    if (spec.hasHint) args.push('hint = hint')

    this.writer.np(`cursor = collection.find(${args.join(', ')})`)
    this.writer.np('try:')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('for doc in cursor:')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('print(doc)')
    this.writer.aKf()
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('finally:')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('client.close()')
    this.writer.aKf()
    this.writer.aKf()
  }

  /** 按 query["k"] = v 逐键展开（对应 Java 侧 b(String, Document)） */
  private emitAssignment(target: string, value: unknown): boolean {
    if (!isPlainObject(value) || Object.keys(value).length === 0) {
      this.writer.np(`${target} = {}`)
      return false
    }
    this.writer.np(`${target} = {}`)
    for (const [key, item] of Object.entries(value as OrderedDoc)) {
      this.writer.no(`${target}["${key}"] = `)
      this.writer.no(this.renderer.render(item))
      this.writer.np('')
    }
    return true
  }

  private renderCollation(collation: unknown): string {
    if (isPlainObject(collation)) {
      const parts = [`locale = "${collation['locale'] ?? ''}"`]
      for (const key of [
        'strength',
        'caseLevel',
        'caseFirst',
        'numericOrdering',
        'alternate',
        'maxVariable',
        'backwards',
        'normalization'
      ]) {
        if (key in collation) {
          this.literal.imports.add('pymongo.collation.Collation')
          parts.push(`${key} = ${this.renderer.render(collation[key])}`)
        }
      }
      return 'Collation(' + parts.join(', ') + ')'
    }
    return this.renderer.render(collation)
  }
}

/** PHP / mongodb 扩展生成器 */
export class PhpGenerator extends CodeGenerator {
  name = 'PHP'
  appFeature = 'QUERY_CODE_GENERATION_PHP'
  override header =
    '<?php\n\n/**\n * Requires:\n * - PHP MongoDB Extension (https://php.net/manual/en/set.mongodb.php)\n * - MongoDB Library (`composer require mongodb/mongodb`)\n */\n\n'

  protected get renderer(): LiteralRenderer {
    return new _PhpLiteralRenderer()
  }

  protected renderImports(): string {
    return "require 'vendor/autoload.php';\n\n"
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('// ' + this.name)
    this.writer.np("$client = new Client('mongodb://localhost:27017');")
    this.writer.np(`$collection = $client->${spec.database}->${spec.collection};`)
    this.writer.np(`$query = ${this.renderQuery(spec)};`)
    if (spec.hasProjection) this.writer.np(`$projection = ${this.renderProjection(spec)};`)
    if (spec.hasSort) this.writer.np(`$sort = ${this.renderSort(spec)};`)
    this.writer.np('$options = [')
    this.writer.aKe()
    this.writer.aKp()
    if (spec.hasProjection) this.writer.np("'projection' => $projection,")
    if (spec.hasSort) this.writer.np("'sort' => $sort,")
    if (spec.hasSkip) this.writer.np(`'skip' => ${spec.skip},`)
    if (spec.hasLimit) this.writer.np(`'limit' => ${spec.limit},`)
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('];')
    this.writer.np('$cursor = $collection->find($query, $options);')
    this.writer.np('foreach ($cursor as $document) {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('echo $document[\'_id\'] . "\\n";')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('}')
    this.emitCredit('//')
  }
}

export class _PhpLiteralRenderer extends JsonLiteralRenderer {
  override quote = "'"
  override trueKw = 'true'
  override falseKw = 'false'
  override nullKw = 'null'
  override objectIdTemplate = 'new MongoDB\\BSON\\ObjectId("{hex}")'
  override dateTemplate = 'new MongoDB\\BSON\\UTCDateTime({ms})'
  override regexTemplate = 'new MongoDB\\BSON\\Regex("{pattern}", "{options}")'
  override decimalTemplate = 'new MongoDB\\BSON\\Decimal128("{text}")'
  override longTemplate = 'new MongoDB\\BSON\\Int64({value})'
  override maxKeyTemplate = 'new MongoDB\\BSON\\MaxKey()'
  override minKeyTemplate = 'new MongoDB\\BSON\\MinKey()'
  override codeTemplate = 'new MongoDB\\BSON\\Javascript("{code}")'
  override binaryTemplate = 'new MongoDB\\BSON\\Binary("{base64}", {subtype})'
}

/** Ruby / mongo driver 生成器 */
export class RubyGenerator extends CodeGenerator {
  name = 'Ruby'
  appFeature = 'QUERY_CODE_GENERATION_RUBY'

  protected get renderer(): LiteralRenderer {
    return new _RubyLiteralRenderer()
  }

  protected renderImports(): string {
    return "require 'mongo'\n\n"
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('# ' + this.name)
    this.writer.np("client = Mongo::Client.new('mongodb://host:port/')")
    this.writer.np(`collection = client[:${spec.database}][:${spec.collection}]`)
    this.writer.np(`query = ${this.renderQuery(spec)}`)
    if (spec.hasProjection) this.writer.np(`projection = ${this.renderProjection(spec)}`)
    if (spec.hasSort) this.writer.np(`sort = ${this.renderSort(spec)}`)
    if (spec.hasSkip) this.writer.np(`skip = ${spec.skip}`)
    if (spec.hasLimit) this.writer.np(`limit = ${spec.limit}`)
    this.writer.blank()

    this.writer.no('collection.find(query)')
    if (spec.hasProjection) this.writer.no('.projection(projection)')
    if (spec.hasSort) this.writer.no('.sort(sort)')
    if (spec.hasSkip) this.writer.no(`.skip(${spec.skip})`)
    if (spec.hasLimit) this.writer.no(`.limit(${spec.limit})`)
    if (spec.allowDiskUse) this.writer.no('.allow_disk_use(true)')
    if (spec.hasCollation) this.writer.no('.collation(collation)')
    if (spec.hasHint) this.writer.no(`.hint(${this.renderer.render(spec.hint)})`)
    this.writer.np('.each do |document|')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('puts document[:_id]')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('end')
    this.emitCredit('#')
  }
}

export class _RubyLiteralRenderer extends JsonLiteralRenderer {
  override quote = "'"
  override trueKw = 'true'
  override falseKw = 'false'
  override nullKw = 'nil'
  override objectIdTemplate = 'BSON::ObjectId.from_string("{hex}")'
  override dateTemplate = 'Time.at({ms}).utc'
  override regexTemplate = '/{pattern}/{options}'
  override decimalTemplate = 'BigDecimal("{text}")'
  override longTemplate = '{value}'
  override maxKeyTemplate = 'BSON::MaxKey'
  override minKeyTemplate = 'BSON::MinKey'
  override codeTemplate = 'BSON::Code.new("{code}")'
  override binaryTemplate = 'BSON::Binary.new({bytes})'
}
