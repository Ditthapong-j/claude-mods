# Phase 0–1: repo + spikes + forge guards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตั้ง repo `claude-mods` เป็น marketplace, ทำ spike S1–S5 ให้ได้คำตอบ, และส่ง plugin `forge` ที่บังคับกฎ JSON + check ในตัว ผ่าน `tool.call` พร้อมคำสั่ง `/guards` ให้ใช้ได้จริงใน work-app

**Architecture:** `forge` เป็น hooks module เดียวที่ดักทุก `tool.call` แล้วส่งให้ engine ล้วน (pure) ตัดสินจากกฎ 3 แหล่ง (repo `guards.json` → กฎในตัว) กฎ JSON ตัดสินด้วย regex ส่วนกฎที่ต้องใช้ข้อมูลภายนอกเรียก check ในตัวที่อ่านผ่าน `$.process` / `$.fs` / `$.http` ผลมี 4 แบบ pass / deny / rewrite / warn สถานะของ session (allow-once, hits) อยู่ใน `$.state`

**Tech Stack:** Claude Code 2.1.293 mod API (`claude-code`, `claude-code/testing`), TypeScript (strict, ไม่มี DOM/Node ใน mod), `claude plugin validate|test`, Node สำหรับสคริปต์ของ repo เท่านั้น

**Spec:** `docs/specs/2026-10-08-claude-mods-suite-design.md` (ช่วง 0 และ 1 ใน §12, เนื้อหา §2, §2.1, §3, §4.1, §4.2, §4.4 ส่วน `/guards`, §4.5, §4.6, §10, §11)

**นอกแผนนี้:** การสร้างกฎจากบทเรียน (§4.3), `/lessons` (ช่วง 2), proof, mission, manager, autopilot, devkit — แต่ละช่วงเขียนแผนแยกหลังได้ผล spike

## Global Constraints

- repo เป็น private `Ditthapong-j/claude-mods`; ห้ามมี host, ชื่อ workflow, เลข PR หรือชื่อบริษัทของงานในโค้ด/README/เทสต์ (spec §2.1) — ตัวอย่างใช้ `acme-app`, `acme.example`
- mod รันใน environment ที่ไม่มี DOM และไม่มี Node: ห้าม `import` จาก `node:*` หรือ npm package ใดๆ ใน `plugins/**/hooks`; ห้าม `import()` แบบ dynamic
- import ระหว่าง plugin ไม่ได้; import ไฟล์ภายใน plugin เดียวกันด้วย `import` declaration เท่านั้น
- TypeScript strict + `noUncheckedIndexedAccess`; ห้าม `any` ใช้ `unknown` แล้ว narrow
- สไตล์: tabs, single quotes, ไม่มี semicolon, trailing commas, 120 คอลัมน์
- ข้อความที่ผู้ใช้หรือโมเดลเห็นเป็นภาษาไทย; id ของกฎเป็น kebab-case อังกฤษ
- guard ต้อง fail closed: hook ของ `tool.call` ที่ throw ต้องได้ `{ deny }` ยกเว้น tool อ่านอย่างเดียว (`Read`, `Grep`, `Glob`, `LS`, `WebSearch`, `WebFetch`, `TodoWrite`)
- rewrite ห้ามเพิ่ม `;`, `&&`, `||`, `|`, `$(`, backtick, `>`, `<` ที่ไม่มีในคำสั่งเดิม และต้อง idempotent (spec §4.5)
- กฎไม่มีทางเปิดใช้เอง; `/guards allow` ต้องมาจากผู้ใช้พิมพ์เอง (`origin.kind === 'composer'`)
- ทุก commit จบด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **คำสั่งต่อกัน** (`cd x && git stash`, `FOO=1 npx vitest`) — กฎต้องยังจับได้ ไม่ใช่จับแค่ต้นบรรทัด → เทสต์ใน Task 7
2. **repo ไม่มี `guards.json` หรือ JSON พัง** — ต้องไม่ล้ม ใช้กฎในตัวต่อ และเตือนครั้งเดียวต่อ session ไม่ใช่ทุกการเรียก tool → เทสต์ใน Task 5 และ Task 6
3. **hook ล้มกลางทาง** — guard ต้อง deny (ไม่ปล่อยผ่าน) แต่ `Read`/`Grep` ยังทำงานได้ ไม่งั้น session ใช้งานไม่ได้เลย → เทสต์ใน Task 6
4. **เครือข่ายหรือ `gh` ใช้ไม่ได้** — `version-bumped` ต้อง deny พร้อมเหตุผล, `pr-head-rename` ต้อง warn ไม่ค้าง → เทสต์ใน Task 8 และ Task 9
5. **โมเดลพยายามยกเว้นกฎเอง** — `/guards allow` จาก origin ที่ไม่ใช่ผู้ใช้ต้องถูกปฏิเสธ → เทสต์ใน Task 10

---

## File Structure

```
claude-mods/
  .claude-plugin/marketplace.json        # Task 1: marketplace ของ repo
  .gitignore                             # Task 1: .forbidden-words, .claude-plugin/types ของแต่ละ plugin
  .githooks/pre-push                     # Task 1: รัน check-forbidden + check.sh
  scripts/check-forbidden.mjs            # Task 1: สแกนคำต้องห้ามใน git ls-files
  scripts/check.sh                       # Task 1: validate + test + tsc ทุก plugin
  README.md                              # Task 1 (ติดตั้ง), Task 11 (guards.json)
  docs/spikes/2026-10-results.md         # Task 2
  plugins/forge/
    .claude-plugin/plugin.json           # Task 1
    hooks/hooks.json                     # Task 1
    hooks/register.ts                    # Task 1 (โครง), Task 6 (tool.call), Task 10 (/guards)
    hooks/types.ts                       # Task 3: Rule, Verdict, RepoConfig
    hooks/glob.ts                        # Task 3: globToRegExp
    hooks/match.ts                       # Task 3: applies, triggers, judge, interpolate
    hooks/safety.ts                      # Task 4: validateRule
    hooks/config.ts                      # Task 5: parseGuards (pure), loadRepoConfig ($)
    hooks/engine.ts                      # Task 6: runRules
    hooks/state.ts                       # Task 6: atoms allowOnce, hits, warnedConfig
    hooks/builtin.ts                     # Task 7: กฎ JSON ในตัว + กฎ check ในตัว
    hooks/checks/types.ts                # Task 8: Check, CheckContext
    hooks/checks/index.ts                # Task 8: CHECKS registry
    hooks/checks/secret.ts               # Task 8
    hooks/checks/vitest-concurrent.ts    # Task 8
    hooks/checks/pr-head-rename.ts       # Task 8
    hooks/checks/version-bumped.ts       # Task 9
    hooks/checks/cost-estimate.ts        # Task 9
    hooks/commands.ts                    # Task 10: handleGuardsCommand (pure) + formatSummary
    types/index.d.ts                     # Task 6: PluginState contract
    tests/helpers.ts                     # Task 6
    tests/*.test.ts                      # ทุก task
```

---

### Task 1: Repo scaffold, marketplace และ forge ที่โหลดได้

**Files:**

- Create: `.claude-plugin/marketplace.json`, `.gitignore`, `.githooks/pre-push`, `scripts/check-forbidden.mjs`, `scripts/check.sh`, `README.md`
- Create: `plugins/forge/.claude-plugin/plugin.json`, `plugins/forge/hooks/hooks.json`, `plugins/forge/hooks/register.ts`, `plugins/forge/tests/smoke.test.ts`

**Interfaces:**

- Produces: plugin ชื่อ `forge` ใน marketplace ชื่อ `claude-mods`; `scripts/check.sh` ที่ task อื่นใช้รันเทสต์ทั้งหมด

- [ ] **Step 1: เขียนไฟล์ marketplace และ manifest**

`.claude-plugin/marketplace.json`:

```json
{
	"name": "claude-mods",
	"owner": { "name": "Ditthapong-j" },
	"plugins": [
		{
			"name": "forge",
			"source": "./plugins/forge",
			"description": "บังคับกฎของ repo และบทเรียนที่เคยพลาด ก่อนคำสั่งจะรัน"
		}
	]
}
```

`plugins/forge/.claude-plugin/plugin.json`:

```json
{
	"name": "forge",
	"version": "0.1.0",
	"description": "บังคับกฎของ repo และบทเรียนที่เคยพลาด ก่อนคำสั่งจะรัน",
	"types": "./types/index.d.ts"
}
```

`plugins/forge/hooks/hooks.json`:

```json
{ "modules": ["./register.ts"] }
```

- [ ] **Step 2: เขียนเทสต์ smoke ที่ต้องล้ม**

`plugins/forge/tests/smoke.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

test('forge registers the /guards command on session start', async ($, on) => {
	const names: string[] = []
	on('command.register', ($, e) => {
		names.push(e.name)
		return { name: e.name }
	})
	await $.session.start({ source: 'startup' })
	expect(names).toContain('guards')
})
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — ยังไม่มี `register.ts` (โหลด module ไม่ได้)

ถ้า `$.session.start` ใน kit ต้องการ field อื่นนอกจาก `source` หรือ `command.register` ต้องคืนค่ารูปแบบอื่น ข้อความ error ของ kit จะบอกชื่อ field ให้แก้เทสต์ตามนั้น (อ่าน `SessionStartInput` และ result ของ `command.register` ใน `.claude-plugin/types/claude-code/index.d.ts`)

- [ ] **Step 4: เขียน register.ts ขั้นต่ำ**

`plugins/forge/hooks/register.ts`:

```ts
import type { Register } from 'claude-code'

export const register: Register = (on) => {
	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: 'guards',
			description: 'ดูกฎที่ทำงานอยู่และสิ่งที่ถูกดัก หรือยกเว้นกฎครั้งเดียว (/guards allow <id>)',
		})
		return next(e)
	})
}
```

- [ ] **Step 5: ไฟล์ของ repo**

`plugins/forge/types/index.d.ts` (ว่างไว้ก่อน Task 6 จะเติม):

```ts
export {}
```

`.gitignore`:

```
.forbidden-words
.DS_Store
node_modules/
plugins/*/.claude-plugin/types/
plugins/*/tsconfig.json
```

`scripts/check-forbidden.mjs`:

```js
#!/usr/bin/env node
// สแกนไฟล์ที่ git track อยู่ หาคำต้องห้ามจาก .forbidden-words (ไม่ commit) ทีละบรรทัด ไม่สนตัวพิมพ์
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const LIST = '.forbidden-words'
if (!existsSync(LIST)) {
	console.error(`ไม่มี ${LIST} — สร้างไฟล์นี้ใส่คำต้องห้ามบรรทัดละคำก่อน push`)
	process.exit(1)
}
const words = readFileSync(LIST, 'utf8')
	.split('\n')
	.map((w) => w.trim())
	.filter((w) => w.length > 0 && !w.startsWith('#'))
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const hits = []
for (const file of files) {
	const text = readFileSync(file, 'utf8').toLowerCase()
	for (const word of words) {
		if (text.includes(word.toLowerCase())) hits.push(`${file}: "${word}"`)
	}
}
if (hits.length > 0) {
	console.error(`พบคำต้องห้าม ${hits.length} จุด:\n${hits.join('\n')}`)
	process.exit(1)
}
console.log(`check-forbidden: ผ่าน (${files.length} ไฟล์, ${words.length} คำ)`)
```

`scripts/check.sh`:

```bash
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
	else
		echo "ข้าม tsc: ยังไม่มี $dir.claude-plugin/types (โหลด plugin ครั้งหนึ่งด้วย claude --plugin-dir $dir)"
	fi
done
exit $status
```

`.githooks/pre-push`:

```bash
#!/usr/bin/env bash
set -euo pipefail
node scripts/check-forbidden.mjs
bash scripts/check.sh
```

`README.md`:

````markdown
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

- `forge` — บังคับกฎของ repo (`.claude/guards.json`) และกฎในตัว ก่อนคำสั่งจะรัน · `/guards`
````

- [ ] **Step 6: รันเทสต์ให้ผ่าน + validate**

Run: `chmod +x scripts/check.sh .githooks/pre-push && claude plugin validate plugins/forge && claude plugin test plugins/forge`
Expected: validate ไม่มี error, เทสต์ smoke PASS

- [ ] **Step 7: ติดตั้งจาก marketplace ในเครื่องและดูว่าโหลด**

Run: `claude plugin marketplace add ~/Documents/claude-mods && claude plugin install forge@claude-mods --scope user && claude plugin list`
Expected: มี `forge@claude-mods` พร้อมบรรทัด `Read from: /Users/…/claude-mods/plugins/forge`

ถามผู้ใช้ก่อนรัน step นี้ เพราะเป็นการติดตั้งระดับ user ที่มีผลทุก session

- [ ] **Step 8: ตั้ง hooks และ commit**

```bash
git config core.hooksPath .githooks
git add -A
git commit -m "feat(forge): scaffold marketplace and forge plugin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Spike S1–S5 (ทิ้งได้)

**Files:**

- Create (ทิ้ง ไม่ commit): `~/.claude/dev-mods/<session>/spikes/` (โฟลเดอร์ mod ตามที่ skill plugin-authoring กำหนด)
- Create (commit): `docs/spikes/2026-10-results.md`

