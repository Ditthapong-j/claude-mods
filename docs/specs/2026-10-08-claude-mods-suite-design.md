# Claude Mods Suite: design

- วันที่: 2026-10-08
- เจ้าของ: Ditthapong-j
- สถานะ: อนุมัติแล้ว 2026-10-08
- ภาพจำลอง: https://claude.ai/artifact/JzQtgy3kM6RdMuJvuQK9jj
- API อ้างอิง: Claude Code 2.1.293 (mod / function hooks เป็น early access และเปลี่ยนได้ระหว่างเวอร์ชัน)

## 1. เป้าหมาย

ชุด mod ของ Claude Code ที่ทำให้ dev ง่ายขึ้นแบบก้าวกระโดด และใช้ได้กับทุก project

### สิ่งที่ผู้ใช้บอก

- อยากให้เปลี่ยนวิธีทำงาน ไม่ใช่แค่กันพลาดทีละเรื่อง
- ต้องใช้กับ project อื่นได้ (repo งานหลัก, repo งานอื่น และ repo ส่วนตัว)
- อยากได้ทั้ง 4 ระบบ (A–D) mod เล็กทั้งหมด และวิธีจัดการ mod
- โค้ดอยู่ใน repo ใหม่แยกต่างหาก

### สิ่งที่สมมติ (ยืนยันตอนรีวิว)

- คนใช้คนแรกคือเจ้าของ แล้วค่อยแชร์ให้คนอื่น (รวมทีมที่ทำงาน) ผ่าน marketplace
- ใช้ทั้ง Claude Code Desktop (แท็บ Code) และ CLI
- repo เป็นของเจ้าของเอง (`Ditthapong-j/claude-mods`) ไม่ใช่ของ org ที่ทำงาน

### วัดความสำเร็จยังไง

1. บทเรียนทุกข้อใน memory ที่เป็นกฎเครื่องจักรได้ (ดู §4.6) ถูกบังคับด้วย mod และมีเทสต์ครบ
2. กฎใหม่สร้างได้จากการแก้ Claude หนึ่งครั้ง ไม่ต้องเขียนโค้ด และใช้เวลาไม่ถึง 1 นาทีจนกฎทำงาน
3. Claude ปิดงานทั้งที่ยังแดงโดยไม่มีคนเห็นไม่ได้
4. งานแก้บั๊กปกติหนึ่งงานเดินด้วย `/ship` ได้ โดยผู้ใช้ต้องตอบแค่ที่จุดอนุมัติ
5. ติดตั้งใน repo ใหม่ได้ด้วยคำสั่งเดียว และไม่มีกฎของ work-app รั่วไปที่ repo อื่น

### นอกขอบเขต

- ไม่แก้ตัว Claude Code และไม่ใช้ API ภายในที่ไม่ได้อยู่ใน type ที่ประกาศไว้
- ไม่สร้างโค้ดที่โมเดลเขียนแล้วรันทันที (ดู §4.2)
- ไม่ deploy หรือ push อะไรเองโดยไม่มีจุดอนุมัติ

## 2. โครงสร้าง repo และการแบ่ง plugin

repo เดียวทำหน้าที่เป็น marketplace และมีหลาย plugin ผู้ใช้เลือกติดตั้งทีละตัวได้

```
claude-mods/
  .claude-plugin/marketplace.json     # รายชื่อ plugin ทั้งหมด
  plugins/
    forge/        # A · Lesson Forge + engine กฎ + กฎกลาง + check กลาง
    proof/        # B · Proof Gate
    mission/      # C · Mission Control
    manager/      # E · Mod Manager (/mods)
    autopilot/    # D · Autopilot (/ship) — depends: forge, proof
    devkit/       # mod เล็ก 9 ตัว แต่ละตัวเปิด/ปิดด้วย userConfig
  docs/specs/  docs/plans/
  README.md                            # วิธีติดตั้ง + /plugin install
```

