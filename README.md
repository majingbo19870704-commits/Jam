# 个人工作站 · Personal Workstation

个人使用的桌面工具软件，覆盖工作事项管理、项目全生命周期管理、知识沉淀、英语学习、AI 工具与快捷链接。

**设计基线**：[《个人工作站设计说明书 v1》](../个人工作站设计说明书_v1.docx)

---

## 技术栈

| 层 | 选型 | 版本 | 备注 |
|---|---|---|---|
| 桌面壳 | Tauri | 2.x | Rust 内核，包体 ~10MB，性能优秀 |
| 前端框架 | React | 18.3 | - |
| 语言 | TypeScript | 5.5 | strict 模式 |
| 构建工具 | Vite | 5.x | 极速热更新 |
| CSS | Tailwind CSS | 3.4 | 原子化 |
| 组件库 | shadcn/ui | latest | 可深度定制 |
| 图标 | lucide-react | latest | 线性图标 |
| 状态管理 | Zustand | 4.x | 轻量、类型友好 |
| 表格 | TanStack Table | 8.x | 排序、筛选、虚拟滚动 |
| 甘特图 | Frappe Gantt | 0.6 | 起步方案；如不足换 DHTMLX |
| 图表 | ECharts | 5.x | 仪表盘、热力图 |
| 富文本 | Tiptap | 2.x | Markdown 编辑 |
| 日期 | date-fns + react-day-picker | latest | - |
| 数据库 | SQLite + FTS5 | via `tauri-plugin-sql` | 本地文件数据库 |
| ORM/查询 | Kysely 或原生 SQL | - | 类型化查询构造器 |
| xlsx 处理 | SheetJS | latest | 导入导出 |

---

## 目录结构（规划）

```
personal-workstation/
├── src/                    # 前端源码
│   ├── app/                # 路由与全局壳
│   ├── modules/            # 8 个一级模块
│   │   ├── dashboard/
│   │   ├── work/
│   │   ├── project/
│   │   ├── knowledge/
│   │   ├── english/
│   │   ├── ai-tools/
│   │   ├── quick-links/
│   │   └── settings/
│   ├── components/         # 通用组件
│   ├── lib/                # 工具函数
│   ├── db/                 # DAO 层
│   ├── stores/             # Zustand stores
│   ├── themes/             # 亮/暗主题
│   └── types/              # 全局类型
├── src-tauri/              # Tauri 壳层
│   ├── src/
│   ├── Cargo.toml
│   └── tauri.conf.json
├── docs/                   # 设计与开发文档
├── prototypes/             # HTML 原型
├── schema/                 # SQL DDL 与迁移
├── scripts/                # 构建/发布脚本
└── package.json
```

---

## 开发环境搭建

参见 [docs/setup.md](docs/setup.md)。

---

## 开发路线

- **Step 0 准备期**：技术栈定型 + 高保真原型 + SQL DDL（本仓库当前所在阶段）
- **Step 1 M0**：应用基座（脚手架、主题、导航、账号、数据层）
- **Step 2 M1**：工作管理 + 项目管理主表 + 参数设置
- **Step 3 M2**：项目详情四页 + 主页看板
- **Step 4 M3**：全局能力（命令面板、通知、回收站等）
- **Step 5 M4**：预留模块 MVP（知识/英语/AI）
- **Step 6**：打磨发布

详见设计说明书第 14 章。
