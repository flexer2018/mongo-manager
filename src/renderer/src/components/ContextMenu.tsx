/**
 * 通用右键菜单：固定定位在鼠标坐标处，渲染后按实际尺寸收回视口内；
 * 点击菜单外部 / 按 Esc / 窗口失焦或缩放即关闭。
 */
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: JSX.Element
  /** 该项之前显示分隔线 */
  dividerBefore?: boolean
  danger?: boolean
  onSelect(): void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose(): void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x, y })

  // 首帧按真实尺寸把菜单收回视口内，避免贴边溢出
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))
    })
  }, [x, y])

  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 捕获阶段监听：树容器自身滚动也能关闭（fixed 菜单不会跟随滚动）
    document.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-[110] min-w-44 rounded-md border border-line bg-elevated py-1 shadow-xl"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.dividerBefore === true && <div className="my-1 border-t border-line" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              item.onSelect()
            }}
            className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-2xs transition-colors duration-fast hover:bg-hover ${
              item.danger === true
                ? 'text-danger hover:text-danger'
                : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {item.icon !== undefined && <span className="shrink-0">{item.icon}</span>}
            <span className="flex-1 truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  )
}
