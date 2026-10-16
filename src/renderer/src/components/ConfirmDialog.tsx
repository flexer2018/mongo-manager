/**
 * 应用内确认/提示对话框：替代 window.confirm / window.alert 原生弹窗。
 * Esc 或点击遮罩取消；danger 模式下默认聚焦"取消"按钮，防止回车误触发危险操作。
 * 传入 confirmKeyword 时需在输入框中手工键入该关键词，确认按钮才可用（高危操作防误触）。
 */
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

interface ConfirmDialogProps {
  title: string
  message: string
  onConfirm(): void
  onClose(): void
  /** 确认按钮是否为危险操作（红色） */
  danger?: boolean
  confirmText?: string
  /** 传 null 隐藏取消按钮（作为纯提示框使用） */
  cancelText?: string | null
  /** 要求用户键入的关键词（如 'delete'），输入完全一致后确认按钮才可用 */
  confirmKeyword?: string
}

export function ConfirmDialog({
  title,
  message,
  onConfirm,
  onClose,
  danger = false,
  confirmText = '确认',
  cancelText = '取消',
  confirmKeyword
}: ConfirmDialogProps): JSX.Element {
  const [keyword, setKeyword] = useState('')
  const keywordOk = confirmKeyword === undefined || keyword.trim() === confirmKeyword

  // Esc 键取消
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/55 p-8" onClick={onClose}>
      <div
        className="panel flex w-[360px] flex-col rounded-lg shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-line px-3">
          <span className="text-xs font-semibold text-text-primary">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer text-text-muted transition-colors duration-fast hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>
        <div className="px-3 py-3 text-xs leading-5 text-text-secondary select-text">
          {message}
          {confirmKeyword !== undefined && (
            <input
              autoFocus
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={`请输入 ${confirmKeyword} 以确认`}
              spellCheck={false}
              className="mono mt-2 h-7 w-full rounded border border-line bg-base px-2 text-xs text-text-primary outline-none transition-colors duration-fast focus:border-accent-dim"
            />
          )}
        </div>
        <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-t border-line px-3">
          {cancelText !== null && (
            <button
              type="button"
              autoFocus={danger && confirmKeyword === undefined}
              onClick={onClose}
              className="cursor-pointer rounded border border-line px-3 py-1 text-xs text-text-secondary transition-colors duration-fast hover:border-line-strong hover:text-text-primary"
            >
              {cancelText}
            </button>
          )}
          <button
            type="button"
            autoFocus={!danger && confirmKeyword === undefined}
            disabled={!keywordOk}
            onClick={onConfirm}
            className={
              danger
                ? 'cursor-pointer rounded bg-danger px-3 py-1 text-xs font-medium text-white transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
                : 'cursor-pointer rounded bg-accent px-3 py-1 text-xs font-medium text-[rgb(var(--c-on-accent))] transition-opacity duration-fast hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