**Interfaces:**

- Produces: ไฟล์ผล spike ที่ Task 6 (ค่าเริ่มต้นของ rewrite) และแผนช่วงถัดไปอ่าน: บรรทัด `S5: rewrite-visible=yes|no`

spike ต้องมีคนดูหน้าจอ ทำใน session ที่เปิด hot reload แล้ว ทุกข้อจด: ทำอะไร, เห็นอะไร (คัดลอกข้อความจริง), สรุป yes/no, ผลต่อ design

- [ ] **Step 1: สร้าง mod spike**

ใช้ skill `plugin-authoring` สร้าง mod ชื่อ `spikes` ที่มี `hooks/register.ts`:

```ts
import type { Register } from 'claude-code'

export const register: Register = (on) => {
	on('session.start', async ($, e, next) => {
		for (const name of ['spike-s1', 'spike-s2', 'spike-s3', 'spike-s3-boom']) {
			await $.command.register({ name, description: `spike ${name}` })
		}
		return next(e)
	})

	// S1: ส่ง prompt ให้ session ตัวเองทำต่อได้ไหม
	on('command.run', { command: 'spike-s1' }, async ($) => {
		const id = await $.session.id()
		const sent = await $.session.send({
			to: { sessionId: id },
			text: 'พิมพ์คำว่า PONG-S1 แล้วจบ',
		})
		await $.prompt.fill({
			text: 'ข้อความจาก prompt.fill (S1 fallback)',
			mode: 'replace',
		})
		return { text: `S1 session.send → ${JSON.stringify(sent)}` }
	})

	// S2: เห็น session อื่นและสถานะของมันไหม
	on('command.run', { command: 'spike-s2' }, async ($) => {
		const res = await $.tool.call({ tool: 'ListAgents' })
		return {
			text: `S2 ListAgents → ${res.deny ?? res.text ?? JSON.stringify(res.result)}`,
		}
	})

	// S3: เห็น fault ของ hook (รวมของ plugin อื่น) ไหม
	const faults: string[] = []
	on('ui.fault', async ($, e, next) => {
		faults.push(JSON.stringify(e).slice(0, 300))
		return next(e)
	})
	on('command.run', { command: 'spike-s3-boom' }, () => {
		throw new Error('S3 boom on purpose')
	})
	on('command.run', { command: 'spike-s3' }, () => ({
		text: `S3 faults seen: ${faults.length}\n${faults.join('\n')}`,
	}))

	// S4: classify ช้าแค่ไหน
	on('prompt.submit', async ($, e, next) => {
		const started = await $.clock.now()
		const label = await $.model.classify(e.text, ['correction', 'task'])
		const took = (await $.clock.now()) - started
		void $.ui.toast(`S4 classify=${label ?? 'none'} ${took}ms`)
		return next(e)
	})

	// S5: rewrite ของ Bash แสดงคำสั่งใหม่ในขั้นขออนุญาตไหม
	on('tool.call', { tool: 'Bash' }, ($, e, next) =>
		e.command.trim() === 'echo spike-s5' ? next({ ...e, command: 'echo spike-s5-REWRITTEN' }) : next(e)
	)
}
```

ถ้า `tsc`/validate บอกว่า signature ของ `$.session.send`, `$.prompt.fill`, `$.clock.now`, `e.text` ต่างจากนี้ ให้แก้ตาม type ใน `.claude-plugin/types/claude-code/index.d.ts` — spike มีไว้หาความจริงของ API นี้

- [ ] **Step 2: S1** — พิมพ์ `/spike-s1` ดูว่า (ก) Claude เริ่มเทิร์นใหม่และพิมพ์ PONG-S1 เองไหม (ข) ช่องพิมพ์มีข้อความ fallback ไหม จดผล

- [ ] **Step 3: S2** — เปิด session อื่นอีกตัวในเครื่องที่ถามคำถามค้างไว้ แล้วพิมพ์ `/spike-s2` ใน session นี้ ดูว่าเห็น session อื่นและบอกได้ไหมว่ามันรอคำตอบ จดผล

- [ ] **Step 4: S3** — พิมพ์ `/spike-s3-boom` แล้ว `/spike-s3` ดูว่า fault ถูกบันทึกไหม จากนั้นทำให้ plugin อื่นล้ม (เช่น แก้ forge ให้ throw ชั่วคราวในเครื่อง ไม่ commit) แล้วดูว่า spike เห็นไหม จดผล

- [ ] **Step 5: S4** — ส่งข้อความยาว 10 ข้อความ จด ms จาก toast ทุกครั้ง คำนวณค่ากลางและค่าสูงสุด เทียบเพดาน 1,500 ms ใน spec §10

- [ ] **Step 6: S5** — ขอให้ Claude รัน `echo spike-s5` ใน permission mode ที่ต้องขออนุญาต (ไม่ใช่ bypass) ดูว่าหน้าขออนุญาตแสดง `echo spike-s5` หรือ `echo spike-s5-REWRITTEN` และผลที่ได้คืออะไร

- [ ] **Step 7: เขียนผลและ commit**

`docs/spikes/2026-10-results.md` (กรอกผลจริง ห้ามเดา):

```markdown
# Spike results 2026-10

| #   | คำถาม                                    | ผล     | หลักฐาน (ข้อความจริงที่เห็น) | ผลต่อ design |
| --- | ---------------------------------------- | ------ | ---------------------------- | ------------ |
| S1  | ส่ง prompt ให้ session ตัวเองทำต่อได้ไหม | yes/no |                              |              |
| S2  | เห็นสถานะ session อื่นไหม                | yes/no |                              |              |
| S3  | เห็น fault ของ plugin อื่นไหม            | yes/no |                              |              |
| S4  | latency ของ classify (median/max ms)     |        |                              |              |
| S5  | rewrite-visible=yes/no                   |        |                              |              |
```

```bash
git add docs/spikes/2026-10-results.md
git commit -m "docs: spike S1-S5 results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

ลบโฟลเดอร์ mod `spikes` หลังจดผล

---

### Task 3: ชนิดข้อมูลกฎ, glob และการตัดสินกฎ JSON

**Files:**

- Create: `plugins/forge/hooks/types.ts`, `plugins/forge/hooks/glob.ts`, `plugins/forge/hooks/match.ts`
- Test: `plugins/forge/tests/match.test.ts`

**Interfaces:**

- Produces:
  - `type Action = 'deny' | 'rewrite' | 'warn'`
  - `type Rule = { id; tools; field; match?; flags?; unless?; paths?; exceptPaths?; requires?; check?; params?; action; rewrite?; why; hint?; examples; enabled }` (ดูโค้ด)
  - `type Verdict = { kind: 'pass' } | { kind: 'deny'; ruleId; message } | { kind: 'rewrite'; ruleId; value; note } | { kind: 'warn'; ruleId; message }`
  - `type Vars = Readonly<Record<string, string>>` (มี `repoRoot` เสมอเมื่ออยู่ใน repo)
  - `globToRegExp(glob: string): RegExp`
  - `interpolate(template: string, vars: Vars): string`
  - `applies(rule: Rule, tool: string, input: ToolInput, vars: Vars): boolean`
  - `triggers(rule: Rule, value: string): boolean`
  - `judge(rule: Rule, value: string, vars: Vars): Verdict` (กฎ JSON เท่านั้น)
  - `PASS: Verdict`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/match.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { globToRegExp } from '../hooks/glob'
import { applies, interpolate, judge, triggers } from '../hooks/match'
import type { Rule } from '../hooks/types'

const base: Rule = {
	id: 'demo',
	tools: ['Bash'],
	field: 'command',
	match: '^(\\s*git\\s+checkout\\s+-b\\s+\\S+)\\s*$',
	action: 'rewrite',
	rewrite: '$1 {baseBranch}',
	why: 'แตก branch จากฐานที่ถูก',
	examples: { hit: [], miss: [] },
	enabled: true,
}

describe('globToRegExp', () => {
	test('** crosses folders, * does not', () => {
		expect(globToRegExp('apps/web/**').test('apps/web/src/a.tsx')).toBe(true)
		expect(globToRegExp('apps/*.ts').test('apps/x/y.ts')).toBe(false)
		expect(globToRegExp('**/*.example*').test('config/app.example.json')).toBe(true)
		expect(globToRegExp('**/*.example*').test('app.example')).toBe(true)
	})
})

describe('interpolate', () => {
	test('fills known vars and keeps unknown ones', () => {
		expect(interpolate('$1 {baseBranch} {nope}', { baseBranch: 'origin/main' })).toBe('$1 origin/main {nope}')
	})
})

describe('judge', () => {
	test('rewrite appends the base branch', () => {
		const v = judge(base, 'git checkout -b fix/a', {
			baseBranch: 'origin/develop',
		})
		expect(v).toEqual({
			kind: 'rewrite',
			ruleId: 'demo',
			value: 'git checkout -b fix/a origin/develop',
			note: 'แก้คำสั่งเป็น: git checkout -b fix/a origin/develop (demo · แตก branch จากฐานที่ถูก)',
		})
	})
	test('rewrite that changes nothing passes', () => {
		expect(judge(base, 'git checkout main', { baseBranch: 'origin/develop' })).toEqual({ kind: 'pass' })
	})
	test('unless exempts', () => {
		const rule: Rule = {
			...base,
			action: 'deny',
			rewrite: undefined,
			match: 'git stash',
			unless: '-m ',
		}
		expect(judge(rule, 'git stash push -m "x"', {}).kind).toBe('pass')
		expect(judge(rule, 'git stash', {})).toEqual({
			kind: 'deny',
			ruleId: 'demo',
			message: 'แตก branch จากฐานที่ถูก',
		})
	})
	test('deny message adds the hint with vars', () => {
		const rule: Rule = {
			...base,
			action: 'deny',
			match: 'x',
			hint: 'ใช้ {baseBranch}',
		}
		expect(judge(rule, 'x', { baseBranch: 'origin/main' })).toEqual({
			kind: 'deny',
			ruleId: 'demo',
			message: 'แตก branch จากฐานที่ถูก · ใช้ origin/main',
		})
	})
	test('a g flag does not make matching stateful', () => {
		const rule: Rule = {
			...base,
			action: 'warn',
			match: 'Acme App',
			flags: 'gi',
		}
		expect(judge(rule, 'acme app', {}).kind).toBe('warn')
		expect(judge(rule, 'acme app', {}).kind).toBe('warn')
	})
})

describe('applies', () => {
	test('checks tool, enabled, requires and paths', () => {
		expect(applies(base, 'Bash', { command: 'x' }, { baseBranch: 'b' })).toBe(true)
		expect(applies(base, 'Edit', { command: 'x' }, { baseBranch: 'b' })).toBe(false)
		expect(applies({ ...base, enabled: false }, 'Bash', { command: 'x' }, {})).toBe(false)
		expect(applies({ ...base, requires: ['baseBranch'] }, 'Bash', { command: 'x' }, {})).toBe(false)
		const edit: Rule = {
			...base,
			tools: ['Edit'],
			field: 'new_string',
			paths: ['apps/web/**'],
			exceptPaths: ['**/*.test.tsx'],
		}
		const vars = { repoRoot: '/r' }
		expect(applies(edit, 'Edit', { file_path: '/r/apps/web/a.tsx', new_string: 'x' }, vars)).toBe(true)
		expect(applies(edit, 'Edit', { file_path: '/r/apps/web/a.test.tsx', new_string: 'x' }, vars)).toBe(false)
		expect(applies(edit, 'Edit', { file_path: '/r/backend/a.cs', new_string: 'x' }, vars)).toBe(false)
	})
})

describe('triggers', () => {
	test('a check rule without match always triggers', () => {
		expect(triggers({ ...base, match: undefined, check: 'secret' }, 'anything')).toBe(true)
		expect(triggers({ ...base, check: 'secret', match: 'vitest' }, 'npm test')).toBe(false)
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `../hooks/glob` และ `../hooks/match` ยังไม่มี

- [ ] **Step 3: เขียนโค้ด**

`plugins/forge/hooks/types.ts`:

```ts
export type Action = 'deny' | 'rewrite' | 'warn'

export type Vars = Readonly<Record<string, string>>

export type ToolInput = Readonly<Record<string, unknown>>

export type Rule = {
	id: string
	tools: readonly string[]
	field: string
	match?: string
	flags?: string
	unless?: string
	paths?: readonly string[]
	exceptPaths?: readonly string[]
	requires?: readonly string[]
	check?: string
	params?: Readonly<Record<string, unknown>>
	action: Action
	rewrite?: string
	why: string
	hint?: string
	examples: { hit: readonly string[]; miss: readonly string[] }
	enabled: boolean
}

export type Verdict =
	| { kind: 'pass' }
	| { kind: 'deny'; ruleId: string; message: string }
	| { kind: 'rewrite'; ruleId: string; value: string; note: string }
	| { kind: 'warn'; ruleId: string; message: string }

export type RepoConfig = {
	root: string | null
	vars: Vars
	rules: readonly Rule[]
	errors: readonly string[]
}
```

`plugins/forge/hooks/glob.ts`:

```ts
const SPECIAL = /[.+^${}()|[\]\\]/g

