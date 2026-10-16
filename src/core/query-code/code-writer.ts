/**
 * 带缩进栈与 import 收集的代码缓冲。
 * 行为细节（幂等换行/挂起行首文本等）由 query-code 测试覆盖。
 */
export class CodeWriter {
  /** 每级缩进宽度 */
  static readonly INDENT_UNIT = 4

  private parts: string[] = []
  private indentStack: number[] = [0]
  private importsSet = new Set<string>()
  private usingsSet = new Set<string>()
  private pending: string[] = []
  private line = 1
  private column = 0
  private dirtyFlag = false
  private needsNewline = false

  /** 追加片段 */
  no(text: string): void {
    this.write(text)
  }

  /** 追加片段并换行 */
  np(text: string): void {
    this.write(text)
    this.flushLine()
  }

  /** 登记一条 import */
  nk(module: string): void {
    this.importsSet.add(module)
  }

  /** 登记一条 using / require */
  nl(module: string): void {
    this.usingsSet.add(module)
  }

  /** 进入下一级缩进：先入栈再幂等结算当前行 */
  aKe(): void {
    this.indentStack.push(this.indentStack[this.indentStack.length - 1] + CodeWriter.INDENT_UNIT)
    this.breakIfDirty()
  }

  /** 退出当前缩进：先出栈再幂等结算当前行 */
  aKf(): void {
    if (this.indentStack.length > 1) this.indentStack.pop()
    this.breakIfDirty()
  }

  private breakIfDirty(): void {
    if (this.lineDirty) {
      this.flushLine()
      return
    }
    // 从尾部剥离空白段（flushLine 写的是 "\n" + 缩进空白），保留换行符
    while (this.parts.length > 0 && this.parts[this.parts.length - 1].trim() === '') {
      this.parts.pop()
    }
    if (this.parts.length > 0 && !this.parts[this.parts.length - 1].endsWith('\n')) {
      this.parts.push('\n')
    }
    this.parts.push(' '.repeat(this.indentStack[this.indentStack.length - 1]))
    this.column = this.indentStack[this.indentStack.length - 1]
  }

  /** 换行；幂等：当前行无内容则跳过 */
  aKp(): void {
    if (this.lineDirty) this.flushLine()
  }

  /** 插入空行（若当前行已有内容） */
  blank(): void {
    if (this.lineDirty) this.flushLine()
    this.needsNewline = false
  }

  private get lineDirty(): boolean {
    return this.dirtyFlag
  }

  /** 当前行号（用于判断"刚才是否写过东西"） */
  kt(): number {
    return this.line
  }

  /** 取出并清空缓冲区 */
  aKq(): string {
    const text = this.parts.join('')
    this.parts = []
    return text
  }

  /** 已登记的 import，按字典序 */
  get imports(): string[] {
    return [...this.importsSet].sort()
  }

  /** 已登记的 using / require，按字典序 */
  get usings(): string[] {
    return [...this.usingsSet].sort()
  }

  private write(text: string): void {
    // 逐字符扫 \n，每个换行后补缩进
    let start = 0
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '\n') continue
      this.parts.push(text.slice(start, index))
      this.flushLine()
      start = index + 1
    }
    if (start < text.length) {
      this.parts.push(text.slice(start))
      this.column += text.length - start
      this.dirtyFlag = true
    }
  }

  private flushLine(): void {
    while (this.pending.length > 0) {
      this.parts.push(this.pending.shift() as string)
      this.dirtyFlag = true
    }
    this.parts.push('\n')
    this.parts.push(' '.repeat(this.indentStack[this.indentStack.length - 1]))
    this.column = this.indentStack[this.indentStack.length - 1]
    this.line += 1
    this.dirtyFlag = false
  }

  /** 挂起一段"下一行最前面输出"的文本 */
  nj(text: string): void {
    this.pending.push(text)
  }
}

/** 一次 find 查询的完整参数 */
export class QuerySpec {
  constructor(
    public database: string,
    public collection: string,
    public query: unknown = null,
    public projection: unknown = null,
    public sort: unknown = null,
    public skip = 0,
    public limit = 0,
    public allowDiskUse = false,
    public collation: unknown = null,
    public hint: unknown = null
  ) {
    this.skip = Math.trunc(skip || 0)
    this.limit = Math.trunc(limit || 0)
    this.allowDiskUse = Boolean(allowDiskUse)
  }

  /** 有且非空 */
  get hasProjection(): boolean {
    return Boolean(
      this.projection &&
        typeof this.projection === 'object' &&
        Object.keys(this.projection as object).length > 0
    )
  }

  get hasSort(): boolean {
    return Boolean(
      this.sort &&
        typeof this.sort === 'object' &&
        Object.keys(this.sort as object).length > 0
    )
  }

  get hasSkip(): boolean {
    return this.skip > 0
  }

  get hasLimit(): boolean {
    return this.limit > 0
  }

  get hasHint(): boolean {
    return this.hint !== null && this.hint !== undefined
  }

  get hasCollation(): boolean {
    return this.collation !== null && this.collation !== undefined
  }
}
