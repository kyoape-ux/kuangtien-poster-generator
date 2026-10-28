#!/bin/bash
# 美編小助手網站部署（Cloudflare Workers 靜態資產，名稱 ktgh-poster）
# 用法：bash deploy-pages.sh        網址：https://ktgh-poster.ktghvideo.workers.dev（前面由 Cloudflare Access 保護）
set -e
cd "$(dirname "$0")"
npx wrangler deploy
echo "完成：https://ktgh-poster.ktghvideo.workers.dev"