export function globToRegExp(glob: string): RegExp {
	let out = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob.charAt(i)
		if (c === '*') {
			if (glob.charAt(i + 1) === '*') {
				out += '.*'
				i++
				if (glob.charAt(i + 1) === '/') i++
			} else {
				out += '[^/]*'
			}
		} else if (c === '?') {
			out += '[^/]'
		} else {
			out += c.replace(SPECIAL, '\\$&')
		}
	}
	return new RegExp(`^${out}$`)
}
```

`plugins/forge/hooks/match.ts`:

```ts
import { globToRegExp } from './glob'
import type { Rule, ToolInput, Vars, Verdict } from './types'

export const PASS: Verdict = { kind: 'pass' }

export function interpolate(template: string, vars: Vars): string {
	return template.replace(/\{(\w+)\}/g, (whole, key: string) => vars[key] ?? whole)
}

function regex(source: string, flags: string | undefined): RegExp {
	return new RegExp(source, (flags ?? '').replace(/g/g, ''))
}

function relative(filePath: string, root: string | undefined): string {
	return root !== undefined && filePath.startsWith(`${root}/`) ? filePath.slice(root.length + 1) : filePath
}

export function applies(rule: Rule, tool: string, input: ToolInput, vars: Vars): boolean {
	if (!rule.enabled || !rule.tools.includes(tool)) return false
	if (rule.requires?.some((key) => vars[key] === undefined)) return false
	if (rule.paths === undefined && rule.exceptPaths === undefined) return true
	const filePath = input['file_path']
	if (typeof filePath !== 'string') return rule.paths === undefined
	const rel = relative(filePath, vars['repoRoot'])
	if (rule.exceptPaths?.some((glob) => globToRegExp(glob).test(rel))) return false
	return rule.paths === undefined || rule.paths.some((glob) => globToRegExp(glob).test(rel))
}

export function triggers(rule: Rule, value: string): boolean {
	if (rule.match === undefined) return true
	if (!regex(rule.match, rule.flags).test(value)) return false
	return rule.unless === undefined || !regex(rule.unless, rule.flags).test(value)
}

