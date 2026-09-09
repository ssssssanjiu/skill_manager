# Skill Manager

Claude Code 的 skill 管理工作台

一个网页面板 + 一个菜单栏图标，管住你所有的 Claude Code skill —— 粘一个 GitHub 地址就装上，软链接托管零拷贝，改完立刻生效。

**纯 Node 标准库写的，没有 `npm install` 这一步。** 克隆下来 `node manager/server.js` 就能跑。

---

## 为什么要它

Claude Code 读 `~/.claude/skills/`。skill 多起来之后有三个麻烦：

| 麻烦 | 这里怎么解 |
| --- | --- |
| 装了什么、装在哪，全靠 `ls` 和记忆 | 面板一页列全，按功能自动分类 |
| 装一个 skill 要 clone、改目录、挪位置 | 粘 GitHub 地址，点安装 |
| 文件散在 `~/.claude/skills/` 里，没版本管理 | 实体留在本库受 git 管，软链接接入 |

第三条是核心。`my-skills/` 是源头，通过软链接接进 `~/.claude/skills/`，所以 Claude Code 直接能调用，而文件实体在这个 git 仓库里 —— 零拷贝，改一次生效一次，历史可回溯。

---

## 面板能做什么

### 我的技能

扫描 `~/.claude/skills` 和库目录，解析每个 `SKILL.md` 的 frontmatter，按功能关键词自动归类。

- 三种状态一眼可辨：**已安装**（软链已建）、**未安装**、**插件提供**（官方插件市场已给，不需要重复软链）
- 一键安装 = 建软链；一键移除 = 断软链，源文件不动
- 卡片描述可展开收起，数据变化才重渲染

### 发现

每天定时抓一次全网新 skill，按「全部 / 🔥 热门 / AI 创业」筛。

| 源 | 方式 | 可靠性 |
| --- | --- | --- |
| GitHub | Search API，按星数与近期热度排 | 稳定，可直接一键安装 |
| YouTube | 无 key 解析搜索页，失败即降级 | 尽力而为 |
| X / 小红书 / 即刻 | 无免费 API，靠 `manual.json` 手动补录 + 深链搜索 | 手动 |

任何单源失败都不会让整体崩溃，各自 try/catch + 超时 + 独立状态。无 token 时 GitHub 请求间隔 6.5 秒避免限速，配了 `GITHUB_TOKEN` 则几乎不限速。

---

## 快速开始

```bash
git clone <this-repo> ~/Documents/claude-skills
cd ~/Documents/claude-skills
node manager/server.js
```

打开 http://localhost:4317 。

路径在运行时按脚本位置推导，**克隆到任何位置都能跑**，不必是 `~/Documents`。

### 装成常驻服务（macOS）

开机自启 + 崩溃自动重拉：

```bash
bash manager/setup-panel.sh            # 安装
bash manager/setup-panel.sh uninstall  # 卸载
```

走 launchd，标签 `com.claude-skills.panel`，日志写在 `manager/panel.log`。

### 菜单栏图标（可选，需 SwiftBar）

在 SwiftBar 设置里，把插件目录指向 `manager/swiftbar/`。脚本要和同目录的 `menu.js` 一起用，所以别只软链单个文件。

菜单栏显示已装 skill 数量，点开可直接跳面板、刷新发现页、重启后端；后端没运行时会给一个「启动后端」的按钮。

### 发现页每日抓取（可选）

每天 09:00 抓一次。macOS 走 launchd，Linux 走 cron。

```bash
bash manager/discover/setup-cron.sh            # 安装
bash manager/discover/setup-cron.sh uninstall  # 卸载
```

---

## 目录结构

```
claude-skills/
├── my-skills/          # 我的 skill，源头，受 git 管理，软链接接入 Claude Code
├── manager/
│   ├── server.js       # 零依赖后端，端口 4317
│   ├── index.html      # 单文件前端
│   ├── setup-panel.sh  # launchd 常驻
│   ├── swiftbar/       # 菜单栏插件
│   └── discover/       # 发现页抓取器 + 每日 cron
└── LICENSE
```

官方 skill（pptx / pdf / docx / xlsx / skill-creator 等）不收录在这里 —— Claude Code 的插件市场已经提供，重复软链会撞名。面板会把它们标成「插件提供」。

---

## 手动加一个 skill

面板装不了的（比如私有仓库），走这三步：

```bash
REPO=~/Documents/claude-skills
mv /path/to/new-skill "$REPO/my-skills/new-skill"
ln -s "$REPO/my-skills/new-skill" ~/.claude/skills/new-skill
cd "$REPO" && git add -A && git commit -m "add new-skill"
```

---

## 注意事项

- **只在 macOS 上完整验证过。** 面板本身是跨平台的 Node 服务，但常驻（launchd）和菜单栏（SwiftBar）是 macOS 特有。
- **面板会写你的 `~/.claude/skills/`。** 只建和删软链，不动源文件，但请知悉它有这个权限。
- **端口固定 4317**，被占用时改环境变量 `PORT`。
- **发现页抓 GitHub 会限速。** 不配 token 时请求间隔 6.5 秒；配了 `GITHUB_TOKEN` 环境变量几乎不限速。

---

## License

MIT，见 [LICENSE](LICENSE)。

