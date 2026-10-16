import { QuerySpec } from './code-writer'
import { CodeGenerator } from './generator-base'
import { JsonLiteralRenderer, LiteralRenderer } from './renderers'

/** C# / MongoDB.Driver 生成器 */
export class CSharpGenerator extends CodeGenerator {
  name = 'C#'
  appFeature = 'QUERY_CODE_GENERATION_CSHARP'

  protected get renderer(): LiteralRenderer {
    return new _CSharpLiteralRenderer()
  }

  protected renderImports(): string {
    const lines = this.writer.imports.map((m) => `using ${m};`)
    lines.push('using System;')
    lines.push('using System.Threading.Tasks;')
    lines.push('using MongoDB.Bson;')
    lines.push('using MongoDB.Driver;')
    lines.push('')
    return lines.join('\n') + '\n'
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('// ' + this.name)
    this.writer.np('var client = new MongoClient("mongodb://host:port/");')
    this.writer.np(`var database = client.GetDatabase("${spec.database}");`)
    this.writer.np(`var collection = database.GetCollection<BsonDocument>("${spec.collection}");`)
    this.writer.aKp()
    this.writer.no('var filter = ')
    this.writer.no(this.renderQuery(spec))
    this.writer.np(';')
    const options: string[] = []
    if (spec.hasProjection) {
      this.writer.np(
        `var projection = Builders<BsonDocument>.Projection.Include(${this.renderProjection(spec)});`
      )
    }
    if (spec.hasSort) this.writer.np(`var sort = ${this.renderSort(spec)};`)
    if (spec.hasSkip) {
      this.writer.np(`var skip = ${spec.skip};`)
      options.push(`Skip = ${spec.skip}`)
    }
    if (spec.hasLimit) {
      this.writer.np(`var limit = ${spec.limit};`)
      options.push(`Limit = ${spec.limit}`)
    }
    if (spec.allowDiskUse) options.push('AllowDiskUse = true')
    if (spec.hasCollation) options.push('Collation = collation')
    if (spec.hasHint) options.push(`Hint = ${this.renderer.render(spec.hint)}`)
    if (options.length > 0) {
      this.writer.no('var options = new FindOptions { ')
      this.writer.no(options.join(',\n    '))
      this.writer.np(' };')
    }
    this.writer.blank()
    if (options.length > 0) this.writer.np('using (var cursor = collection.FindSync(filter, options))')
    else this.writer.np('using (var cursor = collection.FindSync(filter))')
    this.writer.no('{')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('while (cursor.MoveNext())')
    this.writer.no('{')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('foreach (var document in cursor.Current)')
    this.writer.no('{')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('Console.WriteLine(document.ToJson());')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.no('}')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.no('}')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.no('}')
    this.writer.np('}')
    this.writer.np('_Main().Wait();')
    this.emitCredit('//')
  }
}

export class _CSharpLiteralRenderer extends JsonLiteralRenderer {
  override quote = '"'
  override trueKw = 'true'
  override falseKw = 'false'
  override nullKw = 'BsonNull.Value'
  override objectIdTemplate = 'ObjectId.Parse("{hex}")'
  override dateTemplate = 'BsonDateTime.Create("{iso}")'
  override regexTemplate = 'new BsonRegularExpression("{pattern}", "{options}")'
  override decimalTemplate = 'Decimal128.Parse("{text}")'
  override longTemplate = 'new BsonInt64({value})'
  override maxKeyTemplate = 'BsonMaxKey.Value'
  override minKeyTemplate = 'BsonMinKey.Value'
  override codeTemplate = 'BsonJavaScript.Create("{code}")'
  override binaryTemplate = 'new BsonBinaryData(new byte[] {{ {bytes} }})'
}

/** Java 3.x 驱动 API 生成器 */
export class Java3Generator extends CodeGenerator {
  name = 'Java (3.x driver API)'
  appFeature = 'QUERY_CODE_GENERATION_JAVA3'

  protected get renderer(): LiteralRenderer {
    return new _JavaLiteralRenderer()
  }

