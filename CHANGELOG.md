# Changelog

所有显著变更记录于此。格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.3.0] - 2026-10-16

### Added

- **SQL 查询**（MySQL 标准语法子集）：`WHERE` 全套比较 / `IN` / `LIKE` / `BETWEEN` / `IS NULL` /
  `AND/OR/NOT` 嵌套、`GROUP BY` + `COUNT/SUM/AVG/MIN/MAX`（翻译为聚合管道）、`ORDER BY`、`LIMIT/OFFSET`；
  Mongo filter ↔ SQL 双向展示，find 不可表达形态明确标注
- **查询区左右布局**：可视化查询构建器（左）与语句编辑器（右）并列，占视口 35%；VQB 底部执行按钮
- **三种执行方式**：单行执行（光标行）/ 选中执行 / 全部执行（Ctrl+Enter）
- **文档 CRUD**：插入 / 编辑 / 删除（DocEditModal + 行内操作 + 确认弹窗），操作后自动刷新
- **集合管理**：创建（时间序列 / 聚簇选项）/ 重命名 / 删除，树与页签联动
- **索引管理面板**：列表 / 创建 / 删除（`_id_` 保护），结果区新页签
- **结果区增强**：分页条（每页 20/50/100/200）、JSON 节点折叠、文档详情上一条/下一条（←→ 键）
- **通栏状态栏**：连接状态 + 服务器版本 + 当前命名空间 + 结果统计
- IPC：文档 CRUD / 集合管理 / 索引管理 / aggregate 管道执行通道

### Fixed

- Monaco 改为本地打包（脱离 CDN），修复离线环境永远 "Loading..."
- 关闭 JS 模式误报语法诊断（filter 为 shell 语法的 JSON 文档，非 JS 语句）
- VQB 字段下拉经 portal 渲染，修复被面板滚动容器裁剪；采样失败回退当前页推断 schema；
  字段选择改为可过滤 combobox（大列表渲染保护）
- 文档编辑器 pretty 缩进格式化（EJSON stringify 无缩进参数，自实现排版）

## [0.2.0] - 2026-10

### Added

- 双集合页签多开、日间 / 夜间双主题（localStorage 持久化）
- mongosh 风格 JSON 输出（`ObjectId(…)`、`NumberInt(…)`）与 BSON 类型/参数分离着色
- shell 语法 → 规范 EJSON 的边界转换（修复 filter JSON 解析错误）

## [0.1.0] - 2026-10

### Added

- 一期 MVP：连接管理（多连接保存/命名）、连接→库→集合三级懒加载树（类型徽标、本地过滤）
- 查询栏：Monaco filter + projection / sort / skip / limit 分段输入
- 可视化查询构建器（27 操作符 + 递归组 + Include 排除 + 类型过滤 + 双向同步）
- Query Code：8 语言驱动代码实时生成
- 结果区：虚拟化表格 / JSON 双视图 / BSON 类型着色 / 文档详情
- core 纯逻辑层 + 155 项 vitest 语义测试