export function judge(rule: Rule, value: string, vars: Vars): Verdict {
	if (rule.check !== undefined || rule.match === undefined || !triggers(rule, value)) return PASS
	const why = rule.hint === undefined ? rule.why : `${rule.why} · ${interpolate(rule.hint, vars)}`
	if (rule.action === 'deny') return { kind: 'deny', ruleId: rule.id, message: why }
	if (rule.action === 'warn') return { kind: 'warn', ruleId: rule.id, message: why }
	const next = value.replace(regex(rule.match, rule.flags), interpolate(rule.rewrite ?? '$&', vars))
	if (next === value) return PASS
	return {
		kind: 'rewrite',
		ruleId: rule.id,
		value: next,
		note: `แก้คำสั่งเป็น: ${next} (${rule.id} · ${rule.why})`,
	}
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS ทุกเคสใน `match.test.ts` และ `smoke.test.ts`

- [ ] **Step 5: Commit**

```bash
git add plugins/forge/hooks/types.ts plugins/forge/hooks/glob.ts plugins/forge/hooks/match.ts plugins/forge/tests/match.test.ts
git commit -m "feat(forge): rule types, glob and JSON rule judging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: ตรวจความปลอดภัยของกฎ (validateRule)

**Files:**

- Create: `plugins/forge/hooks/safety.ts`
- Test: `plugins/forge/tests/safety.test.ts`

**Interfaces:**

- Consumes: `Rule`, `Vars`, `judge` (Task 3)
- Produces: `validateRule(rule: Rule, vars: Vars, knownChecks: ReadonlySet<string>): string[]` — คืนรายการข้อผิดพลาดภาษาไทย ว่าง = ใช้ได้

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/safety.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { validateRule } from '../hooks/safety'
import type { Rule } from '../hooks/types'

const CHECKS = new Set(['secret'])

const ok: Rule = {
	id: 'branch-base',
	tools: ['Bash'],
	field: 'command',
	match: '^(\\s*git\\s+checkout\\s+-b\\s+\\S+)\\s*$',
	action: 'rewrite',
	rewrite: '$1 {baseBranch}',
	why: 'x',
	examples: {
		hit: ['git checkout -b a'],
		miss: ['git checkout -b a origin/develop', 'git checkout main'],
	},
	enabled: true,
}
const vars = { baseBranch: 'origin/develop' }

describe('validateRule', () => {
	test('a good rule has no errors', () => {
		expect(validateRule(ok, vars, CHECKS)).toEqual([])
	})
	test('bad id, empty tools, broken regex', () => {
		const errors = validateRule({ ...ok, id: 'Bad Id', tools: [], match: '(' }, vars, CHECKS)
		expect(errors.some((e) => e.includes('id'))).toBe(true)
		expect(errors.some((e) => e.includes('tools'))).toBe(true)
		expect(errors.some((e) => e.includes('regex'))).toBe(true)
	})
	test('examples must behave', () => {
		const errors = validateRule(
			{
				...ok,
				examples: { hit: ['git checkout main'], miss: ['git checkout -b b'] },
			},
			vars,
			CHECKS
		)
		expect(errors).toContain('ตัวอย่าง hit ไม่โดนกฎ: git checkout main')
		expect(errors).toContain('ตัวอย่าง miss โดนกฎ: git checkout -b b')
	})
	test('rewrite may not add shell operators', () => {
		const errors = validateRule({ ...ok, rewrite: '$1 && rm -rf /' }, vars, CHECKS)
		expect(errors.some((e) => e.includes('&&'))).toBe(true)
	})
	test('rewrite must be idempotent', () => {
		const loop: Rule = {
			...ok,
			match: 'git push',
			rewrite: '$& --force-with-lease',
			examples: { hit: ['git push'], miss: [] },
		}
		expect(validateRule(loop, vars, CHECKS).some((e) => e.includes('idempotent'))).toBe(true)
	})
	test('rewrite needs a template, check must be known, match xor check rules', () => {
		expect(validateRule({ ...ok, rewrite: undefined }, vars, CHECKS)).toContain('action rewrite ต้องมี rewrite')
		expect(
			validateRule(
				{
					...ok,
					check: 'nope',
					match: undefined,
					examples: { hit: [], miss: [] },
				},
				vars,
				CHECKS
			)
		).toContain('ไม่รู้จัก check "nope"')
		expect(validateRule({ ...ok, check: 'secret', action: 'rewrite' }, vars, CHECKS)).toContain(
			'กฎที่ใช้ check ใช้ action rewrite ไม่ได้'
		)
		expect(validateRule({ ...ok, match: undefined, check: undefined }, vars, CHECKS)).toContain(
			'ต้องมี match หรือ check'
		)
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `../hooks/safety` ยังไม่มี

- [ ] **Step 3: เขียนโค้ด**

`plugins/forge/hooks/safety.ts`:

```ts
import { judge } from './match'
import type { Rule, Vars } from './types'

const OPERATORS = ['&&', '||', ';', '|', '$(', '`', '>', '<'] as const

function count(text: string, token: string): number {
	return text.split(token).length - 1
}

function compiles(source: string, flags: string | undefined): string | undefined {
	try {
		new RegExp(source, flags)
		return undefined
	} catch (err) {
		return err instanceof Error ? err.message : String(err)
	}
}

export function validateRule(rule: Rule, vars: Vars, knownChecks: ReadonlySet<string>): string[] {
	const errors: string[] = []
	if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(rule.id)) errors.push(`id "${rule.id}" ต้องเป็น kebab-case 2-41 ตัว`)
	if (rule.tools.length === 0) errors.push('tools ต้องมีอย่างน้อย 1 ตัว')
	if (rule.why.trim() === '') errors.push('why ต้องไม่ว่าง')
	if (rule.match === undefined && rule.check === undefined) errors.push('ต้องมี match หรือ check')
	if (rule.check !== undefined && !knownChecks.has(rule.check)) errors.push(`ไม่รู้จัก check "${rule.check}"`)
	if (rule.check !== undefined && rule.action === 'rewrite') errors.push('กฎที่ใช้ check ใช้ action rewrite ไม่ได้')
	if (rule.action === 'rewrite' && rule.rewrite === undefined) errors.push('action rewrite ต้องมี rewrite')
	for (const [name, source] of [
		['match', rule.match],
		['unless', rule.unless],
	] as const) {
		if (source === undefined) continue
		const problem = compiles(source, rule.flags?.replace(/g/g, ''))
		if (problem !== undefined) errors.push(`${name} ไม่ใช่ regex ที่ใช้ได้: ${problem}`)
	}
	if (errors.length > 0 || rule.check !== undefined) return errors

	for (const hit of rule.examples.hit) {
		const verdict = judge(rule, hit, vars)
		if (verdict.kind === 'pass') {
			errors.push(`ตัวอย่าง hit ไม่โดนกฎ: ${hit}`)
			continue
		}
		if (verdict.kind !== 'rewrite') continue
		for (const op of OPERATORS) {
			if (count(verdict.value, op) > count(hit, op))
				errors.push(`rewrite เพิ่ม "${op}" ที่ไม่มีในคำสั่งเดิม: ${verdict.value}`)
		}
		if (judge(rule, verdict.value, vars).kind !== 'pass')
			errors.push(`rewrite ไม่ idempotent: ${verdict.value} ยังโดนกฎซ้ำ`)
	}
	for (const miss of rule.examples.miss) {
		if (judge(rule, miss, vars).kind !== 'pass') errors.push(`ตัวอย่าง miss โดนกฎ: ${miss}`)
	}
	return errors
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/forge/hooks/safety.ts plugins/forge/tests/safety.test.ts
git commit -m "feat(forge): validate rules for operators, idempotence and examples

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: อ่าน `.claude/guards.json`

**Files:**

- Create: `plugins/forge/hooks/config.ts`
- Test: `plugins/forge/tests/config.test.ts`

**Interfaces:**

- Consumes: `Rule`, `RepoConfig`, `Vars` (Task 3), `validateRule` (Task 4)
- Produces:
  - `GUARDS_FILE = '.claude/guards.json'`
  - `parseGuards(raw: unknown, root: string, knownChecks: ReadonlySet<string>, validateParams: (check: string, params: unknown) => string[]): RepoConfig` — pure
  - `loadRepoConfig($: EngineInterface, knownChecks, validateParams): Promise<RepoConfig>` — หา root ด้วย `git rev-parse --show-toplevel` ใน cwd ของ session (cache ต่อ cwd), อ่านไฟล์, เรียก `parseGuards`

รูปแบบไฟล์:

```json
{
	"vars": { "baseBranch": "origin/develop" },
	"rules": [
		{
			"id": "…",
			"tool": "Bash",
			"field": "command",
			"match": "…",
			"action": "deny",
			"why": "…",
			"examples": { "hit": [], "miss": [] }
		}
	]
}
```

`tool` (string) หรือ `tools` (array) อย่างใดอย่างหนึ่ง; `enabled` ค่าเริ่มต้น true; `field` ค่าเริ่มต้น `command`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/config.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { parseGuards } from '../hooks/config'

const CHECKS = new Set(['version-bumped'])
const noParams = (): string[] => []

describe('parseGuards', () => {
	test('normalizes rules and adds repoRoot to vars', () => {
		const cfg = parseGuards(
			{
				vars: { baseBranch: 'origin/develop' },
				rules: [
					{
						id: 'prod-ref-main',
						tool: 'Bash',
						match: 'deploy-environment=PROD',
						unless: '--ref main\\b',
						action: 'deny',
						why: 'PROD ต้องรันจาก main',
						examples: {
							hit: ['gh workflow run api.yaml --ref develop -f deploy-environment=PROD'],
							miss: ['gh workflow run api.yaml --ref main -f deploy-environment=PROD'],
						},
					},
				],
			},
			'/r',
			CHECKS,
			noParams
		)
		expect(cfg.errors).toEqual([])
		expect(cfg.vars).toEqual({ baseBranch: 'origin/develop', repoRoot: '/r' })
		expect(cfg.rules[0]?.tools).toEqual(['Bash'])
		expect(cfg.rules[0]?.field).toBe('command')
		expect(cfg.rules[0]?.enabled).toBe(true)
	})
	test('drops invalid rules with a reason and keeps the rest', () => {
		const cfg = parseGuards(
			{
				rules: [
					{ id: 'bad', tool: 'Bash', match: '(', action: 'deny', why: 'x' },
					{ id: 'good', tool: 'Bash', match: 'x', action: 'warn', why: 'y' },
				],
			},
			'/r',
			CHECKS,
			noParams
		)
		expect(cfg.rules.map((r) => r.id)).toEqual(['good'])
		expect(cfg.errors[0]).toContain('bad')
	})
	test('non-object, non-string vars and non-array rules are errors, not crashes', () => {
		expect(parseGuards(42, '/r', CHECKS, noParams).errors.length).toBeGreaterThan(0)
		expect(parseGuards({ vars: { a: 1 } }, '/r', CHECKS, noParams).errors).toContain('vars.a ต้องเป็นข้อความ')
		expect(parseGuards({ rules: {} }, '/r', CHECKS, noParams).errors).toContain('rules ต้องเป็น array')
	})
	test('check params are validated by the check', () => {
		const cfg = parseGuards(
			{
				rules: [
					{
						id: 'vb',
						tool: 'Bash',
						check: 'version-bumped',
						params: {},
						action: 'deny',
						why: 'x',
					},
				],
			},
			'/r',
			CHECKS,
			(check) => (check === 'version-bumped' ? ['params.versionUrl ต้องมี'] : [])
		)
		expect(cfg.rules).toEqual([])
		expect(cfg.errors[0]).toContain('params.versionUrl ต้องมี')
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `../hooks/config` ยังไม่มี

- [ ] **Step 3: เขียนโค้ด**

`plugins/forge/hooks/config.ts`:

```ts
import type { EngineInterface } from 'claude-code'

import { validateRule } from './safety'
import type { Action, RepoConfig, Rule } from './types'

export const GUARDS_FILE = '.claude/guards.json'

type ParamsValidator = (check: string, params: unknown) => string[]

const ACTIONS: readonly Action[] = ['deny', 'rewrite', 'warn']

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function strings(value: unknown): string[] | undefined {
	return Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined
}

function optionalString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined
}

function toRule(raw: unknown, index: number): { rule?: Rule; error?: string } {
	if (!isRecord(raw)) return { error: `rules[${index}] ต้องเป็น object` }
	const id = optionalString(raw['id']) ?? `rules[${index}]`
	const tools = typeof raw['tool'] === 'string' ? [raw['tool']] : strings(raw['tools'])
	const action = ACTIONS.find((a) => a === raw['action'])
	const why = optionalString(raw['why'])
	if (tools === undefined) return { error: `กฎ ${id}: ต้องมี tool หรือ tools` }
	if (action === undefined) return { error: `กฎ ${id}: action ต้องเป็น deny, rewrite หรือ warn` }
	if (why === undefined) return { error: `กฎ ${id}: ต้องมี why` }
	const examples = isRecord(raw['examples']) ? raw['examples'] : {}
	return {
		rule: {
			id,
			tools,
			field: optionalString(raw['field']) ?? 'command',
			match: optionalString(raw['match']),
			flags: optionalString(raw['flags']),
			unless: optionalString(raw['unless']),
			paths: strings(raw['paths']),
			exceptPaths: strings(raw['exceptPaths']),
			requires: strings(raw['requires']),
			check: optionalString(raw['check']),
			params: isRecord(raw['params']) ? raw['params'] : undefined,
			action,
			rewrite: optionalString(raw['rewrite']),
			why,
			hint: optionalString(raw['hint']),
			examples: {
				hit: strings(examples['hit']) ?? [],
				miss: strings(examples['miss']) ?? [],
			},
			enabled: raw['enabled'] !== false,
		},
	}
}

export function parseGuards(
	raw: unknown,
	root: string,
	knownChecks: ReadonlySet<string>,
	validateParams: ParamsValidator
): RepoConfig {
	const errors: string[] = []
	if (!isRecord(raw))
		return {
			root,
			vars: { repoRoot: root },
			rules: [],
			errors: [`${GUARDS_FILE} ต้องเป็น object`],
		}

	const vars: Record<string, string> = {}
	if (isRecord(raw['vars'])) {
		for (const [key, value] of Object.entries(raw['vars'])) {
			if (typeof value === 'string') vars[key] = value
			else errors.push(`vars.${key} ต้องเป็นข้อความ`)
		}
	}
	vars['repoRoot'] = root

	const rules: Rule[] = []
	const rawRules = raw['rules'] ?? []
	if (!Array.isArray(rawRules)) {
		errors.push('rules ต้องเป็น array')
	} else {
		rawRules.forEach((item, index) => {
			const { rule, error } = toRule(item, index)
			if (rule === undefined) {
				errors.push(error ?? `rules[${index}] ใช้ไม่ได้`)
				return
			}
			const problems = [
				...validateRule(rule, vars, knownChecks),
				...(rule.check === undefined ? [] : validateParams(rule.check, rule.params ?? {})),
			]
			if (problems.length > 0) errors.push(`กฎ ${rule.id}: ${problems.join(' · ')}`)
			else rules.push(rule)
		})
	}
	return { root, vars, rules, errors }
}

const rootByCwd = new Map<string, string | null>()

async function repoRoot($: EngineInterface): Promise<string | null> {
	const cwd = await $.session.cwd()
	const cached = rootByCwd.get(cwd)
	if (cached !== undefined) return cached
	const res = await $.process.run(['git', 'rev-parse', '--show-toplevel'], {
		cwd,
	})
	const root = res.exitCode === 0 ? res.stdout.trim() : null
	rootByCwd.set(cwd, root)
	return root
}

export async function loadRepoConfig(
	$: EngineInterface,
	knownChecks: ReadonlySet<string>,
	validateParams: ParamsValidator
): Promise<RepoConfig> {
	const root = await repoRoot($)
	if (root === null) return { root: null, vars: {}, rules: [], errors: [] }
	const path = `${root}/${GUARDS_FILE}`
	if (!(await $.fs.exists(path))) return { root, vars: { repoRoot: root }, rules: [], errors: [] }
	const text = await $.fs.read(path)
	if (typeof text !== 'string')
		return {
			root,
			vars: { repoRoot: root },
			rules: [],
			errors: [`${GUARDS_FILE} ไม่ใช่ไฟล์ข้อความ`],
		}
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err)
		return {
			root,
			vars: { repoRoot: root },
			rules: [],
			errors: [`${GUARDS_FILE} ไม่ใช่ JSON ที่ถูกต้อง: ${reason}`],
		}
	}
	return parseGuards(raw, root, knownChecks, validateParams)
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/forge/hooks/config.ts plugins/forge/tests/config.test.ts
git commit -m "feat(forge): parse and load .claude/guards.json

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Engine และการต่อเข้ากับ `tool.call`

**Files:**

- Create: `plugins/forge/hooks/engine.ts`, `plugins/forge/hooks/state.ts`, `plugins/forge/hooks/checks/types.ts`, `plugins/forge/hooks/checks/index.ts`, `plugins/forge/tests/helpers.ts`, `plugins/forge/tests/engine.test.ts`, `plugins/forge/tests/tool-call.test.ts`
- Modify: `plugins/forge/hooks/register.ts`, `plugins/forge/types/index.d.ts`

**Interfaces:**

- Consumes: Task 3–5
- Produces:
  - `type CheckContext = { $: EngineInterface; rule: Rule; tool: string; value: string; input: ToolInput; vars: Vars }`
  - `type Check = { run(ctx: CheckContext): Promise<Verdict>; validate(params: unknown): string[] }`
  - `CHECKS: Readonly<Record<string, Check>>` (ว่างใน task นี้, Task 8–9 เติม), `CHECK_NAMES: ReadonlySet<string>`, `validateCheckParams(check: string, params: unknown): string[]`
  - `type Outcome = { deny?: { ruleId: string; message: string }; input: ToolInput; notes: string[]; warns: string[]; hits: HitRecord[]; consumed: string[] }`
  - `runRules($, rules: readonly Rule[], tool: string, input: ToolInput, vars: Vars, allowed: ReadonlySet<string>, now: number): Promise<Outcome>`
  - `mergeRules(...sources: readonly (readonly Rule[])[]): Rule[]` — กฎ id ซ้ำ ตัวแรกชนะ
  - atoms ใน `state.ts`: `allowOnceAtom` (string[]), `hitsAtom` (HitRecord[], เก็บ 100 ล่าสุด), `warnedAtom` (string[] ของข้อความ config error ที่เตือนแล้ว)
  - `type HitRecord = { ruleId: string; tool: string; kind: 'deny' | 'rewrite' | 'warn'; at: number; summary: string }` ใน `types/index.d.ts`
  - `BUILTIN_RULES` import จาก `./builtin` (Task 7 สร้าง; task นี้สร้างไฟล์ที่ export array ว่างก่อน)
  - ค่า `userConfig` `rewriteAsDeny` (boolean, ค่าเริ่มต้นจากผล S5: `false` ถ้า `rewrite-visible=yes`, `true` ถ้า `no`)

- [ ] **Step 1: เพิ่ม userConfig และ contract ของ state**

แก้ `plugins/forge/.claude-plugin/plugin.json` (ใส่ default ตามผล S5 ใน `docs/spikes/2026-10-results.md`):

```json
{
	"name": "forge",
	"version": "0.1.0",
	"description": "บังคับกฎของ repo และบทเรียนที่เคยพลาด ก่อนคำสั่งจะรัน",
	"types": "./types/index.d.ts",
	"userConfig": {
		"rewriteAsDeny": {
			"type": "boolean",
			"title": "แก้คำสั่งแทนการบล็อก",
			"description": "เปิด = กฎ rewrite จะบล็อกและบอกคำสั่งที่ถูกแทนการแก้ให้เอง",
			"default": false
		}
	}
}
```

ถ้า `claude plugin validate` บอกว่า schema ของ `userConfig` ต่างจากนี้ ให้แก้ตามข้อความของ validate (ไม่เปลี่ยนชื่อ field `rewriteAsDeny`)

`plugins/forge/types/index.d.ts`:

```ts
export type HitRecord = {
	ruleId: string
	tool: string
	kind: 'deny' | 'rewrite' | 'warn'
	at: number
	summary: string
}

declare module 'claude-code' {
	interface PluginState {
		forge: { allowOnce: string[]; hits: HitRecord[]; warned: string[] }
	}
}
```

`plugins/forge/hooks/state.ts`:

```ts
import { atom } from 'claude-code'

import type { HitRecord } from '../types'

export const allowOnceAtom = atom({ plugin: 'forge', key: 'allowOnce' } as const, [] as string[])
export const hitsAtom = atom({ plugin: 'forge', key: 'hits' } as const, [] as HitRecord[])
export const warnedAtom = atom({ plugin: 'forge', key: 'warned' } as const, [] as string[])
```

`plugins/forge/hooks/checks/types.ts`:

```ts
import type { EngineInterface } from 'claude-code'

import type { Rule, ToolInput, Vars, Verdict } from '../types'

export type CheckContext = {
	$: EngineInterface
	rule: Rule
	tool: string
	value: string
	input: ToolInput
	vars: Vars
}

export type Check = {
	run(ctx: CheckContext): Promise<Verdict>
	validate(params: unknown): string[]
}
```

`plugins/forge/hooks/checks/index.ts`:

```ts
import type { Check } from './types'

export const CHECKS: Readonly<Record<string, Check>> = {}

export const CHECK_NAMES: ReadonlySet<string> = new Set(Object.keys(CHECKS))

export function validateCheckParams(check: string, params: unknown): string[] {
	const found = CHECKS[check]
	return found === undefined ? [`ไม่รู้จัก check "${check}"`] : found.validate(params)
}
```

`plugins/forge/hooks/builtin.ts` (Task 7 เติม):

```ts
import type { Rule } from './types'

export const BUILTIN_RULES: readonly Rule[] = []
```

- [ ] **Step 2: เขียนเทสต์ engine ที่ล้ม**

`plugins/forge/tests/helpers.ts`:

```ts
import type { On } from 'claude-code'

export type World = {
	cwd?: string
	cwdThrows?: boolean
	root?: string | null
	files?: Record<string, string>
	run?: (argv: readonly string[]) => { exitCode: number; stdout: string; stderr?: string } | undefined
	fetch?: (url: string) => { status: number; text: string }
	toasts?: string[]
	ran?: string[]
}

// แทน engine ใต้ plugin: git root, ไฟล์, process, http, toast และ Bash ที่ "รันจริง"
export function world(on: On, w: World): void {
	const cwd = w.cwd ?? '/repo'
	const root = w.root === undefined ? '/repo' : w.root
	on('session.cwd', () => {
		if (w.cwdThrows === true) throw new Error('boom')
		return cwd
	})
	on('process.run', ($, e) => {
		const custom = w.run?.(e.argv)
		const res =
			custom ??
			(e.argv.join(' ') === 'git rev-parse --show-toplevel'
				? {
						exitCode: root === null ? 128 : 0,
						stdout: root === null ? '' : `${root}\n`,
					}
				: { exitCode: 1, stdout: '' })
		return {
			exitCode: res.exitCode,
			stdout: res.stdout,
			stderr: res.stderr ?? '',
			isStdoutTruncated: false,
			isStderrTruncated: false,
		}
	})
	on('fs.exists', ($, e) => w.files?.[e.path] !== undefined)
	on('fs.read', ($, e) => {
		const text = w.files?.[e.path]
		if (text === undefined) throw new Error(`no file ${e.path}`)
		return text
	})
	on('http.fetch', ($, e) => {
		const res = w.fetch?.(e.url) ?? { status: 599, text: 'offline' }
		return {
			status: res.status,
			ok: res.status >= 200 && res.status < 300,
			headers: {},
			text: res.text,
		}
	})
	on('ui.toast', ($, e) => {
		w.toasts?.push(e.text)
	})
	on('ui.status', () => undefined)
	on('tool.call', { tool: 'Bash' }, ($, e) => {
		w.ran?.push(e.command)
		return { result: { stdout: 'ok', stderr: '', interrupted: false } }
	})
	on('tool.call', { tool: 'Read' }, () => ({
		result: {
			type: 'text',
			file: {
				filePath: '/x',
				content: '',
				numLines: 0,
				startLine: 1,
				totalLines: 0,
			},
		},
	}))
}

export function guardsAt(root: string, guards: unknown): Record<string, string> {
	return { [`${root}/.claude/guards.json`]: JSON.stringify(guards) }
}
```

ถ้า type ของผล `Read` ใน kit ต่างจากนี้ ให้ใช้ shape ตามที่ tsc บอก (เทสต์ใช้แค่ว่า Read ผ่านได้)

`plugins/forge/tests/engine.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { mergeRules } from '../hooks/engine'
import type { Rule } from '../hooks/types'

const rule = (id: string, why: string): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why,
	examples: { hit: [], miss: [] },
	enabled: true,
})

describe('mergeRules', () => {
	test('the first source wins on a duplicate id', () => {
		const merged = mergeRules([rule('a', 'repo')], [rule('a', 'builtin'), rule('b', 'builtin')])
		expect(merged.map((r) => `${r.id}:${r.why}`)).toEqual(['a:repo', 'b:builtin'])
	})
})
```

`plugins/forge/tests/tool-call.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { guardsAt, world } from './helpers'

const GUARDS = {
	vars: { baseBranch: 'origin/develop' },
	rules: [
		{
			id: 'no-x',
			tool: 'Bash',
			match: '^echo x$',
			action: 'deny',
			why: 'ห้าม echo x',
			examples: { hit: ['echo x'], miss: ['echo y'] },
		},
		{
			id: 'add-base',
			tool: 'Bash',
			match: '^(git checkout -b \\S+)$',
			action: 'rewrite',
			rewrite: '$1 {baseBranch}',
			why: 'แตกจากฐาน',
			examples: {
				hit: ['git checkout -b a'],
				miss: ['git checkout -b a origin/develop'],
			},
		},
		{
			id: 'warn-y',
			tool: 'Bash',
			match: '^echo y$',
			action: 'warn',
			why: 'ระวัง echo y',
			examples: { hit: ['echo y'], miss: [] },
		},
	],
}

describe('tool.call', () => {
	test('deny stops the command and names the rule', async ($, on) => {
		const ran: string[] = []
		world(on, { files: guardsAt('/repo', GUARDS), ran })
		const res = await $.tool.call({ tool: 'Bash', command: 'echo x' })
		expect(res.isError).toBe(true)
		expect(res.text).toContain('no-x')
		expect(ran).toEqual([])
	})

	test('rewrite changes what runs and tells the model', async ($, on) => {
		const ran: string[] = []
		const toasts: string[] = []
		world(on, { files: guardsAt('/repo', GUARDS), ran, toasts })
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'git checkout -b a',
		})
		expect(ran).toEqual(['git checkout -b a origin/develop'])
		expect(res.context?.join('\n')).toContain('แก้คำสั่งเป็น')
		expect(toasts.some((t) => t.includes('add-base'))).toBe(true)
	})

	test('warn runs the command, toasts and tells the model', async ($, on) => {
		const ran: string[] = []
		const toasts: string[] = []
		world(on, { files: guardsAt('/repo', GUARDS), ran, toasts })
		const res = await $.tool.call({ tool: 'Bash', command: 'echo y' })
		expect(ran).toEqual(['echo y'])
		expect(res.context?.join('\n')).toContain('ระวัง echo y')
		expect(toasts.length).toBe(1)
	})

	test('outside a repo only builtin rules apply and nothing breaks', async ($, on) => {
		const ran: string[] = []
		world(on, { root: null, ran })
		await $.tool.call({ tool: 'Bash', command: 'echo x' })
		expect(ran).toEqual(['echo x'])
	})

	test('broken guards.json toasts once per session and keeps working', async ($, on) => {
		const ran: string[] = []
		const toasts: string[] = []
		world(on, {
			files: { '/repo/.claude/guards.json': '{ nope' },
			ran,
			toasts,
		})
		await $.tool.call({ tool: 'Bash', command: 'echo 1' })
		await $.tool.call({ tool: 'Bash', command: 'echo 2' })
		expect(ran).toEqual(['echo 1', 'echo 2'])
		expect(toasts.filter((t) => t.includes('guards.json')).length).toBe(1)
	})

	test('a failing guard denies Bash but lets Read through', async ($, on) => {
		world(on, { files: guardsAt('/repo', GUARDS), cwdThrows: true })
		const bash = await $.tool.call({ tool: 'Bash', command: 'echo ok' })
		expect(bash.isError).toBe(true)
		expect(bash.text).toContain('forge')
		const read = await $.tool.call({ tool: 'Read', file_path: '/x' })
		expect(read.isError).not.toBe(true)
	})
})
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `../hooks/engine` ยังไม่มี และ tool.call ยังไม่ถูกดัก

- [ ] **Step 4: เขียน engine**

`plugins/forge/hooks/engine.ts`:

```ts
import type { EngineInterface } from 'claude-code'

import type { HitRecord } from '../types'
import { CHECKS } from './checks/index'
import { applies, judge, PASS, triggers } from './match'
import type { Rule, ToolInput, Vars, Verdict } from './types'

export type Outcome = {
	deny?: { ruleId: string; message: string }
	input: ToolInput
	notes: string[]
	warns: string[]
	hits: HitRecord[]
	consumed: string[]
}

export function mergeRules(...sources: readonly (readonly Rule[])[]): Rule[] {
	const seen = new Set<string>()
	const out: Rule[] = []
	for (const source of sources) {
		for (const rule of source) {
			if (seen.has(rule.id)) continue
			seen.add(rule.id)
			out.push(rule)
		}
	}
	return out
}

async function verdictFor(
	$: EngineInterface,
	rule: Rule,
	tool: string,
	value: string,
	input: ToolInput,
	vars: Vars
): Promise<Verdict> {
	if (rule.check === undefined) return judge(rule, value, vars)
	if (!triggers(rule, value)) return PASS
	const check = CHECKS[rule.check]
	if (check === undefined)
		return {
			kind: 'deny',
			ruleId: rule.id,
			message: `ไม่รู้จัก check "${rule.check}"`,
		}
	return check.run({ $, rule, tool, value, input, vars })
}

export async function runRules(
	$: EngineInterface,
	rules: readonly Rule[],
	tool: string,
	start: ToolInput,
	vars: Vars,
	allowed: ReadonlySet<string>,
	now: number
): Promise<Outcome> {
	let input = start
	const out: Outcome = { input, notes: [], warns: [], hits: [], consumed: [] }
	for (const rule of rules) {
		if (!applies(rule, tool, input, vars)) continue
		const value = input[rule.field]
		if (typeof value !== 'string') continue
		const verdict = await verdictFor($, rule, tool, value, input, vars)
		if (verdict.kind === 'pass') continue
		if (allowed.has(rule.id) && !out.consumed.includes(rule.id)) {
			out.consumed.push(rule.id)
			out.notes.push(`ยกเว้นกฎ ${rule.id} ครั้งนี้ตามที่ผู้ใช้สั่ง (/guards allow)`)
			continue
		}
		const summary = verdict.kind === 'rewrite' ? verdict.note : verdict.message
		out.hits.push({
			ruleId: rule.id,
			tool,
			kind: verdict.kind,
			at: now,
			summary,
		})
		if (verdict.kind === 'deny') {
			out.deny = { ruleId: rule.id, message: verdict.message }
			out.input = input
			return out
		}
		if (verdict.kind === 'rewrite') {
			input = { ...input, [rule.field]: verdict.value }
			out.notes.push(verdict.note)
		} else {
			out.notes.push(`${rule.id}: ${verdict.message}`)
			out.warns.push(`${rule.id}: ${verdict.message}`)
		}
	}
	out.input = input
	return out
}
```

- [ ] **Step 5: ต่อเข้ากับ register.ts**

`plugins/forge/hooks/register.ts`:

```ts
import { read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { BUILTIN_RULES } from './builtin'
import { CHECK_NAMES, validateCheckParams } from './checks/index'
import { GUARDS_FILE, loadRepoConfig } from './config'
import { mergeRules, runRules } from './engine'
import { allowOnceAtom, hitsAtom, warnedAtom } from './state'
import type { ToolInput } from './types'

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite'])

async function warnConfigOnce($: EngineInterface, errors: readonly string[]): Promise<void> {
	const seen = await read($, warnedAtom)
	const fresh = errors.filter((e) => !seen.includes(e))
	if (fresh.length === 0) return
	await update($, warnedAtom, (list) => [...list, ...fresh])
	void $.ui.toast(`forge: ${GUARDS_FILE} มีปัญหา ${fresh.length} จุด ใช้กฎที่เหลือต่อ · ${fresh[0] ?? ''}`)
}

export const register: Register = (on, options) => {
	const rewriteAsDeny = options['rewriteAsDeny'] === true

	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: 'guards',
			description: 'ดูกฎที่ทำงานอยู่และสิ่งที่ถูกดัก หรือยกเว้นกฎครั้งเดียว (/guards allow <id>)',
		})
		return next(e)
	})

	on('tool.call', async ($, e, next) => {
		const repo = await loadRepoConfig($, CHECK_NAMES, validateCheckParams)
		if (repo.errors.length > 0) await warnConfigOnce($, repo.errors)
		const rules = mergeRules(repo.rules, BUILTIN_RULES)
		const allowed = new Set(await read($, allowOnceAtom))
		const input = e as unknown as ToolInput
		const out = await runRules($, rules, e.tool, input, repo.vars, allowed, await $.clock.now())

		if (out.consumed.length > 0)
			await update($, allowOnceAtom, (list) => list.filter((id) => !out.consumed.includes(id)))
		if (out.hits.length > 0) await update($, hitsAtom, (list) => [...list, ...out.hits].slice(-100))

		if (out.deny !== undefined) {
			return { deny: `[forge · ${out.deny.ruleId}] ${out.deny.message}` }
		}
		const rewrites = out.hits.filter((h) => h.kind === 'rewrite')
		if (rewriteAsDeny && rewrites.length > 0) {
			const first = rules.find((r) => r.id === rewrites[0]?.ruleId)
			const fixed = first === undefined ? '' : String(out.input[first.field] ?? '')
			return { deny: `[forge] ใช้คำสั่งนี้แทน: ${fixed} · ${rewrites.map((r) => r.summary).join(' · ')}` }
		}
		}
		for (const r of rewrites) void $.ui.toast(`forge แก้คำสั่ง (${r.ruleId})`)
		for (const w of out.warns) void $.ui.toast(`forge: ${w}`)

		const ran = await next(out.input as typeof e)
		if (out.notes.length === 0 || ran.deny !== undefined) return ran
		return {
			...ran,
			context: [...(ran.context ?? []), ...out.notes.map((n) => `[forge] ${n}`)],
		}
	}).catch(($, e, next) => {
		if (next.called) return next(e)
		if (READ_ONLY.has(e.tool)) return next(e)
		return {
			deny: 'forge: ตัวตรวจกฎล้มเหลว จึงไม่รันคำสั่งนี้ · พิมพ์ /guards เพื่อดูสถานะ หรือรัน claude --debug เพื่อดูสาเหตุ',
		}
	})
}
```

- [ ] **Step 6: รันเทสต์ให้ผ่าน + typecheck**

Run: `claude plugin test plugins/forge && bash scripts/check.sh`
Expected: PASS ทุกไฟล์; tsc ไม่มี error (ถ้ายังไม่มี types dir ให้โหลดด้วย `/reload-plugins` ใน session ที่ติดตั้ง forge แล้วรันใหม่)

- [ ] **Step 7: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): rule engine on tool.call with allow-once, hits and fail-closed guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: กฎ JSON ในตัว (ทุก repo)

