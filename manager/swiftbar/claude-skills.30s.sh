#!/usr/bin/env bash
# <xbar.title>Claude Skills 工作台</xbar.title>
# <xbar.version>v1.0</xbar.version>
# <xbar.author>you</xbar.author>
# <xbar.desc>菜单栏常驻：查看/打开 Skill 面板、刷新发现页、重启后端。</xbar.desc>
# <xbar.dependencies>node</xbar.dependencies>
#
# SwiftBar 插件：每 30 秒刷新。把本文件所在文件夹设为 SwiftBar 的插件目录即可。
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 定位 node（SwiftBar 的 PATH 很精简，逐个兜底）
NODE=""
for c in /opt/homebrew/bin/node /usr/local/bin/node "$(command -v node 2>/dev/null)"; do
  [ -x "$c" ] && { NODE="$c"; break; }
done

if [ -z "$NODE" ]; then
  echo "Skills ⚠︎"
  echo "---"
  echo "未找到 node | color=#c0392b"
  exit 0
fi

exec "$NODE" "$DIR/menu.js"
