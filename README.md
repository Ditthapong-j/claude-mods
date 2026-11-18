# claude-mods

ชุด mod สำหรับ Claude Code (2.1.293 ขึ้นไป) ช่วยกันพลาดซ้ำ เห็นสถานะงานในจอเดียว และเดินงานจาก issue ถึง PR

| mod         | ทำอะไร                                                                                                                      | คำสั่ง                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `forge`     | ดักคำสั่งก่อนรันตามกฎของ repo (`.claude/guards.json`), กฎส่วนตัว และกฎในตัว · ร่างกฎใหม่ให้เมื่อคุณแก้ Claude               | `/guards`, `/lessons` |
| `proof`     | รันคำสั่งพิสูจน์ (tsc, vitest หรือที่ตั้งใน `guards.json` → `proof`) เบื้องหลังหลังแก้ไฟล์ และเตือนเมื่อปิดงานทั้งที่ยังแดง | `/proof`              |
| `mission`   | รวม worktree, PR + CI, session อื่น และ version ของแต่ละ env ไว้จอเดียว                                                     | `/mission`            |
| `manager`   | ดู mod ที่โหลด, กฎของ forge และสถานะ proof                                                                                  | `/mods`               |
| `autopilot` | เดินงานจาก issue ถึง PR ทีละขั้น หยุดรอคุณที่จุดอนุมัติ                                                                     | `/ship`               |
| `devkit`    | mod เล็ก 7 ตัว ติดตั้งแล้วใช้ได้เลย                                                                                         | `/cleanup`            |

## ติดตั้ง

ต้องใช้ Claude Code 2.1.293 ขึ้นไป เช็กด้วย `claude --version`

1. เพิ่ม marketplace (ครั้งเดียว)

```bash
claude plugin marketplace add Ditthapong-j/claude-mods
```

2. ติดตั้ง mod ที่ต้องการ ทีละตัว

```bash
claude plugin install forge@claude-mods --scope user
```

เปลี่ยน `forge` เป็น `proof`, `mission`, `manager`, `autopilot` หรือ `devkit` ได้ · `--scope user` = ใช้ได้ทุก project ในเครื่อง

3. เริ่ม session ใหม่ หรือพิมพ์ `/reload-plugins` ใน session ที่เปิดอยู่

4. ลองพิมพ์ `/mods` (ถ้าติดตั้ง `manager`) หรือ `/guards` (ถ้าติดตั้ง `forge`) เพื่อดูว่าโหลดแล้ว

ถ้าเพิ่งเริ่ม แนะนำ `forge` + `devkit` ก่อน สองตัวนี้ใช้ได้ทันทีโดยไม่ต้องตั้งค่า

### อัปเดต

```bash
claude plugin marketplace update claude-mods
```

```bash
claude plugin update forge@claude-mods --scope user
```

แล้วเริ่ม session ใหม่

### ตั้งค่า

พิมพ์ `/plugin configure <mod>@claude-mods` ใน Claude Code เพื่อตั้งค่า หรือดูว่ามีตัวเลือกอะไรและตั้งไปแล้วหรือยังด้วย

```bash
claude plugin configure mission@claude-mods
```

| mod         | ตัวเลือก                                                                        | ค่าเริ่มต้น           |
| ----------- | ------------------------------------------------------------------------------- | --------------------- |
| `forge`     | `rewriteAsDeny` บล็อกและบอกคำสั่งที่ถูกแทน แทนการแก้คำสั่งให้เอง                | ปิด                   |
| `proof`     | `autoRun` รันคำสั่งพิสูจน์เองหลังแก้ไฟล์ (ปิด = รันเฉพาะ `/proof run`)          | เปิด                  |
| `mission`   | `envs` รายการ env ที่จะถามว่ารัน version อะไร · `refreshSeconds` (อย่างน้อย 30) | `[]` · 120            |
| `autopilot` | `reviewer` ชื่อ subagent ที่ใช้ในขั้น review                                    | `general-purpose`     |
| `devkit`    | เปิด/ปิดทีละตัว · `diskMinFreeGb` · `turnSoundSeconds`                          | เปิดทุกตัว · 15 · 120 |

### ถอนการติดตั้ง

```bash
claude plugin uninstall forge@claude-mods --scope user
```

ปิดชั่วคราวโดยไม่ถอนใช้ `claude plugin disable forge@claude-mods`

## วิธีใช้

### forge

forge ตรวจทุกครั้งก่อน Claude เรียก Bash, Edit หรือ Write แล้วตัดสินตามกฎ 3 แบบ

- **deny** ไม่รัน Claude ได้เหตุผลกลับไปแก้เอง
- **rewrite** แก้คำสั่งให้แล้วรัน พร้อม toast บอกว่าแก้อะไร
- **warn** รันได้ แต่ขึ้น toast และแนบคำเตือนให้ Claude เห็น

กฎมาจาก 3 ที่ ตรวจตามลำดับนี้: `.claude/guards.json` ของ repo (commit ไว้ ทีมได้กฎชุดเดียวกัน), กฎส่วนตัวในเครื่องคุณ และกฎในตัว (เช่น ห้าม `git stash` ที่ไม่ตั้งชื่อ, ห้ามเขียน secret ลงไฟล์, branch ใหม่ต้องแตกจากฐาน)

