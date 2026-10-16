import { useState } from 'react'
import type { FormEvent, JSX } from 'react'
import { Save, Trash2, X } from 'lucide-react'
import { useAppStore } from '../store/app-store'

const PLACEHOLDER = 'mongodb://user:pass@host:27017/admin?authMechanism=SCRAM-SHA-1'

/** 连接管理对话框：新建连接 + 保存列表（命名 / 删除） */
export function ConnectDialog({ onClose }: { onClose(): void }): JSX.Element {
  const saved = useAppStore((s) => s.saved)
  const saveConnection = useAppStore((s) => s.saveConnection)
  const removeSaved = useAppStore((s) => s.removeSaved)
  const connect = useAppStore((s) => s.connect)
  const connError = useAppStore((s) => s.connError)
  const [name, setName] = useState('')
  const [uri, setUri] = useState('')

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (uri.trim() === '') return
    void saveConnection(name.trim(), uri.trim())
    setName('')
    setUri('')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6">
      <div className="panel flex max-h-[70vh] w-[560px] flex-col rounded-lg shadow-2xl">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-semibold text-text-primary">连接管理</span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
          >
            <X size={15} />
          </button>
        </div>

        <form onSubmit={submit} className="flex shrink-0 gap-2 border-b border-line p-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="连接名称"
            className="h-8 w-36 rounded border border-line bg-base px-2 text-xs text-text-primary outline-none transition-colors duration-fast placeholder:text-text-faint focus:border-accent-dim"
          />
          <input
            value={uri}
            onChange={(event) => setUri(event.target.value)}
            placeholder={PLACEHOLDER}
            className="mono h-8 flex-1 rounded border border-line bg-base px-2 text-xs text-text-primary outline-none transition-colors duration-fast placeholder:text-text-faint focus:border-accent-dim"
          />
          <button
            type="submit"
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded bg-accent/15 px-3 text-xs font-medium text-accent transition-colors duration-fast hover:bg-accent/25"
          >
            <Save size={12} />
            保存
          </button>
        </form>

        {connError !== null && (
          <div className="shrink-0 border-b border-line bg-danger/10 px-3 py-1.5 text-2xs text-danger">
            {connError}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {saved.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-2 rounded px-2 py-1.5 transition-colors duration-fast hover:bg-hover"
            >
              <button
                type="button"
                onClick={() => {
                  void connect(item.uri)
                  onClose()
                }}
                className="min-w-0 flex-1 cursor-pointer text-left"
              >
                <div className="truncate text-xs text-text-primary">{item.name}</div>
                <div className="mono truncate text-2xs text-text-muted">{item.uri}</div>
              </button>
              <button
                type="button"
                onClick={() => void removeSaved(item.id)}
                className="cursor-pointer p-1 text-text-faint opacity-0 transition-all duration-fast group-hover:opacity-100 hover:text-danger"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          {saved.length === 0 && (
            <div className="py-6 text-center text-2xs text-text-muted">
              保存一个连接串，下次一键连入
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