แต่ละ plugin มี `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts(x)`, `types/index.d.ts` (ถ้ามี state หรือเพิ่ม noun ให้ `$`) และ `tests/*.test.ts`

**การแชร์ระหว่าง plugin:** plugin import ไฟล์ข้าม plugin ไม่ได้ จึงแชร์ผ่านช่องทางของ engine

- `forge` เพิ่ม noun `$.forge` (ประกาศ contract ใน `types/index.d.ts`) ให้ plugin อื่นใช้: `check(cmd)`, `rules()`, `hits()`
- `autopilot` และ `mission` ระบุ `forge`, `proof` ใน `dependencies` เพื่อให้ได้ type และรับประกันว่าโหลดก่อน
- ข้อมูลที่หลาย plugin ต้องเห็นร่วมกัน (ผลหลักฐานของ proof, จำนวนครั้งที่ดัก) อยู่ใน `$.state` ภายใต้ชื่อของ plugin เจ้าของ

### 2.1 แยกของที่ทำงานออกจาก repo นี้

repo นี้เป็น repo ส่วนตัว จึงมีแต่โค้ดกลางที่ไม่ผูกกับบริษัทหรือ project ใด

- กฎทุกข้อที่เฉพาะของ repo งาน อยู่ใน `.claude/guards.json` ของ repo นั้นๆ (commit ใน repo ของงาน) ไม่อยู่ใน repo นี้
- check ในตัวเขียนแบบกลางและรับค่าจาก guards.json: `version-bumped` (ไฟล์ version, URL ที่ถาม version ของแต่ละ env) และ `cost-estimate` (รูปแบบคำสั่ง, ค่าต่อหน่วย, เพดานที่ต้องยืนยัน) ไม่มี host, ชื่อ workflow หรือเลข PR ของงานอยู่ในโค้ด
- ตัวอย่างใน README, เทสต์ และ fixture ใช้ชื่อสมมติ (`acme-app`, `acme.example`) ไม่ใช้ข้อมูลจริงจากงาน
- ก่อน push ขึ้น GitHub ทุกครั้ง มีสคริปต์ตรวจคำต้องห้าม (ชื่อบริษัท, domain ภายใน) ที่ตั้งเองได้ในไฟล์ที่ไม่ commit
- ตัวอย่าง guards.json ของ repo งานเก็บไว้ใน repo งานนั้น (`.claude/guards.json`) เป็นงานแยกที่เปิด PR ตามขั้นตอนของทีม

## 3. Config: สามชั้น

| ชั้น         | อยู่ที่ไหน                                             | ใครเขียน                           | ใช้ทำอะไร                                                                 |
| ------------ | ------------------------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| ค่าของผู้ใช้ | `userConfig` ใน plugin.json → settings `pluginConfigs` | ผู้ใช้ผ่านเมนู config              | เปิด/ปิดฟีเจอร์, host ของ env, เวลาที่ถือว่าค้าง                          |
| กฎของ repo   | `.claude/guards.json` ใน repo                          | ทีมของ repo นั้น (commit เข้า git) | baseBranch, deploy, brand, proof commands, longBranch                     |
| กฎส่วนตัว    | `$.store` ของ forge (ข้าม session)                     | Lesson Forge                       | กฎที่ผู้ใช้สร้างแล้วเลือกขอบเขต "ทุก repo" หรือ "repo นี้เฉพาะเครื่องฉัน" |

ลำดับความสำคัญเมื่อชนกัน: กฎของ repo > กฎส่วนตัวที่ผูกกับ repo > กฎส่วนตัวทุก repo > กฎในตัว
repo ที่ไม่มี `guards.json` ได้กฎในตัวที่ไม่ต้องตั้งค่า (secret, stash, vitest ซ้อน), กฎส่วนตัวที่ขอบเขต "ทุก repo" และ devkit

