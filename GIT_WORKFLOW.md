# Git 版本管理指南

> ZoteroSeek 项目的 Git 工作流和版本管理规范

---

## 1. Git 基础概念

### 1.1 什么是版本管理？

版本管理就像给代码"存档"，你可以：
- 随时回退到之前的版本
- 多人同时开发不同功能
- 记录每次修改的内容和原因

### 1.2 核心概念

```
工作区 (Working Directory)    暂存区 (Stage)    本地仓库 (Repository)    远程仓库 (Remote)
    你的文件         →         git add         →        git commit        →       git push
```

**简单理解**：
- **工作区**：你正在编辑的文件
- **暂存区**：准备提交的文件"购物车"
- **本地仓库**：你电脑上的历史记录
- **远程仓库**：GitHub 上的备份

---

## 2. 分支策略

### 2.1 分支模型

我们采用 **Git Flow** 简化版：

```
main (主分支) ─────────────────────────────────────────→
  │                    ↑                    ↑
  │                    │                    │
  └── develop (开发) ──┼────────────────────┼──→
       │               │                    │
       ├── feature/chat ──→ (合并到 develop)
       ├── feature/rag ───→ (合并到 develop)
       └── bugfix/xxx ────→ (合并到 develop)
```

### 2.2 分支说明

| 分支 | 命名规则 | 用途 | 从哪里来 | 合并到哪里 |
|------|----------|------|----------|------------|
| `main` | - | 生产环境代码，始终保持稳定 | - | - |
| `develop` | - | 开发主分支，最新功能 | `main` | `main` |
| `feature/*` | `feature/功能名` | 新功能开发 | `develop` | `develop` |
| `bugfix/*` | `bugfix/问题描述` | Bug 修复 | `develop` | `develop` |
| `release/*` | `release/版本号` | 发布准备 | `develop` | `main` + `develop` |

### 2.3 分支命名规范

```bash
# ✅ 好的命名
feature/chat-interface
feature/pdf-parser
feature/rag-retriever
bugfix/fix-api-timeout
bugfix/fix-memory-leak

# ❌ 不好的命名
feature/my-feature        # 太模糊
feature/aaa              # 无意义
fix-bug                  # 不清晰
```

---

## 3. 提交规范

### 3.1 Conventional Commits

我们使用 **Conventional Commits** 规范，格式如下：

```
<type>(<scope>): <subject>

<空行>

<body>(可选)

<空行>

<footer>(可选)
```

### 3.2 Type 类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `feat` | 新功能 | `feat(chat): 添加流式响应支持` |
| `fix` | 修复 Bug | `fix(api): 修复 OpenAI 超时问题` |
| `docs` | 文档更新 | `docs(readme): 更新安装说明` |
| `style` | 代码格式（不影响功能） | `style: 统一代码缩进` |
| `refactor` | 重构（不是新功能也不是修复） | `refactor(llm): 重构适配器模式` |
| `test` | 测试相关 | `test(chat): 添加对话组件测试` |
| `chore` | 构建/工具相关 | `chore: 更新依赖版本` |
| `perf` | 性能优化 | `perf(rag): 优化向量检索性能` |

### 3.3 Scope 范围（可选）

常用的 scope：
- `chat` - 对话功能
- `rag` - RAG 检索
- `llm` - LLM 适配器
- `ui` - 界面相关
- `api` - API 调用
- `config` - 配置相关

### 3.4 提交示例

```bash
# 简单提交
git commit -m "feat: 添加对话历史功能"

# 带 scope
git commit -m "feat(chat): 添加对话历史功能"

# 带详细描述
git commit -m "feat(chat): 添加对话历史功能

- 实现对话列表展示
- 支持对话切换和删除
- 使用 Dexie 持久化存储

Closes #42"

# 修复 bug
git commit -m "fix(api): 修复 DeepSeek API 返回空响应的问题

添加空响应检查和重试机制"
```

### 3.5 提交频率

**原则**：每次提交应该是一个完整的、可工作的逻辑单元

```bash
# ✅ 好的做法
git commit -m "feat(chat): 实现消息列表组件"
git commit -m "feat(chat): 添加消息发送功能"
git commit -m "feat(chat): 实现流式响应"

# ❌ 不好的做法
git commit -m "WIP"                    # 进行中，不完整
git commit -m "update"                 # 太模糊
git commit -m "fix bug"                # 没说修了什么
git commit -m "feat: 添加了100个功能"   # 太大，应该拆分
```

---

## 4. 常用 Git 命令

### 4.1 日常开发流程

