#!/usr/bin/env bash
# validate + test + typecheck ทุก plugin ใน plugins/
set -euo pipefail
cd "$(dirname "$0")/.."
status=0
for dir in plugins/*/; do
	name="$(basename "$dir")"
	echo "== $name"
	claude plugin validate "$dir" || status=1
	claude plugin test "$dir" || status=1
	if [ -f "$dir.claude-plugin/types/tsconfig.json" ]; then
		npx -y -p typescript@5.7.3 tsc -p "$dir" || status=1
	elif [ -n "${CLAUDE_MOD_TYPES:-}" ]; then
		# ยังไม่มี types ที่ engine วางให้: ใช้ไฟล์ type ของ skill plugin-authoring แทน (tsconfig อยู่นอกโฟลเดอร์ mod)
		tmp="$(mktemp -d)"
		abs="$(cd "$dir" && pwd)"
		cat > "$tmp/tsconfig.json" <<JSON
{
	"compilerOptions": {
		"target": "es2023", "lib": ["es2023"], "types": [],
		"module": "esnext", "moduleResolution": "bundler",
		"strict": true, "noUncheckedIndexedAccess": true,
		"noEmit": true, "skipLibCheck": true,
		"jsx": "react", "jsxFactory": "h", "jsxFragmentFactory": "Fragment"
	},
	"include": ["$CLAUDE_MOD_TYPES", "$abs/hooks", "$abs/types", "$abs/tests"]
}
JSON
		npx -y -p typescript@5.7.3 tsc -p "$tmp/tsconfig.json" || status=1
		rm -rf "$tmp"
	else
		echo "ข้าม tsc: ยังไม่มี $dir.claude-plugin/types (โหลด plugin ครั้งหนึ่ง หรือตั้ง CLAUDE_MOD_TYPES=<path ของ claude-code.d.ts>)"
	fi
done
exit $status