`guards.json` ตรวจ schema ตอนโหลด ถ้าผิด จะขึ้น toast บอกบรรทัดที่ผิด และใช้เฉพาะกฎในตัว ไม่ล้มทั้ง plugin

## 4. A · Lesson Forge (`forge`)

### 4.1 Engine กฎ

hook เดียวที่ `tool.call` (ทุก tool) เรียกกฎที่ตรงกับ tool นั้นตามลำดับ ผลมี 4 แบบ:

- `allow`: ส่งต่อด้วย `next(e)`
- `rewrite`: `next({ ...e, input: ใหม่ })` และต่อท้ายผลด้วยบรรทัด "แก้คำสั่งเป็น …"
- `deny`: คืน `{ deny: เหตุผล + วิธีที่ถูก }` โดยไม่เรียก `next`
- `warn`: เรียก `next(e)` แล้วแนบข้อความเตือนในผลให้โมเดลเห็น + `ui.toast`

กฎที่เป็น guard ลงทะเบียนพร้อม `.catch(($, e, next) => next.called ? next(e) : { deny })` ตามที่ reference กำหนด เพื่อให้ hook ที่ throw หรือหมดเวลาไม่ปล่อยคำสั่งผ่านไปเฉยๆ

### 4.2 รูปแบบกฎ: ข้อมูล ไม่ใช่โค้ด

กฎที่ Lesson Forge สร้างเป็น JSON ล้วน ไม่มีโค้ดที่โมเดลเขียนให้รัน

```json
{
	"id": "branch-base",
	"tool": "Bash",
	"field": "command",
	"match": "^git (checkout -b|switch -c) \\S+$",
	"action": "rewrite",
	"rewrite": "$0 {baseBranch}",
	"why": "แตกจาก PR ที่รอ squash ทำให้ CHANGELOG ชน",
	"scope": { "kind": "any-repo" },
	"examples": {
		"hit": ["git checkout -b fix/OB-1"],
		"miss": ["git checkout -b fix/OB-1 origin/develop", "git checkout main"]
	},
	"source": { "date": "2026-10-08", "session": "…" },
	"enabled": true
}
```

กฎที่ต้องใช้ข้อมูลจากนอกคำสั่ง (เทียบ version กับ PROD, เช็ก PR ของ branch, ประมาณค่า eval) เขียนเป็น **check ในตัว** ที่เป็นโค้ดของ plugin ซึ่งผ่านรีวิวแล้ว กฎ JSON อ้างถึงได้ด้วย `"check": "version-bumped"` เท่านั้น

### 4.3 การสร้างกฎจากบทเรียน

1. `prompt.submit`: ส่งข้อความของผู้ใช้ + การเรียก tool ล่าสุด 3 ครั้งให้ `model.classify` ตอบว่า "เป็นการแก้พฤติกรรมที่เครื่องบังคับได้" หรือไม่ ใช้โมเดลเล็กที่สุด และข้ามถ้าข้อความสั้นกว่า 8 คำหรือไม่มีการเรียก tool ก่อนหน้า
2. ถ้าใช่ `model.complete` ร่างกฎตามรูปแบบ §4.2 พร้อม `examples` โดยใช้คำสั่งที่พลาดจริงเป็นเคส hit
3. ตรวจกฎทันที: regex compile ได้, hit ทุกเคสตรง, miss ทุกเคสไม่ตรง, และต้องไม่ตรงกับคำสั่ง 200 ครั้งล่าสุดที่ผ่านไปโดยไม่มีปัญหา (กันกฎกว้างเกิน) ถ้าไม่ผ่าน ให้ร่างใหม่ได้อีก 1 รอบ แล้วเลิก
4. แสดงการ์ดกฎในแถบเหนือช่องพิมพ์ ปุ่ม: เปิดใช้ / แก้ก่อน / ไม่ต้อง
5. กดเปิดใช้: เลือกขอบเขต (ทุก repo / repo นี้ในเครื่องฉัน / เขียนลง `guards.json` ของ repo) แล้วบันทึก กฎมีผลตั้งแต่การเรียก tool ครั้งถัดไป ไม่ต้อง reload