| คำสั่ง                                        | ทำอะไร                                                                                    |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `/guards`                                     | ดูกฎที่ทำงานอยู่ จำนวนครั้งที่ดัก และปัญหาใน `guards.json`                                |
| `/guards allow <id>`                          | ยกเว้นกฎนั้นครั้งเดียว (ต้องพิมพ์เอง Claude สั่งแทนไม่ได้)                                |
| `/lessons`                                    | เปิดคลังกฎ                                                                                |
| `/lessons accept any-repo` · `repo` · `file`  | รับร่างกฎล่าสุด เป็นกฎส่วนตัวทุก repo · เฉพาะ repo นี้ · เขียนลง `guards.json` ให้ทั้งทีม |
| `/lessons reject`                             | ไม่รับร่างกฎ                                                                              |
| `/lessons enable` · `disable` · `remove <id>` | เปิด/ปิด/ลบกฎส่วนตัว                                                                      |
| `/lessons import-memory [dir]`                | ร่างกฎจากไฟล์ memory `feedback*.md` ที่มีอยู่                                             |

**forge เรียนจากการแก้ของคุณ:** เมื่อคุณพิมพ์แก้ Claude หลังมันเรียกเครื่องมือ (ข้อความยาวพอ) forge จะร่างกฎจากคำสั่งที่พลาดจริง แล้วขึ้นการ์ดเหนือช่องพิมพ์ให้คุณเลือกรับหรือไม่รับ กฎจะทำงานหลังคุณกดรับเท่านั้น Claude เองก็เสนอกฎผ่าน tool `propose_rule` ได้ แต่ต้องรอคุณกดรับเหมือนกัน

