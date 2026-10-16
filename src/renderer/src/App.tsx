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
          <div className="flex h-7 shrink-0 items-center border-b border-line bg-panel px-1.5">
            <button
              type="button"
              onClick={() => setNavOpen((open) => !open)}
              className="cursor-pointer p-1 text-text-muted transition-colors duration-fast hover:text-text-primary"
            >
              {navOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
            </button>
          </div>
          <Workbench />
        </main>
      </div>
      <StatusBar />
    </div>
  )
}
