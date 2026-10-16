import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAppStore } from './store/app-store'
import { Toolbar } from './components/Toolbar'
import { NavTree } from './components/nav-tree/NavTree'
import { Workbench } from './components/collection-tab/Workbench'
import { StatusBar } from './components/StatusBar'

/** 三栏工作台外壳：顶部工具条 + 左侧导航 + 右侧集合工作区 */
export default function App(): JSX.Element {
  const loadSaved = useAppStore((s) => s.loadSaved)
  const theme = useAppStore((s) => s.theme)
  const [navOpen, setNavOpen] = useState(true)

  useEffect(() => {
    void loadSaved()
  }, [loadSaved])

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
  }, [theme])

  const navToggle = (
    <button
      type="button"
      onClick={() => setNavOpen((open) => !open)}
      title={navOpen ? '收起导航栏' : '展开导航栏'}
      className="mr-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-text-muted transition-colors duration-fast hover:bg-hover hover:text-text-primary"
    >
      {navOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
    </button>
  )

  return (
    <div className="flex h-full flex-col bg-base">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {navOpen ? (
          <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel">
            <NavTree />
          </aside>
        ) : null}
        <main className="flex min-w-0 flex-1 flex-col">
          <Workbench navToggle={navToggle} />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
