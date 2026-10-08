# claude-mods

ชุด mod ส่วนตัวสำหรับ Claude Code (2.1.293 ขึ้นไป)

## ติดตั้งจากเครื่อง (ระหว่างพัฒนา)

```bash
claude plugin marketplace add ~/Documents/claude-mods
```

```bash
claude plugin install forge@claude-mods
```

แก้โค้ดแล้วพิมพ์ `/reload-plugins` ใน session

## ตั้งค่า repo ครั้งแรก

```bash
git config core.hooksPath .githooks
```

สร้าง `.forbidden-words` (ไม่ commit) ใส่ชื่อบริษัทและ domain ภายในบรรทัดละคำ

## Plugins

| plugin | ทำอะไร | คำสั่ง |
|---|---|---|
| `forge` | ดักคำสั่งก่อนรันตามกฎของ repo (`.claude/guards.json`), กฎส่วนตัว และกฎในตัว · เรียนรู้กฎใหม่เมื่อคุณแก้ Claude | `/guards`, `/guards allow <id>`, `/lessons`, `/lessons import-memory [dir]` |
| `proof` | รันคำสั่งพิสูจน์ (tsc, vitest, หรือที่ตั้งใน `guards.json` → `proof`) เบื้องหลังหลังแก้ไฟล์ และเตือนเมื่อปิดงานทั้งที่ยังแดง | `/proof`, `/proof run`, `/proof on|off`, `/proof continue` |
| `mission` | รวม worktree, PR + CI, session อื่น และ version ของแต่ละ env ไว้จอเดียว (ตั้ง `envs` ในเมนู config) | `/mission`, `/mission refresh` |
| `manager` | ดู plugin ที่ติดตั้ง, กฎของ forge และสถานะ proof | `/mods`, `/mods text` |
| `autopilot` | เดินงานจาก issue ถึง PR ทีละขั้น หยุดรอคุณที่จุดอนุมัติ | `/ship <issue>`, `/ship status`, `/ship approve`, `/ship stop` |

ติดตั้งแต่ละตัว:

```bash
claude plugin install <plugin>@claude-mods --scope user
```

## ตัวอย่าง `.claude/guards.json`

```json
{
	"vars": { "baseBranch": "origin/main" },
	"proof": { "apps/web/**": "npx tsc -p apps/web/tsconfig.json --noEmit" },
	"rules": [
		{
			"id": "prod-ref-main",
			"tool": "Bash",
			"match": "deploy-environment=PROD",
			"unless": "--ref[ =]main\\b",
			"action": "deny",
			"why": "PROD ต้องรันจาก main",
			"examples": { "hit": ["gh workflow run api.yaml --ref develop -f deploy-environment=PROD"], "miss": ["gh workflow run api.yaml --ref main -f deploy-environment=PROD"] }
		}
	]
}
```