กฎไม่มีทางเปิดใช้เองโดยที่ผู้ใช้ไม่ได้กด

### 4.4 คำสั่ง

- `/lessons`: เปิดคลังกฎ (pane) แสดงกฎ, ขอบเขต, จำนวนครั้งที่ดักใน 30 วัน, ที่มา
- `/guards`: สรุปสิ่งที่ถูกดักใน session นี้
- `/guards allow <id>`: ยกเว้นกฎนั้นครั้งเดียว (ครั้งถัดไปที่ตรง)
- `/lessons import-memory`: อ่าน memory feedback ของ project แล้วเสนอกฎทีละข้อแบบเดียวกับ §4.3

### 4.5 ความปลอดภัยของ forge

- ไม่มี action ใดใน engine ที่รันคำสั่งเพิ่มเอง rewrite เปลี่ยนได้แค่ input ของคำสั่งที่โมเดลเรียกอยู่แล้ว
- rewrite ต้องเป็นการเติมหรือแทนที่ภายในคำสั่งเดิม ห้ามเพิ่ม `;`, `&&`, `|` หรือ `$(` ใหม่ (ตรวจตอนสร้างกฎ)
- กฎที่ไม่ได้ใช้ 90 วันจะถูกถามใน `/lessons` ว่าเก็บไว้ไหม ไม่ลบเอง

### 4.6 กฎชุดแรก

กฎที่ขอบเขตเป็น "ทุก repo" มาพร้อม forge ส่วนกฎที่ขอบเขตเป็น repo ใด repo หนึ่ง เขียนลง `.claude/guards.json` ของ repo นั้น (ดู §2.1)

| id                  | ชนิด                   | ขอบเขต                    | มาจาก                                                             |
| ------------------- | ---------------------- | ------------------------- | ----------------------------------------------------------------- |
| prod-ref-main       | JSON deny              | repo (work-app)            | deploy PROD ต้อง --ref main                                       |
| version-bumped      | check (กลาง)           | repo (work-app)            | bump /VERSION ก่อน PROD (work-app ตั้งให้เทียบ `/api/v1/version`)  |
| nonprod-ref-develop | JSON deny              | repo (work-app)            | DEV/UAT ต้องจาก develop                                           |
| named-stash         | JSON deny              | ทุก repo                  | stash stack ใช้ร่วมทุก worktree                                   |
| branch-base         | JSON rewrite           | ทุก repo ที่มี baseBranch | แตก branch จาก PR ที่รอ squash                                    |
| pr-head-rename      | check                  | ทุก repo                  | rename branch ที่เป็น head ของ PR แล้ว PR ปิด                     |
| one-branch          | JSON deny              | repo (work-other)           | ฟีเจอร์ยาวอยู่ branch เดียว                                      |
| cost-estimate       | check (กลาง)           | repo (work-app)            | ประมาณค่าใช้จ่าย eval เป็นบาท, ยืนยันถ้า > 100 บาทหรือ paid judge |
| brand-name          | JSON warn (Edit/Write) | repo (work-app)            | ชื่อแบรนด์ "Acme"                                              |
| no-emoji-ui         | JSON warn (Edit/Write) | repo (work-app)            | ห้าม emoji ใน UI เว็บ                                             |
| vitest-cwd          | JSON rewrite           | repo (work-app)            | vitest ต้องรันใน apps/web                                         |
| vitest-concurrent   | check                  | ทุก repo                  | ห้ามรัน vitest ซ้อน                                               |
| skip-testcontainers | JSON rewrite           | repo (work-app)            | `dotnet test` เติม filter ข้าม integration                        |
| secret-write        | check (Edit/Write)     | ทุก repo                  | ห้ามเขียน secret ลงไฟล์                                           |

## 5. B · Proof Gate (`proof`)

