import { useCallback, useRef, useState } from 'react'
import type { JSX } from 'react'
import Editor from '@monaco-editor/react'
import { KeyCode, KeyMod } from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import {
  Braces,
  Check,
  Copy,
  CornerDownLeft,
  Highlighter,
  Play,
  Loader2,
  Terminal,
  X
} from 'lucide-react'
import type { WorkTab } from '../../store/app-store'
import { useAppStore } from '../../store/app-store'
import { ensureMonacoConfigured } from '../../lib/monaco'

ensureMonacoConfigured()

/** 等宽编辑器（JSON filter / SQL，带语法高亮），编辑器实例上抛支持行/选区提取 */
function FilterEditor({
  tab,
  editorRef
}: {
  tab: WorkTab
  editorRef: { current: MonacoEditor.IStandaloneCodeEditor | null }
}): JSX.Element {
  const patchActive = useAppStore((s) => s.patchActive)
  const isSql = tab.queryMode === 'sql'
  const isShell = tab.queryMode === 'shell'

  const handleMount = useCallback(
    (instance: MonacoEditor.IStandaloneCodeEditor) => {
      editorRef.current = instance
      // Ctrl+Enter → 全部执行（新查询回到第一页）
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
        useAppStore
          .getState()
          .runTab(useAppStore.getState().activeTabId ?? '', { resetSkip: true })
      })
    },
    [editorRef]
  )

  return (
    <div className="min-h-0 flex-1 overflow-hidden rounded border border-line bg-base transition-colors duration-fast focus-within:border-accent-dim">
      <Editor
        key={`${tab.id}-${tab.queryMode}`}
        height="100%"
        defaultLanguage={isSql ? 'mysql' : 'javascript'}
        theme="vs-dark"
        value={isSql ? tab.sqlText : isShell ? tab.shellText : tab.filterText}
        onChange={(value) =>
          patchActive(
            isSql
              ? { sqlText: value ?? '' }
              : isShell
                ? { shellText: value ?? '' }
                : { filterText: value ?? '' }
          )
        }
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 12,
          lineHeight: 18,
          lineNumbers: 'on',
          glyphMargin: false,
          folding: false,
          renderLineHighlight: 'line',
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          tabSize: 2,
          automaticLayout: true,
          padding: { top: 5, bottom: 5 },
          scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }
        }}
      />
    </div>
  )
}

type RunMode = 'line' | 'selection' | 'all'

/** 查询模式三段 Tab */
const QUERY_MODES: { mode: WorkTab['queryMode']; label: string; title: string }[] = [
  { mode: 'json', label: 'JSON', title: 'MongoDB filter 文档（JSON / shell 语法）' },
  { mode: 'sql', label: 'SQL', title: 'MySQL 风格 SELECT 子集' },
  {
    mode: 'shell',
    label: 'Shell',
    title: '完整 mongosh 命令（find / deleteMany / updateMany 等）'
  }
]