**Files:**

- Modify: `plugins/forge/hooks/builtin.ts`
- Test: `plugins/forge/tests/builtin.test.ts`

**Interfaces:**

- Consumes: `Rule` (Task 3), `validateRule` (Task 4), `CHECK_NAMES` (Task 6)
- Produces: `BUILTIN_RULES` มี `named-stash` (deny) และ `branch-base` (rewrite, requires `baseBranch`); Task 8 เติมกฎ check

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/builtin.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { BUILTIN_RULES } from '../hooks/builtin'
import { CHECK_NAMES } from '../hooks/checks/index'
import { judge } from '../hooks/match'
import { validateRule } from '../hooks/safety'

const vars = { baseBranch: 'origin/develop', repoRoot: '/r' }
const rule = (id: string) => {
	const found = BUILTIN_RULES.find((r) => r.id === id)
	if (found === undefined) throw new Error(`missing ${id}`)
	return found
}

describe('builtin rules', () => {
	test('every builtin rule validates', () => {
		for (const r of BUILTIN_RULES) expect(validateRule(r, vars, CHECK_NAMES)).toEqual([])
	})

	test('named-stash catches bare stash anywhere in a chain', () => {
		const r = rule('named-stash')
		for (const cmd of [
			'git stash',
			'git stash pop',
			'git stash push -u',
			'cd apps/web && git stash',
			'FOO=1 git stash',
		]) {
			expect(judge(r, cmd, vars).kind).toBe('deny')
		}
		for (const cmd of [
			'git stash push -u -m "wip-x"',
			'git stash list',
			'git stash apply 3f2a1b',
			'git status',
			'git stash drop stash@{2}',
		]) {
			expect(judge(r, cmd, vars).kind).toBe('pass')
		}
	})

	test('branch-base appends the base once', () => {
		const r = rule('branch-base')
		expect(judge(r, 'git checkout -b fix/a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'git checkout -b fix/a origin/develop',
		})
		expect(judge(r, 'git switch -c fix/a', vars)).toMatchObject({
			kind: 'rewrite',
			value: 'git switch -c fix/a origin/develop',
		})
		expect(judge(r, 'git checkout -b fix/a origin/develop', vars).kind).toBe('pass')
		expect(judge(r, 'git checkout -b fix/a main', vars).kind).toBe('pass')
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `missing named-stash`

- [ ] **Step 3: เขียนกฎ**

`plugins/forge/hooks/builtin.ts`:

```ts
import type { Rule } from './types'

export const BUILTIN_RULES: readonly Rule[] = [
	{
		id: 'named-stash',
		tools: ['Bash'],
		field: 'command',
		match: '(?:^|[;&|]\\s*|\\s)git\\s+stash(?:\\s+(?:push|pop|save))?(?=\\s|$)',
		unless: '\\s(?:-m|--message)[\\s=]|git\\s+stash\\s+(?:list|show|apply\\s+\\S|drop\\s+\\S|branch\\s)',
		action: 'deny',
		why: 'stash stack ใช้ร่วมกับทุก worktree และทุก session อาจไปหยิบงานของคนอื่น',
		hint: 'ใช้ WIP commit หรือ git stash push -u -m "<tag>" แล้วจด SHA ไว้ apply ด้วย SHA',
		examples: {
			hit: ['git stash', 'git stash pop', 'cd x && git stash'],
			miss: ['git stash push -u -m "wip-x"', 'git stash list', 'git stash apply 3f2a1b'],
		},
		enabled: true,
	},
	{
		id: 'branch-base',
		tools: ['Bash'],
		field: 'command',
		match: '^(\\s*git\\s+(?:checkout\\s+-b|switch\\s+-c)\\s+\\S+)\\s*$',
		requires: ['baseBranch'],
		action: 'rewrite',
		rewrite: '$1 {baseBranch}',
		why: 'branch ใหม่ต้องแตกจากฐานของ repo ไม่ใช่จาก branch ที่อยู่ตอนนี้',
		examples: {
			hit: ['git checkout -b fix/a', 'git switch -c fix/a'],
			miss: ['git checkout -b fix/a origin/develop', 'git checkout main'],
		},
		enabled: true,
	},
]
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/forge/hooks/builtin.ts plugins/forge/tests/builtin.test.ts
git commit -m "feat(forge): builtin named-stash and branch-base rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: check ในตัว: secret, vitest-concurrent, pr-head-rename

**Files:**

- Create: `plugins/forge/hooks/checks/secret.ts`, `plugins/forge/hooks/checks/vitest-concurrent.ts`, `plugins/forge/hooks/checks/pr-head-rename.ts`
- Modify: `plugins/forge/hooks/checks/index.ts`, `plugins/forge/hooks/builtin.ts`
- Test: `plugins/forge/tests/checks-local.test.ts`

**Interfaces:**

- Consumes: `Check`, `CheckContext` (Task 6), `PASS` (Task 3)
- Produces: `CHECKS.secret`, `CHECKS['vitest-concurrent']`, `CHECKS['pr-head-rename']`; กฎในตัว `secret-edit` (Edit · `new_string`), `secret-write` (Write · `content`), `vitest-concurrent` (Bash), `pr-head-rename` (Bash)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/checks-local.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { world } from './helpers'

describe('secret', () => {
	test('denies a private key or password in an edit', async ($, on) => {
		world(on, {})
		const key = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/src/a.ts',
			content: '-----BEGIN RSA PRIVATE KEY-----\nabc',
		})
		expect(key.isError).toBe(true)
		expect(key.text).toContain('private key')
		const conn = await $.tool.call({
			tool: 'Edit',
			file_path: '/repo/appsettings.json',
			old_string: 'a',
			new_string: '"Mongo": "mongodb://admin:hunter22@db:27017"',
		})
		expect(conn.isError).toBe(true)
	})
	test('placeholders, example files and .env are allowed', async ($, on) => {
		world(on, {})
		on('tool.call', { tool: 'Write' }, () => ({
			result: {
				type: 'create',
				filePath: '/x',
				content: '',
				structuredPatch: [],
			},
		}))
		const placeholder = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/a.json',
			content: 'Password=${DB_PASS}',
		})
		expect(placeholder.isError).not.toBe(true)
		const example = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/.env.example',
			content: 'KEY=sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
		})
		expect(example.isError).not.toBe(true)
		const env = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/.env',
			content: 'KEY=sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
		})
		expect(env.isError).not.toBe(true)
	})
})

describe('vitest-concurrent', () => {
	test('denies a second vitest while one runs', async ($, on) => {
		world(on, {
			run: (argv) => (argv[0] === 'pgrep' ? { exitCode: 0, stdout: '48211\n' } : undefined),
		})
		const res = await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
		expect(res.isError).toBe(true)
		expect(res.text).toContain('48211')
	})
	test('runs when no vitest is running', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			run: (argv) => (argv[0] === 'pgrep' ? { exitCode: 1, stdout: '' } : undefined),
		})
		await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
		expect(ran).toEqual(['npx vitest run'])
	})
})

describe('pr-head-rename', () => {
	test('denies renaming a branch that heads an open PR', async ($, on) => {
		world(on, {
			run: (argv) => (argv[0] === 'gh' ? { exitCode: 0, stdout: '18923\n' } : undefined),
		})
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'git branch -m feature/chat feature/chat-v2',
		})
		expect(res.isError).toBe(true)
		expect(res.text).toContain('18923')
	})
	test('one-arg rename looks up the current branch', async ($, on) => {
		const asked: string[] = []
		world(on, {
			run: (argv) => {
				if (argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') return { exitCode: 0, stdout: 'feature/chat\n' }
				if (argv[0] === 'gh') {
					asked.push(argv.join(' '))
					return { exitCode: 0, stdout: '' }
				}
				return undefined
			},
		})
		await $.tool.call({
			tool: 'Bash',
			command: 'git branch -m feature/chat-v2',
		})
		expect(asked[0]).toContain('--head feature/chat')
	})
	test('gh failure warns instead of hanging or blocking', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			run: (argv) => (argv[0] === 'gh' ? { exitCode: 4, stdout: '', stderr: 'gh: not logged in' } : undefined),
		})
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'git branch -m a b',
		})
		expect(ran).toEqual(['git branch -m a b'])
		expect(res.context?.join('\n')).toContain('not logged in')
	})
})
```

ถ้า shape ผลของ `Write` ใน kit ต่างจากนี้ ให้ใช้ shape ที่ tsc บอก (เทสต์ใช้แค่ว่าผ่านได้)

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — คำสั่งผ่านหมดเพราะยังไม่มี check

- [ ] **Step 3: เขียน check**

`plugins/forge/hooks/checks/secret.ts`:

```ts
import { PASS } from '../match'
import type { Check } from './types'

const PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
	['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
	['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
	['API key แบบ sk-', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/],
	['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
	['Slack token', /\bxox[abpr]-[A-Za-z0-9-]{10,}/],
	[
		'connection string ที่มีรหัสผ่าน',
		/\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis|amqps?):\/\/[^:\s/]+:(?![$<{%])[^@\s]{3,}@/,
	],
	['รหัสผ่านใน connection string', /\b(?:Password|Pwd)=(?![$<{%])[^;"'\s]{4,}/i],
]

export const secret: Check = {
	async run({ rule, value }) {
		for (const [label, pattern] of PATTERNS) {
			if (pattern.test(value)) {
				return {
					kind: 'deny',
					ruleId: rule.id,
					message: `พบ ${label} ในเนื้อหาที่จะเขียน ให้เก็บใน secret store (Key Vault, user-secrets หรือ .env ที่ไม่ commit) แล้วอ้างผ่าน config`,
				}
			}
		}
		return PASS
	},
	validate: () => [],
}
```

`plugins/forge/hooks/checks/vitest-concurrent.ts`:

```ts
import { PASS } from '../match'
import type { Check } from './types'

export const vitestConcurrent: Check = {
	async run({ $, rule }) {
		const res = await $.process.run(['pgrep', '-f', 'vitest'])
		if (res.exitCode !== 0) return PASS
		const pids = res.stdout.trim().split('\n').filter(Boolean)
		if (pids.length === 0) return PASS
		return {
			kind: 'deny',
			ruleId: rule.id,
			message: `vitest อีกตัวยังรันอยู่ (pid ${pids.join(', ')}) รันซ้อนแล้วเคสที่ใช้เวลานานจะ timeout · รอให้จบก่อน หรือถ้าเป็น watch ของ editor ให้ผู้ใช้พิมพ์ /guards allow ${rule.id}`,
		}
	},
	validate: () => [],
}
```

`plugins/forge/hooks/checks/pr-head-rename.ts`:

```ts
import { PASS } from '../match'
import type { Check } from './types'

function renameTargets(command: string): string[] {
	const m = /git\s+branch\s+(?:-m|-M|--move)\s+(.*)$/.exec(command)
	return (m?.[1] ?? '').split(/\s+/).filter((t) => t.length > 0 && !t.startsWith('-'))
}

export const prHeadRename: Check = {
	async run({ $, rule, value, vars }) {
		const args = renameTargets(value)
		const cwd = vars['repoRoot']
		let old = args.length >= 2 ? args[0] : undefined
		if (old === undefined) {
			const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], { cwd })
			old = head.exitCode === 0 ? head.stdout.trim() : undefined
		}
		if (old === undefined || old === '') return PASS
		const prs = await $.process.run(
			['gh', 'pr', 'list', '--head', old, '--state', 'open', '--json', 'number', '--jq', '.[].number'],
			{ cwd }
		)
		if (prs.exitCode !== 0) {
			return {
				kind: 'warn',
				ruleId: rule.id,
				message: `เช็ก PR ของ branch ${old} ไม่ได้ (${prs.stderr.trim().slice(0, 120)}) ถ้า branch นี้มี PR เปิดอยู่ การ rename จะทำให้ GitHub ปิด PR`,
			}
		}
		const numbers = prs.stdout.trim().split('\n').filter(Boolean)
		if (numbers.length === 0) return PASS
		return {
			kind: 'deny',
			ruleId: rule.id,
			message: `branch ${old} เป็น head ของ PR #${numbers.join(', #')} ถ้า rename GitHub จะปิด PR · ทำงานต่อบน branch เดิม`,
		}
	},
	validate: () => [],
}
```

แก้ `plugins/forge/hooks/checks/index.ts`:

```ts
import { prHeadRename } from './pr-head-rename'
import { secret } from './secret'
import type { Check } from './types'
import { vitestConcurrent } from './vitest-concurrent'

export const CHECKS: Readonly<Record<string, Check>> = {
	secret,
	'vitest-concurrent': vitestConcurrent,
	'pr-head-rename': prHeadRename,
}

export const CHECK_NAMES: ReadonlySet<string> = new Set(Object.keys(CHECKS))

export function validateCheckParams(check: string, params: unknown): string[] {
	const found = CHECKS[check]
	return found === undefined ? [`ไม่รู้จัก check "${check}"`] : found.validate(params)
}
```

เพิ่มท้าย `BUILTIN_RULES` ใน `plugins/forge/hooks/builtin.ts`:

```ts
	{
		id: 'secret-edit',
		tools: ['Edit'],
		field: 'new_string',
		check: 'secret',
		exceptPaths: ['**/*.example*', '**/*.sample*', '**/.env', '**/.env.*'],
		action: 'deny',
		why: 'ห้ามเขียน secret ลงไฟล์',
		examples: { hit: [], miss: [] },
		enabled: true,
	},
	{
		id: 'secret-write',
		tools: ['Write'],
		field: 'content',
		check: 'secret',
		exceptPaths: ['**/*.example*', '**/*.sample*', '**/.env', '**/.env.*'],
		action: 'deny',
		why: 'ห้ามเขียน secret ลงไฟล์',
		examples: { hit: [], miss: [] },
		enabled: true,
	},
	{
		id: 'vitest-concurrent',
		tools: ['Bash'],
		field: 'command',
		match: '\\bvitest\\b',
		unless: '\\bvitest\\s+(?:list|--version)\\b',
		check: 'vitest-concurrent',
		action: 'deny',
		why: 'ห้ามรัน vitest ซ้อนกัน',
		examples: { hit: [], miss: [] },
		enabled: true,
	},
	{
		id: 'pr-head-rename',
		tools: ['Bash'],
		field: 'command',
		match: 'git\\s+branch\\s+(?:-m|-M|--move)\\b',
		check: 'pr-head-rename',
		action: 'deny',
		why: 'ห้าม rename branch ที่เป็น head ของ PR',
		examples: { hit: [], miss: [] },
		enabled: true,
	},
```

หมายเหตุ: `exceptPaths` ใช้ glob ที่ `**/.env` ต้องจับ `.env` ที่ราก repo ด้วย — `globToRegExp('**/.env')` ให้ `^.*\.env$` ซึ่งจับ `.env` ได้ (ทดสอบแล้วในเทสต์ `.env` ด้านบน)

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS ทั้งไฟล์ใหม่และไฟล์เดิม (`builtin.test.ts` ยืนยันว่ากฎ check ใหม่ validate ผ่าน)

- [ ] **Step 5: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): secret, vitest-concurrent and pr-head-rename checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: check ที่ตั้งค่าได้: version-bumped, cost-estimate

**Files:**

- Create: `plugins/forge/hooks/checks/version-bumped.ts`, `plugins/forge/hooks/checks/cost-estimate.ts`
- Modify: `plugins/forge/hooks/checks/index.ts`
- Test: `plugins/forge/tests/checks-config.test.ts`

**Interfaces:**

- Consumes: `Check` (Task 6)
- Produces:
  - `version-bumped` params `{ versionFile: string; versionUrl: string; field?: string }` (field ค่าเริ่มต้น `version`)
  - `cost-estimate` params `{ estimateBaht: number; maxBaht: number; paidPattern?: string }`
  - ทั้งสองใช้ได้จาก `guards.json` เท่านั้น (ไม่อยู่ใน `BUILTIN_RULES`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/checks-config.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { validateCheckParams } from '../hooks/checks/index'
import { guardsAt, world } from './helpers'

const VERSION_RULE = {
	id: 'prod-version',
	tool: 'Bash',
	match: 'deploy-environment=PROD',
	check: 'version-bumped',
	params: {
		versionFile: 'VERSION',
		versionUrl: 'https://api.acme.example/api/v1/version',
	},
	action: 'deny',
	why: 'bump version ก่อน deploy PROD',
}
const COST_RULE = {
	id: 'eval-cost',
	tool: 'Bash',
	match: 'evals/run\\.py',
	check: 'cost-estimate',
	params: { estimateBaht: 20, maxBaht: 100, paidPattern: '--allow-paid-judge' },
	action: 'deny',
	why: 'ประมาณค่าใช้จ่ายก่อนรัน eval',
}
const DEPLOY = 'gh workflow run api.yaml --ref main -f deploy-environment=PROD'

describe('version-bumped', () => {
	test('denies when the local version equals the running one', async ($, on) => {
		world(on, {
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.1\n',
			},
			fetch: () => ({
				status: 200,
				text: '{"version":"1.5.1","commit":"abc"}',
			}),
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.isError).toBe(true)
		expect(res.text).toContain('1.5.1')
	})
	test('passes when bumped', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.2',
			},
			fetch: () => ({ status: 200, text: '{"version":"1.5.1"}' }),
		})
		await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(ran).toEqual([DEPLOY])
	})
	test('an unreachable version endpoint denies with the reason', async ($, on) => {
		world(on, {
			files: {
				...guardsAt('/repo', { rules: [VERSION_RULE] }),
				'/repo/VERSION': '1.5.2',
			},
		})
		const res = await $.tool.call({ tool: 'Bash', command: DEPLOY })
		expect(res.isError).toBe(true)
		expect(res.text).toContain('599')
	})
	test('params are required', () => {
		expect(validateCheckParams('version-bumped', {}).length).toBe(2)
	})
})

describe('cost-estimate', () => {
	test('warns with the estimate under the cap', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, files: guardsAt('/repo', { rules: [COST_RULE] }) })
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py --phase p6c',
		})
		expect(ran.length).toBe(1)
		expect(res.context?.join('\n')).toContain('20 บาท')
	})
	test('denies a paid option', async ($, on) => {
		world(on, { files: guardsAt('/repo', { rules: [COST_RULE] }) })
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py --allow-paid-judge',
		})
		expect(res.isError).toBe(true)
		expect(res.text).toContain('/guards allow eval-cost')
	})
	test('denies over the cap', async ($, on) => {
		world(on, {
			files: guardsAt('/repo', {
				rules: [{ ...COST_RULE, params: { estimateBaht: 300, maxBaht: 100 } }],
			}),
		})
		const res = await $.tool.call({
			tool: 'Bash',
			command: 'uv run python evals/run.py',
		})
		expect(res.isError).toBe(true)
	})
	test('params are validated', () => {
		expect(validateCheckParams('cost-estimate', { estimateBaht: 'x', maxBaht: 1 })).toContain(
			'params.estimateBaht ต้องเป็นตัวเลข'
		)
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — guards.json มี check ที่ไม่รู้จัก กฎถูกทิ้ง คำสั่งผ่านหมด

- [ ] **Step 3: เขียน check**

`plugins/forge/hooks/checks/version-bumped.ts`:

```ts
import { PASS } from '../match'
import type { Check } from './types'

type Params = { versionFile: string; versionUrl: string; field: string }

function parse(params: unknown): Params | undefined {
	if (typeof params !== 'object' || params === null) return undefined
	const p = params as Record<string, unknown>
	if (typeof p['versionFile'] !== 'string' || typeof p['versionUrl'] !== 'string') return undefined
	return {
		versionFile: p['versionFile'],
		versionUrl: p['versionUrl'],
		field: typeof p['field'] === 'string' ? p['field'] : 'version',
	}
}

export const versionBumped: Check = {
	async run({ $, rule, vars }) {
		const params = parse(rule.params)
		const root = vars['repoRoot']
		if (params === undefined || root === undefined)
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: 'ตั้งค่า version-bumped ไม่ครบ',
			}
		const allow = `ถ้าแน่ใจ ให้ผู้ใช้พิมพ์ /guards allow ${rule.id}`
		const localText = await $.fs.read(`${root}/${params.versionFile}`)
		const local = typeof localText === 'string' ? localText.trim() : ''
		let running: unknown
		try {
			const res = await $.http.fetch(params.versionUrl)
			if (!res.ok)
				return {
					kind: 'deny',
					ruleId: rule.id,
					message: `ถาม version ที่รันอยู่ไม่ได้ (HTTP ${res.status} จาก ${params.versionUrl}) · ${allow}`,
				}
			const body: unknown = JSON.parse(res.text)
			running = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)[params.field] : undefined
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err)
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `ถาม version ที่รันอยู่ไม่ได้ (${reason}) · ${allow}`,
			}
		}
		if (typeof running !== 'string')
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `${params.versionUrl} ไม่มี field "${params.field}" · ${allow}`,
			}
		if (local !== running) return PASS
		return {
			kind: 'deny',
			ruleId: rule.id,
			message: `${params.versionFile} = ${local} เท่ากับที่รันอยู่ ต้อง bump ก่อน deploy · ถามผู้ใช้ว่า patch, minor หรือ major`,
		}
	},
	validate(params) {
		const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
		const errors: string[] = []
		if (typeof p['versionFile'] !== 'string') errors.push('params.versionFile ต้องเป็นข้อความ')
		if (typeof p['versionUrl'] !== 'string' || !p['versionUrl'].startsWith('https://'))
			errors.push('params.versionUrl ต้องเป็น https URL')
		return errors
	},
}
```

`plugins/forge/hooks/checks/cost-estimate.ts`:

```ts
import type { Check } from './types'

