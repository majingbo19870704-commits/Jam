# 开发环境搭建

面向 Windows 11 中文版。macOS / Linux 步骤类似但命令略有不同。

## 1. 先决条件

| 工具 | 版本 | 下载 |
|---|---|---|
| Node.js | ≥ 20.10 LTS | https://nodejs.org/ |
| pnpm | ≥ 9 | `npm i -g pnpm` |
| Rust 工具链 | 1.78+ | https://rustup.rs/ |
| Microsoft Visual Studio Build Tools 2022 | Latest | 含 "使用 C++ 的桌面开发" 工作负载 |
| WebView2 Runtime | Latest | Windows 11 默认已装 |
| Git | 2.x | https://git-scm.com/ |
| LibreOffice（可选） | 25.x | 用于 Office 文件预览转 PDF；用户首次预览时提示按需安装 |

## 2. 一次性初始化

```powershell
# 1) 安装 Rust
winget install Rustlang.Rustup
# 重开 PowerShell 让环境变量生效
rustup default stable

# 2) 安装 Tauri CLI
cargo install create-tauri-app --locked
cargo install tauri-cli --locked

# 3) 检查 Node
node -v      # 期望 v20.x
pnpm -v      # 期望 9.x
```

## 3. 首次克隆后

```powershell
cd personal-workstation
pnpm install

# 前端热更新（用于开发 UI）
pnpm dev

# 完整应用（含 Tauri 壳）
pnpm tauri dev
```

## 4. 常用命令

```powershell
pnpm dev              # 仅前端 vite dev
pnpm tauri dev        # Tauri 完整应用开发模式
pnpm build            # 前端产物
pnpm tauri build      # 打包 Windows 安装器（.msi/.exe）
pnpm lint             # ESLint
pnpm format           # Prettier
pnpm test             # Vitest 单测
pnpm db:migrate       # 执行 schema/migrations 下的 SQL
pnpm db:seed          # 灌入初始种子数据
```

## 5. 常见问题

**Q：`pnpm tauri dev` 报 `error: linker link.exe not found`**
A：未装 Visual Studio Build Tools。启动 Visual Studio Installer → 修改 → 勾选"使用 C++ 的桌面开发"。

**Q：中文路径下热更新失败**
A：Rust/Cargo 对包含空格或中文的路径不友好。建议将仓库放在 `C:\dev\personal-workstation` 之类的英文路径下。开发完成后打包出的安装器在任意路径都可正常运行。

**Q：WebView2 找不到**
A：Windows 11 默认已装；Windows 10 用户从 https://developer.microsoft.com/microsoft-edge/webview2/ 下载 Evergreen 分发版。

## 6. 编辑器推荐

**VS Code** + 以下插件：
- `rust-lang.rust-analyzer`
- `tauri-apps.tauri-vscode`
- `dbaeumer.vscode-eslint`
- `esbenp.prettier-vscode`
- `bradlc.vscode-tailwindcss`
- `ms-vscode.hexeditor`（查 SQLite 文件时有用）

## 7. 数据目录

开发模式下 SQLite 数据库位于：
```
%APPDATA%\PersonalWorkstation-dev\data.db
```

打包发布后：
```
%APPDATA%\PersonalWorkstation\data.db
```

用户可在系统设置中修改此路径。
