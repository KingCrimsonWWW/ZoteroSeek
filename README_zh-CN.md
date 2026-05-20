# ZoteroSeek

<div align="right">

**[English](README.md)** | 中文

</div>

> Zotero 智能研究助手 - 基于大语言模型

[![Build and Test](https://github.com/KingCrimsonWWW/ZoteroSeek/actions/workflows/build.yml/badge.svg)](https://github.com/KingCrimsonWWW/ZoteroSeek/actions/workflows/build.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

## 功能特性

- 💬 **AI 对话** - 与大语言模型进行自然语言对话
- 📚 **PDF 分析** - 对 PDF 文档内容进行智能问答
- 🔍 **知识库** - 构建和检索研究知识库
- 🤖 **多模型支持** - OpenAI、DeepSeek、MiMo 等
- 🌐 **双语界面** - 支持中文和英文界面

## 安装

### 环境要求

- Zotero 7.0 或更高版本
- Node.js 18+（开发需要）

### 从 Release 安装

1. 从 [Releases](https://github.com/KingCrimsonWWW/ZoteroSeek/releases) 下载最新的 `.xpi` 文件
2. 在 Zotero 中，点击 工具 → 附加组件
3. 点击齿轮图标 → 从文件安装附加组件
4. 选择下载的 `.xpi` 文件

### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/KingCrimsonWWW/ZoteroSeek.git
cd ZoteroSeek

# 安装依赖
npm install

# 构建插件
npm run build

# 构建后的 .xpi 文件在 .scaffold/build/ 目录
```

## 开发

```bash
# 启动开发模式
npm start

# 运行代码检查
npm run lint

# 类型检查
npm run typecheck

# 格式化代码
npm run format
```

## 配置

安装后，配置你的 API Key：

1. 点击 编辑 → 首选项 → ZoteroSeek
2. 输入你选择的 LLM 提供商的 API Key
3. 选择默认模型

## 使用

### 快捷键

- `Ctrl/Cmd + Shift + S` - 打开/关闭 ZoteroSeek 面板
- `Ctrl/Cmd + Shift + A` - 分析选中的条目

### 对话界面

1. 点击 ZoteroSeek 图标或使用快捷键打开面板
2. 在输入框中输入问题
3. 按 Enter 发送

## 技术栈

- **前端框架**：React 18 + TypeScript + Tailwind CSS
- **状态管理**：Zustand
- **数据存储**：Dexie (IndexedDB)
- **LLM 集成**：OpenAI 兼容接口
- **构建工具**：esbuild + zotero-plugin-scaffold

## 贡献

欢迎贡献！请先阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

本项目采用 AGPL-3.0 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 致谢

- [Zotero](https://www.zotero.org/) - 文献管理软件
- [Aria](https://github.com/lifan0127/ai-research-assistant) - 参考架构
- [Zotero-GPT](https://github.com/MuiseDestiny/zotero-gpt) - 灵感来源
