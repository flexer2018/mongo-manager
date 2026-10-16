/**
 * 结果区分页条：页码导航 + 每页行数。
 * 页码派生自 tab 的 skip/limit；totalCount 为 null（count 未返回）时仅显示当前页。
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { WorkTab } from '../../store/app-store'
import { useAppStore } from '../../store/app-store'

const PAGE_SIZES = [20, 50, 100, 200]

export function PaginationBar({ tab }: { tab: WorkTab }): JSX.Element | null {
  const patchActive = useAppStore((s) => s.patchActive)
  const runTab = useAppStore((s) => s.runTab)

  const limit = tab.limit > 0 ? tab.limit : 100
  const page = Math.floor(tab.skip / limit)
  const totalPages =
    tab.totalCount !== null && limit > 0 ? Math.max(1, Math.ceil(tab.totalCount / limit)) : null

  const goto = (nextPage: number): void => {
    const target = Math.max(0, totalPages !== null ? Math.min(nextPage, totalPages - 1) : nextPage)
    patchActive({ skip: target * limit })
    void runTab(tab.id)
  }

  const changeSize = (size: number): void => {
    patchActive({ limit: size, skip: 0 })
    void runTab(tab.id)
  }

  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t border-line bg-panel px-2 text-[10px] text-text-muted">
      <span>每页</span>
      <select
        value={tab.limit}
        onChange={(event) => changeSize(Number.parseInt(event.target.value, 10))}
        className="h-5 cursor-pointer rounded border border-line bg-base px-1 text-[10px] text-text-primary outline-none focus:border-accent-dim"
      >
        {PAGE_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
        {!PAGE_SIZES.includes(tab.limit) && <option value={tab.limit}>{tab.limit}</option>}
      </select>
      <span>条</span>

      <div className="flex-1" />

      <button
        type="button"
        disabled={page <= 0}
        onClick={() => goto(0)}
        className="cursor-pointer px-1 transition-colors duration-fast enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        «
      </button>
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => goto(page - 1)}
        className="flex cursor-pointer items-center px-1 transition-colors duration-fast enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronLeft size={12} />
      </button>
      <span className="tabular-nums">
        第 {page + 1} 页{totalPages !== null ? ` / ${totalPages} 页` : ''}
      </span>
      <button
        type="button"
        disabled={totalPages !== null && page >= totalPages - 1}
        onClick={() => goto(page + 1)}
        className="flex cursor-pointer items-center px-1 transition-colors duration-fast enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ChevronRight size={12} />
      </button>
      <button
        type="button"
        disabled={totalPages === null || page >= totalPages - 1}
        onClick={() => goto(totalPages !== null ? totalPages - 1 : page + 1)}
        className="cursor-pointer px-1 transition-colors duration-fast enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        »
      </button>

      {tab.totalCount !== null && (
        <span className="ml-1">
          共 {tab.totalCount} 条 · 跳过 {tab.skip}
        </span>
      )}
    </div>
  )
}