- `tool.call` ของ Edit/Write/NotebookEdit: บันทึก path ที่ถูกแก้ใน `$.state.proof.touched`
- จับคู่ path กับคำสั่งพิสูจน์จาก `guards.json` → `proof` (glob → command) ถ้า repo ไม่มี ใช้ค่าเริ่มต้นที่เดาจากไฟล์ใน repo: `tsconfig.json` → `tsc --noEmit`, `vitest.config.*` → `vitest related`, `*.csproj` → `dotnet build`
- รันด้วย `process.spawn` ทีละคำสั่ง (คิวเดียวต่อ repo ไม่รันซ้อน) หลังไม่มีการแก้ไฟล์ 5 วินาที รันใหม่เฉพาะคำสั่งที่ไฟล์ของมันเปลี่ยน
- เทสต์ที่ล้ม: รันเดี่ยวซ้ำ 3 ครั้งก่อนสรุปว่าล้มจริง ถ้าผ่านบางรอบ ติดป้าย "flaky" (มาจาก memory เรื่องวัด A/B)
- ผลอยู่ใน `$.state.proof.results` แสดงใน `ui.status` ("proof: 2 ✓ · 1 ✗")
- `turn.complete`: ถ้ามีผลแดงหรือยังรันไม่เสร็จ แสดงแถบ "Claude บอกว่าเสร็จ แต่ยังมีเทสต์ล้ม N เคส" + ปุ่ม "ให้ Claude แก้ต่อ" และ "ดู log"
- ปุ่ม "ให้ Claude แก้ต่อ": ตาม spike S1 (§10)
- `/proof`: ดูรายละเอียดและ log ของแต่ละคำสั่ง, `/proof off` ปิดใน session นี้

## 6. C · Mission Control (`mission`)

pane `/mission` มี 4 กล่อง อัปเดตด้วย `clock.every` (ค่าเริ่มต้น 2 นาที)

- **รอคุณ:** session หรือ subagent ที่รอคำตอบ (spike S2), PR ที่ CI แดงหรือมี review ใหม่, คำสั่งที่ forge หยุดรอยืนยัน
- **กำลังทำ:** `git worktree list` ของ repo ปัจจุบัน + branch + ไฟล์ค้าง + commit ล่าสุด
- **PR + CI:** `gh pr list --author @me --json …` และ `gh pr checks`
- **Environments:** `http.fetch` ไปที่ `/api/v1/version` ตาม host ใน userConfig, ติดป้ายแดงเมื่อ `0.0.0-dev` หรือ `commit: unknown`

ทุกกล่องที่ดึงข้อมูลไม่ได้ ให้แสดงเหตุผลในกล่องนั้น ไม่ซ่อนกล่อง
pane เปิดเองไม่ได้ถ้า terminal แคบกว่า 144 คอลัมน์ (ข้อจำกัดของ engine) แต่ `/mission` เปิดได้ทุกความกว้าง

## 7. D · Autopilot (`autopilot`)

`/ship <issue>` เดินขั้นตอนตามลำดับ แต่ละขั้นมีเงื่อนไขผ่านที่ตรวจได้

| ขั้น | ทำอะไร                                                                              | ผ่านเมื่อ                            |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------ |
| 1    | อ่าน issue (`gh issue view`) และเช็กงานซ้ำ (PR เปิด, commit ใน base)                | ไม่มีงานซ้ำ หรือผู้ใช้ยืนยันว่าทำต่อ |
| 2    | สร้าง worktree จาก baseBranch                                                       | worktree มีอยู่และอยู่บน branch ใหม่ |
| 3    | เขียนเทสต์ที่ต้องล้มก่อน                                                            | proof รายงานว่าเทสต์ใหม่ล้ม          |
| 4    | แก้โค้ด                                                                             | —                                    |
| 5    | Proof Gate                                                                          | proof เขียวทั้งหมด                   |
| 6    | review ด้วย subagent (`agent.spawn`, เลือกตาม guards.json เช่น clean-arch-reviewer) | ไม่มี finding ระดับ P0/P1 ค้าง       |
| 7    | **จุดอนุมัติ:** เปิด PR                                                             | ผู้ใช้กดอนุมัติ                      |

