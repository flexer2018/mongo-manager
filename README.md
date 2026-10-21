# Mongo Manager

**免费开源的 MongoDB 桌面管理工具** · Free & open-source MongoDB desktop manager

一个为开发者打造的现代化 MongoDB 图形客户端：把可视化查询构建、多语言驱动代码生成、SQL 查询、数据管理与结果浏览整合进一个流畅的深色 IDE 风格工作台。基于 Electron + TypeScript 构建，跨 Windows / macOS / Linux（源码运行）。

## 功能特性

### 查询

- **双模式编辑器**：JSON（shell 语法，键可无引号、`ObjectId(…)`/`NumberInt(…)` 等构造器）与 SQL（MySQL 标准语法子集）一键切换，Monaco 本地打包、离线可用
- **可视化查询构建器（VQB）**：无需手写查询语句——27 种操作符 + AND/OR/NOR/$elemMatch 递归组、Include/Exclude 字段控制、操作符按字段类型自动过滤，与查询栏 filter 双向实时同步
- **SQL 查询**：`WHERE` 全套比较 / `IN` / `LIKE` / `BETWEEN` / `IS NULL` / `AND/OR/NOT` 嵌套、`GROUP BY` + `COUNT/SUM/AVG/MIN/MAX`（自动翻译为聚合管道）、`ORDER BY`、`LIMIT/OFFSET`；find 无法表达的形态在反向展示时明确标注
- **三种执行方式**：单行执行（光标行）/ 选中执行 / 全部执行（`Ctrl+Enter` / `F9`），支持多语句脚本逐条运行
- **Query Code 生成**：同一查询实时生成 Shell / Node.js / C# / Java×2 / Python / PHP / Ruby 驱动代码，语法高亮、一键复制

### 数据管理

- **导航树**：连接 → 库 → 集合三级懒加载，集合类型徽标（普通 c / 视图 v / 系统 s / 时间序列 ts / 聚簇 cl）、本地过滤
- **右键菜单**：集合行可复制集合名、在 SQL / Shell 编辑器中打开该集合、查看单个集合统计；数据库行可复制库名、以表格页签查看该库全部集合统计
- **文档 CRUD**：行内编辑 / 删除（确认弹窗）/ 插入文档（EJSON 编辑 + 客户端校验），操作后自动刷新
- **集合管理**：创建（时间序列 / 聚簇选项）/ 重命名 / 删除，页签联动
- **索引管理**：列表（名称 / 键 / 唯一 / 稀疏）/ 创建 / 删除，`_id_` 保护
- **集合统计**：单集合统计（文档数 / 数据与存储大小 / 平均文档 / 索引数与索引大小）弹窗查看；库级「集合统计」页签用表格汇总该库所有集合，支持列排序、合计行、60 秒缓存与手动刷新，双击集合名直接打开该集合
- **结果区**：虚拟化表格 + JSON 双视图、BSON 类型着色、节点折叠、mongosh 风格展示、分页（每页 20/50/100/200）、文档详情弹窗（`F4` 查看当前记录 / 上一条 / 下一条 / ←→ 键导航 / 复制 / 编辑）
- **通栏状态栏**：连接状态呼吸灯 + 服务器版本 + 当前命名空间 + 结果统计
- **操作日志**：内建日志面板（工具栏按钮 / `Ctrl+Shift+L`）记录每次 filter ↔ VQB 树同步、规则勾选 / 编辑、执行与异常，复现问题时一键复制整段日志便于排查
- **日间 / 夜间双主题**，深色 IDE 风格设计

### SQL 查询示例

```sql
SELECT status, count(*) AS cnt
FROM my_collection
WHERE age > 25 AND status IN ('active', 'pending') AND name LIKE '张%'
GROUP BY status
ORDER BY cnt DESC
LIMIT 20
```

翻译为 MongoDB 聚合管道执行；普通查询（无 GROUP BY）翻译为 `find` 的 filter / projection / sort / skip / limit，并与 VQB、查询栏各分段自动同步。

## 快速开始

要求：Node.js ≥ 18，npm ≥ 9。

```bash
npm install
npm start            # 开发模式启动（Electron + Vite，源码运行）
```

```bash
npm test             # vitest：169 项语义/功能测试
npm run typecheck    # main / preload / renderer 三层类型检查
npm run build        # electron-vite 全量构建
```