type Params = { estimateBaht: number; maxBaht: number; paidPattern?: string }

function parse(params: unknown): Params | undefined {
	if (typeof params !== 'object' || params === null) return undefined
	const p = params as Record<string, unknown>
	if (typeof p['estimateBaht'] !== 'number' || typeof p['maxBaht'] !== 'number') return undefined
	return {
		estimateBaht: p['estimateBaht'],
		maxBaht: p['maxBaht'],
		paidPattern: typeof p['paidPattern'] === 'string' ? p['paidPattern'] : undefined,
	}
}

export const costEstimate: Check = {
	async run({ rule, value }) {
		const p = parse(rule.params)
		if (p === undefined)
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: 'ตั้งค่า cost-estimate ไม่ครบ',
			}
		const ask = `บอกผู้ใช้ค่าใช้จ่ายโดยประมาณ แล้วให้ผู้ใช้พิมพ์ /guards allow ${rule.id} ถ้าจะรันต่อ`
		const paid = p.paidPattern === undefined ? null : new RegExp(p.paidPattern).exec(value)
		if (paid !== null) {
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `คำสั่งนี้ใช้ตัวเลือกที่เสียเงิน (${paid[0]}) ต้องให้ผู้ใช้ยืนยันก่อน · ${ask}`,
			}
		}
		if (p.estimateBaht > p.maxBaht) {
			return {
				kind: 'deny',
				ruleId: rule.id,
				message: `ประมาณค่าใช้จ่าย ~${p.estimateBaht} บาท เกินเพดาน ${p.maxBaht} บาท · ${ask}`,
			}
		}
		return {
			kind: 'warn',
			ruleId: rule.id,
			message: `ประมาณค่าใช้จ่าย ~${p.estimateBaht} บาท (ต่ำกว่าเพดาน ${p.maxBaht} บาท) · บอกผู้ใช้ด้วย`,
		}
	},
	validate(params) {
		const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
		const errors: string[] = []
		if (typeof p['estimateBaht'] !== 'number') errors.push('params.estimateBaht ต้องเป็นตัวเลข')
		if (typeof p['maxBaht'] !== 'number') errors.push('params.maxBaht ต้องเป็นตัวเลข')
		if (p['paidPattern'] !== undefined && typeof p['paidPattern'] !== 'string')
			errors.push('params.paidPattern ต้องเป็นข้อความ')
		return errors
	},
}
```

แก้ `CHECKS` ใน `plugins/forge/hooks/checks/index.ts` ให้เป็น:

```ts
import { costEstimate } from './cost-estimate'
import { prHeadRename } from './pr-head-rename'
import { secret } from './secret'
import type { Check } from './types'
import { versionBumped } from './version-bumped'
import { vitestConcurrent } from './vitest-concurrent'

