#!/bin/bash
# 一次性：產生共用範本的管理員金鑰，存成本機檔案（不進 git），並設為 Worker 秘密 ADMIN_TOKEN
set -e
cd "$(dirname "$0")"
TOK=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)
printf '%s\n' "$TOK" > .admin-token.txt && chmod 600 .admin-token.txt
printf '%s' "$TOK" | npx wrangler secret put ADMIN_TOKEN --config "$PWD/worker-gen/wrangler.toml"
grep -q "^.admin-token.txt" .gitignore || printf '\n.admin-token.txt\n' >> .gitignore
echo ""
echo "完成。管理員金鑰存在：$PWD/.admin-token.txt（在美編小助手左側「管理員模式」輸入）"
open -R .admin-token.txt 2>/dev/null || true