/** 查询区右侧：编辑器 + 模式三段 Tab（JSON / SQL / Shell）+ 三种执行方式 */
export function QueryBar(): JSX.Element | null {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const patchActive = useAppStore((s) => s.patchActive)
  const setQueryMode = useAppStore((s) => s.setQueryMode)
  const runTab = useAppStore((s) => s.runTab)
  const runSqlText = useAppStore((s) => s.runSqlText)
  const runShellText = useAppStore((s) => s.runShellText)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const [errorCopied, setErrorCopied] = useState(false)

  if (activeTab === null) return null

  /** 错误信息一键复制：便于把完整报错贴到 issue / 排查 */
  const copyError = (): void => {
    const message = activeTab.runError
    if (message === null) return
    void navigator.clipboard.writeText(message).then(() => {
      setErrorCopied(true)
      window.setTimeout(() => setErrorCopied(false), 1200)
    })
  }

  /** JSON（filter 文档）模式没有分句概念，三种方式都执行完整 filter */
  const isTextMode = activeTab.queryMode !== 'json'

  /** 从编辑器提取执行目标文本 */
  const extractText = (mode: RunMode): string | null => {
    if (!isTextMode) return activeTab.filterText
    const instance = editorRef.current
    const model = instance?.getModel()
    if (instance === null || model === null || model === undefined) return null
    if (mode === 'selection') {
      const selection = instance.getSelection()
      if (selection === null || selection.isEmpty()) return null
      return model.getValueInRange(selection)
    }
    if (mode === 'line') {
      const position = instance.getPosition()
      if (position === null) return null
      return model.getLineContent(position.lineNumber)
    }
    return model.getValue()
  }

  const runMode = (mode: RunMode): void => {
    if (!isTextMode) {
      // JSON filter：执行完整文档
      void runTab(activeTab.id, { resetSkip: true })
      return
    }
    if (mode === 'all' && activeTab.kind !== 'collection') {
      // 独立编辑器「全部执行」交给 runTab 分发（SQL / Shell）
      void runTab(activeTab.id, { resetSkip: true })
      return
    }
    const text = extractText(mode)
    if (text === null || text.trim() === '') {
      patchActive({
        runError: mode === 'selection' ? '选中执行：请先选中要执行的语句' : '单行执行：光标所在行没有语句'
      })
      return
    }
    if (activeTab.queryMode === 'shell') {
      void runShellText(text)
    } else {
      void runSqlText(text)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-1.5 bg-panel p-2">
      <FilterEditor tab={activeTab} editorRef={editorRef} />

      {/* 执行方式：SQL 模式支持单行/选中/全部，JSON 模式执行完整 filter */}
      <div className="flex h-7 shrink-0 items-center justify-end gap-1.5">
        {/* 查询模式三段 Tab：仅集合页签可切换；独立 SQL / Shell 编辑器模式固定 */}
        {activeTab.kind === 'collection' ? (
          <div className="mr-auto flex h-6 shrink-0 items-center rounded border border-line bg-elevated p-0.5">
            <Braces size={10} className="mx-1 shrink-0 text-text-faint" />
            {QUERY_MODES.map(({ mode, label, title }) => (
              <button
                key={mode}
                type="button"
                title={title}
                onClick={() => setQueryMode(mode)}
                className={`h-5 cursor-pointer rounded px-2 text-[10px] transition-colors duration-fast ${
                  activeTab.queryMode === mode
                    ? 'bg-accent/20 font-medium text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : (
          <span className="mr-auto flex shrink-0 items-center gap-1.5 text-[10px] text-text-muted">
            {activeTab.kind === 'sql' ? <Braces size={11} /> : <Terminal size={11} />}
            {activeTab.kind === 'sql' ? 'SQL 查询' : 'mongosh 查询'}
          </span>
        )}
        {activeTab.runError !== null && (
          <div className="flex min-w-0 flex-1 items-center gap-1">
            <span
              className="min-w-0 cursor-text truncate text-[10px] text-danger select-text"
              title={activeTab.runError}
            >
              {activeTab.runError}
            </span>
            <button
              type="button"
              onClick={copyError}
              title="复制错误信息"
              className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded border border-line bg-elevated px-1.5 py-0.5 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent"
            >
              {errorCopied ? (
                <>
                  <Check size={11} className="text-accent" /> 已复制
                </>
              ) : (
                <>
                  <Copy size={11} /> 复制
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => patchActive({ runError: null })}
              title="关闭提示"
              className="flex shrink-0 cursor-pointer items-center rounded px-1 py-0.5 text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text-primary"
            >
              <X size={11} />
            </button>
            <div className="flex-1" />
          </div>
        )}
        {isTextMode && (
          <>
            <button
              type="button"
              title="执行光标所在行的语句"
              onClick={() => runMode('line')}
              className="flex h-6 cursor-pointer items-center gap-1 rounded border border-line bg-elevated px-2 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent"
            >
              <CornerDownLeft size={11} /> 单行执行
            </button>
            <button
              type="button"
              title="执行选中的语句"
              onClick={() => runMode('selection')}
              className="flex h-6 cursor-pointer items-center gap-1 rounded border border-line bg-elevated px-2 text-[10px] text-text-secondary transition-colors duration-fast hover:border-accent-dim hover:text-accent"
            >
              <Highlighter size={11} /> 选中执行
            </button>
          </>
        )}
        <button
          type="button"
          title="执行全部语句（Ctrl+Enter）"
          disabled={activeTab.running}
          onClick={() => runMode('all')}
          className="flex h-6 cursor-pointer items-center gap-1 rounded bg-accent px-2.5 text-[10px] font-semibold text-[rgb(var(--c-on-accent))] transition-colors duration-fast hover:bg-accent-bright disabled:cursor-not-allowed disabled:opacity-50"
        >
          {activeTab.running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
          全部执行
        </button>
      </div>
    </div>
  )
}
