<h1 align="center">Skill Manager</h1>

<p align="center">
  A local web panel that keeps every Claude Code skill in one place —<br>
  paste a GitHub URL to install, symlink-hosted so edits go live instantly.
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License">
  <img src="https://img.shields.io/badge/node-%E2%89%A518-brightgreen" alt="Node 18+">
  <img src="https://img.shields.io/badge/dependencies-0-success" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey" alt="Platform">
</p>

Claude Code loads skills from `~/.claude/skills`. That works fine for three of them. Past a dozen, you stop knowing what is installed, where it came from, or which copy is the real one. Installing a new skill means cloning a repo, digging for the `SKILL.md`, and moving a directory to exactly the right path.

Skill Manager puts all of it on one page. Every skill it can see, grouped by what it does, with its state on the card. Installing is a paste and a click. Nothing is copied anywhere: your skills stay in a git repository you control, and `~/.claude/skills` holds only symlinks pointing at it.

> **Requires Node 18 or newer** and `git` on your `PATH`. The panel itself runs anywhere Node runs. The always-on service uses launchd and the menu bar uses SwiftBar, both **macOS only**. The daily discover job supports macOS and Linux.

---

## Why

| The problem | What the panel does |
| --- | --- |
| You have no idea what is installed without running `ls` | One page, everything listed, grouped by function |
| Installing a skill means clone, hunt, move, hope | Paste a GitHub URL, click install |
| Skills live loose in `~/.claude/skills`, outside version control | Real files stay in a git repo, only symlinks go into Claude's directory |

The third row is the one that matters. `my-skills/` is the source of truth and it is tracked by git. Claude Code reads through symlinks and never knows the difference. Edit a skill once and it is live immediately, with full history behind it.

---

## Features

### Every skill on one page

The panel scans `~/.claude/skills` and the library directories, reads each `SKILL.md` frontmatter for its name and description, and infers a category from keywords. Skills that live only in `~/.claude/skills`, dropped there by hand, show up too.

Each card carries one of three states:

| State | Meaning |
| --- | --- |
| **Installed** | A symlink exists and Claude Code can load it |
| **Not installed** | Present in the library, no symlink yet |
| **Provided by plugin** | Already supplied by the official plugin marketplace, so linking it would collide |

Long descriptions collapse behind a toggle. The list re-renders only when the underlying data actually changes, not on every poll.

### Install from GitHub in one paste

Paste a repository URL, click install. The panel clones it into `my-skills/`, finds the `SKILL.md` whether it sits at the repo root or one level down, and symlinks the right directory into `~/.claude/skills/`.

Removing a skill unlinks it. The source directory is left alone.

### Zero-copy symlink hosting

```
~/.claude/skills/design-style-parser ──symlink──► <repo>/my-skills/design-style-parser
                                                    └── tracked by git
```

No copies to keep in sync, no "which version is the real one". Claude Code follows the link, git watches the file.

### Discover feed

A second tab aggregates newly published skills once a day, filterable by **All**, **Trending**, and **AI startup**.

| Source | How | Reliability |
| --- | --- | --- |
| GitHub | Real Search API, ranked by stars and recent activity | Solid, and installable in one click |
| YouTube | Parses the search page without an API key, degrades on failure | Best effort |
| X / Xiaohongshu / Jike | No free API, curated by hand in `manual.json` plus deep links | Manual |

Every source is wrapped in its own timeout and error handler, so one failing source never takes the page down. Without a token, GitHub requests are spaced 6.5 seconds apart to stay under the rate limit. Set `GITHUB_TOKEN` and that restriction essentially disappears.

### Always-on, and in the menu bar

A launchd agent keeps the backend alive, restarts it if it crashes, and starts it at login. A SwiftBar plugin puts the installed count in your menu bar, with shortcuts to open the panel, refresh the discover feed, and restart the backend. If the backend is down, the menu offers to start it.

### Zero dependencies

No `npm install`, no lockfile, no supply chain to audit. Node's standard library only, roughly 42 KB of source across the backend, the frontend, and the fetcher. Paths are derived at runtime from the script's own location, so cloning it anywhere works.

---

## Quick start

```bash
git clone https://github.com/ssssssanjiu/skill_manager.git
cd skill_manager
node manager/server.js
```

Open http://localhost:4317 .

### Run it as a background service (macOS)

Starts at login, restarts on crash:

```bash
bash manager/setup-panel.sh
```

Uninstall with `bash manager/setup-panel.sh uninstall`. The agent is labelled `com.claude-skills.panel` and logs to `manager/panel.log`.

### Menu bar (optional, needs SwiftBar)

Point SwiftBar's plugin directory at `manager/swiftbar/`. The script needs `menu.js` beside it, so do not symlink the shell script on its own.

### Daily discover job (optional)

Runs once a day at 09:00, launchd on macOS and cron on Linux:

```bash
bash manager/discover/setup-cron.sh
```

---

## HTTP API

The backend is a plain JSON API on port 4317. Useful if you want to script it.

| Method | Path | Body | Does |
| --- | --- | --- | --- |
| `GET` | `/api/skills` | — | Every skill, its state, category and source |
| `POST` | `/api/install` | `{ "url": "..." }` | Clone a repo into the library and link it |
| `POST` | `/api/link` | `{ "name": "..." }` | Symlink a skill already in the library |
| `POST` | `/api/unlink` | `{ "name": "..." }` | Remove the symlink, keep the source |
| `GET` | `/api/discover` | — | Read the cached discover feed |
| `POST` | `/api/discover/refresh` | — | Re-run the fetcher, 90s timeout |

---

## Configuration

| Variable | Default | Effect |
| --- | --- | --- |
| `PORT` | `4317` | Port the panel listens on |
| `GITHUB_TOKEN` | unset | Lifts the GitHub rate limit for the discover feed |

---

## Project layout

```
skill_manager/
├── my-skills/               # Your skills. Source of truth, git-tracked, symlinked into Claude Code
└── manager/
    ├── server.js            # Zero-dependency backend
    ├── index.html           # Single-file frontend
    ├── setup-panel.sh       # launchd always-on service
    ├── swiftbar/            # Menu bar plugin
    └── discover/            # Discover feed fetcher and daily job
```

---

## Known limitations

- **The always-on service and menu bar are macOS only.** The panel is a portable Node server, but launchd and SwiftBar are not. The discover job does handle Linux cron.
- **No authentication.** It binds a local port and writes to `~/.claude/skills`. Keep it on localhost; do not expose it to a network.
- **Only GitHub is a real API in the discover feed.** YouTube is best-effort scraping and will break when the page changes. The other platforms are hand-curated.
- **Categories are inferred from keywords**, not curated. Expect the occasional skill in the wrong bucket.
- **Install expects `SKILL.md` at the repo root or one level down.** Deeper nesting is not detected.
- **The UI is currently Chinese only.**

---

## Roadmap

- English UI
- Windows support for the always-on service
- Search and filter on the installed list
- Update a skill in place, not just install and remove

---

## License

MIT, see [LICENSE](LICENSE).
