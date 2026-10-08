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
| `devkit` | mod เล็ก 7 ตัว ติดตั้งแล้วใช้ได้เลย (ดูด้านล่าง) | `/cleanup`, `/cleanup confirm` |

ติดตั้งแต่ละตัว:

```bash
claude plugin install <plugin>@claude-mods --scope user
```

### devkit

เปิด/ปิดทีละตัวได้ในเมนู config ของ plugin (ค่าเริ่มต้นเปิดทุกตัว)

| ตัว | ทำอะไร |
|---|---|
| `eolGuard` | ไฟล์ที่เป็น CRLF ล้วน: หลัง Claude Edit แล้วกลายเป็น LF จะแปลงกลับเป็น CRLF ให้ diff ไม่บวมทั้งไฟล์ · ไฟล์ผสม/binary/ไฟล์ใหม่ไม่แตะ · Write ที่ตั้งใจเขียน LF ทั้งไฟล์ไม่แปลงกลับ |
| `branchWatch` | status line บอก branch, ตามหลัง base กี่ commit, ไฟล์ค้างกี่ไฟล์ · เตือนเมื่อ branch เปลี่ยนโดยไม่ใช่คำสั่งของ Claude |
| `priorWork` | prompt ที่มีเลข issue (`ABC-123`, `#45`) จะแนบ PR ที่เปิดอยู่และ commit ที่เกี่ยวข้องให้ Claude เห็นก่อนเริ่ม · รอไม่เกิน ~4 วินาที · ไม่มี `gh` ก็ส่ง prompt ได้ตามปกติ |
| `longRunWatch` | คำสั่งที่รันนานกว่า 2 เท่าของค่าเฉลี่ยตัวเอง (หรือ 5 นาที, คำสั่งที่รู้ว่าช้าอย่าง gradle/dotnet test 10 นาที) ขึ้นแถบเตือน |
| `diskBand` | พื้นที่ดิสก์ต่ำกว่า `diskMinFreeGb` หรือ container ของ testcontainers ค้างเยอะ ขึ้นแถบเตือน · `/cleanup` ดูรายการ, `/cleanup confirm` (คุณพิมพ์เองเท่านั้น) ลบตัวที่หยุดแล้วพร้อม volume |
| `usageMeter` | status line มี `ctx N%` |
| `turnDoneSound` | เทิร์นที่นานกว่า `turnSoundSeconds` เล่นเสียงและ toast ตอนเสร็จ |

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