export const CHECKS: Readonly<Record<string, Check>> = {
	secret,
	'vitest-concurrent': vitestConcurrent,
	'pr-head-rename': prHeadRename,
	'version-bumped': versionBumped,
	'cost-estimate': costEstimate,
}
```

(ส่วน `CHECK_NAMES` และ `validateCheckParams` คงเดิม)

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): configurable version-bumped and cost-estimate checks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: คำสั่ง `/guards`

**Files:**

- Create: `plugins/forge/hooks/commands.ts`
- Modify: `plugins/forge/hooks/register.ts`
- Test: `plugins/forge/tests/commands.test.ts`

**Interfaces:**

- Consumes: `Rule`, `RepoConfig` (Task 3), `HitRecord` (Task 6), atoms (Task 6)
- Produces:
  - `type GuardsInput = { args: string; originKind: string; rules: readonly Rule[]; hits: readonly HitRecord[]; errors: readonly string[]; root: string | null }`
  - `type GuardsAction = { text: string; allow?: string }`
  - `handleGuardsCommand(input: GuardsInput): GuardsAction` — pure

- [ ] **Step 1: เขียนเทสต์ที่ล้ม**

`plugins/forge/tests/commands.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { handleGuardsCommand } from '../hooks/commands'
import type { Rule } from '../hooks/types'

const rules: Rule[] = [
	{
		id: 'named-stash',
		tools: ['Bash'],
		field: 'command',
		match: 'x',
		action: 'deny',
		why: 'w',
		examples: { hit: [], miss: [] },
		enabled: true,
	},
]
const base = { rules, hits: [], errors: [], root: '/repo' }