- ขั้นตอนเป็น prompt ที่ส่งให้ Claude ทำในเทิร์นของ session ปัจจุบัน autopilot ไม่ได้รันโมเดลแยกเอง (ยกเว้น reviewer ในขั้น 6)
- สถานะเก็บใน `$.state.autopilot` เพื่อให้ reload หรือ restart แล้วทำต่อได้
- จุดอนุมัติกำหนดใน guards.json ได้ ค่าเริ่มต้น: เปิด PR, push, deploy ทุกจุดอนุมัติข้ามไม่ได้ด้วยการตั้งค่า
- `/ship status`, `/ship stop`

## 8. E · Mod Manager (`manager`)

pane `/mods`

- plugin ที่โหลดอยู่: hook `plugin.register` บันทึกชื่อ, เวอร์ชัน, ที่มา (`<name>@<marketplace>` / `@inline`), โฟลเดอร์
- กฎของ forge: เปิด/ปิดทีละข้อ (เรียก `$.forge`)
- hook ที่ล้มล่าสุด: จาก `ui.log` / `ui.fault` ถ้าอ่านได้ (spike S3) ถ้าอ่านไม่ได้ บอกให้รัน `claude --debug`
- ปุ่มลัด: เปิดเมนู config ของ plugin, คัดลอกคำสั่ง `claude plugin disable <name>` (การเปิด/ปิด plugin ทั้งตัวทำผ่าน `/plugin` ของ Claude Code เอง manager ไม่ทำแทน)

## 9. devkit: mod เล็ก

plugin เดียว เปิด/ปิดแต่ละตัวด้วย userConfig (ค่าเริ่มต้นเปิดทุกตัว ยกเว้น turn-done-sound)

| ตัว             | hook                                                                                                       | หมายเหตุ                                                 |
| --------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| secret-guard    | ย้ายไปเป็นกฎ `secret-write` ของ forge                                                                      | ไม่อยู่ใน devkit                                         |
| eol-guard       | `tool.call` Edit/Write: จำ EOL ก่อนแก้ แล้วคืนหลังแก้                                                      | ใช้ได้เฉพาะ Edit/Write ไม่ครอบคลุม sed ใน Bash           |
| branch-watch    | `ui.status` + `clock.every` 30 วินาที                                                                      | toast เมื่อ branch เปลี่ยนโดยไม่ได้มาจากคำสั่งของ Claude |
| pr-pane         | ย้ายไปอยู่ใน mission                                                                                       | ไม่อยู่ใน devkit                                         |
| prior-work      | `prompt.submit`: เจอ `[A-Z]+-\d+` หรือ `#\d+` ค้น `gh pr list --search` + `git log --grep` แนบเป็น context | ไม่บล็อก                                                 |
| long-run-watch  | `tool.call` Bash: จับเวลา, แถบเตือนเมื่อเกินค่าเฉลี่ย 2 เท่าของคำสั่งเดียวกัน (เก็บใน `$.store`)           |                                                          |
| disk-band       | `clock.every` 10 นาที: `df` + `docker ps -a --filter label=org.testcontainers`                             | `/cleanup` แสดงรายการและถามก่อนลบทุกครั้ง                |
| usage-meter     | `session.usage` → `ui.status`                                                                              |                                                          |
| turn-done-sound | `turn.complete` เมื่อเทิร์นนานเกิน 2 นาที → `audio.play`                                                   |                                                          |

## 10. Spike: ต้องพิสูจน์ก่อนสร้างจริง