ทุกกฎต้องมีตัวอย่าง `hit` (ต้องโดน) และ `miss` (ต้องไม่โดน) forge รันตัวอย่างพวกนี้ตอนโหลด กฎที่ตัวอย่างไม่ผ่านจะถูกตัดทิ้งพร้อม toast เตือน · ดูตัวอย่างไฟล์ที่ [ตัวอย่าง `.claude/guards.json`](#ตัวอย่าง-claudeguardsjson)

### proof

หลัง Claude แก้ไฟล์ proof รันคำสั่งพิสูจน์ที่ตรงกับไฟล์นั้นเบื้องหลัง (เช่น `tsc --noEmit` หรือ vitest) ถ้าปิดงานทั้งที่ยังแดง จะขึ้นแถบเตือนพร้อมผลที่ล้ม

| คำสั่ง              | ทำอะไร                       |
| ------------------- | ---------------------------- |
| `/proof`            | เปิด pane ดูผลล่าสุด         |
| `/proof run`        | รันคำสั่งพิสูจน์ตอนนี้       |
| `/proof on` · `off` | เปิด/ปิดการรันอัตโนมัติ      |
| `/proof continue`   | ส่งผลที่ล้มให้ Claude แก้ต่อ |

กำหนดคำสั่งพิสูจน์ต่อโฟลเดอร์ได้ใน `guards.json` → `proof`

### mission

`/mission` เปิดจอรวม: worktree ทั้งหมด, PR + สถานะ CI, session อื่นที่รันอยู่ และ version ที่แต่ละ env รัน · `/mission refresh` ดึงใหม่ทันที

ตั้ง `envs` เป็น JSON array เพื่อให้ถาม version ของแต่ละ env (URL ต้องเป็น https และตอบ JSON ที่มี `version` / `commit`):

```json
[
	{ "name": "UAT", "service": "api", "url": "https://api-uat.acme.example/api/v1/version" },
	{ "name": "PROD", "service": "api", "url": "https://api.acme.example/api/v1/version" }
]
```

`service` ไม่ใส่ก็ได้ ถ้าใส่ ตารางจะแยกคอลัมน์ตาม service

### manager

`/mods` เปิดจอรวม mod ที่โหลด, กฎของ forge (เปิด/ปิดได้จากจอนี้) และสถานะ proof · `/mods text` ได้เป็นข้อความแทน

### autopilot

`/ship <issue>` เดินงานทีละขั้น และหยุดรอคุณเมื่อต้องตัดสินใจ

1. อ่าน issue และเช็กงานซ้ำ
2. สร้าง worktree จากฐาน
3. เขียนเทสต์ที่ต้องล้มก่อน
4. แก้โค้ด
5. Proof Gate (ใช้ proof)
6. review ด้วย subagent ตาม `reviewer`
7. จุดอนุมัติ: เปิด PR

push, เปิด PR และ merge ถูกบล็อกจนกว่าคุณจะอนุมัติขั้นสุดท้าย · ขั้นไหนติดหลังลองหลายรอบ จะหยุดรอคุณ

| คำสั่ง          | ทำอะไร                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| `/ship <issue>` | เริ่มงาน                                                                   |
| `/ship status`  | ดูขั้นปัจจุบันและ log ล่าสุด                                               |
| `/ship approve` | อนุมัติ (ทำต่อเมื่อเจองานซ้ำ, อนุญาตเปิด PR, หรือให้ลองขั้นที่ติดอีกครั้ง) |
| `/ship stop`    | หยุดงาน                                                                    |

### devkit

ติดตั้งแล้วทำงานเลย เปิด/ปิดทีละตัวได้ในการตั้งค่า (ค่าเริ่มต้นเปิดทุกตัว)

| ตัว             | ทำอะไร                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eolGuard`      | ไฟล์ที่เป็น CRLF ล้วน: หลัง Claude Edit แล้วกลายเป็น LF จะแปลงกลับเป็น CRLF ให้ diff ไม่บวมทั้งไฟล์ · ไฟล์ผสม/binary/ไฟล์ใหม่ไม่แตะ · Write ที่ตั้งใจเขียน LF ทั้งไฟล์ไม่แปลงกลับ        |
| `branchWatch`   | status line บอก branch, ตามหลัง base กี่ commit, ไฟล์ค้างกี่ไฟล์ · เตือนเมื่อ branch เปลี่ยนโดยไม่ใช่คำสั่งของ Claude                                                                    |
| `priorWork`     | prompt ที่มีเลข issue (`ABC-123`, `#45`) จะแนบ PR ที่เปิดอยู่และ commit ที่เกี่ยวข้องให้ Claude เห็นก่อนเริ่ม · รอไม่เกิน ~4 วินาที · ไม่มี `gh` ก็ส่ง prompt ได้ตามปกติ                 |
| `longRunWatch`  | คำสั่งที่รันนานกว่า 2 เท่าของค่าเฉลี่ยตัวเอง (หรือ 5 นาที, คำสั่งที่รู้ว่าช้าอย่าง gradle/dotnet test 10 นาที) ขึ้นแถบเตือน                                                              |
| `diskBand`      | พื้นที่ดิสก์ต่ำกว่า `diskMinFreeGb` หรือ container ของ testcontainers ค้างเยอะ ขึ้นแถบเตือน · `/cleanup` ดูรายการ, `/cleanup confirm` (คุณพิมพ์เองเท่านั้น) ลบตัวที่หยุดแล้วพร้อม volume |
| `usageMeter`    | status line มี `ctx N%`                                                                                                                                                                  |
| `turnDoneSound` | เทิร์นที่นานกว่า `turnSoundSeconds` เล่นเสียงและ toast ตอนเสร็จ                                                                                                                          |

## ตัวอย่าง `.claude/guards.json`

วางไว้ที่ราก repo แล้ว commit ทุกคนในทีมที่ติดตั้ง forge จะได้กฎชุดนี้

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
			"examples": {
				"hit": ["gh workflow run api.yaml --ref develop -f deploy-environment=PROD"],
				"miss": ["gh workflow run api.yaml --ref main -f deploy-environment=PROD"]
			}
		}
	]
}
```

| field                   | ความหมาย                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `tool` / `tools`        | เครื่องมือที่กฎใช้ เช่น `Bash`, `Edit`, `Write`                                                   |
| `field`                 | ส่วนของ input ที่ตรวจ (ค่าเริ่มต้น `command`; Edit ใช้ `new_string`, Write ใช้ `content`)         |
| `match` / `unless`      | regex ที่ต้องโดน / ข้อยกเว้น                                                                      |
| `segments`              | `true` = ตรวจทีละท่อนของคำสั่งที่ต่อด้วย `&&` `;` `                                               | `   |
| `paths` / `exceptPaths` | glob ของไฟล์ที่กฎใช้ / ไม่ใช้                                                                     |
| `action`                | `deny`, `rewrite` หรือ `warn`                                                                     |
| `rewrite`               | คำสั่งใหม่ (ใช้ `$1`, `{baseBranch}` ได้) · แก้ได้เฉพาะ `command` และห้ามเพิ่ม operator ของ shell |
| `why` / `hint`          | เหตุผล / วิธีที่ถูก (Claude เห็นทั้งสองอย่าง)                                                     |
| `examples`              | `hit` ที่ต้องโดน และ `miss` ที่ต้องไม่โดน                                                         |

## พัฒนา mod

```bash
git clone https://github.com/Ditthapong-j/claude-mods.git ~/Documents/claude-mods
```

```bash
claude plugin marketplace add ~/Documents/claude-mods
```

marketplace แบบโฟลเดอร์ Claude Code อ่าน mod จากโฟลเดอร์โดยตรง แก้โค้ดแล้วพิมพ์ `/reload-plugins` ใน session ได้เลย ไม่ต้อง update

ตั้งค่า repo ครั้งแรก:

```bash
git config core.hooksPath .githooks
```

สร้าง `.forbidden-words` (ไม่ commit) ใส่ชื่อบริษัทและ domain ภายในบรรทัดละคำ hook จะไม่ให้คำเหล่านี้หลุดเข้า repo

ก่อนปล่อยเวอร์ชันใหม่ให้คนอื่น bump `version` ใน `plugins/<mod>/.claude-plugin/plugin.json`

## License

[MIT](LICENSE)
