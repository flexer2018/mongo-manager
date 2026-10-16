/**
 * GROUP BY / 聚合 SELECT → MongoDB aggregate 管道（纯逻辑）。
 * 管道形态：$match(where) → $group(_id + 聚合) → $project(展平) → $sort → $skip → $limit。
 * ORDER BY 仅可引用分组字段或聚合别名（展平后的顶层字段）。
 */
import type { SelectItem, SqlSelect } from './sql'

/** 校验并收集聚合输出项；普通列必须出现在 GROUP BY 中 */
function collectItems(stmt: SqlSelect): { aggregates: SelectItem[]; columns: SelectItem[] } {
  const aggregates: SelectItem[] = []
  const columns: SelectItem[] = []
  const groupBy = stmt.groupBy ?? []
  for (const item of stmt.items ?? []) {
    if (item.kind === 'aggregate') {
      if (item.func !== 'COUNT' && item.field === '*') {
        throw new Error(`${item.func}(*) 无效：仅 COUNT(*) 允许 * 参数`)
      }
      aggregates.push(item)
      continue
    }
    if (stmt.groupBy !== null && !groupBy.includes(item.field)) {
      throw new Error(`列 "${item.field}" 必须出现在 GROUP BY 中（聚合查询）`)
    }
    if (stmt.groupBy === null) {
      throw new Error('聚合查询的普通列必须出现在 GROUP BY 中')
    }
    columns.push(item)
  }
  return { aggregates, columns }
}

/** 构建聚合管道；matchFilter 为已编译的 WHERE（可为 null） */
export function buildAggregatePipeline(
  stmt: SqlSelect,
  matchFilter: Record<string, unknown> | null
): Record<string, unknown>[] {
  if (stmt.items === null) throw new Error('GROUP BY 需要 SELECT 输出项（不允许 SELECT *）')
  const { aggregates } = collectItems(stmt)
  if (aggregates.length === 0) {
    throw new Error('聚合查询至少需要一个聚合函数（如 COUNT(*)）')
  }

  const pipeline: Record<string, unknown>[] = []
  if (matchFilter !== null && Object.keys(matchFilter).length > 0) {
    pipeline.push({ $match: matchFilter })
  }

  const groupBy = stmt.groupBy ?? []
  const groupBody: Record<string, unknown> = {}
  for (const item of aggregates) {
    if (item.func === undefined) continue
    if (item.func === 'COUNT') {
      groupBody[item.alias] =
        item.field === '*' ? { $sum: 1 } : { $sum: { $cond: [{ $ifNull: [`$${item.field}`, false] }, 1, 0] } }
    } else {
      groupBody[item.alias] = { [`$${item.func.toLowerCase()}`]: `$${item.field}` }
    }
  }
  let groupId: unknown
  if (groupBy.length === 0) groupId = null
  else if (groupBy.length === 1) groupId = `$${groupBy[0]}`
  else groupId = Object.fromEntries(groupBy.map((field) => [field, `$${field}`]))
  pipeline.push({ $group: { _id: groupId, ...groupBody } })

  // 展平：分组字段从 _id 还原为顶层，聚合保留别名
  const project: Record<string, unknown> = {}
  for (const field of groupBy) {
    project[field] = groupBy.length === 1 ? '$_id' : `$_id.${field}`
  }
  for (const item of aggregates) project[item.alias] = 1
  project._id = 0
  pipeline.push({ $project: project })

  const sortable = new Set([...groupBy, ...aggregates.map((item) => item.alias)])
  if (stmt.orderBy.length > 0) {
    const sort: Record<string, number> = {}
    for (const { field, desc } of stmt.orderBy) {
      if (!sortable.has(field)) {
        throw new Error(`聚合查询的 ORDER BY 仅可引用分组字段或聚合别名（"${field}" 不在其中）`)
      }
      sort[field] = desc ? -1 : 1
    }
    pipeline.push({ $sort: sort })
  }
  if (stmt.offset !== null && stmt.offset > 0) pipeline.push({ $skip: stmt.offset })
  if (stmt.limit !== null) pipeline.push({ $limit: stmt.limit })
  return pipeline
}
