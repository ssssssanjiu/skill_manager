#!/usr/bin/env bash
# 安装/卸载「发现页」每日抓取的系统定时任务（macOS launchd / Linux cron）。
# 用法：
#   bash setup-cron.sh           # 安装（每天 09:00 抓取一次）
#   bash setup-cron.sh uninstall # 卸载
#
# 可移植：所有路径在运行时根据脚本位置推导，换台机器/换用户名也能用。
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$DIR/fetch-skills.js"
LOG="$DIR/cron.log"
NODE="$(command -v node || true)"
LABEL="com.claude-skills.discover"
HOUR=9
MIN=0

if [ -z "$NODE" ]; then echo "未找到 node，请先安装 Node.js"; exit 1; fi

uninstall() {
  case "$(uname)" in
    Darwin)
      local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
      launchctl unload "$plist" 2>/dev/null || true
      rm -f "$plist"
      echo "已卸载 launchd 任务：$LABEL" ;;
    *)
      crontab -l 2>/dev/null | grep -v "$SCRIPT" | crontab - || true
      echo "已从 crontab 移除：$SCRIPT" ;;
  esac
}

install() {
  case "$(uname)" in
    Darwin)
      local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
      cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$SCRIPT</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>$HOUR</integer><key>Minute</key><integer>$MIN</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
      launchctl unload "$plist" 2>/dev/null || true
      launchctl load "$plist"
      echo "已安装 launchd 任务：$LABEL（每天 $(printf '%02d:%02d' $HOUR $MIN) 抓取）"
      echo "日志：$LOG" ;;
    *)
      local line="$MIN $HOUR * * * $NODE $SCRIPT >> $LOG 2>&1"
      ( crontab -l 2>/dev/null | grep -v "$SCRIPT"; echo "$line" ) | crontab -
      echo "已写入 crontab：$line" ;;
  esac
}

case "${1:-install}" in
  uninstall|remove|stop) uninstall ;;
  *) install ;;
esac