```bash
# 1. 开始新功能前，先更新 develop
git checkout develop
git pull origin develop

# 2. 创建功能分支
git checkout -b feature/chat-interface

# 3. 开发过程中，定期提交
git add .
git commit -m "feat(chat): 实现基础对话界面"

# 4. 功能完成，推送分支到远程
git push origin feature/chat-interface

# 5. 在 GitHub 上创建 Pull Request (PR)

# 6. PR 合并后，删除本地分支
git checkout develop
git pull origin develop
git branch -d feature/chat-interface
```

### 4.2 查看状态

```bash
# 查看当前状态
git status

# 查看提交历史
git log --oneline -10

# 查看某个文件的修改
git diff src/components/ChatPanel.tsx

# 查看暂存区内容
git diff --staged
```

### 4.3 撤销操作

```bash
# 撤销工作区的修改（未 add）
git checkout -- <file>

# 撤销暂存区的修改（已 add，未 commit）
git reset HEAD <file>

# 撤销最后一次 commit（保留修改）
git reset --soft HEAD~1

# 撤销最后一次 commit（丢弃修改）⚠️ 危险
git reset --hard HEAD~1
```

### 4.4 解决冲突

当多人修改同一文件时可能产生冲突：

```bash
# 1. 拉取最新代码
git pull origin develop

# 2. 如果有冲突，Git 会提示
# CONFLICT (content): Merge conflict in src/xxx.ts

# 3. 打开冲突文件，找到冲突标记
<<<<<<< HEAD
你的代码
=======
别人的代码
>>>>>>> feature/xxx

# 4. 手动解决冲突，删除标记，保留正确代码

# 5. 添加解决后的文件
git add <file>

# 6. 完成合并
git commit -m "merge: 解决合并冲突"
```

---

## 5. 版本发布流程

### 5.1 版本号规则 (SemVer)

```
MAJOR.MINOR.PATCH
  │      │     │
  │      │     └── 补丁版本：Bug 修复
  │      └──────── 次版本：新功能（向下兼容）
  └─────────────── 主版本：不兼容的变更
```

**示例**：
- `0.1.0` → `0.1.1`：修复了一个 Bug
- `0.1.1` → `0.2.0`：添加了新功能
- `0.2.0` → `1.0.0`：正式发布，有重大变更

### 5.2 发布步骤

```bash
# 1. 确保 develop 分支是最新的
git checkout develop
git pull origin develop

# 2. 创建 release 分支
git checkout -b release/0.1.0

# 3. 更新版本号（在 package.json 中）
# "version": "0.1.0"

# 4. 提交版本号更新
git add package.json
git commit -m "chore: bump version to 0.1.0"

# 5. 合并到 main
git checkout main
git merge release/0.1.0

# 6. 打标签
git tag -a v0.1.0 -m "Release v0.1.0: 基础对话功能"

# 7. 推送到远程
git push origin main --tags

# 8. 合并回 develop
git checkout develop
git merge release/0.1.0

# 9. 删除 release 分支
git branch -d release/0.1.0
git push origin --delete release/0.1.0
```

### 5.3 使用 release-it 工具

我们配置了 `release-it` 工具来简化发布流程：

```bash
# 交互式发布（会询问版本号）
npm run release

# 指定版本类型
npm run release -- --release-version 0.1.0

# 预览模式（不实际执行）
npm run release -- --dry-run
```

`release-it` 会自动：
1. 更新版本号
2. 创建 Git 标签
3. 推送到远程
4. 创建 GitHub Release

### 5.4 GitHub Actions 自动构建

