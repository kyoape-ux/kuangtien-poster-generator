#!/bin/bash
# 美編小助手 → Cloudflare Pages（搭配 Cloudflare Access 做存取控管）
# 第一次：npx wrangler pages project create ktgh-poster --production-branch main
# 之後每次部署：bash deploy-pages.sh
set -e
cd "$(dirname "$0")"
npx wrangler pages deploy docs --project-name ktgh-poster --branch main --commit-dirty=true
echo "完成：https://ktgh-poster.pages.dev"
