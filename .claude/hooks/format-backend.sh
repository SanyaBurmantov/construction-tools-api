#!/bin/sh
# PostToolUse hook: prettier on the backend .ts file Claude just edited.
# The backend lints prettier rules as errors, so an unformatted edit is a red
# CI run. The frontend is not prettier-formatted — it is left alone.
# Never blocks: any failure here exits 0.
ROOT=${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
FILE=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input.file_path||"")}catch{}})' 2>/dev/null)
case "$FILE" in
  "$ROOT"/backend/src/*.ts|"$ROOT"/backend/test/*.ts) ;;
  *) exit 0 ;;
esac
[ -f "$FILE" ] && [ -x "$ROOT/backend/node_modules/.bin/prettier" ] || exit 0
cd "$ROOT/backend" && ./node_modules/.bin/prettier --log-level silent --write "$FILE" 2>/dev/null
exit 0
