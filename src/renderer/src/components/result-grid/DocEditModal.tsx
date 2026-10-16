/**
 * 文档编辑/插入模态：EJSON（兼容 shell 语法）文本编辑 + 客户端校验，
 * 保存走 store CRUD 动作（成功后自动刷新当前页）。
 */
import { useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { EJSON } from 'bson'
import { Value, isPlainObject, parseShellLiteral } from '@core'
import { X } from 'lucide-react'
import { useAppStore } from '../../store/app-store'

interface DocEditModalProps {
  mode: 'edit' | 'insert'
  doc?: Value | null
  onClose(): void
}

/**
 * 把单行 EJSON 字符串缩进为多行（2 空格）。
 * bson 的 EJSON.stringify 不支持缩进参数，这里只做排版、不改任何 token：
 * 字符串字面量内的 { } [ ] , : 一律不动。
 */
export function prettyEjson(text: string): string {
  const pad = (): string => '  '.repeat(depth)
  let depth = 0
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '{' || ch === '[') {
      // 空容器保持 {} / [] 不拆行
      let j = i + 1
      while (j < text.length && /\s/.test(text[j])) j++
      if (text[j] === '}' || text[j] === ']') {
        out += ch + text[j]
        i = j
      } else {
        depth++
        out += ch + '\n' + pad()
      }
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
      out = out.replace(/\n[ \t]*$/, '') + '\n' + pad() + ch
    } else if (ch === ',') {
      out += ',\n' + pad()
    } else if (ch === ':') {
      out += ': '
    } else if (!/\s/.test(ch)) {
      out += ch
    }
  }
  return out
}

export function DocEditModal({ mode, doc, onClose }: DocEditModalProps): JSX.Element {
  const initialText = useMemo(
    () =>
      mode === 'edit' && doc != null
        ? prettyEjson(EJSON.stringify(doc, { relaxed: false }))
        : '{\n  \n}',
    [mode, doc]
  )
  const [text, setText] = useState(initialText)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    setError(null)
    let parsed: unknown
    try {
      parsed = parseShellLiteral(text.trim() === '' ? '{}' : text)
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc))
      return
    }
    if (!isPlainObject(parsed)) {
      setError('文档必须是 {...} 对象')
      return
    }
    setSaving(true)
    const store = useAppStore.getState()
    const result =
      mode === 'edit' && doc != null
        ? await store.updateDoc(EJSON.stringify((doc as Record<string, unknown>)._id), text)
        : await store.insertDoc(text)
    setSaving(false)
    if (result.ok) {
      onClose()
    } else {
      setError(result.error ?? '保存失败')
    }
  }

  /** Tab 键插入 2 空格缩进，保持焦点在文本域 */
  const handleTab = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Tab') return
    event.preventDefault()
    const target = event.currentTarget
    const { selectionStart, selectionEnd, value } = target
    const next = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd)
    setText(next)
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2
    })
  }

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-8" onClick={onClose}>
      <div
        className="panel flex max-h-full w-[680px] flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-semibold text-text-primary">
            {mode === 'edit' ? '编辑文档' : '插入文档'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 p-3">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={handleTab}
            spellCheck={false}
            className="mono h-72 w-full resize-none rounded border border-line bg-base p-2 text-[11px] leading-5 text-text-primary outline-none transition-colors duration-fast focus:border-accent-dim"
          />
          <div className="mt-1 text-[10px] text-text-faint">
            支持 shell 语法（键可无引号）：{'{'} name: 'xx', age: NumberInt(1), _id: ObjectId('...') {'}'}
          </div>
          {error !== null && (
            <div className="mt-2 rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[11px] text-danger">
              {error}
            </div>
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-3">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded border border-line px-3 py-1 text-xs text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="cursor-pointer rounded bg-accent px-3 py-1 text-xs font-medium text-[rgb(var(--c-on-accent))] transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? '保存中…' : mode === 'edit' ? '保存修改' : '插入'}
          </button>
        </div>
      </div>
    </div>
  )
}
