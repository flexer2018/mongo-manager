import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Check, Code2, Copy } from 'lucide-react'
import {
  availableLanguages,
  generateFindCode,
  generateShellCommand,
  parseFindFilter,
  parseShellLiteral,
  toBson,
  QueryGroup,
  ShellOp
} from '@core'
import { useAppStore } from '../../store/app-store'

/** 语言名 → 页签短标签 */
const LABELS: Record<string, string> = {
  'MongoDB Shell': 'Shell',
  'JavaScript (Node.js)': 'Node.js',
  Python: 'Python',
  PHP: 'PHP',
  Ruby: 'Ruby',
  'C#': 'C#',
  'Java (2.x driver API)': 'Java (legacy)',
  'Java (3.x driver API)': 'Java (new)'
}

/** mongosh 命令操作类型 */
const OPS: { op: ShellOp; label: string; title: string }[] = [
  { op: 'find', label: 'find', title: '查询（支持 projection / sort / skip / limit，按所选语言生成）' },
  { op: 'deleteOne', label: 'deleteOne', title: '删除一条匹配文档（mongosh）' },
  { op: 'deleteMany', label: 'deleteMany', title: '删除全部匹配文档（mongosh）' },
  { op: 'countDocuments', label: 'countDocuments', title: '统计匹配文档数（mongosh）' }
]

function parseDoc(text: string): unknown {
  if (text.trim() === '') return undefined
  try {
    // shell 语法解析（兼容 dumps 输出的无引号键 / ISODate 等构造器），标准 JSON 也能解析
    return parseShellLiteral(text)
  } catch {
    return undefined
  }
}

/** Query Code 页签：同一查询实时生成 8 种语言驱动代码，一键复制 */
export function QueryCodePanel(): JSX.Element | null {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const vqbTree = activeTab?.vqbTree ?? null
  const filterText = activeTab?.filterText ?? '{}'
  const projectionText = activeTab?.projectionText ?? ''
  const sortText = activeTab?.sortText ?? ''
  const skip = activeTab?.skip ?? 0
  const limit = activeTab?.limit ?? 100
  const [selected, setSelected] = useState(availableLanguages()[0])
  const [op, setOp] = useState<ShellOp>('find')
  const [copied, setCopied] = useState(false)

  // 优先用 VQB 树；否则从 filter 文本反解析（失败则不生成）
  const tree: QueryGroup | null = useMemo(() => {
    if (vqbTree !== null) return vqbTree
    try {
      return parseFindFilter(filterText || '{}')
    } catch {
      return null
    }
  }, [vqbTree, filterText])

  const code = useMemo(() => {
    if (activeTab === null) return '// 打开一个集合后自动生成'
    if (activeTab.kind !== 'collection') {
      return '// 独立 SQL / Shell 编辑器不生成驱动代码\n// 在集合页签的查询区切换查看'
    }
    if (tree === null) return '// filter 不是合法查询文档，无法生成'
    try {
      if (op !== 'find') {
        // 非查询操作：完整形态 mongosh 命令（deleteMany 等不带查询选项）
        return generateShellCommand(activeTab.db, activeTab.coll, op, toBson(tree))
      }
      return generateFindCode(activeTab.db, activeTab.coll, toBson(tree), {
        language: selected,
        projection: parseDoc(projectionText),
        sort: parseDoc(sortText),
        skip,
        limit
      })
    } catch (exc) {
      return `// 生成失败: ${exc instanceof Error ? exc.message : String(exc)}`
    }
  }, [tree, activeTab, selected, op, projectionText, sortText, skip, limit])

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-base">
      <div className="flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line bg-panel px-2">
        <Code2 size={11} className="mr-1 shrink-0 text-text-muted" />
        {OPS.map(({ op: value, label, title }) => (
          <button
            key={value}
            type="button"
            title={title}
            onClick={() => setOp(value)}
            className={`mono h-6 shrink-0 cursor-pointer rounded px-2 text-[10px] transition-colors duration-fast ${
              op === value
                ? 'bg-active text-accent'
                : 'text-text-muted hover:bg-hover hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
        <span className="mx-1.5 h-3.5 w-px shrink-0 bg-line" />
        {op === 'find' &&
          availableLanguages().map((language) => (
            <button
              key={language}
              type="button"
              onClick={() => setSelected(language)}
              className={`h-6 shrink-0 cursor-pointer rounded px-2 text-[10px] transition-colors duration-fast ${
                selected === language
                  ? 'bg-active text-accent'
                  : 'text-text-muted hover:bg-hover hover:text-text-primary'
              }`}
            >
              {LABELS[language] ?? language}
            </button>
          ))}
        {op !== 'find' && (
          <span className="text-[10px] text-text-faint">mongosh 命令（可直接粘贴执行）</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={copy}
          className="flex h-6 cursor-pointer items-center gap-1 rounded px-2 text-[10px] text-text-muted transition-colors duration-fast hover:text-text-primary"
        >
          {copied ? (
            <>
              <Check size={11} className="text-accent" /> 已复制
            </>
          ) : (
            <>
              <Copy size={11} /> 复制
            </>
          )}
        </button>
      </div>
      <pre className="mono min-h-0 flex-1 overflow-auto p-3 text-[11px] leading-5 text-text-secondary select-text">
        {code}
      </pre>
    </div>
  )
}