  protected renderImports(): string {
    const lines = this.writer.imports.map((m) => `import ${m};`)
    lines.push('import com.mongodb.MongoClient;')
    lines.push('import com.mongodb.MongoNamespace;')
    lines.push('import com.mongodb.client.MongoCollection;')
    lines.push('import com.mongodb.client.MongoCursor;')
    lines.push('import com.mongodb.client.MongoDatabase;')
    lines.push('import org.bson.Document;')
    lines.push('import com.mongodb.block.Block;')
    lines.push('')
    return lines.join('\n') + '\n'
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('// ' + this.name)
    this.writer.np('MongoClient client = new MongoClient("mongodb://host:port/");')
    this.writer.np(`MongoDatabase database = client.getDatabase("${spec.database}");`)
    this.writer.np(`MongoCollection<Document> collection = database.getCollection("${spec.collection}");`)
    this.writer.aKp()

    this.writer.np(`Document query = ${this.renderQuery(spec)};`)
    if (spec.hasProjection) this.writer.np(`Document projection = ${this.renderProjection(spec)};`)
    if (spec.hasSort) this.writer.np(`Document sort = ${this.renderSort(spec)};`)
    if (spec.hasSkip) this.writer.np(`int skip = ${spec.skip};`)
    if (spec.hasLimit) this.writer.np(`int limit = ${spec.limit};`)
    this.writer.blank()

    this.writer.np('Block<Document> processBlock = new Block<Document>() {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('@Override')
    this.writer.no('public void apply(Document document) {')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('System.out.println(document);')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.no('}')
    this.writer.aKf()
    this.writer.aKp()
    this.writer.np('};')
    this.writer.blank()

    this.writer.no('collection.find(query)')
    if (spec.hasProjection) this.writer.no('.projection(projection)')
    if (spec.hasSort) this.writer.no('.sort(sort)')
    if (spec.hasSkip) this.writer.no(`.skip(${spec.skip})`)
    if (spec.hasLimit) this.writer.no(`.limit(${spec.limit})`)
    if (spec.allowDiskUse) this.writer.no('.allowDiskUse(true)')
    if (spec.hasCollation) this.writer.no('.collation(collation)')
    if (spec.hasHint) this.writer.no(`.hint(${this.renderer.render(spec.hint)})`)
    this.writer.np('.forEach(processBlock);')
    this.emitCredit('//')
  }
}

/** Java 2.x 驱动 API：不支持 allowDiskUse，即使开启也不生成 */
export class Java2Generator extends CodeGenerator {
  name = 'Java (2.x driver API)'
  appFeature = 'QUERY_CODE_GENERATION_JAVA2'

  protected get renderer(): LiteralRenderer {
    return new _Java2LiteralRenderer()
  }

  protected renderImports(): string {
    const lines = this.writer.imports.map((m) => `import ${m};`)
    lines.push('import com.mongodb.BasicDBObject;')
    lines.push('import com.mongodb.DB;')
    lines.push('import com.mongodb.DBCollection;')
    lines.push('import com.mongodb.DBCursor;')
    lines.push('import com.mongodb.MongoClient;')
    lines.push('')
    return lines.join('\n') + '\n'
  }

  protected emitFind(spec: QuerySpec): void {
    this.writer.np('// ' + this.name)
    this.writer.np('MongoClient mongo = new MongoClient("mongodb://host:port/");')
    this.writer.np(`DB db = mongo.getDB("${spec.database}");`)
    this.writer.np(`DBCollection collection = db.getCollection("${spec.collection}");`)
    this.writer.blank()
    this.writer.np('// Important Note: MongoDB 2.x drivers do not support allowDiskUse query option')
    this.writer.np(`BasicDBObject query = ${this.renderQuery(spec)};`)
    if (spec.hasProjection) this.writer.np(`BasicDBObject projection = ${this.renderProjection(spec)};`)
    if (spec.hasSort) this.writer.np(`BasicDBObject sort = ${this.renderSort(spec)};`)
    if (spec.hasSkip) this.writer.np(`int skip = ${spec.skip};`)
    if (spec.hasLimit) this.writer.np(`int limit = ${spec.limit};`)
    this.writer.blank()

    this.writer.no('DBCursor cursor = collection.find(query')
    if (spec.hasProjection) this.writer.no(', projection')
    this.writer.no(')')
    if (spec.hasSort) this.writer.no('.sort(sort)')
    if (spec.hasSkip) this.writer.no(`.skip(${spec.skip})`)
    if (spec.hasLimit) this.writer.no(`.limit(${spec.limit})`)
    if (spec.hasHint) this.writer.no(`.hint(${this.renderer.render(spec.hint)})`)
    this.writer.np(';')
    this.writer.blank()
    this.writer.np('while (cursor.hasNext())')
    this.writer.no('{')
    this.writer.aKe()
    this.writer.aKp()
    this.writer.np('BasicDBObject document = (BasicDBObject) cursor.next();')
    this.writer.np('System.out.println(document.toString());')
    this.writer.aKf()
    this.writer.aKf()
    this.writer.no('}')
    this.writer.aKp()
    this.writer.np('mongo.close();')
    this.emitCredit('//')
  }
}

export class _JavaLiteralRenderer extends JsonLiteralRenderer {
  override quote = '"'
  override trueKw = 'true'
  override falseKw = 'false'
  override nullKw = 'null'
  override objectIdTemplate = 'new ObjectId("{hex}")'
  override dateTemplate = 'new Date({ms})'
  override regexTemplate = 'java.util.regex.Pattern.compile("{pattern}", {flags})'
  override decimalTemplate = 'new BigDecimal("{text}")'
  override longTemplate = '{value}L'
  override maxKeyTemplate = 'new MaxKey()'
  override minKeyTemplate = 'new MinKey()'
  override codeTemplate = 'new Code("{code}")'
  override binaryTemplate = 'new Binary({bytes})'
}

export class _Java2LiteralRenderer extends _JavaLiteralRenderer {
  override objectIdTemplate = 'new ObjectId("{hex}")'
  override dateTemplate = 'new java.util.Date({ms})'
}