| #   | คำถาม                                                                                                | ถ้าทำไม่ได้                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| S1  | plugin ส่ง prompt ให้ session ตัวเองทำต่อได้ไหม (เช่น `session.send` ถึงตัวเอง หรือ `prompt.submit`) | ใช้ `prompt.fill` ใส่ข้อความ "แก้เทสต์ที่ล้มต่อ" ลงช่องพิมพ์ ผู้ใช้กด Enter เอง    |
| S2  | อ่านสถานะ "รอคำตอบ" ของ session อื่นในเครื่องได้ไหม                                                  | กล่อง "รอคุณ" แสดงเฉพาะ session นี้ + PR + forge                                   |
| S3  | อ่าน error ของ hook ของ plugin อื่นได้ไหม                                                            | แสดงเฉพาะของชุดนี้เอง (แต่ละ plugin บันทึก error ของตัวเองใน `$.state`)            |
| S4  | `model.classify` ใน `prompt.submit` เพิ่ม latency เท่าไหร่                                           | ถ้าเกิน 1.5 วินาที ย้ายไปทำหลังส่ง prompt แล้ว (ไม่ขวาง) และแสดงการ์ดกฎตอนจบเทิร์น |
| S5  | `tool.call` rewrite ของ Bash แสดงคำสั่งใหม่ให้ผู้ใช้เห็นในขั้นอนุญาตไหม                              | ถ้าไม่แสดง เปลี่ยน rewrite เป็น deny + บอกคำสั่งที่ถูก                             |

แต่ละ spike ทำเป็น mod ทิ้งได้ใน `~/.claude/dev-mods` ไม่เข้า repo

## 11. การทดสอบ

- ทุก plugin มี `tests/*.test.ts` รันด้วย `claude plugin test plugins/<name>`
- กฎทุกข้อใน §4.6 มีเคส hit และ miss อย่างน้อย 2 เคสต่อด้าน
- เทสต์ UI วนทั้ง `['terminal', 'desktop']` ตามคำแนะนำของ reference
- เทสต์ความปลอดภัย: hook ที่ throw ต้องได้ deny (ไม่ปล่อยผ่าน), rewrite ที่เพิ่ม `&&` ต้องถูกปฏิเสธตอนสร้างกฎ, guards.json ที่ผิด schema ต้องไม่ล้ม plugin
- `claude plugin validate` และ `tsc -p` ทุก plugin ใน CI ของ repo (GitHub Actions)
- ทดลองใช้จริงใน work-app 1 สัปดาห์ต่อช่วงก่อนเริ่มช่วงถัดไป

## 12. ลำดับการสร้าง

| ช่วง | สิ่งที่ได้                                                        | ใช้งานได้เมื่อจบช่วง             |
| ---- | ----------------------------------------------------------------- | -------------------------------- |
| 0    | repo, marketplace, CI, spike S1–S5                                | ผล spike และ design ที่ปรับตามผล |
| 1    | forge: engine + กฎ JSON + check ในตัว + กฎชุดแรก §4.6 + `/guards` | guard ทั้งหมดทำงานใน work-app     |
| 2    | forge: สร้างกฎจากบทเรียน + `/lessons` + import-memory             | กฎใหม่สร้างจากการแก้ Claude ได้  |
| 3    | proof                                                             | หลักฐานบนจอ + แถบเตือนตอนปิดงาน  |
| 4    | manager + mission                                                 | `/mods`, `/mission`              |
| 5    | autopilot                                                         | `/ship`                          |
| 6    | devkit                                                            | mod เล็กที่เหลือ                 |

## 13. คำตอบจากการรีวิว (2026-10-08)

1. repo `Ditthapong-j/claude-mods` เป็น **private**
2. repo ที่ไม่มี guards.json ใช้ reviewer `code-review` ทั่วไปในขั้น 6 ของ autopilot
3. รับได้ที่จะ classify ด้วยโมเดลเล็กทุกข้อความที่ยาวพอ (ผ่าน subscription ของ Claude Code) โดยยังคงเงื่อนไขข้ามใน §4.3 และเพดาน latency ใน S4