当推送标签时，GitHub Actions 会自动：

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'  # 触发条件：推送 v 开头的标签

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # 1. 检出代码
      - uses: actions/checkout@v4
      
      # 2. 安装 Node.js
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      # 3. 安装依赖
      - run: npm install
      
      # 4. 构建插件
      - run: npm run build
      
      # 5. 创建 GitHub Release 并上传 xpi 文件
      - uses: softprops/action-gh-release@v1
        with:
          files: build/*.xpi
          generate_release_notes: true
```

---

## 6. 实际操作示例

### 6.1 场景：开发"对话历史"功能

```bash
# Step 1: 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/conversation-history

# Step 2: 开发第一个功能点 - 对话列表
# ... 编写代码 ...
git add src/components/history/HistoryPanel.tsx
git commit -m "feat(history): 实现对话列表组件"

# Step 3: 开发第二个功能点 - 对话切换
# ... 编写代码 ...
git add src/hooks/useConversation.ts
git commit -m "feat(history): 添加对话切换功能"

# Step 4: 开发第三个功能点 - 对话删除
# ... 编写代码 ...
git add src/stores/chatStore.ts
git commit -m "feat(history): 实现对话删除功能"

# Step 5: 推送分支
git push origin feature/conversation-history

# Step 6: 在 GitHub 创建 PR
# 标题: feat: 对话历史管理功能
# 描述: 实现对话列表、切换、删除功能

# Step 7: Code Review 通过后合并

# Step 8: 清理本地分支
git checkout develop
git pull origin develop
git branch -d feature/conversation-history
```

### 6.2 场景：修复 API 超时 Bug

```bash
# Step 1: 创建修复分支
git checkout develop
git pull origin develop
git checkout -b bugfix/fix-api-timeout

# Step 2: 修复 Bug
# ... 编写代码 ...
git add src/apis/llm/openai.ts
git commit -m "fix(api): 修复 OpenAI API 超时未重试的问题

添加超时检测和自动重试机制，最多重试3次"

# Step 3: 推送并创建 PR
git push origin bugfix/fix-api-timeout

# Step 4: 合并后清理
git checkout develop
git pull origin develop
git branch -d bugfix/fix-api-timeout
```

### 6.3 场景：发布 v0.1.0 版本

```bash
# Step 1: 确保 develop 是最新的
git checkout develop
git pull origin develop

# Step 2: 运行测试
npm run test

# Step 3: 使用 release-it 发布
npm run release

# release-it 会交互式询问：
# ? Select semver increment (Use arrow keys)
#   Patch (0.0.1)
#   Minor (0.1.0)  ← 选择这个
#   Major (1.0.0)
#   Pre-release

# ? Enter pre-release (optional): 
#   (直接回车跳过)

# ? Generate changelog? (Y/n) 
#   Y

# release-it 自动执行：
# 1. 更新 package.json 版本号
# 2. 生成 CHANGELOG.md
# 3. git commit -m "chore: release v0.1.0"
# 4. git tag v0.1.0
# 5. git push origin main --tags
# 6. 创建 GitHub Release
```

---

## 7. 常见问题 FAQ

### Q1: 不小心提交到了错误的分支怎么办？

```bash
# 场景：在 main 分支上开发了功能

# 方法1：撤销提交，保留修改
git reset --soft HEAD~1
git stash
git checkout develop
git stash pop
git add .
git commit -m "feat: xxx"

# 方法2：提交已经推送
git revert HEAD  # 创建一个新的提交来撤销
```

### Q2: 如何撤销已经推送的提交？

```bash
# 创建一个新的提交来"反转"之前的修改
git revert <commit-hash>

# 推送撤销
git push origin main
```

### Q3: 如何查看某个文件的修改历史？

```bash
# 查看文件的提交历史
git log --oneline src/components/ChatPanel.tsx

# 查看文件的详细修改记录
git log -p src/components/ChatPanel.tsx

# 查看某次提交的修改内容
git show <commit-hash>
```

### Q4: 如何临时保存当前工作？

```bash
# 保存当前修改
git stash

# 查看保存列表
git stash list

# 恢复最近的保存
git stash pop

# 恢复但不删除保存
git stash apply

# 删除保存
git stash drop
```

### Q5: 如何同步远程的最新代码？

```bash
# 方法1：拉取并合并
git pull origin develop

# 方法2：拉取并变基（保持线性历史）
git pull --rebase origin develop
```

---

## 8. 最佳实践总结

### ✅ 应该做的

1. **频繁提交**：小步快跑，每个逻辑单元一次提交
2. **清晰的提交信息**：说明做了什么，为什么做
3. **及时拉取**：开始工作前先 `git pull`
4. **使用分支**：功能开发在独立分支进行
5. **Code Review**：通过 PR 进行代码审查
6. **标签发布**：使用语义化版本标签

### ❌ 不应该做的

1. **直接在 main/develop 上开发**
2. **提交未完成的代码**（WIP）
3. **提交无意义的信息**（update、fix）
4. **强制推送**（`git push --force`）除非你确定
5. **提交敏感信息**（API Key、密码）
6. **一次性提交大量代码**

---

## 9. 工具推荐

### Git GUI 工具

- **GitHub Desktop**：官方 GUI，简单易用
- **GitKraken**：功能强大，界面美观
- **VS Code Git**：编辑器内置，方便快捷
- **SourceTree**：免费，功能全面

### VS Code 扩展

- **GitLens**：增强 Git 功能
- **Git Graph**：可视化分支图
- **Conventional Commits**：规范化提交信息

---

**文档版本**：v1.0.0  
**最后更新**：2026-05-20
