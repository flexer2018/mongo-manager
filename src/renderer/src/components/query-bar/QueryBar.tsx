import { useCallback, useRef } from 'react'
import type { JSX } from 'react'
import Editor from '@monaco-editor/react'
import { KeyCode, KeyMod } from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { Braces, CornerDownLeft, Highlighter, Play, Loader2, Wand2 } from 'lucide-react'
import { mongoFilterToSql, parseShellLiteral } from '@core'
import type { OrderedDoc } from '@core'
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
      // Ctrl+Enter → 全部执行
      instance.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => {
        useAppStore.getState().runTab(useAppStore.getState().activeTabId ?? '')
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

function SegmentInput({
  label,
  value,
  onChange,
  width,
  numeric
}: {
  label: string
  value: string
  onChange(value: string): void
  width: string
  numeric?: boolean
}): JSX.Element {
  return (
    <label className="flex shrink-0 items-center gap-1">
      <span className="text-[10px] uppercase tracking-wide text-text-muted">{label}</span>
      <input
        value={value}
        inputMode={numeric ? 'numeric' : undefined}
        onChange={(event) => onChange(event.target.value)}
        className={`mono h-6 rounded border border-line bg-base px-1.5 text-[11px] text-text-primary outline-none transition-colors duration-fast placeholder:text-text-faint focus:border-accent-dim ${width}`}
      />
    </label>
  )
}

type RunMode = 'line' | 'selection' | 'all'

/** 查询区右侧：模式切换 + 编辑器 + 分段参数 + 三种执行方式 */
export function QueryBar(): JSX.Element | null {
  const activeTab = useAppStore((s) => s.tabs.find((t) => t.id === s.activeTabId) ?? null)
  const patchActive = useAppStore((s) => s.patchActive)
  const runTab = useAppStore((s) => s.runTab)
  const runSqlText = useAppStore((s) => s.runSqlText)
  const importFilterToVqb = useAppStore((s) => s.importFilterToVqb)
  const toggleVqb = useAppStore((s) => s.toggleVqb)
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)

  if (activeTab === null) return null

  const setPart = (part: 'projectionText' | 'sortText' | 'skip' | 'limit', value: string): void => {
    if (part === 'skip' || part === 'limit') {
      const parsed = Number.parseInt(value, 10)
      patchActive({ [part]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })
      return
    }
    patchActive({ [part]: value })
  }

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
      void runTab(activeTab.id)
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
      <div className="flex items-center gap-2">
        <span className="mono text-[11px] text-text-secondary">
          {activeTab.db} <span className="text-text-faint">›</span>{' '}
          <span className="text-accent">{activeTab.coll}</span>
        </span>
        <div className="flex-1" />
        <span className="text-[10px] text-text-muted">
          {activeTab.running
            ? '查询中…'
            : `${activeTab.resultCount} 条 · ${activeTab.elapsedMs} ms`}
          {activeTab.totalCount !== null && ` / 总 ${activeTab.totalCount}`}
        </span>
        <button
          type="button"
          title="切换 JSON / SQL 查询模式"
          onClick={() => {
            const toSql = activeTab.queryMode === 'json'
            if (toSql && activeTab.sqlText.trim() === '') {
              // 首次切到 SQL：用当前 filter 生成等价 SELECT（不可表达则留提示）
              let doc: OrderedDoc = {}
              try {
                doc = parseShellLiteral(
                  activeTab.filterText.trim() === '' ? '{}' : activeTab.filterText
                ) as OrderedDoc
              } catch {
                doc = {}
              }
              const sql = mongoFilterToSql(doc, activeTab.coll)
              patchActive({
                queryMode: 'sql',
                sqlText: sql ?? '-- 当前 filter 含 SQL 无法表达的查询形态\n-- 请直接编写 MySQL 风格 SELECT'
              })
              return
            }
            patchActive({ queryMode: toSql ? 'sql' : 'json' })
          }}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded border px-2 text-[10px] transition-colors duration-fast ${
            activeTab.queryMode === 'sql'
              ? 'border-accent-dim bg-accent-subtle text-accent'
              : 'border-line bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <Braces size={11} />
          {activeTab.queryMode === 'sql' ? 'SQL' : 'JSON'}
        </button>
        <button
          type="button"
          onClick={toggleVqb}
          className={`flex h-6 cursor-pointer items-center gap-1 rounded border px-2 text-[10px] transition-colors duration-fast ${
            activeTab.vqbOpen
              ? 'border-accent-dim bg-accent-subtle text-accent'
              : 'border-line bg-elevated text-text-secondary hover:text-text-primary'
          }`}
        >
          <Wand2 size={11} />
          可视化构建
        </button>
      </div>

      <FilterEditor tab={activeTab} editorRef={editorRef} />

      <div className="flex items-center gap-3">
        <SegmentInput
          label="proj"
          value={activeTab.projectionText}
          onChange={(value) => setPart('projectionText', value)}
          width="w-44"
        />
        <SegmentInput
          label="sort"
          value={activeTab.sortText}
          onChange={(value) => setPart('sortText', value)}
          width="w-36"
        />
        <SegmentInput
          label="skip"
          value={String(activeTab.skip)}
          onChange={(value) => setPart('skip', value)}
          width="w-16"
          numeric
        />
        <SegmentInput
          label="limit"
          value={String(activeTab.limit)}
          onChange={(value) => setPart('limit', value)}
          width="w-16"
          numeric
        />
        {activeTab.vqbOpen && activeTab.vqbTree !== null && activeTab.queryMode === 'json' && (
          <button
            type="button"
            onClick={() => {
              if (!importFilterToVqb()) window.alert('filter 不是合法查询文档，无法导入')
            }}
            className="cursor-pointer text-[10px] text-accent-dim transition-colors duration-fast hover:text-accent"
          >
            ← 从 filter 导入 VQB
          </button>
        )}
      </div>

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
