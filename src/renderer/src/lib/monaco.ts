/**
 * Monaco 本地装配：@monaco-editor/react 默认从 CDN 拉 monaco，
 * 离线/网络受限时会永远停在 "Loading..."——这里改为使用依赖内打包的
 * monaco-editor（ESM），并注入 base editor worker（Monarch 词法高亮
 * 在主线程运行，无需语言 worker）。
 */
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

;(globalThis as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(): Worker {
    return new EditorWorker()
  }
}

let configured = false

export function ensureMonacoConfigured(): void {
  if (configured) return
  loader.config({ monaco })
  // filter 编辑器托管的是 shell 语法的 JSON 文档（键可无引号、ObjectId(…) 等），
  // JS 语法/语义校验在此全是误报（如裸对象字面量被当作块语句报 "';' expected"），
  // 关闭诊断但保留 Monarch 语法着色
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true
  })
  configured = true
}