真实库冒烟验收（凭据经环境变量传入，不落盘）：

```bash
MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?authMechanism=SCRAM-SHA-1' \
  node scripts/smoke-real.mjs    # 连接/列库/列集合/find/count/EJSON 往返
MONGO_SMOKE_URI='mongodb://user:pass@host:27017/admin?authMechanism=SCRAM-SHA-1' \
  node scripts/smoke-crud.mjs    # CRUD/集合/索引全链路（专用临时库，自清理）
```

## 架构

```
渲染进程 (React 18 + Zustand + TanStack Virtual + Monaco 本地打包)
  │   查询语义全部本地计算（编译/反解析微秒级，不走 IPC）
  ├─ src/core/   纯逻辑层：无 UI、无 Node 依赖，可独立 vitest
  │     compiler / parser（shell 语法解析）/ sql / sql-aggregate / sql-reverse
  │     query-code（8 语言生成）/ db-tree / schema / type-colors
  ├─ preload     contextBridge 类型化契约（MongoApi）
  └─ IPC (EJSON 字符串) → 主进程薄数据库代理 → mongodb 驱动 6.x → MongoDB
```

性能设计目标：

| 常见性能陷阱 | 本项目的方案 |
| --- | --- |
| 驱动调用阻塞 UI 线程 | 驱动在主进程，查询异步经 IPC，UI 永不阻塞 |
| 同一查询重复编译多次 | VQB 树 ↔ filter 编译/反解析为纯计算，仅状态变更时执行一次 |
| 输入逐键打服务器 | 树过滤 / 查询输入本地防抖，网络请求仅在执行时发起 |
| 编辑器逐键重渲染整棵工作区 | 键入文本先留在 Monaco，停顿 200ms 才合并写回状态；执行 / 切换模式 / 失焦前强制提交，不丢输入 |
| 反复打开统计页重复全量拉取 | 库级集合统计按「连接 + 库」缓存 60 秒，命中直接回填，可手动强制刷新 |
| 全量重绘 | TanStack Virtual 只渲染可见行（overscan 12） |
| 编辑器依赖 CDN 加载 | Monaco 本地打包，完全离线可用 |

## 开发指南

```
src/core/        纯逻辑层（可独立测试；查询语义的唯一实现处）
src/main/        主进程：窗口生命周期 + ConnectionManager + IPC 薄代理
src/preload/     contextBridge 类型化契约
src/renderer/    React 工作台（store / components）
tests/           vitest 测试（core 语义 + SQL 翻译 + 冒烟）
docs/            功能路线图
scripts/         真实库冒烟脚本（凭据走 MONGO_SMOKE_URI 环境变量）
```

约定：

- **查询语义只写在 `src/core`**：渲染进程与主进程之间所有查询/文档以 EJSON 字符串（`relaxed: false`）传递，主进程只做 `EJSON.parse` 薄代理
- **绝不 eval**：所有用户输入经白名单解析器（shell 语法 / SQL）处理
- **测试即规格**：操作符归约优先级、正则操作符降级路径、`$in/$nin/$all` 列表结构等行为由测试固化，改动语义前先改测试

## 反馈与贡献

这个项目还在快速成长中，非常欢迎你的参与：

- **提建议 / 需求**：在 [GitHub Issues](https://github.com/flexer2018/mongo-manager/issues) 告诉我们你希望 Mongo Manager 增加什么功能、哪些交互需要改进——每一条建议都会认真评估并纳入路线图
- **报告问题**：遇到 Bug 请附上复现步骤、MongoDB 版本与控制台输出，会尽快跟进修复
- **参与贡献**：欢迎提交 Pull Request。核心查询语义集中在 `src/core` 且有完整测试覆盖，从修复一个解析边界到新增一种代码生成语言都是很好的切入点
- **路线图讨论**：导入导出、聚合管道构建器、Explain 可视化等规划项的设计讨论在 Issues 中进行，欢迎发表意见

## 路线图

详见 [docs/FEATURE-ROADMAP.md](docs/FEATURE-ROADMAP.md)。已完成：查询全链路（VQB / SQL / Query Code）+ 日常管理（CRUD / 集合 / 索引）。规划中：导入导出（JSON / CSV）、聚合管道构建器、Explain 可视化、数据对比同步、内嵌 mongosh。

## 许可

[MIT](LICENSE)
