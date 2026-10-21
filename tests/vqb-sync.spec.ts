import { beforeAll, describe, expect, it } from 'vitest'
import { createFieldRule, createQueryGroup, parseFindFilter } from '../src/core'
import type { FieldRule, QueryGroup } from '../src/core'

/**
 * VQB 树 ↔ filter 文本同步的回归测试：
 * 勾选/取消勾选、占位空行等编辑不能把查询栏里已有的条件整片清空。
 */
const FILTER = `{
  gid: "G6ab4ce",
  crawled: "on",
  totalCount: 0,
  domains: "www.starfire-live.com"
}`

type StoreType = typeof import('../src/renderer/src/store/app-store')['useAppStore']
let store: StoreType

function makeTab(filterText: string, vqbTree: QueryGroup | null): never {
  return {
    id: 't1',
    kind: 'collection',
    connId: 'c1',
    db: 'web',
    coll: 'coll',
    queryMode: 'json',
    sqlText: '',
    shellText: '',
    filterText,
    projectionText: '',
    sortText: '',
    skip: 0,
    limit: 100,
    docs: [],
    resultCount: 0,
    totalCount: null,
    elapsedMs: 0,
    running: false,
    runError: null,
    schema: null,
    sampling: false,
    vqbTree,
    vqbOpen: true,
    statsRows: [],
    statsLoadedAt: 0
  } as never
}

function seed(filterText: string, vqbTree: QueryGroup | null): void {
  store.setState({ tabs: [makeTab(filterText, vqbTree)], activeTabId: 't1' })
}

function currentTab(): { filterText: string; vqbTree: QueryGroup | null } {
  return store.getState().tabs[0]
}

beforeAll(async () => {
  // store 依赖 window.mongoApi（渲染进程注入），node 环境下先打桩
  ;(globalThis as unknown as { window: unknown }).window = { mongoApi: {} }
  const module = await import('../src/renderer/src/store/app-store')
  store = module.useAppStore
})

describe('VQB 取消勾选', () => {
  it('只去掉该条件，其余条件保留在 filter 里', () => {
    const tree = parseFindFilter(FILTER)
    seed(FILTER, tree)
    const first = tree.children[0] as FieldRule
    first.include = false
    store.getState().setVqbTree(tree)

    const tab = currentTab()
    expect(tab.filterText).not.toBe('{}')
    expect(tab.filterText).toContain('crawled')
    expect(tab.filterText).not.toContain('gid')
    // 行本身保留（仅取消勾选），便于重新勾选
    expect((tab.vqbTree as QueryGroup).children).toHaveLength(4)
    expect((tab.vqbTree as QueryGroup).children[0].include).toBe(false)
  })

  it('占位空行（字段未填）不会把已有 filter 覆盖成 {}', () => {
    // 场景：filter 文本无法反解析时，VQB 里只有一条占位空行
    const placeholder = createQueryGroup({ op: 'AND', isRoot: true })
    placeholder.children = [createFieldRule({ field: '' })]
    seed(FILTER, placeholder)

    const first = placeholder.children[0] as FieldRule
    first.include = false
    store.getState().setVqbTree(placeholder)

    expect(currentTab().filterText).toBe(FILTER)
  })

  it('后加的条件不会因为「取消勾选第一条」而被整片丢弃', () => {
    // 复现链路：VQB 首次打开建树 → 填第一条 → 新增第二条 → 取消勾选第一条。
    // 每次提交都必须以 store 里最新的树为根（与面板重渲染后拿到的 root 一致）。
    const placeholder = createQueryGroup({ op: 'AND', isRoot: true })
    placeholder.children = [createFieldRule({ field: '' })]
    seed('{}', placeholder)

    // 1) 填第一条
    let root = currentTab().vqbTree as QueryGroup
    Object.assign(root.children[0] as FieldRule, { field: 'fromusername', value: 'gh_1' })
    store.getState().setVqbTree(root)

    // 2) 新增第二条并填值
    root = currentTab().vqbTree as QueryGroup
    root.children.push(createFieldRule({ field: '' }))
    store.getState().setVqbTree(root)
    root = currentTab().vqbTree as QueryGroup
    Object.assign(root.children[1] as FieldRule, { field: 'month', value: '202609' })
    store.getState().setVqbTree(root)

    // 3) 取消勾选第一条：month 仍应留在 filter 里
    root = currentTab().vqbTree as QueryGroup
    ;(root.children[0] as FieldRule).include = false
    store.getState().setVqbTree(root)

    const tab = currentTab()
    expect(tab.filterText).toContain('month')
    expect(tab.filterText).not.toContain('fromusername')
  })
})
