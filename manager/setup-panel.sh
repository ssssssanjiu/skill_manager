#!/usr/bin/env bash
# 把 Skill 面板后端装成常驻服务（macOS launchd）：开机自启 + 崩溃自动重拉。
# 用法：
#   bash setup-panel.sh            # 安装并启动（端口 4317）
#   bash setup-panel.sh uninstall  # 卸载
#
# 可移植：路径在运行时按脚本位置推导，换机器/用户名也能用。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="$DIR/server.js"
LOG="$DIR/panel.log"
NODE="$(command -v node || true)"
LABEL="com.claude-skills.panel"
PORT=4317

if [ -z "$NODE" ]; then echo "未找到 node，请先安装 Node.js"; exit 1; fi

plist_path() { echo "$HOME/Library/LaunchAgents/$LABEL.plist"; }

uninstall() {
  local plist; plist="$(plist_path)"
  launchctl unload "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "已卸载常驻面板：$LABEL"
}

install() {
  local plist; plist="$(plist_path)"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SERVER</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PORT</key><string>$PORT</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
  launchctl unload "$plist" 2>/dev/null || true
  launchctl load "$plist"
  echo "已安装常驻面板：$LABEL"
  echo "  地址：http://localhost:$PORT"
  echo "  日志：$LOG"
}

case "${1:-install}" in
  uninstall|remove|stop) uninstall ;;
  *) install ;;
esac
