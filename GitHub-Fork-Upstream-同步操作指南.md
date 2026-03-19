# GitHub：把别人的仓库“搬到自己账号”并保持同步（Fork + upstream）

这份文档解决一件事：**把别人的 GitHub 仓库变成你自己的仓库（可提交/可推送），同时还能持续同步原作者的更新**，并且你本地也能随时拉到最新代码。

核心约定：
- **origin**：你的仓库（你账号下的 fork）
- **upstream**：原作者/官方仓库

---

## 0）前提：Windows 常见坑（浏览器能上 GitHub，但 git 不通）

如果你浏览器能访问 GitHub，但 `git clone / git push` 超时或 443 连不上，通常是 **命令行没走代理**。

设置 git 代理（把地址替换成你自己的代理端口，比如常见 `127.0.0.1:7890/7897`）：

```bash
git config --global http.proxy  http://127.0.0.1:7897
git config --global https.proxy http://127.0.0.1:7897
```

不需要代理时取消：

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

---

## 1）把别人的仓库“搞到你账号”（Fork）

### 方式 A：网页端（最稳）
打开对方仓库页面 → 点击 **Fork** → 选择你的账号 → 创建完成。

### 方式 B：命令行（更快，推荐装 GitHub CLI：`gh`）

先登录（只需一次）：

```bash
gh auth login
```

Fork 到你账号（不自动 clone）：

```bash
gh repo fork 原作者/仓库名 --clone=false
```

> 例：`gh repo fork firecrawl/firecrawl --clone=false`

---

## 2）Clone 到本地（从你自己的 fork 克隆）

建议 **clone 你自己的仓库**（这样你 push 有权限）：

```bash
git clone https://github.com/你的用户名/仓库名.git
cd 仓库名
```

---

## 3）配置 upstream（指向原作者仓库，用来同步更新）

在本地仓库目录里执行：

```bash
git remote add upstream https://github.com/原作者/仓库名.git
git remote -v
```

你应该能看到：
- `origin` → `https://github.com/你的用户名/仓库名.git`
- `upstream` → `https://github.com/原作者/仓库名.git`

---

## 4）让你的 GitHub 跟上原作者更新（同步 upstream → 推回 origin）

在本地仓库里执行（以默认分支 `main` 为例）：

```bash
git fetch upstream
git checkout main
git merge upstream/main
git push origin main
```

如果原仓库默认分支是 `master`，把上面命令里的 `main` 改成 `master`。

---

## 5）你本地也能拿到你 GitHub 上的最新代码（拉 origin）

```bash
git pull origin main
```

---

## 6）日常最简工作流（记住这 3 句就够）

在仓库目录里：

- **同步别人更新到本地**：

```bash
git fetch upstream
git merge upstream/main
```

- **同步到你 GitHub（你的 fork）**：

```bash
git push origin main
```

- **本地跟随你 GitHub（另一台机器/另一个目录）**：

```bash
git pull origin main
```

---

## 7）推荐习惯（可选，但强烈建议）

- **永远在你的 fork（origin）上开发**，不要直接改 upstream。
- 功能开发用分支更安全：

```bash
git checkout -b feature/xxx
git push -u origin feature/xxx
```

