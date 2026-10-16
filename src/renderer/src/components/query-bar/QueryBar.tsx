import { useCallback, useRef } from 'react'
import type { JSX } from 'react'
import Editor from '@monaco-editor/react'
import { KeyCode, KeyMod } from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { CornerDownLeft, Highlighter, Play, Loader2 } from 'lucide-react'
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
        value={isSql ? tab.sqlText : tab.filterText}
        onChange={(value) =>
          patchActive(isSql ? { sqlText: value ?? '' } : { filterText: value ?? '' })
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

/** 查询区右侧：编辑器 + 三种执行方式（模式切换在页签栏，proj/sort/skip/limit 在 VQB 面板） */
export function QueryBar(): JSX.Element | null {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const patchActive = useAppStore((s) => s.patchActive)
  const runTab = useAppStore((s) => s.runTab)
  const runSqlText = useAppStore((s) => s.runSqlText)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

  if (activeTab === null) return null

  /** 从编辑器提取执行目标文本；JSON 模式三种方式均执行完整 filter */
  const extractText = (mode: RunMode): string | null => {
    if (activeTab.queryMode !== 'sql') return activeTab.filterText
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
    if (activeTab.queryMode !== 'sql') {
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
    void runSqlText(text)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-1.5 bg-panel p-2">
      <FilterEditor tab={activeTab} editorRef={editorRef} />

      {/* 执行方式：SQL 模式支持单行/选中/全部，JSON 模式执行完整 filter */}
      <div className="flex h-7 shrink-0 items-center justify-end gap-1.5">
        {activeTab.runError !== null && (
          <span className="min-w-0 flex-1 truncate text-[10px] text-danger" title={activeTab.runError}>
            {activeTab.runError}
          </span>
        )}
        {activeTab.queryMode === 'sql' && (
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