describe('/guards', () => {
	test('summary lists rules, hits and config errors', () => {
		const out = handleGuardsCommand({
			...base,
			args: '',
			originKind: 'composer',
			hits: [
				{
					ruleId: 'named-stash',
					tool: 'Bash',
					kind: 'deny',
					at: 0,
					summary: 'stash',
				},
			],
			errors: ['rules ต้องเป็น array'],
		})
		expect(out.text).toContain('named-stash')
		expect(out.text).toContain('ดักไป 1 ครั้ง')
		expect(out.text).toContain('rules ต้องเป็น array')
		expect(out.allow).toBeUndefined()
	})
	test('allow from the person grants one exception', () => {
		const out = handleGuardsCommand({
			...base,
			args: 'allow named-stash',
			originKind: 'composer',
		})
		expect(out.allow).toBe('named-stash')
		expect(out.text).toContain('1 ครั้ง')
	})
	test('allow from anything but the person is refused', () => {
		for (const originKind of ['plugin', 'sdk', 'peer', 'scheduled-trigger']) {
			const out = handleGuardsCommand({
				...base,
				args: 'allow named-stash',
				originKind,
			})
			expect(out.allow).toBeUndefined()
			expect(out.text).toContain('ผู้ใช้ต้องพิมพ์เอง')
		}
	})
	test('allow of an unknown rule says so', () => {
		const out = handleGuardsCommand({
			...base,
			args: 'allow nope',
			originKind: 'composer',
		})
		expect(out.allow).toBeUndefined()
		expect(out.text).toContain('ไม่มีกฎ nope')
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `../hooks/commands` ยังไม่มี

- [ ] **Step 3: เขียนโค้ด**

`plugins/forge/hooks/commands.ts`:

```ts
import type { HitRecord } from '../types'
import type { Rule } from './types'

export type GuardsInput = {
	args: string
	originKind: string
	rules: readonly Rule[]
	hits: readonly HitRecord[]
	errors: readonly string[]
	root: string | null
}

export type GuardsAction = { text: string; allow?: string }

function summary(input: GuardsInput): string {
	const count = new Map<string, number>()
	for (const h of input.hits) count.set(h.ruleId, (count.get(h.ruleId) ?? 0) + 1)
	const lines = [`forge · repo: ${input.root ?? '(ไม่อยู่ใน git repo)'} · กฎ ${input.rules.length} ข้อ`]
	for (const r of input.rules) {
		const n = count.get(r.id) ?? 0
		lines.push(
			`  ${r.enabled ? '●' : '○'} ${r.id} (${r.action}${r.check === undefined ? '' : ` · ${r.check}`})${n > 0 ? ` · ดักไป ${n} ครั้ง` : ''}`
		)
	}
	const recent = input.hits.slice(-5)
	if (recent.length > 0) {
		lines.push('ล่าสุด:')
		for (const h of recent) lines.push(`  ${h.kind} ${h.ruleId}: ${h.summary.slice(0, 100)}`)
	}
	if (input.errors.length > 0) {
		lines.push('ปัญหาใน .claude/guards.json:')
		for (const e of input.errors) lines.push(`  ${e}`)
	}
	lines.push('ยกเว้นกฎครั้งเดียว: /guards allow <id>')
	return lines.join('\n')
}

export function handleGuardsCommand(input: GuardsInput): GuardsAction {
	const [verb, id] = input.args.trim().split(/\s+/)
	if (verb !== 'allow') return { text: summary(input) }
	if (input.originKind !== 'composer') return { text: 'ผู้ใช้ต้องพิมพ์เองที่ช่องพิมพ์ ยกเว้นกฎแทนผู้ใช้ไม่ได้' }
	if (id === undefined || !input.rules.some((r) => r.id === id))
		return {
			text: `ไม่มีกฎ ${id ?? '(ไม่ได้ระบุ)'} · พิมพ์ /guards เพื่อดูรายชื่อ`,
		}
	return {
		text: `ยกเว้นกฎ ${id} ได้ 1 ครั้ง (ครั้งถัดไปที่กฎนี้จะทำงาน)`,
		allow: id,
	}
}
```

เพิ่มใน `register.ts` หลัง hook `session.start` (และเพิ่ม import `handleGuardsCommand` จาก `./commands`):

```ts
on('command.run', { command: 'guards' }, async ($, e) => {
	const repo = await loadRepoConfig($, CHECK_NAMES, validateCheckParams)
	const action = handleGuardsCommand({
		args: e.args,
		originKind: e.origin.kind,
		rules: mergeRules(repo.rules, BUILTIN_RULES),
		hits: await read($, hitsAtom),
		errors: repo.errors,
		root: repo.root,
	})
	const allow = action.allow
	if (allow !== undefined) await update($, allowOnceAtom, (list) => [...list, allow])
	return { text: action.text }
})
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน + check ทั้งหมด**

Run: `claude plugin test plugins/forge && bash scripts/check.sh`
Expected: PASS ทั้งหมด

- [ ] **Step 5: ลองใน session จริง**

ใน session ที่ติดตั้ง forge แล้ว: `/reload-plugins` → พิมพ์ `/guards` เห็นกฎในตัว 6 ข้อ → ขอให้ Claude รัน `git stash` เห็นว่าถูกบล็อกพร้อมชื่อกฎ → `/guards allow named-stash` → ขอให้รัน `git stash list` แล้ว `git stash` อีกครั้งในโฟลเดอร์ทดลอง (ไม่ใช่ repo งาน) เห็นว่าผ่านครั้งเดียว จดผลลงข้อความ commit

- [ ] **Step 6: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): /guards summary and person-only allow-once

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `guards.json` ของ work-app (ใน repo งาน)

**Files (ใน repo work-app ไม่ใช่ claude-mods):**

- Create: `.claude/guards.json`

**Interfaces:**

- Consumes: รูปแบบไฟล์ (Task 5), checks `version-bumped`, `cost-estimate` (Task 9)

repo งานต้องตามขั้นตอนของทีม: แตก branch จาก `origin/develop`, commit `chore(infra): …`, เปิด PR เข้า develop

- [ ] **Step 1: สร้าง branch**

```bash
git -C <work-repo> fetch origin develop
git -C <work-repo> checkout -b chore/claude-guards origin/develop
```

(`<work-repo>` คือ checkout ของ repo งานที่ผู้ใช้ชี้ให้ ถามผู้ใช้ก่อนเริ่ม)

- [ ] **Step 2: เขียนไฟล์**

`.claude/guards.json`:

```json
{
	"vars": { "baseBranch": "origin/develop" },
	"rules": [
		{
			"id": "prod-ref-main",
			"tool": "Bash",
			"match": "gh\\s+workflow\\s+run\\b.*deploy-environment=PROD",
			"unless": "--ref[ =]main\\b",
			"action": "deny",
			"why": "PROD ต้อง dispatch จาก main หลัง merge develop → main (merge commit)",
			"hint": "merge develop → main ก่อน แล้วรันด้วย --ref main",
			"examples": {
				"hit": ["gh workflow run api.yaml --ref develop -f deploy-environment=PROD"],
				"miss": [
					"gh workflow run api.yaml --ref main -f deploy-environment=PROD",
					"gh workflow run api.yaml --ref develop -f deploy-environment=DEV"
				]
			}
		},
		{
			"id": "nonprod-ref-develop",
			"tool": "Bash",
			"match": "gh\\s+workflow\\s+run\\b.*deploy-environment=(DEV|UAT)",
			"unless": "--ref[ =]develop\\b",
			"action": "deny",
			"why": "DEV/UAT ต้องรันจาก develop ไม่ใช่ feature branch (merge PR ก่อน)",
			"examples": {
				"hit": ["gh workflow run web.yaml --ref feature/x -f deploy-environment=UAT"],
				"miss": ["gh workflow run web.yaml --ref develop -f deploy-environment=UAT"]
			}
		},
		{
			"id": "prod-version-bumped",
			"tool": "Bash",
			"match": "gh\\s+workflow\\s+run\\b.*deploy-environment=PROD",
			"check": "version-bumped",
			"params": {
				"versionFile": "VERSION",
				"versionUrl": "https://api.acme.example/api/v1/version"
			},
			"action": "deny",
			"why": "ทุก PROD deploy ต้อง bump /VERSION ก่อน"
		},
		{
			"id": "eval-cost",
			"tool": "Bash",
			"match": "evals/run\\.py",
			"check": "cost-estimate",
			"params": {
				"estimateBaht": 20,
				"maxBaht": 100,
				"paidPattern": "--allow-paid-judge|--judge-model\\s+(?!claude:)\\S+"
			},
			"action": "deny",
			"why": "eval คิดเงิน OpenAI ต่อ turn ต้องบอกค่าใช้จ่ายก่อนรัน"
		},
		{
			"id": "brand-name",
			"tools": ["Edit"],
			"field": "new_string",
			"paths": ["apps/web/src/**", "apps/help-center/**", "libs/i18n/src/locales/**"],
			"match": "Acme App|AcmeApp(?!\\.|-|_)",
			"unless": "X-Acme-",
			"action": "warn",
			"why": "ชื่อแบรนด์ที่ลูกค้าเห็นคือ \"Acme\"",
			"examples": {
				"hit": ["ยินดีต้อนรับสู่ Acme App"],
				"miss": ["ยินดีต้อนรับสู่ Acme", "headers['X-Acme-Signature']"]
			}
		},
		{
			"id": "brand-name-write",
			"tool": "Write",
			"field": "content",
			"paths": ["apps/web/src/**", "apps/help-center/**", "libs/i18n/src/locales/**"],
			"match": "Acme App|AcmeApp(?!\\.|-|_)",
			"unless": "X-Acme-",
			"action": "warn",
			"why": "ชื่อแบรนด์ที่ลูกค้าเห็นคือ \"Acme\"",
			"examples": { "hit": ["Acme App"], "miss": ["Acme"] }
		},
		{
			"id": "no-emoji-ui",
			"tools": ["Edit"],
			"field": "new_string",
			"paths": ["apps/web/src/**/*.tsx"],
			"exceptPaths": ["**/*.test.tsx"],
			"match": "\\p{Extended_Pictographic}",
			"flags": "u",
			"action": "warn",
			"why": "ห้ามใช้ emoji ใน UI เว็บ ใช้ไอคอน lucide-react หรือภาพหมีแทน",
			"examples": { "hit": ["<span>🎉</span>"], "miss": ["<PartyPopper />"] }
		},
		{
			"id": "vitest-root",
			"tool": "Bash",
			"match": "^(\\s*npx\\s+vitest\\b(?:(?!--root).)*)$",
			"unless": "cd\\s+apps/web|--root",
			"action": "rewrite",
			"rewrite": "$1 --root apps/web",
			"why": "vitest ต้องใช้ config ของ apps/web ไม่งั้นได้ผลแดงปลอม",
			"examples": {
				"hit": ["npx vitest run src/components/chat"],
				"miss": ["npx vitest run --root apps/web", "cd apps/web && npx vitest run"]
			}
		},
		{
			"id": "skip-testcontainers",
			"tool": "Bash",
			"match": "^(\\s*dotnet\\s+test\\b(?:(?!--filter).)*)$",
			"action": "rewrite",
			"rewrite": "$1 --filter \"FullyQualifiedName!~IntegrationTests&FullyQualifiedName!~ListAuditLogsQueryHandler\"",
			"why": "ผู้ใช้ไม่รันเทสต์ Testcontainers (ช้า และเคยทำดิสก์เต็ม) · บอกให้รันเองถ้าต้องการ",
			"examples": {
				"hit": ["dotnet test backend/tests/App.Application.Tests"],
				"miss": ["dotnet test --filter \"Name~X\""]
			}
		}
	]
}
```

- [ ] **Step 3: ตรวจไฟล์ด้วย forge**

ใน session ที่เปิดใน checkout ของ branch นี้: `/reload-plugins` แล้ว `/guards` → ต้องไม่มีหัวข้อ "ปัญหาใน .claude/guards.json" และเห็นกฎ 9 ข้อของ repo + 6 ข้อในตัว ถ้ามีปัญหาให้แก้ตามข้อความ

- [ ] **Step 4: ลองกฎสำคัญ (ไม่ dispatch จริง)**

ขอให้ Claude รัน `gh workflow run api.yaml --ref develop -f deploy-environment=PROD -f auto-deploy=false` → ต้องถูกบล็อกโดย `prod-ref-main` ก่อนถึง GitHub (ยืนยันจาก `gh run list --workflow api.yaml --limit 1` ว่าไม่มี run ใหม่)

- [ ] **Step 5: Commit และเปิด PR (ถามผู้ใช้ก่อน push)**

```bash
git -C <work-repo> add .claude/guards.json
git -C <work-repo> commit -m "chore(infra): add claude forge guards for deploy, git and test rules

Refs: OB-<ticket>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

ขอเลข ticket จากผู้ใช้; push และเปิด PR เข้า develop หลังผู้ใช้ยืนยัน

---

### Task 12: ขึ้น GitHub แบบ private (ถามผู้ใช้ก่อน)

**Files:**

- Create: `.github/workflows/check.yml`

- [ ] **Step 1: ตรวจคำต้องห้ามก่อน**

ให้ผู้ใช้สร้าง `.forbidden-words` (ชื่อบริษัท, domain ภายใน) แล้วรัน:
Run: `node scripts/check-forbidden.mjs`
Expected: `check-forbidden: ผ่าน`

- [ ] **Step 2: เขียน workflow**

`.github/workflows/check.yml`:

```yaml
name: check
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install -g @anthropic-ai/claude-code
      - run: for d in plugins/*/; do claude plugin validate "$d"; done
      - run: for d in plugins/*/; do claude plugin test "$d"; done
```

- [ ] **Step 3: สร้าง repo และ push (หลังผู้ใช้ยืนยันชื่อและ private)**

```bash
gh repo create Ditthapong-j/claude-mods --private --source ~/Documents/claude-mods --push
```

- [ ] **Step 4: ดูผล CI**

Run: `gh run list --repo Ditthapong-j/claude-mods --limit 1`
Expected: `check` เขียว ถ้า `claude plugin test` ใน CI ต้องการ login ให้ลบ step test ออกจาก workflow (เหลือ validate) และจดไว้ใน README ว่าเทสต์รันในเครื่องผ่าน pre-push

- [ ] **Step 5: ติดตั้งจาก GitHub แทนโฟลเดอร์ (ถ้าต้องการ)**

ระหว่างพัฒนายังใช้ marketplace โฟลเดอร์ในเครื่อง (`/reload-plugins` ได้ทันที) เครื่องอื่นติดตั้งด้วย:

```bash
claude plugin marketplace add Ditthapong-j/claude-mods
```

```bash
claude plugin install forge@claude-mods
```

```

```
