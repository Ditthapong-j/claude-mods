# Phase 2–5: Lesson Forge, Proof Gate, Mission Control, Mod Manager, Autopilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำชั้นที่ 1 ให้ครบ: forge สร้างกฎจากบทเรียนได้ (`/lessons`, `propose_rule`, import จาก memory), plugin `proof` (Proof Gate), `mission` (Mission Control), `manager` (Mod Manager, `/mods`) และ `autopilot` (`/ship`)

**Architecture:** ทุก plugin ใช้แบบเดียวกับ forge ช่วง 1: logic ล้วนอยู่ในไฟล์แยกที่เทสต์ได้, การเรียก `$` และ atom ทั้งหมดอยู่ใน `hooks/register.tsx` ไฟล์เดียวของแต่ละ plugin (engine ไม่ยอมให้ `$` ข้าม import และต้องประกาศ atom ในไฟล์ที่ใช้) plugin คุยกันผ่าน tool ที่ลงทะเบียนด้วย `$.tool.register` (`mcp__<plugin>__<name>`) แล้วอีก plugin เรียกด้วย `$.tool.call` — ไม่อ่าน state ข้าม plugin

**Tech Stack:** Claude Code mod API 2.1.293 (`claude-code`, `claude-code/testing`), TypeScript/TSX (JSX ผ่าน `$.ui.resolve(e)`), `claude plugin validate|test`

**Spec:** `docs/specs/2026-10-08-claude-mods-suite-design.md` §4.3–§4.4, §5, §6, §7, §8, §10, §11 · ผล spike: `docs/spikes/2026-10-results.md`

## Global Constraints

- ทุกข้อใน Global Constraints ของแผนช่วง 0–1 (`docs/plans/2026-10-08-phase-0-1-forge-guards.md`) ยังใช้
- `$` และ `atom(...)` อยู่ใน `hooks/register.tsx` ของ plugin นั้นเท่านั้น; ฟังก์ชันที่ import มาเป็น pure
- hook ของเทสต์ที่ตอบการเรียก `$` คืน `{ value: ... }`; ผลถูกบล็อกของ `$.tool.call` จากเทสต์คือ `{ deny }`
- guard (hook ที่ตัดสินว่าให้ทำหรือไม่) ต้องมี `.catch` fail closed; hook อื่นห่อด้วย try/catch แล้วบันทึกลง atom `errors` ของ plugin (S3: engine ไม่ส่ง fault ให้ plugin อื่น)
- classify บทเรียนห้ามขวาง `prompt.submit` (S4: median 1.5 s) — ทำตอน `turn.complete`
- ไม่มีอะไรทำงานแทนผู้ใช้ที่จุดอนุมัติ: เปิดใช้กฎ, เปิด PR, push, deploy ต้องมาจากปุ่มที่ผู้ใช้กด หรือ `origin.kind === 'composer'`
- คำสั่งที่เปลี่ยนสถานะกฎ (`/lessons disable|enable|remove|accept`) รับจาก `composer` หรือจาก plugin `manager` เท่านั้น
- ทุก probe มี timeout (process 5 s ยกเว้นคำสั่งพิสูจน์ของ proof 15 นาที; http แข่งกับ `$.clock.sleep`)
- ข้อความภาษาไทย, id/ชื่อ tool ภาษาอังกฤษ; ห้ามมีชื่อบริษัท/host ของงานในโค้ด (pre-push ตรวจ)

## Review Focus

1. **โมเดลพยายามปิดกฎหรือเปิดใช้กฎเอง** (ผ่าน `/lessons`, `propose_rule`, หรือ `$.command.run` จาก plugin อื่น) — ต้องได้แค่ "ร่างรอผู้ใช้กด" → เทสต์ใน Task A3, A4
2. **Proof Gate รันคำสั่งหนักซ้อนหรือค้าง** (แก้ไฟล์ 20 ครั้งติด, คำสั่งไม่จบ) — debounce + คิวเดียว + timeout → เทสต์ใน Task B2
3. **`gh`/เครือข่ายใช้ไม่ได้ใน Mission Control** — กล่องนั้นแสดงเหตุผล ไม่ซ่อน ไม่ทำ pane ล้ม → เทสต์ใน Task C1, C2
4. **Autopilot วนไม่จบ** (ขั้นไม่ผ่านซ้ำ) — สูงสุด 3 รอบต่อขั้นแล้วหยุดรอผู้ใช้ → เทสต์ใน Task D1
5. **memory/guards.json ที่มีข้อความแปลก** (ไม่มี JSON, JSON พัง, ไฟล์ว่าง) — ร่างกฎถูกข้ามพร้อมเหตุผล ไม่ล้ม → เทสต์ใน Task A1, A4

---

## File Structure

```
plugins/
  forge/
    hooks/register.ts → register.tsx    # A: + prompt.submit, turn.complete, ui.render, /lessons, tools
    hooks/lessons.ts                     # A1: candidate filter, draft prompt, parseDraft, tooBroad (pure)
    hooks/personal.ts                    # A2: personal rule list ops (pure)
    hooks/guards-file.ts                 # A2: merge a rule into guards.json text (pure)
    hooks/config.ts                      # A1: export toRule
    hooks/rules-view.ts                  # A3: rows for /lessons + rules tool (pure)
    types/index.d.ts                     # + Draft, PersonalRule state
  proof/                                 # B
    .claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx
    hooks/plan.ts                        # which commands prove which paths (pure)
    hooks/results.ts                     # status line, band text, continue prompt, flaky logic (pure)
    types/index.d.ts, tests/*
  mission/                               # C
    hooks/register.tsx, hooks/parse.ts (pure), types/index.d.ts, tests/*
  manager/                               # E
    hooks/register.tsx, hooks/view.ts (pure), types/index.d.ts, tests/*
  autopilot/                             # D
    hooks/register.tsx, hooks/steps.ts (pure state machine), types/index.d.ts, tests/*
.claude-plugin/marketplace.json          # + proof, mission, manager, autopilot
```

---

## Part A — Lesson Forge (forge ช่วง 2)

### Task A1: ร่างกฎจากบทเรียน (pure)

**Files:**

- Create: `plugins/forge/hooks/lessons.ts`
- Modify: `plugins/forge/hooks/config.ts` (export `toRule`)
- Test: `plugins/forge/tests/lessons.test.ts`

**Interfaces:**

- Produces:
  - `type RecentCall = { tool: string; summary: string }`
  - `isLessonCandidate(text: string, calls: readonly RecentCall[]): boolean` — ยาว ≥ 20 ตัวอักษร (ภาษาไทยไม่มีช่องว่าง จึงนับตัวอักษรแทนคำ) และมี tool call ก่อนหน้าอย่างน้อย 1
  - `draftPrompt(text: string, calls: readonly RecentCall[]): string`
  - `parseDraft(answer: string): { rule: Rule } | { error: string }`
  - `tooBroad(rule: Rule, history: readonly string[], vars: Vars): string | undefined`
  - `toRule(raw: unknown, index: number): { rule?: Rule; error?: string }` (export จาก config.ts ที่มีอยู่)

- [ ] **Step 1: เทสต์ที่ล้ม**

`plugins/forge/tests/lessons.test.ts`:

````ts
import { describe, expect, test } from 'claude-code/testing'

import { draftPrompt, isLessonCandidate, parseDraft, tooBroad } from '../hooks/lessons'

const calls = [{ tool: 'Bash', summary: 'git checkout -b fix/a' }]

describe('isLessonCandidate', () => {
	test('needs a real sentence and a previous tool call', () => {
		expect(isLessonCandidate('อย่าแตกจาก branch ของ PR ที่ยังไม่ merge', calls)).toBe(true)
		expect(isLessonCandidate('ต่อ', calls)).toBe(false)
		expect(isLessonCandidate('อย่าแตกจาก branch ของ PR ที่ยังไม่ merge', [])).toBe(false)
	})
})

describe('draftPrompt', () => {
	test('carries the correction, the calls and the JSON contract', () => {
		const p = draftPrompt('อย่าแตกจาก branch ของ PR', calls)
		expect(p).toContain('อย่าแตกจาก branch ของ PR')
		expect(p).toContain('git checkout -b fix/a')
		expect(p).toContain('"examples"')
		expect(p).toContain('NO_RULE')
	})
})

describe('parseDraft', () => {
	test('takes the first JSON object out of the answer', () => {
		const answer =
			'นี่คือกฎ:\n```json\n{"id":"branch-base","tool":"Bash","match":"^git checkout -b \\\\S+$","action":"deny","why":"แตกจากฐาน","examples":{"hit":["git checkout -b a"],"miss":["git status"]}}\n```'
		const out = parseDraft(answer)
		expect('rule' in out ? out.rule.id : out.error).toBe('branch-base')
	})
	test('NO_RULE, no JSON and broken JSON are errors, not crashes', () => {
		expect(parseDraft('NO_RULE')).toEqual({ error: 'โมเดลบอกว่าบทเรียนนี้เป็นกฎเครื่องไม่ได้' })
		expect('error' in parseDraft('ไม่มีอะไร')).toBe(true)
		expect('error' in parseDraft('{ "id": ')).toBe(true)
		expect('error' in parseDraft('')).toBe(true)
	})
})

describe('tooBroad', () => {
	test('a rule that would have stopped commands that ran fine is too broad', () => {
		const out = parseDraft('{"id":"no-git","tool":"Bash","match":"^git","action":"deny","why":"x"}')
		if (!('rule' in out)) throw new Error(out.error)
		expect(tooBroad(out.rule, ['git status', 'npm test'], {})).toContain('git status')
		const narrow = parseDraft('{"id":"no-stash","tool":"Bash","match":"^git stash$","action":"deny","why":"x"}')
		if (!('rule' in narrow)) throw new Error(narrow.error)
		expect(tooBroad(narrow.rule, ['git status', 'npm test'], {})).toBeUndefined()
	})
})
````

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `cannot import "../hooks/lessons"`

- [ ] **Step 3: export `toRule` จาก config.ts**

ใน `plugins/forge/hooks/config.ts` เปลี่ยน `function toRule(` เป็น `export function toRule(`

- [ ] **Step 4: เขียน lessons.ts**

`plugins/forge/hooks/lessons.ts`:

```ts
import { toRule } from './config'
import { judge, triggers } from './match'
import type { Rule, Vars } from './types'

export type RecentCall = { tool: string; summary: string }

const MIN_CHARS = 20

export function isLessonCandidate(text: string, calls: readonly RecentCall[]): boolean {
	return text.trim().length >= MIN_CHARS && calls.length > 0
}

export function draftPrompt(text: string, calls: readonly RecentCall[]): string {
	const recent = calls.map((c, i) => `${i + 1}. ${c.tool}: ${c.summary}`).join('\n')
	return [
		'ผู้ใช้เพิ่งแก้พฤติกรรมของ Claude Code ด้วยข้อความด้านล่าง หลังการเรียก tool เหล่านี้',
		`ข้อความผู้ใช้: ${text}`,
		`การเรียก tool ล่าสุด:\n${recent}`,
		'',
		'ถ้าบทเรียนนี้บังคับได้ด้วยการตรวจข้อความของการเรียก tool ให้ตอบเป็น JSON object เดียว รูปแบบ:',
		'{"id":"kebab-case","tool":"Bash","field":"command","match":"<regex>","unless":"<regex หรือไม่ใส่>","action":"deny|warn|rewrite","rewrite":"<เฉพาะ rewrite ใช้ $& หรือ $1>","why":"<เหตุผลภาษาไทย>","hint":"<วิธีที่ถูก>","examples":{"hit":["<คำสั่งที่พลาดจริงด้านบน>"],"miss":["<คำสั่งที่ถูกต้องที่ต้องไม่โดน>"]}}',
		'ใช้คำสั่งที่พลาดจริงเป็น examples.hit อย่างน้อย 1 ตัว และ examples.miss อย่างน้อย 2 ตัว',
		'rewrite ห้ามเพิ่ม ; && || | $( ` > < ใหม่; ถ้าไม่แน่ใจให้ใช้ deny',
		'ถ้าบังคับด้วยการตรวจข้อความไม่ได้ ตอบคำเดียว: NO_RULE',
	].join('\n')
}

function firstObject(text: string): string | undefined {
	const start = text.indexOf('{')
	if (start < 0) return undefined
	let depth = 0
	let inString = false
	for (let i = start; i < text.length; i++) {
		const c = text.charAt(i)
		if (inString) {
			if (c === '\\') i++
			else if (c === '"') inString = false
		} else if (c === '"') inString = true
		else if (c === '{') depth++
		else if (c === '}' && --depth === 0) return text.slice(start, i + 1)
	}
	return undefined
}

export function parseDraft(answer: string): { rule: Rule } | { error: string } {
	if (answer.trim() === 'NO_RULE') return { error: 'โมเดลบอกว่าบทเรียนนี้เป็นกฎเครื่องไม่ได้' }
	const json = firstObject(answer)
	if (json === undefined) return { error: 'ไม่พบ JSON ในคำตอบของโมเดล' }
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch (err) {
		return { error: `JSON ของร่างกฎพัง: ${err instanceof Error ? err.message : String(err)}` }
	}
	const { rule, error } = toRule(raw, 0)
	return rule === undefined ? { error: error ?? 'ร่างกฎใช้ไม่ได้' } : { rule }
}

export function tooBroad(rule: Rule, history: readonly string[], vars: Vars): string | undefined {
	if (!rule.tools.includes('Bash') || rule.field !== 'command') return undefined
	const caught = history.filter((cmd) =>
		rule.check === undefined ? judge(rule, cmd, vars).kind !== 'pass' : triggers(rule, cmd)
	)
	if (caught.length === 0) return undefined
	return `กฎกว้างเกิน: จะดักคำสั่งที่เพิ่งรันผ่านไปด้วยดี ${caught.length} ครั้ง เช่น ${caught.slice(0, 3).join(' · ')}`
}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS ทั้งหมด (เดิม 64 + ใหม่)

- [ ] **Step 6: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): draft rules from lessons (candidate filter, prompt, parser, breadth check)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2: กฎส่วนตัวและการเขียนลง guards.json (pure)

**Files:**

- Create: `plugins/forge/hooks/personal.ts`, `plugins/forge/hooks/guards-file.ts`
- Test: `plugins/forge/tests/personal.test.ts`

**Interfaces:**

- Produces:
  - `type Scope = { kind: 'any-repo' } | { kind: 'repo'; root: string }`
  - `type PersonalRule = { rule: Rule; scope: Scope; createdAt: number; lesson: string }`
  - `personalFor(list: readonly PersonalRule[], root: string | null): { repo: Rule[]; any: Rule[] }`
  - `upsert(list, item): PersonalRule[]` (id ซ้ำแทนที่), `setEnabled(list, id, enabled): PersonalRule[]`, `remove(list, id): PersonalRule[]`
  - `ruleToJson(rule: Rule): Record<string, unknown>` (ตัด field ที่เป็น undefined, `tools` เดียวเขียนเป็น `tool`)
  - `withRule(text: string | null, rule: Rule): { text: string } | { error: string }` — เพิ่ม/แทนที่กฎใน guards.json (ไฟล์ไม่มี = สร้างใหม่)

- [ ] **Step 1: เทสต์ที่ล้ม**

`plugins/forge/tests/personal.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { withRule } from '../hooks/guards-file'
import { personalFor, remove, setEnabled, upsert } from '../hooks/personal'
import type { PersonalRule } from '../hooks/personal'
import type { Rule } from '../hooks/types'

const rule = (id: string): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why: 'w',
	examples: { hit: [], miss: [] },
	enabled: true,
})
const item = (id: string, root?: string): PersonalRule => ({
	rule: rule(id),
	scope: root === undefined ? { kind: 'any-repo' } : { kind: 'repo', root },
	createdAt: 0,
	lesson: 'l',
})

describe('personal rules', () => {
	test('split by scope for the current repo', () => {
		const out = personalFor([item('a'), item('b', '/r'), item('c', '/other')], '/r')
		expect(out.repo.map((r) => r.id)).toEqual(['b'])
		expect(out.any.map((r) => r.id)).toEqual(['a'])
		expect(personalFor([item('b', '/r')], null).repo).toEqual([])
	})
	test('upsert replaces by id, setEnabled and remove', () => {
		const list = upsert([item('a')], { ...item('a'), lesson: 'new' })
		expect(list.length).toBe(1)
		expect(list[0]?.lesson).toBe('new')
		expect(setEnabled(list, 'a', false)[0]?.rule.enabled).toBe(false)
		expect(remove(list, 'a')).toEqual([])
	})
})

describe('withRule', () => {
	test('creates, appends and replaces rules in guards.json text', () => {
		const created = withRule(null, rule('a'))
		if (!('text' in created)) throw new Error(created.error)
		expect(JSON.parse(created.text)).toEqual({
			rules: [
				{
					id: 'a',
					tool: 'Bash',
					field: 'command',
					match: 'x',
					action: 'deny',
					why: 'w',
					examples: { hit: [], miss: [] },
				},
			],
		})
		const appended = withRule(
			'{"vars":{"baseBranch":"origin/main"},"rules":[{"id":"z","tool":"Bash","match":"y","action":"warn","why":"v"}]}',
			rule('a')
		)
		if (!('text' in appended)) throw new Error(appended.error)
		const parsed = JSON.parse(appended.text) as { vars: unknown; rules: { id: string }[] }
		expect(parsed.vars).toEqual({ baseBranch: 'origin/main' })
		expect(parsed.rules.map((r) => r.id)).toEqual(['z', 'a'])
		const replaced = withRule(appended.text, { ...rule('a'), why: 'ใหม่' })
		if (!('text' in replaced)) throw new Error(replaced.error)
		expect((JSON.parse(replaced.text) as { rules: { why: string }[] }).rules[1]?.why).toBe('ใหม่')
	})
	test('broken JSON is an error, not an overwrite', () => {
		expect('error' in withRule('{ nope', rule('a'))).toBe(true)
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `cannot import "../hooks/guards-file"`

- [ ] **Step 3: เขียนโค้ด**

`plugins/forge/hooks/personal.ts`:

```ts
import type { Rule } from './types'

export type Scope = { kind: 'any-repo' } | { kind: 'repo'; root: string }

export type PersonalRule = { rule: Rule; scope: Scope; createdAt: number; lesson: string }

export function personalFor(list: readonly PersonalRule[], root: string | null): { repo: Rule[]; any: Rule[] } {
	return {
		repo: list.filter((p) => p.scope.kind === 'repo' && p.scope.root === root).map((p) => p.rule),
		any: list.filter((p) => p.scope.kind === 'any-repo').map((p) => p.rule),
	}
}

export function upsert(list: readonly PersonalRule[], item: PersonalRule): PersonalRule[] {
	return [...list.filter((p) => p.rule.id !== item.rule.id), item]
}

export function setEnabled(list: readonly PersonalRule[], id: string, enabled: boolean): PersonalRule[] {
	return list.map((p) => (p.rule.id === id ? { ...p, rule: { ...p.rule, enabled } } : p))
}

export function remove(list: readonly PersonalRule[], id: string): PersonalRule[] {
	return list.filter((p) => p.rule.id !== id)
}
```

`plugins/forge/hooks/guards-file.ts`:

```ts
import type { Rule } from './types'

export function ruleToJson(rule: Rule): Record<string, unknown> {
	const { tools, enabled, ...rest } = rule
	const out: Record<string, unknown> = tools.length === 1 ? { id: rest.id, tool: tools[0] } : { id: rest.id, tools }
	for (const [key, value] of Object.entries(rest)) {
		if (key !== 'id' && value !== undefined) out[key] = value
	}
	if (!enabled) out['enabled'] = false
	return out
}

export function withRule(text: string | null, rule: Rule): { text: string } | { error: string } {
	let raw: unknown = {}
	if (text !== null && text.trim() !== '') {
		try {
			raw = JSON.parse(text)
		} catch (err) {
			return {
				error: `.claude/guards.json ไม่ใช่ JSON ที่ถูกต้อง จึงไม่เขียนทับ: ${err instanceof Error ? err.message : String(err)}`,
			}
		}
	}
	if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
		return { error: '.claude/guards.json ต้องเป็น object' }
	const doc = raw as Record<string, unknown>
	const rules = Array.isArray(doc['rules']) ? (doc['rules'] as unknown[]) : []
	const others = rules.filter(
		(r) => !(typeof r === 'object' && r !== null && (r as Record<string, unknown>)['id'] === rule.id)
	)
	const next = { ...doc, rules: [...others, ruleToJson(rule)] }
	return { text: `${JSON.stringify(next, null, '\t')}\n` }
}
```

- [ ] **Step 4: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/forge
git commit -m "feat(forge): personal rule list and guards.json merge

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3: ต่อการเรียนรู้เข้ากับ session (ร่างกฎ, band, `/lessons`, tools)

**Files:**

- Rename: `plugins/forge/hooks/register.ts` → `plugins/forge/hooks/register.tsx`; แก้ `plugins/forge/hooks/hooks.json` เป็น `{ "modules": ["./register.tsx"] }`
- Create: `plugins/forge/hooks/rules-view.ts`
- Modify: `plugins/forge/types/index.d.ts`, `plugins/forge/hooks/commands.ts` (ไม่แตะ ใช้ต่อ)
- Test: `plugins/forge/tests/learning.test.ts`, `plugins/forge/tests/rules-view.test.ts`

**Interfaces:**

- Consumes: A1, A2, `handleGuardsCommand` (ช่วง 1)
- Produces:
  - `type RuleRow = { id: string; source: 'repo' | 'personal-repo' | 'personal' | 'builtin'; action: string; enabled: boolean; hits30: number }`
  - `ruleRows(sources: { repo: readonly Rule[]; personalRepo: readonly Rule[]; personal: readonly Rule[]; builtin: readonly Rule[] }, hitlog: readonly { ruleId: string; at: number }[], now: number): RuleRow[]`
  - `type LessonsAction = { kind: 'open' } | { kind: 'accept'; scope: 'any-repo' | 'repo' | 'file' } | { kind: 'reject' } | { kind: 'set'; id: string; enabled: boolean } | { kind: 'remove'; id: string } | { kind: 'import'; dir?: string } | { kind: 'refused'; text: string } | { kind: 'help'; text: string }`
  - `parseLessonsArgs(args: string, origin: { kind: string; name?: string }): LessonsAction` (pure, ใน rules-view.ts)
  - state contract เพิ่ม: `forge.draft: Draft | null`, `forge.pending: { text: string; calls: RecentCall[] } | null`, `forge.recent: RecentCall[]`, `forge.history: string[]`, `forge.importQueue: Draft[]`, `forge.errors: { at: number; where: string; message: string }[]`
  - `type Draft = { rule: Rule; lesson: string }`
  - `$.store` keys: `personalRules` (PersonalRule[]), `hitlog` ({ ruleId, at }[] ล่าสุด 1000)
  - tools: `mcp__forge__propose_rule` (input `{ rule: object, lesson?: string }` → ตรวจแล้วตั้งเป็นร่างรอผู้ใช้), `mcp__forge__rules` (ไม่มี input → JSON `{ rules: RuleRow[], errors: string[] }`)
  - คำสั่ง `/lessons` (ไม่มี args = เปิด pane `lessons`; `accept any-repo|repo|file`, `reject`, `enable <id>`, `disable <id>`, `remove <id>`, `import-memory [dir]`)

- [ ] **Step 1: เทสต์ pure ของ rules-view (ล้ม)**

`plugins/forge/tests/rules-view.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { parseLessonsArgs, ruleRows } from '../hooks/rules-view'
import type { Rule } from '../hooks/types'

const r = (id: string, enabled = true): Rule => ({
	id,
	tools: ['Bash'],
	field: 'command',
	match: 'x',
	action: 'deny',
	why: 'w',
	examples: { hit: [], miss: [] },
	enabled,
})
const DAY = 86_400_000

describe('ruleRows', () => {
	test('labels each source and counts hits in the last 30 days', () => {
		const rows = ruleRows(
			{ repo: [r('a')], personalRepo: [r('b')], personal: [r('c', false)], builtin: [r('d')] },
			[
				{ ruleId: 'a', at: 40 * DAY },
				{ ruleId: 'a', at: 5 * DAY },
				{ ruleId: 'd', at: 39 * DAY },
			],
			40 * DAY
		)
		expect(rows.map((x) => `${x.id}:${x.source}:${x.enabled}:${x.hits30}`)).toEqual([
			'a:repo:true:1',
			'b:personal-repo:true:0',
			'c:personal:false:0',
			'd:builtin:true:1',
		])
	})
})

describe('parseLessonsArgs', () => {
	const person = { kind: 'composer' }
	test('person may change rules', () => {
		expect(parseLessonsArgs('', person)).toEqual({ kind: 'open' })
		expect(parseLessonsArgs('accept repo', person)).toEqual({ kind: 'accept', scope: 'repo' })
		expect(parseLessonsArgs('disable named-stash', person)).toEqual({ kind: 'set', id: 'named-stash', enabled: false })
		expect(parseLessonsArgs('import-memory /x/memory', person)).toEqual({ kind: 'import', dir: '/x/memory' })
	})
	test('the manager plugin may toggle but not accept', () => {
		const manager = { kind: 'plugin', name: 'manager' }
		expect(parseLessonsArgs('disable a', manager)).toEqual({ kind: 'set', id: 'a', enabled: false })
		expect(parseLessonsArgs('accept any-repo', manager).kind).toBe('refused')
	})
	test('anyone else is refused for changes but may open', () => {
		for (const origin of [{ kind: 'sdk' }, { kind: 'plugin', name: 'other' }, { kind: 'peer' }]) {
			expect(parseLessonsArgs('disable a', origin).kind).toBe('refused')
			expect(parseLessonsArgs('accept file', origin).kind).toBe('refused')
			expect(parseLessonsArgs('', origin)).toEqual({ kind: 'open' })
		}
	})
	test('unknown verbs explain usage', () => {
		expect(parseLessonsArgs('nope', person).kind).toBe('help')
	})
})
```

- [ ] **Step 2: เทสต์ flow ใน session (ล้ม)**

`plugins/forge/tests/learning.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { world } from './helpers'

const P = { isFullscreen: false, columns: 120 }
const DRAFT =
	'{"id":"no-bare-checkout","tool":"Bash","match":"^git checkout -b \\\\S+$","action":"deny","why":"แตกจากฐานเสมอ","examples":{"hit":["git checkout -b fix/a"],"miss":["git checkout -b fix/a origin/develop","git status"]}}'

function model(on: Parameters<typeof world>[0], label: string, answer: string): void {
	on('model.classify', () => ({ value: label }))
	on('model.complete', () => ({
		value: {
			isAnswered: true,
			text: answer,
			usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
		},
	}))
}

describe('learning from a correction', () => {
	test('a correction after a tool call becomes a draft, and accept stores it', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, root: null })
		model(on, 'correction', DRAFT)
		on('prompt.submit', ($, e) => ({ text: e.text }))
		on('turn.complete', ($, e) => ({ text: 'ok' }))
		mockStore(on)
		await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/a' })
		await $.prompt.submit({
			text: 'อย่าแตก branch ตรงนี้ ให้แตกจาก origin/develop เสมอนะ',
			origin: { kind: 'composer' },
		})
		await $.turn.complete({ reason: 'answer', text: 'ขอโทษครับ' })
		const accepted = await $.command.run({
			command: 'lessons',
			args: 'accept any-repo',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(accepted.text).toContain('no-bare-checkout')
		const res = await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/b' })
		expect(res.deny).toContain('no-bare-checkout')
	})

	test('a task message makes no draft', async ($, on) => {
		world(on, { root: null })
		model(on, 'task', DRAFT)
		on('prompt.submit', ($, e) => ({ text: e.text }))
		on('turn.complete', () => ({ text: 'ok' }))
		mockStore(on)
		await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/a' })
		await $.prompt.submit({
			text: 'ช่วยเพิ่มปุ่ม export CSV ในหน้ารายการออเดอร์ให้หน่อย',
			origin: { kind: 'composer' },
		})
		await $.turn.complete({ reason: 'answer', text: 'ok' })
		const res = await $.command.run({
			command: 'lessons',
			args: 'accept any-repo',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(res.text).toContain('ไม่มีร่างกฎ')
	})

	test('propose_rule from the model only drafts; the model cannot accept it', async ($, on) => {
		world(on, { root: null })
		mockStore(on)
		const proposed = await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: JSON.parse(DRAFT) as object })
		expect(JSON.stringify(proposed)).toContain('รอผู้ใช้')
		const byModel = await $.command.run({
			command: 'lessons',
			args: 'accept any-repo',
			origin: { kind: 'sdk' },
			presentation: P,
		})
		expect(byModel.text).toContain('ผู้ใช้ต้อง')
		const ran: string[] = []
		const res = await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/b' })
		expect(res.deny).toBeUndefined()
		expect(ran).toEqual([])
	})

	test('the rules tool lists builtin rules', async ($, on) => {
		world(on, { root: null })
		mockStore(on)
		const res = await $.tool.call({ tool: 'mcp__forge__rules' })
		expect(JSON.stringify(res)).toContain('named-stash')
	})
})

function mockStore(on: Parameters<typeof world>[0]): void {
	const data = new Map<string, unknown>()
	on('store.get', ($, e) => ({ value: data.get(e.key) }))
	on('store.set', ($, e) => {
		data.set(e.key, e.value)
		return { value: undefined }
	})
}
```

ถ้า kit มี `mock.store(on)` ให้ใช้แทน `mockStore`; ถ้า shape ของ `$.prompt.submit`, `$.turn.complete` หรือคำตอบของ `model.complete` ต่างจากนี้ ให้ปรับตาม type ใน `claude-code.d.ts` (`PromptSubmitInput`, `TurnCompleteInput`, `ModelCompleteResult`) — เทสต์ต้องยังพิสูจน์พฤติกรรมเดิม

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/forge`
Expected: FAIL — `cannot import "../hooks/rules-view"` และ learning ล้มเพราะยังไม่มี `/lessons`

- [ ] **Step 4: เขียน rules-view.ts**

`plugins/forge/hooks/rules-view.ts`:

```ts
import type { Rule } from './types'

export type RuleRow = {
	id: string
	source: 'repo' | 'personal-repo' | 'personal' | 'builtin'
	action: string
	enabled: boolean
	hits30: number
}

const THIRTY_DAYS = 30 * 86_400_000

export function ruleRows(
	sources: {
		repo: readonly Rule[]
		personalRepo: readonly Rule[]
		personal: readonly Rule[]
		builtin: readonly Rule[]
	},
	hitlog: readonly { ruleId: string; at: number }[],
	now: number
): RuleRow[] {
	const since = now - THIRTY_DAYS
	const hits = new Map<string, number>()
	for (const h of hitlog) if (h.at >= since) hits.set(h.ruleId, (hits.get(h.ruleId) ?? 0) + 1)
	const rows: RuleRow[] = []
	const add = (list: readonly Rule[], source: RuleRow['source']): void => {
		for (const r of list) {
			if (rows.some((x) => x.id === r.id)) continue
			rows.push({
				id: r.id,
				source,
				action: r.check === undefined ? r.action : `${r.action} · ${r.check}`,
				enabled: r.enabled,
				hits30: hits.get(r.id) ?? 0,
			})
		}
	}
	add(sources.repo, 'repo')
	add(sources.personalRepo, 'personal-repo')
	add(sources.personal, 'personal')
	add(sources.builtin, 'builtin')
	return rows
}

export type LessonsAction =
	| { kind: 'open' }
	| { kind: 'accept'; scope: 'any-repo' | 'repo' | 'file' }
	| { kind: 'reject' }
	| { kind: 'set'; id: string; enabled: boolean }
	| { kind: 'remove'; id: string }
	| { kind: 'import'; dir?: string }
	| { kind: 'refused'; text: string }
	| { kind: 'help'; text: string }

const USAGE = '/lessons · accept any-repo|repo|file · reject · enable|disable|remove <id> · import-memory [dir]'

export function parseLessonsArgs(args: string, origin: { kind: string; name?: string }): LessonsAction {
	const [verb, arg] = args.trim().split(/\s+/)
	const person = origin.kind === 'composer'
	const manager = origin.kind === 'plugin' && origin.name === 'manager'
	if (verb === undefined || verb === '') return { kind: 'open' }
	const refused = {
		kind: 'refused',
		text: 'ผู้ใช้ต้องพิมพ์เองที่ช่องพิมพ์ หรือกดปุ่มใน /lessons /mods เปลี่ยนกฎแทนผู้ใช้ไม่ได้',
	} as const
	if (verb === 'accept') {
		if (!person) return refused
		return arg === 'any-repo' || arg === 'repo' || arg === 'file'
			? { kind: 'accept', scope: arg }
			: { kind: 'help', text: USAGE }
	}
	if (verb === 'reject') return person ? { kind: 'reject' } : refused
	if (verb === 'enable' || verb === 'disable' || verb === 'remove') {
		if (!person && !manager) return refused
		if (arg === undefined) return { kind: 'help', text: USAGE }
		return verb === 'remove' ? { kind: 'remove', id: arg } : { kind: 'set', id: arg, enabled: verb === 'enable' }
	}
	if (verb === 'import-memory') return person ? { kind: 'import', dir: arg } : refused
	return { kind: 'help', text: USAGE }
}
```

- [ ] **Step 5: ขยาย state contract**

แทนที่ `plugins/forge/types/index.d.ts` ด้วย:

```ts
export type HitRecord = { ruleId: string; tool: string; kind: 'deny' | 'rewrite' | 'warn'; at: number; summary: string }

export type RecentCallState = { tool: string; summary: string }

export type DraftState = { rule: Record<string, unknown>; lesson: string }

export type ErrorRecord = { at: number; where: string; message: string }

declare module 'claude-code' {
	interface PluginState {
		forge: {
			allowOnce: string[]
			hits: HitRecord[]
			warned: string[]
			draft: DraftState | null
			pending: { text: string; calls: RecentCallState[] } | null
			recent: RecentCallState[]
			history: string[]
			importQueue: DraftState[]
			errors: ErrorRecord[]
		}
	}
}
```

(ร่างกฎเก็บเป็น JSON ของกฎ (`ruleToJson`) เพราะ state ต้องเป็นข้อมูลล้วน แล้วแปลงกลับด้วย `toRule` ตอนใช้)

- [ ] **Step 6: register.tsx — เพิ่มการเรียนรู้**

ย้ายไฟล์และแก้ hooks.json:

```bash
git mv plugins/forge/hooks/register.ts plugins/forge/hooks/register.tsx
printf '{ "modules": ["./register.tsx"] }\n' > plugins/forge/hooks/hooks.json
```

เพิ่มใน `register.tsx` (คงของช่วง 1 ไว้ทั้งหมด):

1. import เพิ่ม:

```ts
import { toRule } from './config'
import { ruleToJson, withRule } from './guards-file'
import { draftPrompt, isLessonCandidate, parseDraft, tooBroad } from './lessons'
import type { RecentCall } from './lessons'
import { personalFor, remove, setEnabled, upsert } from './personal'
import type { PersonalRule } from './personal'
import { validateRule } from './safety'
import { parseLessonsArgs, ruleRows } from './rules-view'
import type { DraftState, ErrorRecord, RecentCallState } from '../types'
```

2. atom เพิ่ม (ถัดจาก atom เดิม):

```ts
const draftAtom = atom({ plugin: 'forge', key: 'draft' } as const, null as DraftState | null)
const pendingAtom = atom(
	{ plugin: 'forge', key: 'pending' } as const,
	null as { text: string; calls: RecentCallState[] } | null
)
const recentAtom = atom({ plugin: 'forge', key: 'recent' } as const, [] as RecentCallState[])
const historyAtom = atom({ plugin: 'forge', key: 'history' } as const, [] as string[])
const importQueueAtom = atom({ plugin: 'forge', key: 'importQueue' } as const, [] as DraftState[])
const errorsAtom = atom({ plugin: 'forge', key: 'errors' } as const, [] as ErrorRecord[])
const PANE = 'lessons'
```

3. helper ในไฟล์เดียวกัน:

```ts
async function recordError($: EngineInterface, where: string, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err)
	const at = await $.clock.now()
	await update($, errorsAtom, (list) => [...list, { at, where, message }].slice(-50))
}

async function personalRules($: EngineInterface): Promise<PersonalRule[]> {
	const raw = await $.store.get('personalRules')
	return Array.isArray(raw) ? (raw as PersonalRule[]) : []
}

async function allRules(
	$: EngineInterface
): Promise<{ repo: RepoConfig; personalRepo: Rule[]; personal: Rule[]; merged: Rule[] }> {
	const repo = await loadRepo($)
	const mine = personalFor(await personalRules($), repo.root)
	return {
		repo,
		personalRepo: mine.repo,
		personal: mine.any,
		merged: mergeRules(repo.rules, mine.repo, mine.any, BUILTIN_RULES),
	}
}

// ร่างกฎหนึ่งข้อ: ตรวจ validate + กว้างเกิน; คืนข้อความปัญหาหรือ undefined
async function checkDraft($: EngineInterface, rule: Rule, vars: Vars): Promise<string | undefined> {
	const problems = validateRule(rule, vars, CHECK_NAMES)
	if (problems.length > 0) return problems.join(' · ')
	return tooBroad(rule, await read($, historyAtom), vars)
}

async function showNextDraft($: EngineInterface): Promise<void> {
	const queue = await read($, importQueueAtom)
	const [next, ...rest] = queue
	await update($, importQueueAtom, () => rest)
	await update($, draftAtom, () => next ?? null)
}
```

(เพิ่ม `Rule`, `Vars` ใน import type จาก `./types`)

4. ใน hook `tool.call` เดิม: แทน `const rules = mergeRules(repo.rules, BUILTIN_RULES)` ด้วยการรวมกฎส่วนตัว:

```ts
const mine = personalFor(await personalRules($), repo.root)
const rules = mergeRules(repo.rules, mine.repo, mine.any, BUILTIN_RULES)
```

และหลัง `const ran = await next(out.input as typeof e)` (ก่อน return) บันทึกประวัติ:

```ts
if (ran.deny === undefined && ran.isError !== true) {
	const summary = e.tool === 'Bash' ? String(out.input['command'] ?? '') : String(out.input['file_path'] ?? e.tool)
	await update($, recentAtom, (list) => [...list, { tool: e.tool, summary: summary.slice(0, 300) }].slice(-3))
	if (e.tool === 'Bash') await update($, historyAtom, (list) => [...list, summary].slice(-200))
}
if (out.hits.length > 0) {
	const log = await $.store.get('hitlog')
	const prev = Array.isArray(log) ? (log as { ruleId: string; at: number }[]) : []
	await $.store.set('hitlog', [...prev, ...out.hits.map((h) => ({ ruleId: h.ruleId, at: h.at }))].slice(-1000))
}
```

(บล็อก hitlog วางก่อน `if (out.deny !== undefined)` ด้วย เพื่อให้นับ deny; ย้ายให้อยู่จุดเดียวก่อน deny)

5. hook ใหม่:

```ts
on('prompt.submit', async ($, e, next) => {
	try {
		if (e.origin.kind === 'composer') {
			await update($, pendingAtom, () => null)
			const calls = await read($, recentAtom)
			if (isLessonCandidate(e.text, calls)) await update($, pendingAtom, () => ({ text: e.text, calls }))
			await update($, recentAtom, () => [])
		}
	} catch (err) {
		await recordError($, 'prompt.submit', err)
	}
	return next(e)
})

on('turn.complete', async ($, e, next) => {
	const res = await next(e)
	if (e.agentId !== undefined) return res
	const pending = await read($, pendingAtom)
	if (pending === null) return res
	await update($, pendingAtom, () => null)
	try {
		const label = await $.model.classify(pending.text, ['correction', 'task'])
		if (label !== 'correction') return res
		const answer = await $.model.complete({ prompt: draftPrompt(pending.text, pending.calls as RecentCall[]) })
		if (!answer.isAnswered) return res
		const parsed = parseDraft(answer.text)
		if (!('rule' in parsed)) {
			await recordError($, 'lesson-draft', parsed.error)
			return res
		}
		const repo = await loadRepo($)
		const problem = await checkDraft($, parsed.rule, repo.vars)
		if (problem !== undefined) {
			await recordError($, 'lesson-draft', `${parsed.rule.id}: ${problem}`)
			return res
		}
		await update($, draftAtom, () => ({ rule: ruleToJson(parsed.rule), lesson: pending.text }))
	} catch (err) {
		await recordError($, 'turn.complete', err)
	}
	return res
})
```

ถ้า `TurnCompleteInput` ไม่มี `agentId` บน main loop ให้ใช้เงื่อนไขตาม type (field ที่บอกว่าเป็น subagent) แทน `e.agentId !== undefined`; ถ้า `$.model.complete` ต้องมี `model` ให้ใส่ model เล็กที่สุดที่ `ModelCompleteInput` รับ

6. tools + `/lessons`:

```ts
on('session.start', async ($, e, next) => {
	const res = await next(e)
	await $.command.register({
		name: 'lessons',
		description: 'คลังกฎของ forge · accept/reject ร่างกฎ · enable/disable/remove <id> · import-memory [dir]',
	})
	await $.tool.register({
		name: 'propose_rule',
		description: 'เสนอกฎใหม่ให้ forge (JSON แบบ guards.json) ผู้ใช้ต้องกดยืนยันก่อนกฎทำงาน',
		inputSchema: {
			type: 'object',
			properties: { rule: { type: 'object' }, lesson: { type: 'string' } },
			required: ['rule'],
		},
	})
	await $.tool.register({
		name: 'rules',
		description: 'รายการกฎของ forge ที่ใช้ใน repo นี้ (JSON)',
		inputSchema: { type: 'object', properties: {} },
	})
	return res
})

on('tool.call', { tool: 'mcp__forge__propose_rule' }, async ($, e) => {
	const input = e as unknown as Record<string, unknown>
	const { rule, error } = toRule(input['rule'], 0)
	if (rule === undefined) return { result: `ร่างกฎใช้ไม่ได้: ${error ?? ''}` }
	const repo = await loadRepo($)
	const problem = await checkDraft($, rule, repo.vars)
	if (problem !== undefined) return { result: `ร่างกฎใช้ไม่ได้: ${problem}` }
	await update($, draftAtom, () => ({ rule: ruleToJson(rule), lesson: String(input['lesson'] ?? 'เสนอโดย Claude') }))
	return { result: `ร่างกฎ ${rule.id} รอผู้ใช้กดยืนยันที่แถบเหนือช่องพิมพ์ (หรือพิมพ์ /lessons accept ...)` }
})

on('tool.call', { tool: 'mcp__forge__rules' }, async ($) => {
	const all = await allRules($)
	const log = await $.store.get('hitlog')
	const rows = ruleRows(
		{ repo: all.repo.rules, personalRepo: all.personalRepo, personal: all.personal, builtin: BUILTIN_RULES },
		Array.isArray(log) ? (log as { ruleId: string; at: number }[]) : [],
		await $.clock.now()
	)
	return { result: JSON.stringify({ rules: rows, errors: all.repo.errors }) }
})

on('command.run', { command: 'lessons' }, async ($, e) => {
	const origin = (e.origin as { kind?: string; name?: string } | undefined) ?? {}
	const action = parseLessonsArgs(e.args, { kind: origin.kind ?? 'unknown', name: origin.name })
	if (action.kind === 'refused' || action.kind === 'help') return { text: action.text }
	if (action.kind === 'open') {
		await $.ui.open({ id: PANE, title: 'forge · คลังกฎ' })
		return { text: 'เปิดคลังกฎแล้ว' }
	}
	if (action.kind === 'reject') {
		await showNextDraft($)
		return { text: 'ทิ้งร่างกฎแล้ว' }
	}
	if (action.kind === 'accept') {
		const draft = await read($, draftAtom)
		if (draft === null) return { text: 'ไม่มีร่างกฎที่รออยู่' }
		const { rule } = toRule(draft.rule, 0)
		if (rule === undefined) return { text: 'ร่างกฎเสีย ทิ้งแล้ว' }
		const repo = await loadRepo($)
		if (action.scope === 'file') {
			if (repo.root === null) return { text: 'ไม่ได้อยู่ใน git repo จึงเขียน .claude/guards.json ไม่ได้' }
			const path = `${repo.root}/${GUARDS_FILE}`
			const current = (await $.fs.exists(path)) ? await $.fs.read(path) : null
			const merged = withRule(typeof current === 'string' ? current : null, rule)
			if ('error' in merged) return { text: merged.error }
			await $.fs.write(path, merged.text)
		} else {
			if (action.scope === 'repo' && repo.root === null) return { text: 'ไม่ได้อยู่ใน git repo จึงผูกกับ repo ไม่ได้' }
			const scope =
				action.scope === 'repo' && repo.root !== null
					? { kind: 'repo' as const, root: repo.root }
					: { kind: 'any-repo' as const }
			const item: PersonalRule = { rule, scope, createdAt: await $.clock.now(), lesson: draft.lesson }
			await $.store.set('personalRules', upsert(await personalRules($), item))
		}
		await showNextDraft($)
		void $.ui.toast(`forge: เปิดใช้กฎ ${rule.id} แล้ว`)
		return { text: `เปิดใช้กฎ ${rule.id} (${action.scope}) แล้ว` }
	}
	if (action.kind === 'set' || action.kind === 'remove') {
		const list = await personalRules($)
		if (!list.some((p) => p.rule.id === action.id))
			return {
				text: `${action.id} ไม่ใช่กฎส่วนตัว (กฎของ repo แก้ใน .claude/guards.json, กฎในตัวปิดได้ด้วยกฎ repo id เดียวกันที่ enabled: false)`,
			}
		await $.store.set(
			'personalRules',
			action.kind === 'remove' ? remove(list, action.id) : setEnabled(list, action.id, action.enabled)
		)
		return { text: `${action.kind === 'remove' ? 'ลบ' : action.enabled ? 'เปิด' : 'ปิด'}กฎ ${action.id} แล้ว` }
	}
	return { text: await importMemory($, action.dir) }
})
```

7. ui.render: แถบร่างกฎ และ pane คลังกฎ:

```tsx
on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
	const draft = await read($, draftAtom)
	if (draft === null) return next(e)
	const { rule } = toRule(draft.rule, 0)
	if (rule === undefined) return next(e)
	const { Box, Button, Text } = $.ui.resolve(e)
	const run = (args: string) => () => $.command.run({ command: 'lessons', args })
	return (
		<Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
			<Text bold>forge เจอบทเรียนใหม่: {rule.id}</Text>
			<Text dimColor wrap="wrap">
				“{draft.lesson.slice(0, 160)}”
			</Text>
			<Text wrap="wrap">
				{rule.action} · {rule.match ?? rule.check ?? ''} · {rule.why}
			</Text>
			<Box gap={1}>
				<Button key="any" label="ใช้ทุก repo" variant="primary" onPress={run('accept any-repo')} />
				<Button key="repo" label="เฉพาะ repo นี้" onPress={run('accept repo')} />
				<Button key="file" label="เขียนลง guards.json" onPress={run('accept file')} />
				<Button
					key="edit"
					label="แก้ก่อน"
					onPress={() =>
						$.prompt.fill({
							text: `ช่วยปรับกฎนี้แล้วส่งใหม่ด้วย tool propose_rule:\n${JSON.stringify(draft.rule)}\n`,
							mode: 'replace',
						})
					}
				/>
				<Button key="no" label="ไม่ต้อง" role="dismiss" onPress={run('reject')} />
			</Box>
		</Box>
	)
})

on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
	const { Box, Button, Text } = $.ui.resolve(e)
	const all = await allRules($)
	const log = await $.store.get('hitlog')
	const rows = ruleRows(
		{ repo: all.repo.rules, personalRepo: all.personalRepo, personal: all.personal, builtin: BUILTIN_RULES },
		Array.isArray(log) ? (log as { ruleId: string; at: number }[]) : [],
		await $.clock.now()
	)
	return (
		<Box flexDirection="column">
			<Text dimColor>
				repo: {all.repo.root ?? '(ไม่อยู่ใน git repo)'} · กฎ {rows.length} ข้อ
			</Text>
			{rows.map((r) => (
				<Box key={r.id} gap={1}>
					<Text color={r.enabled ? 'success' : 'inactive'}>{r.enabled ? '●' : '○'}</Text>
					<Text>{r.id}</Text>
					<Text dimColor>
						{r.source} · {r.action} · ดัก {r.hits30} ครั้ง/30 วัน
					</Text>
					{r.source.startsWith('personal') && (
						<Button
							key={`t-${r.id}`}
							label={r.enabled ? 'ปิด' : 'เปิด'}
							plain
							onPress={() => $.command.run({ command: 'lessons', args: `${r.enabled ? 'disable' : 'enable'} ${r.id}` })}
						/>
					)}
				</Box>
			))}
			{all.repo.errors.map((err) => (
				<Text key={err} color="error">
					{err}
				</Text>
			))}
		</Box>
	)
})
```

หมายเหตุความปลอดภัย: ปุ่มเรียก `$.command.run` จาก plugin `forge` เอง origin จะเป็น `{ kind: 'plugin', name: 'forge' }` ซึ่ง `parseLessonsArgs` ปฏิเสธ — ให้ปุ่มเรียกฟังก์ชันภายในไฟล์แทน: แยกตัว handler ของ `command.run` ออกเป็น `async function applyLessons($, action: LessonsAction): Promise<string>` ในไฟล์เดียวกัน แล้วปุ่มเรียก `applyLessons($, { kind: 'accept', scope: 'repo' })` ตรงๆ (การกดปุ่มคือการกระทำของผู้ใช้) ส่วน `command.run` เรียก `applyLessons($, parseLessonsArgs(...))`

8. `importMemory`:

```ts
async function importMemory($: EngineInterface, dir: string | undefined): Promise<string> {
	const home = await $.env.get('HOME')
	const cwd = await $.session.cwd()
	const target = dir ?? `${home ?? ''}/.claude/projects/${cwd.replace(/[/.]/g, '-')}/memory`
	if (!(await $.fs.exists(target))) return `ไม่พบโฟลเดอร์ memory: ${target} (ระบุเองด้วย /lessons import-memory <dir>)`
	const names = (await $.fs.list(target))
		.map((x) => (typeof x === 'string' ? x : String((x as { name?: unknown }).name ?? '')))
		.filter((n) => /^feedback.*\.md$/.test(n))
	const repo = await loadRepo($)
	const drafts: DraftState[] = []
	const skipped: string[] = []
	for (const name of names) {
		const text = await $.fs.read(`${target}/${name}`)
		if (typeof text !== 'string' || text.trim() === '') continue
		const answer = await $.model.complete({
			prompt: draftPrompt(text.slice(0, 4000), [{ tool: 'memory', summary: name }]),
		})
		if (!answer.isAnswered) continue
		const parsed = parseDraft(answer.text)
		if (!('rule' in parsed)) {
			skipped.push(`${name}: ${parsed.error}`)
			continue
		}
		const problem = await checkDraft($, parsed.rule, repo.vars)
		if (problem !== undefined) {
			skipped.push(`${name}: ${problem}`)
			continue
		}
		drafts.push({ rule: ruleToJson(parsed.rule), lesson: `memory: ${name}` })
	}
	await update($, importQueueAtom, (q) => [...q, ...drafts])
	if ((await read($, draftAtom)) === null) await showNextDraft($)
	return `อ่าน memory ${names.length} ไฟล์ · ได้ร่างกฎ ${drafts.length} ข้อ รอยืนยันทีละข้อ · ข้าม ${skipped.length}${skipped.length > 0 ? `\n${skipped.join('\n')}` : ''}`
}
```

ถ้า `$.fs.list` คืนชนิดต่างจากนี้ ให้ map ตาม `FsListResult` ใน type

- [ ] **Step 7: รันเทสต์ให้ผ่าน + check**

Run: `claude plugin test plugins/forge && CLAUDE_MOD_TYPES=<path> bash scripts/check.sh`
Expected: PASS ทั้งหมด; tsc ไม่มี error

- [ ] **Step 8: ลองใน session**

`/reload-plugins` → แก้ Claude หลังมันรันคำสั่ง (เช่น "อย่ารัน npm install ตรงๆ ให้ใช้ npm ci") → จบเทิร์นแล้วต้องเห็นแถบร่างกฎ → กด "ไม่ต้อง" → `/lessons` เห็น pane คลังกฎ

- [ ] **Step 9: Commit**

```bash
git add -A plugins/forge
git commit -m "feat(forge): learn rules from corrections, /lessons, propose_rule and rules tools

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4: import บทเรียนจาก memory (เทสต์)

**Files:**

- Test: `plugins/forge/tests/import-memory.test.ts`

**Interfaces:**

- Consumes: `importMemory` ผ่าน `/lessons import-memory <dir>` (Task A3)

- [ ] **Step 1: เทสต์**

`plugins/forge/tests/import-memory.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import { world } from './helpers'

const P = { isFullscreen: false, columns: 120 }

test('import-memory drafts one rule per usable feedback file and skips the rest', async ($, on) => {
	world(on, {
		root: null,
		files: {
			'/m/feedback_a.md': 'อย่าใช้ git stash เปล่า',
			'/m/feedback_b.md': 'ไม่มีอะไรบังคับได้',
			'/m/feedback_c.md': '',
		},
	})
	on('fs.list', () => ({ value: ['feedback_a.md', 'feedback_b.md', 'feedback_c.md', 'project_x.md'] }))
	on('model.complete', ($, e) => {
		const prompt = String((e as unknown as Record<string, unknown>)['prompt'])
		const text = prompt.includes('feedback_a.md')
			? '{"id":"bare-stash","tool":"Bash","match":"^git stash$","action":"deny","why":"x","examples":{"hit":["git stash"],"miss":["git status","git stash list"]}}'
			: 'NO_RULE'
		return {
			value: {
				isAnswered: true,
				text,
				usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
			},
		}
	})
	const data = new Map<string, unknown>()
	on('store.get', ($, e) => ({ value: data.get(e.key) }))
	on('store.set', ($, e) => {
		data.set(e.key, e.value)
		return { value: undefined }
	})
	const res = await $.command.run({
		command: 'lessons',
		args: 'import-memory /m',
		origin: { kind: 'composer' },
		presentation: P,
	})
	expect(res.text).toContain('ได้ร่างกฎ 1 ข้อ')
	expect(res.text).toContain('feedback_b.md')
	const accepted = await $.command.run({
		command: 'lessons',
		args: 'accept any-repo',
		origin: { kind: 'composer' },
		presentation: P,
	})
	expect(accepted.text).toContain('bare-stash')
})
```

- [ ] **Step 2: รันให้ผ่าน** (โค้ดมีแล้วจาก A3; ถ้าล้มแปลว่า A3 ผิด แก้ที่ A3)

Run: `claude plugin test plugins/forge`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add plugins/forge/tests/import-memory.test.ts
git commit -m "test(forge): import lessons from memory

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part B — Proof Gate (`proof`)

### Task B0: ยืนยัน `$.prompt.submit` (spike S1b)

**Files:** แก้ mod spikes ใน dev-mods (ทิ้งได้), `docs/spikes/2026-10-results.md`

- [ ] **Step 1:** เพิ่ม action `s1b` ใน tool `probe` ของ mod spikes: `await $.prompt.submit({ text: 'S1b: ตอบแค่คำว่า PONG-S1b' })` คืน `{ result: 'queued' }`
- [ ] **Step 2:** จบเทิร์นให้ mod reload แล้วเรียก `mcp__spikes__probe` action `s1b`; ดูว่าหลังเทิร์นจบมีเทิร์นใหม่ที่ prompt คือ "S1b: ..." เริ่มเองไหม
- [ ] **Step 3:** เขียนผลเพิ่มแถว S1b ในไฟล์ผล spike แล้ว commit: ถ้า yes → ปุ่ม "ให้ Claude แก้ต่อ" และ Autopilot ใช้ `$.prompt.submit`; ถ้า no → ใช้ `$.prompt.fill` (ผู้ใช้กด Enter) และ Autopilot ทุกขั้นต้องรอผู้ใช้กด Enter — ledger เป็น ruling

### Task B1: วางแผนคำสั่งพิสูจน์และสรุปผล (pure)

**Files:**

- Create: `plugins/proof/.claude-plugin/plugin.json`, `plugins/proof/hooks/hooks.json`, `plugins/proof/hooks/plan.ts`, `plugins/proof/hooks/results.ts`, `plugins/proof/types/index.d.ts`
- Modify: `.claude-plugin/marketplace.json`
- Test: `plugins/proof/tests/plan.test.ts`, `plugins/proof/tests/results.test.ts`

**Interfaces:**

- Produces:
  - `type ProofCommand = { id: string; cwd: string; argv: string[]; label: string }` (id = label เพื่อ dedupe)
  - `parseProofConfig(text: string | null): { rules: { glob: string; command: string }[]; errors: string[] }` — อ่าน `proof` ใน guards.json: `{ "proof": { "<glob>": "<command>" } }`
  - `commandsFor(paths: readonly string[], root: string, config: { glob: string; command: string }[], projects: readonly { dir: string; kind: 'tsc' | 'vitest' }[]): ProofCommand[]` — ใช้ config ก่อน; path ที่ไม่มี config ใช้ project ใกล้สุด (`tsc` → `npx tsc --noEmit -p <dir>`, `vitest` → `npx vitest related --run <files relative to dir>` cwd=dir)
  - `splitCommand(command: string): string[]` (แยกด้วยช่องว่างนอกเครื่องหมายคำพูด; ห้าม `;`, `&&`, `|` → คืน `[]`)
  - `type ProofResult = { id: string; label: string; status: 'running' | 'pass' | 'fail' | 'flaky'; exitCode: number | null; tail: string; at: number; durationMs: number }`
  - `statusLine(results: readonly ProofResult[]): string | undefined`
  - `bandText(results: readonly ProofResult[]): string | undefined` — มี fail/running เท่านั้น
  - `continuePrompt(results: readonly ProofResult[]): string`
  - `settle(runs: readonly { exitCode: number }[]): 'pass' | 'fail' | 'flaky'` — รอบแรกผ่าน = pass; รอบแรกล้มแต่รอบหลังมีผ่าน = flaky; ล้มทุกรอบ = fail

- [ ] **Step 1: manifests**

`plugins/proof/.claude-plugin/plugin.json`:

```json
{
	"name": "proof",
	"version": "0.1.0",
	"description": "รันเทสต์และ typecheck ที่เกี่ยวข้องเบื้องหลังหลังแก้ไฟล์ และเตือนเมื่อปิดงานทั้งที่ยังแดง",
	"author": { "name": "Ditthapong-j" },
	"types": "./types/index.d.ts",
	"userConfig": {
		"autoRun": {
			"type": "boolean",
			"title": "รันอัตโนมัติหลังแก้ไฟล์",
			"description": "ปิด = รันเฉพาะเมื่อพิมพ์ /proof run",
			"default": true
		}
	}
}
```

`plugins/proof/hooks/hooks.json`: `{ "modules": ["./register.tsx"] }`

เพิ่มใน `.claude-plugin/marketplace.json` → `plugins`:

```json
{
	"name": "proof",
	"source": "./plugins/proof",
	"description": "Proof Gate: หลักฐานเทสต์บนจอ และเตือนเมื่อปิดงานทั้งที่ยังแดง"
}
```

- [ ] **Step 2: เทสต์ที่ล้ม**

`plugins/proof/tests/plan.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { commandsFor, parseProofConfig, splitCommand } from '../hooks/plan'

describe('parseProofConfig', () => {
	test('reads the proof map and reports bad entries', () => {
		const out = parseProofConfig('{"proof":{"apps/web/**":"npx tsc -p apps/web/tsconfig.app.json --noEmit","x/**":42}}')
		expect(out.rules).toEqual([{ glob: 'apps/web/**', command: 'npx tsc -p apps/web/tsconfig.app.json --noEmit' }])
		expect(out.errors[0]).toContain('x/**')
		expect(parseProofConfig(null)).toEqual({ rules: [], errors: [] })
		expect(parseProofConfig('{ nope').errors.length).toBe(1)
	})
})

describe('splitCommand', () => {
	test('keeps quoted args and refuses shell operators', () => {
		expect(splitCommand('dotnet test --filter "A&B"')).toEqual(['dotnet', 'test', '--filter', 'A&B'])
		expect(splitCommand('npm test && rm -rf x')).toEqual([])
		expect(splitCommand('a | b')).toEqual([])
	})
})

describe('commandsFor', () => {
	test('config first, then the nearest project, deduplicated', () => {
		const cmds = commandsFor(
			['/r/apps/web/src/a.tsx', '/r/apps/web/src/b.tsx', '/r/libs/x/y.ts', '/r/README.md'],
			'/r',
			[{ glob: 'apps/web/**', command: 'npx tsc -p apps/web/tsconfig.app.json --noEmit' }],
			[
				{ dir: '/r/libs/x', kind: 'tsc' },
				{ dir: '/r/libs/x', kind: 'vitest' },
			]
		)
		expect(cmds.map((c) => c.label)).toEqual([
			'npx tsc -p apps/web/tsconfig.app.json --noEmit',
			'npx tsc --noEmit -p /r/libs/x',
			'npx vitest related --run y.ts (/r/libs/x)',
		])
		expect(cmds[0]?.cwd).toBe('/r')
		expect(cmds[2]?.cwd).toBe('/r/libs/x')
	})
})
```

`plugins/proof/tests/results.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { bandText, continuePrompt, settle, statusLine } from '../hooks/results'
import type { ProofResult } from '../hooks/results'

const r = (label: string, status: ProofResult['status']): ProofResult => ({
	id: label,
	label,
	status,
	exitCode: status === 'fail' ? 1 : 0,
	tail: `${label} log`,
	at: 0,
	durationMs: 1000,
})

describe('results', () => {
	test('status line counts', () => {
		expect(statusLine([])).toBeUndefined()
		expect(statusLine([r('a', 'pass'), r('b', 'fail'), r('c', 'running'), r('d', 'flaky')])).toBe(
			'proof: 1 ✓ · 1 ✗ · 1 flaky · รันอยู่ 1'
		)
	})
	test('band only when something is red or still running', () => {
		expect(bandText([r('a', 'pass')])).toBeUndefined()
		expect(bandText([r('a', 'fail')])).toContain('1')
		expect(bandText([r('a', 'running')])).toContain('ยังรัน')
	})
	test('continue prompt carries each failure with its tail', () => {
		const p = continuePrompt([r('npx tsc', 'fail'), r('ok', 'pass')])
		expect(p).toContain('npx tsc')
		expect(p).toContain('npx tsc log')
		expect(p).not.toContain('ok log')
	})
	test('settle: pass, flaky, fail', () => {
		expect(settle([{ exitCode: 0 }])).toBe('pass')
		expect(settle([{ exitCode: 1 }, { exitCode: 0 }])).toBe('flaky')
		expect(settle([{ exitCode: 1 }, { exitCode: 1 }, { exitCode: 1 }])).toBe('fail')
	})
})
```

- [ ] **Step 3: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/proof`
Expected: FAIL — ยังไม่มี hooks module / plan.ts

- [ ] **Step 4: เขียนโค้ด**

`plugins/proof/hooks/plan.ts`:

```ts
export type ProofCommand = { id: string; cwd: string; argv: string[]; label: string }

type ConfigRule = { glob: string; command: string }

function globToRegExp(glob: string): RegExp {
	let out = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob.charAt(i)
		if (c === '*') {
			if (glob.charAt(i + 1) === '*') {
				out += '.*'
				i++
				if (glob.charAt(i + 1) === '/') i++
			} else out += '[^/]*'
		} else if (c === '?') out += '[^/]'
		else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
	}
	return new RegExp(`^${out}$`)
}

export function parseProofConfig(text: string | null): { rules: ConfigRule[]; errors: string[] } {
	if (text === null || text.trim() === '') return { rules: [], errors: [] }
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		return {
			rules: [],
			errors: [`.claude/guards.json ไม่ใช่ JSON: ${err instanceof Error ? err.message : String(err)}`],
		}
	}
	const proof = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['proof'] : undefined
	if (proof === undefined) return { rules: [], errors: [] }
	if (typeof proof !== 'object' || proof === null)
		return { rules: [], errors: ['proof ต้องเป็น object ของ glob → คำสั่ง'] }
	const rules: ConfigRule[] = []
	const errors: string[] = []
	for (const [glob, command] of Object.entries(proof)) {
		if (typeof command === 'string' && splitCommand(command).length > 0) rules.push({ glob, command })
		else errors.push(`proof["${glob}"] ต้องเป็นคำสั่งเดียว ไม่มี ; && |`)
	}
	return { rules, errors }
}

export function splitCommand(command: string): string[] {
	const out: string[] = []
	let cur = ''
	let quote: string | null = null
	for (const c of command) {
		if (quote !== null) {
			if (c === quote) quote = null
			else cur += c
		} else if (c === '"' || c === "'") quote = c
		else if (c === ';' || c === '|' || c === '`' || c === '>' || c === '<') return []
		else if (c === '&') {
			return []
		} else if (/\s/.test(c)) {
			if (cur !== '') out.push(cur)
			cur = ''
		} else cur += c
	}
	if (cur !== '') out.push(cur)
	return quote === null ? out : []
}

function rel(path: string, base: string): string {
	return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

function nearest(
	path: string,
	projects: readonly { dir: string; kind: 'tsc' | 'vitest' }[],
	kind: 'tsc' | 'vitest'
): string | undefined {
	return projects
		.filter((p) => p.kind === kind && path.startsWith(`${p.dir}/`))
		.sort((a, b) => b.dir.length - a.dir.length)[0]?.dir
}

export function commandsFor(
	paths: readonly string[],
	root: string,
	config: readonly ConfigRule[],
	projects: readonly { dir: string; kind: 'tsc' | 'vitest' }[]
): ProofCommand[] {
	const out: ProofCommand[] = []
	const add = (cmd: ProofCommand): void => {
		if (!out.some((c) => c.id === cmd.id)) out.push(cmd)
	}
	const vitest = new Map<string, string[]>()
	for (const path of paths) {
		const relPath = rel(path, root)
		const hit = config.find((c) => globToRegExp(c.glob).test(relPath))
		if (hit !== undefined) {
			add({ id: hit.command, cwd: root, argv: splitCommand(hit.command), label: hit.command })
			continue
		}
		if (!/\.(tsx?|jsx?|mts|cts)$/.test(path)) continue
		const tsc = nearest(path, projects, 'tsc')
		if (tsc !== undefined) {
			const label = `npx tsc --noEmit -p ${tsc}`
			add({ id: label, cwd: tsc, argv: ['npx', 'tsc', '--noEmit', '-p', tsc], label })
		}
		const vdir = nearest(path, projects, 'vitest')
		if (vdir !== undefined) vitest.set(vdir, [...(vitest.get(vdir) ?? []), rel(path, vdir)])
	}
	for (const [dir, files] of vitest) {
		const label = `npx vitest related --run ${files.join(' ')} (${dir})`
		add({ id: `vitest:${dir}`, cwd: dir, argv: ['npx', 'vitest', 'related', '--run', ...files], label })
	}
	return out
}
```

`plugins/proof/hooks/results.ts`:

```ts
export type ProofResult = {
	id: string
	label: string
	status: 'running' | 'pass' | 'fail' | 'flaky'
	exitCode: number | null
	tail: string
	at: number
	durationMs: number
}

export function statusLine(results: readonly ProofResult[]): string | undefined {
	if (results.length === 0) return undefined
	const n = (s: ProofResult['status']) => results.filter((r) => r.status === s).length
	const parts = [`${n('pass')} ✓`, `${n('fail')} ✗`]
	if (n('flaky') > 0) parts.push(`${n('flaky')} flaky`)
	if (n('running') > 0) parts.push(`รันอยู่ ${n('running')}`)
	return `proof: ${parts.join(' · ')}`
}

export function bandText(results: readonly ProofResult[]): string | undefined {
	const fails = results.filter((r) => r.status === 'fail').length
	const running = results.filter((r) => r.status === 'running').length
	if (fails > 0)
		return `Claude ปิดงานแล้ว แต่ยังมีคำสั่งพิสูจน์ที่ล้ม ${fails} ชุด${running > 0 ? ` (ยังรันอีก ${running})` : ''}`
	if (running > 0) return `Claude ปิดงานแล้ว แต่ยังรันคำสั่งพิสูจน์อยู่ ${running} ชุด`
	return undefined
}

export function continuePrompt(results: readonly ProofResult[]): string {
	const fails = results.filter((r) => r.status === 'fail')
	const body = fails.map((r) => `### ${r.label} (exit ${r.exitCode ?? '?'})\n\`\`\`\n${r.tail}\n\`\`\``).join('\n\n')
	return `คำสั่งพิสูจน์เหล่านี้ยังล้มหลังการแก้ล่าสุด แก้ให้ผ่านแล้วรันใหม่ยืนยัน:\n\n${body}`
}

export function settle(runs: readonly { exitCode: number }[]): 'pass' | 'fail' | 'flaky' {
	if (runs[0]?.exitCode === 0) return 'pass'
	return runs.slice(1).some((r) => r.exitCode === 0) ? 'flaky' : 'fail'
}
```

`plugins/proof/types/index.d.ts`:

```ts
export type ProofResultState = {
	id: string
	label: string
	status: 'running' | 'pass' | 'fail' | 'flaky'
	exitCode: number | null
	tail: string
	at: number
	durationMs: number
}

declare module 'claude-code' {
	interface PluginState {
		proof: {
			touched: string[]
			results: ProofResultState[]
			bandHidden: boolean
			enabled: boolean
			busy: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
```

(B2 สร้าง `register.tsx`; เทสต์ pure ไม่ต้องโหลด module แต่ kit โหลด plugin ทั้งตัว — ให้สร้าง `register.tsx` ขั้นต่ำก่อน:)

```tsx
import type { Register } from 'claude-code'

export const register: Register = () => {}
```

- [ ] **Step 5: รันเทสต์ให้ผ่าน**

Run: `claude plugin test plugins/proof`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A plugins/proof .claude-plugin/marketplace.json
git commit -m "feat(proof): plan proof commands and summarize results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task B2: proof ใน session (รันเบื้องหลัง, status line, แถบเตือน, `/proof`, tool `status`)

**Files:**

- Modify: `plugins/proof/hooks/register.tsx`
- Create: `plugins/proof/tests/helpers.ts`, `plugins/proof/tests/session.test.ts`

**Interfaces:**

- Consumes: B1
- Produces: tool `mcp__proof__status` → JSON `{ enabled: boolean, touched: string[], results: ProofResult[] }`; คำสั่ง `/proof` (`''` เปิด pane, `run`, `off`, `on`)

- [ ] **Step 1: เทสต์ที่ล้ม**

`plugins/proof/tests/helpers.ts`:

```ts
import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

export type ProofWorld = {
	files?: Record<string, string>
	runs?: { argv: readonly string[]; cwd?: string }[]
	exit?: (argv: readonly string[]) => number
	toasts?: string[]
	status?: (string | undefined)[]
	submitted?: string[]
}

export function proofWorld(on: On, w: ProofWorld): MockClock {
	const clock = mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('process.run', ($, e) => {
		if (e.argv.join(' ') === 'git rev-parse --show-toplevel')
			return { value: { exitCode: 0, stdout: '/r\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
		w.runs?.push({ argv: e.argv, cwd: e.init?.cwd })
		const code = w.exit?.(e.argv) ?? 0
		return {
			value: {
				exitCode: code,
				stdout: code === 0 ? 'ok' : 'FAIL x.test.ts',
				stderr: '',
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		}
	})
	on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }))
	on('fs.read', ($, e) => ({ value: w.files?.[e.path] ?? '' }))
	on('fs.ancestors', () => ({ value: [] }))
	on('ui.toast', ($, e) => {
		w.toasts?.push(e.text)
		return { value: undefined }
	})
	on('ui.status', ($, e) => {
		w.status?.push(e.text)
		return { value: undefined }
	})
	on('prompt.submit', ($, e) => {
		w.submitted?.push(e.text)
		return { text: e.text }
	})
	on('tool.call', { tool: 'Edit' }, () => ({
		result: {
			filePath: '/x',
			oldString: '',
			newString: '',
			originalFile: '',
			structuredPatch: [],
			userModified: false,
			replaceAll: false,
		},
	}))
	on('turn.complete', () => ({ text: 'done' }))
	return clock
}
```

`plugins/proof/tests/session.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { proofWorld } from './helpers'

const GUARDS = {
	'/r/.claude/guards.json': '{"proof":{"apps/web/**":"npx tsc -p apps/web/tsconfig.app.json --noEmit"}}',
}
const P = { isFullscreen: false, columns: 120 }
const edit = (file_path: string) => ({ tool: 'Edit' as const, file_path, old_string: 'a', new_string: 'b' })

describe('proof in a session', () => {
	test('edits are debounced into one run of each proof command', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const status: (string | undefined)[] = []
		const clock = proofWorld(on, { files: GUARDS, runs, status })
		for (let i = 0; i < 20; i++) await $.tool.call(edit(`/r/apps/web/src/a${i}.tsx`))
		expect(runs).toEqual([])
		await clock.advance(5000)
		expect(runs.map((r) => r.argv.join(' '))).toEqual(['npx tsc -p apps/web/tsconfig.app.json --noEmit'])
		expect(status.at(-1)).toBe('proof: 1 ✓ · 0 ✗')
	})

	test('a failure is retried twice, then the band offers to continue', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const submitted: string[] = []
		const clock = proofWorld(on, { files: GUARDS, runs, submitted, exit: () => 1 })
		await $.tool.call(edit('/r/apps/web/src/a.tsx'))
		await clock.advance(5000)
		expect(runs.length).toBe(3)
		await $.turn.complete({ reason: 'answer', text: 'เสร็จแล้วครับ' })
		const res = await $.command.run({
			command: 'proof',
			args: 'continue',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(res.text).toContain('ส่งให้ Claude')
		expect(submitted[0]).toContain('npx tsc -p apps/web/tsconfig.app.json --noEmit')
	})

	test('off stops automatic runs; status tool reports state', async ($, on) => {
		const runs: { argv: readonly string[] }[] = []
		const clock = proofWorld(on, { files: GUARDS, runs })
		await $.command.run({ command: 'proof', args: 'off', origin: { kind: 'composer' }, presentation: P })
		await $.tool.call(edit('/r/apps/web/src/a.tsx'))
		await clock.advance(5000)
		expect(runs).toEqual([])
		const status = await $.tool.call({ tool: 'mcp__proof__status' })
		expect(JSON.stringify(status)).toContain('"enabled":false')
	})
})
```

`continue` คือ action เดียวกับปุ่ม "ให้ Claude แก้ต่อ" (เปิดให้เทสต์และพิมพ์เองได้); ถ้า B0 บอกว่า `$.prompt.submit` ใช้ไม่ได้ ให้ assert ว่า `prompt.fill` ถูกเรียกแทน

- [ ] **Step 2: รันให้เห็นว่าล้ม**

Run: `claude plugin test plugins/proof`
Expected: FAIL — register ยังว่าง

- [ ] **Step 3: register.tsx**

`plugins/proof/hooks/register.tsx`:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProofResultState } from '../types'
import { commandsFor, parseProofConfig } from './plan'
import type { ProofCommand } from './plan'
import { bandText, continuePrompt, settle, statusLine } from './results'

const touchedAtom = atom({ plugin: 'proof', key: 'touched' } as const, [] as string[])
const resultsAtom = atom({ plugin: 'proof', key: 'results' } as const, [] as ProofResultState[])
const bandHiddenAtom = atom({ plugin: 'proof', key: 'bandHidden' } as const, true)
const enabledAtom = atom({ plugin: 'proof', key: 'enabled' } as const, true)
const busyAtom = atom({ plugin: 'proof', key: 'busy' } as const, false)
const errorsAtom = atom(
	{ plugin: 'proof', key: 'errors' } as const,
	[] as { at: number; where: string; message: string }[]
)

const PANE = 'proof'
const DEBOUNCE_MS = 5000
const RUN_TIMEOUT_MS = 15 * 60_000
const RETRIES = 2
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

let timer: { cancel: () => void } | undefined

async function recordError($: EngineInterface, where: string, err: unknown): Promise<void> {
	const at = await $.clock.now()
	const message = err instanceof Error ? err.message : String(err)
	await update($, errorsAtom, (l) => [...l, { at, where, message }].slice(-50))
}

async function repoRoot($: EngineInterface): Promise<string | null> {
	const res = await $.process.run(['git', 'rev-parse', '--show-toplevel'], {
		cwd: await $.session.cwd(),
		timeoutMs: 5000,
	})
	return res.exitCode === 0 ? res.stdout.trim() : null
}

async function plan($: EngineInterface, root: string, paths: readonly string[]): Promise<ProofCommand[]> {
	const guards = `${root}/.claude/guards.json`
	const text = (await $.fs.exists(guards)) ? await $.fs.read(guards) : null
	const config = parseProofConfig(typeof text === 'string' ? text : null)
	for (const err of config.errors) await recordError($, 'guards.json', err)
	const projects: { dir: string; kind: 'tsc' | 'vitest' }[] = []
	for (const path of paths) {
		const found = await $.fs.ancestors({
			names: ['tsconfig.json', 'vitest.config.ts', 'vitest.config.mts'],
			of: path,
			below: root,
		})
		for (const hit of found as readonly { dir: string; name: string }[]) {
			projects.push({ dir: hit.dir, kind: hit.name.startsWith('vitest') ? 'vitest' : 'tsc' })
		}
	}
	return commandsFor(paths, root, config.rules, projects)
}

async function runOne($: EngineInterface, cmd: ProofCommand): Promise<void> {
	const started = await $.clock.now()
	await update($, resultsAtom, (l) => [
		...l.filter((r) => r.id !== cmd.id),
		{ id: cmd.id, label: cmd.label, status: 'running', exitCode: null, tail: '', at: started, durationMs: 0 },
	])
	const runs: { exitCode: number; tail: string }[] = []
	for (let i = 0; i <= RETRIES; i++) {
		const res = await $.process.run(cmd.argv, { cwd: cmd.cwd, timeoutMs: RUN_TIMEOUT_MS })
		runs.push({ exitCode: res.exitCode, tail: `${res.stdout}\n${res.stderr}`.trim().split('\n').slice(-40).join('\n') })
		if (res.exitCode === 0) break
	}
	const status = settle(runs)
	const last = runs.at(-1)
	const done = await $.clock.now()
	await update($, resultsAtom, (l) => [
		...l.filter((r) => r.id !== cmd.id),
		{
			id: cmd.id,
			label: cmd.label,
			status,
			exitCode: last?.exitCode ?? null,
			tail: last?.tail ?? '',
			at: done,
			durationMs: done - started,
		},
	])
}

async function runAll($: EngineInterface): Promise<void> {
	if (await read($, busyAtom)) return
	await update($, busyAtom, () => true)
	try {
		const root = await repoRoot($)
		const paths = await read($, touchedAtom)
		if (root === null || paths.length === 0) return
		await update($, touchedAtom, () => [])
		for (const cmd of await plan($, root, paths)) await runOne($, cmd)
	} catch (err) {
		await recordError($, 'run', err)
	} finally {
		await update($, busyAtom, () => false)
		void $.ui.status(statusLine(await read($, resultsAtom)))
	}
}

async function continueWithClaude($: EngineInterface): Promise<string> {
	const results = await read($, resultsAtom)
	if (!results.some((r) => r.status === 'fail')) return 'ไม่มีคำสั่งพิสูจน์ที่ล้ม'
	await update($, bandHiddenAtom, () => true)
	void $.prompt.submit({ text: continuePrompt(results) })
	return 'ส่งให้ Claude แก้ต่อแล้ว (เริ่มเมื่อ session ว่าง)'
}

export const register: Register = (on, options) => {
	const autoRun = options['autoRun'] !== false

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await update($, enabledAtom, () => autoRun)
		await $.command.register({ name: 'proof', description: 'หลักฐานเทสต์: เปิด pane · run · on · off · continue' })
		await $.tool.register({
			name: 'status',
			description: 'สถานะคำสั่งพิสูจน์ของ proof (JSON)',
			inputSchema: { type: 'object', properties: {} },
		})
		return res
	})

	on('tool.call', async ($, e, next) => {
		const ran = await next(e)
		try {
			if (!EDIT_TOOLS.has(e.tool) || ran.deny !== undefined || ran.isError === true) return ran
			const path =
				(e as unknown as Record<string, unknown>)['file_path'] ??
				(e as unknown as Record<string, unknown>)['notebook_path']
			if (typeof path !== 'string') return ran
			await update($, touchedAtom, (l) => (l.includes(path) ? l : [...l, path]))
			await update($, bandHiddenAtom, () => true)
			if (!(await read($, enabledAtom))) return ran
			timer?.cancel()
			timer = await $.clock.after(DEBOUNCE_MS, () => runAll($))
		} catch (err) {
			await recordError($, 'tool.call', err)
		}
		return ran
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		if (bandText(await read($, resultsAtom)) !== undefined) await update($, bandHiddenAtom, () => false)
		return res
	})

	on('tool.call', { tool: 'mcp__proof__status' }, async ($) => ({
		result: JSON.stringify({
			enabled: await read($, enabledAtom),
			touched: await read($, touchedAtom),
			results: await read($, resultsAtom),
		}),
	}))

	on('command.run', { command: 'proof' }, async ($, e) => {
		const verb = e.args.trim()
		if (verb === 'off' || verb === 'on') {
			await update($, enabledAtom, () => verb === 'on')
			return { text: `proof ${verb === 'on' ? 'เปิด' : 'ปิด'}การรันอัตโนมัติแล้ว` }
		}
		if (verb === 'run') {
			await runAll($)
			return { text: statusLine(await read($, resultsAtom)) ?? 'ไม่มีไฟล์ที่แก้รอพิสูจน์' }
		}
		if (verb === 'continue') return { text: await continueWithClaude($) }
		await $.ui.open({ id: PANE, title: 'proof · หลักฐาน' })
		return { text: 'เปิด pane proof แล้ว' }
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (await read($, bandHiddenAtom)) return next(e)
		const text = bandText(await read($, resultsAtom))
		if (text === undefined) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		return (
			<Box gap={1} borderStyle="round" borderColor="error" paddingX={1}>
				<Text wrap="wrap">{text}</Text>
				<Button key="continue" label="ให้ Claude แก้ต่อ" variant="primary" onPress={() => continueWithClaude($)} />
				<Button key="log" label="ดู log" onPress={() => $.ui.open({ id: PANE, title: 'proof · หลักฐาน' })} />
				<Button key="hide" label="ข้าม" role="dismiss" onPress={() => update($, bandHiddenAtom, () => true)} />
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const results = await read($, resultsAtom)
		const errors = await read($, errorsAtom)
		return (
			<Box flexDirection="column">
				<Text dimColor>
					{statusLine(results) ?? 'ยังไม่มีผล'} · อัตโนมัติ {(await read($, enabledAtom)) ? 'เปิด' : 'ปิด'}
				</Text>
				{results.map((r) => (
					<Box key={r.id} flexDirection="column">
						<Text color={r.status === 'pass' ? 'success' : r.status === 'fail' ? 'error' : 'warning'}>
							{r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : r.status === 'flaky' ? '~' : '…'} {r.label} ·{' '}
							{Math.round(r.durationMs / 1000)}s
						</Text>
						{r.status !== 'pass' && (
							<Text dimColor wrap="wrap">
								{r.tail}
							</Text>
						)}
					</Box>
				))}
				{errors.slice(-3).map((x) => (
					<Text key={`${x.at}`} color="error">
						{x.where}: {x.message}
					</Text>
				))}
			</Box>
		)
	})
}
```

ถ้า `$.clock.after` คืนชนิดอื่น (ไม่มี `cancel`) ให้ใช้ตามที่ type บอก (เช่น `ClockHandle`) — พฤติกรรมที่ต้องการคือ debounce: แก้ไฟล์ใหม่ยกเลิก timer เดิม; ถ้า `$.fs.ancestors` คืน shape อื่น ให้ map ตาม `FsAncestorsResult`

- [ ] **Step 4: รันเทสต์ให้ผ่าน + check**

Run: `claude plugin test plugins/proof && CLAUDE_MOD_TYPES=<path> bash scripts/check.sh`
Expected: PASS; tsc clean

- [ ] **Step 5: ติดตั้งและลองใน session (ถามผู้ใช้ก่อน)**

```bash
claude plugin install proof@claude-mods --scope user
```

`/reload-plugins` → ให้ Claude แก้ไฟล์ .ts ใน repo ที่มี tsconfig → 5 วินาทีหลังแก้เห็น status line `proof: …`

- [ ] **Step 6: Commit**

```bash
git add -A plugins/proof
git commit -m "feat(proof): background proof runs, status line, red-turn band and /proof

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part C — Mission Control (`mission`)

### Task C1: แปลงข้อมูล (pure)

**Files:**

- Create: `plugins/mission/.claude-plugin/plugin.json`, `plugins/mission/hooks/hooks.json`, `plugins/mission/hooks/parse.ts`, `plugins/mission/hooks/register.tsx` (ขั้นต่ำ), `plugins/mission/types/index.d.ts`
- Modify: `.claude-plugin/marketplace.json`
- Test: `plugins/mission/tests/parse.test.ts`

**Interfaces:**

- Produces:
  - `type Worktree = { path: string; branch: string | null }` · `parseWorktrees(porcelain: string): Worktree[]`
  - `type Pr = { number: number; title: string; branch: string; checks: 'pass' | 'fail' | 'pending' | 'none'; review: 'approved' | 'changes' | 'pending' }` · `parsePrs(json: string): Pr[] | { error: string }`
  - `type Peer = { name: string; id: string; kind: 'interactive' | 'remote'; state: string }` · `parsePeers(text: string): Peer[]`
  - `type EnvRow = { name: string; version: string | null; commit: string | null; problem: string | null }` · `parseVersion(name: string, res: { ok: boolean; status: number; text: string } | { error: string }): EnvRow`
  - `parseEnvConfig(text: string): { name: string; url: string }[] | { error: string }` (userConfig `envs` เป็น JSON string)
  - `waiting(prs: readonly Pr[], envs: readonly EnvRow[]): string[]`

- [ ] **Step 1: manifests**

`plugins/mission/.claude-plugin/plugin.json`:

```json
{
	"name": "mission",
	"version": "0.1.0",
	"description": "Mission Control: worktree, PR + CI, session อื่น และ version ของแต่ละ env ในจอเดียว",
	"author": { "name": "Ditthapong-j" },
	"types": "./types/index.d.ts",
	"userConfig": {
		"envs": {
			"type": "string",
			"title": "Environments (JSON)",
			"description": "[{\"name\":\"PROD\",\"url\":\"https://api.example.com/api/v1/version\"}]",
			"default": "[]"
		},
		"refreshSeconds": { "type": "number", "title": "อัปเดตทุกกี่วินาที", "default": 120 }
	}
}
```

`hooks.json`: `{ "modules": ["./register.tsx"] }` · register.tsx ขั้นต่ำเหมือน B1 · marketplace เพิ่ม `{ "name": "mission", "source": "./plugins/mission", "description": "Mission Control: งาน, PR, CI และ env ในจอเดียว" }`

`plugins/mission/types/index.d.ts`:

```ts
export type MissionSnapshot = {
	at: number
	worktrees: { path: string; branch: string | null; dirty: number }[]
	prs: { number: number; title: string; branch: string; checks: string; review: string }[] | { error: string }
	peers: { name: string; id: string; kind: string; state: string }[] | { error: string }
	envs: { name: string; version: string | null; commit: string | null; problem: string | null }[]
	waiting: string[]
}

declare module 'claude-code' {
	interface PluginState {
		mission: {
			snapshot: MissionSnapshot | null
			open: boolean
			errors: { at: number; where: string; message: string }[]
		}
	}
}
```

- [ ] **Step 2: เทสต์ที่ล้ม**

`plugins/mission/tests/parse.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { parseEnvConfig, parsePeers, parsePrs, parseVersion, parseWorktrees, waiting } from '../hooks/parse'

describe('parse', () => {
	test('worktrees from porcelain', () => {
		const text = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r/.wt/x\nHEAD def\ndetached\n'
		expect(parseWorktrees(text)).toEqual([
			{ path: '/r', branch: 'main' },
			{ path: '/r/.wt/x', branch: null },
		])
	})
	test('prs with checks and review', () => {
		const json = JSON.stringify([
			{
				number: 1,
				title: 'a',
				headRefName: 'fix/a',
				reviewDecision: 'APPROVED',
				statusCheckRollup: [{ conclusion: 'SUCCESS' }],
			},
			{
				number: 2,
				title: 'b',
				headRefName: 'fix/b',
				reviewDecision: 'CHANGES_REQUESTED',
				statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }],
			},
			{
				number: 3,
				title: 'c',
				headRefName: 'fix/c',
				reviewDecision: '',
				statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }],
			},
		])
		const prs = parsePrs(json)
		if ('error' in prs) throw new Error(prs.error)
		expect(prs.map((p) => `${p.number}:${p.checks}:${p.review}`)).toEqual([
			'1:pass:approved',
			'2:fail:changes',
			'3:pending:pending',
		])
		expect('error' in parsePrs('not json')).toBe(true)
	})
	test('peers from ListAgents text', () => {
		const text =
			'Peer sessions (2):\n  Fix login [ab6772]  ·  interactive  ·  idle  ·  Claude Desktop session  ·  started 3h ago\n  Deploy [128be5]  ·  Remote Control  ·  offline\n'
		expect(parsePeers(text)).toEqual([
			{ name: 'Fix login', id: 'ab6772', kind: 'interactive', state: 'idle' },
			{ name: 'Deploy', id: '128be5', kind: 'remote', state: 'offline' },
		])
	})
	test('env version rows flag a build without identity', () => {
		expect(parseVersion('DEV', { ok: true, status: 200, text: '{"version":"1.5.1","commit":"abc1234def"}' })).toEqual({
			name: 'DEV',
			version: '1.5.1',
			commit: 'abc1234',
			problem: null,
		})
		expect(
			parseVersion('AI', { ok: true, status: 200, text: '{"version":"0.0.0-dev","commit":"unknown"}' }).problem
		).toContain('build args')
		expect(parseVersion('UAT', { error: 'timeout' }).problem).toBe('timeout')
		expect(parseVersion('X', { ok: false, status: 502, text: '' }).problem).toBe('HTTP 502')
	})
	test('env config and waiting list', () => {
		expect(parseEnvConfig('[{"name":"PROD","url":"https://a.example/v"}]')).toEqual([
			{ name: 'PROD', url: 'https://a.example/v' },
		])
		expect('error' in parseEnvConfig('{')).toBe(true)
		expect(
			waiting(
				[{ number: 2, title: 'b', branch: 'x', checks: 'fail', review: 'changes' }],
				[{ name: 'AI', version: null, commit: null, problem: 'timeout' }]
			)
		).toEqual(['PR #2 b · CI แดง', 'PR #2 b · ขอแก้จาก review', 'AI · timeout'])
	})
})
```

- [ ] **Step 3: รันให้เห็นว่าล้ม** — Run: `claude plugin test plugins/mission` · Expected: FAIL (ยังไม่มี parse.ts)

- [ ] **Step 4: parse.ts**

`plugins/mission/hooks/parse.ts`:

```ts
export type Worktree = { path: string; branch: string | null }
export type Pr = {
	number: number
	title: string
	branch: string
	checks: 'pass' | 'fail' | 'pending' | 'none'
	review: 'approved' | 'changes' | 'pending'
}
export type Peer = { name: string; id: string; kind: 'interactive' | 'remote'; state: string }
export type EnvRow = { name: string; version: string | null; commit: string | null; problem: string | null }

export function parseWorktrees(porcelain: string): Worktree[] {
	return porcelain
		.split('\n\n')
		.map((block) => block.split('\n'))
		.filter((lines) => lines[0]?.startsWith('worktree ') === true)
		.map((lines) => {
			const branch = lines.find((l) => l.startsWith('branch '))
			return {
				path: (lines[0] ?? '').slice('worktree '.length),
				branch: branch === undefined ? null : branch.slice('branch refs/heads/'.length),
			}
		})
}

function rollup(checks: unknown): Pr['checks'] {
	if (!Array.isArray(checks) || checks.length === 0) return 'none'
	const list = checks as Record<string, unknown>[]
	if (
		list.some((c) =>
			['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(String(c['conclusion'] ?? c['state'] ?? ''))
		)
	)
		return 'fail'
	if (
		list.some(
			(c) =>
				c['conclusion'] === null ||
				['PENDING', 'IN_PROGRESS', 'QUEUED'].includes(String(c['status'] ?? c['state'] ?? ''))
		)
	)
		return 'pending'
	return 'pass'
}

export function parsePrs(json: string): Pr[] | { error: string } {
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch (err) {
		return { error: `อ่านผล gh ไม่ได้: ${err instanceof Error ? err.message : String(err)}` }
	}
	if (!Array.isArray(raw)) return { error: 'ผล gh ไม่ใช่ array' }
	return (raw as Record<string, unknown>[]).map((p) => ({
		number: Number(p['number']),
		title: String(p['title'] ?? ''),
		branch: String(p['headRefName'] ?? ''),
		checks: rollup(p['statusCheckRollup']),
		review:
			p['reviewDecision'] === 'APPROVED'
				? 'approved'
				: p['reviewDecision'] === 'CHANGES_REQUESTED'
					? 'changes'
					: 'pending',
	}))
}

const PEER = /^\s+(.+?) \[([0-9a-f]+)\]\s+·\s+(interactive|Remote Control)\s+·\s+(\w+)/

export function parsePeers(text: string): Peer[] {
	const out: Peer[] = []
	for (const line of text.split('\n')) {
		const m = PEER.exec(line)
		if (m === null) continue
		out.push({
			name: m[1] ?? '',
			id: m[2] ?? '',
			kind: m[3] === 'interactive' ? 'interactive' : 'remote',
			state: m[4] ?? '',
		})
	}
	return out
}

export function parseVersion(
	name: string,
	res: { ok: boolean; status: number; text: string } | { error: string }
): EnvRow {
	if ('error' in res) return { name, version: null, commit: null, problem: res.error }
	if (!res.ok) return { name, version: null, commit: null, problem: `HTTP ${res.status}` }
	let body: Record<string, unknown> = {}
	try {
		const raw: unknown = JSON.parse(res.text)
		if (typeof raw === 'object' && raw !== null) body = raw as Record<string, unknown>
	} catch {
		return { name, version: null, commit: null, problem: 'ไม่ใช่ JSON' }
	}
	const version = typeof body['version'] === 'string' ? body['version'] : null
	const commit = typeof body['commit'] === 'string' ? body['commit'].slice(0, 7) : null
	const noIdentity = version === '0.0.0-dev' || body['commit'] === 'unknown'
	return { name, version, commit, problem: noIdentity ? 'build args ไม่ถึง Dockerfile (0.0.0-dev / unknown)' : null }
}

export function parseEnvConfig(text: string): { name: string; url: string }[] | { error: string } {
	try {
		const raw: unknown = JSON.parse(text)
		if (!Array.isArray(raw)) return { error: 'envs ต้องเป็น array' }
		return (raw as Record<string, unknown>[])
			.filter(
				(e) => typeof e['name'] === 'string' && typeof e['url'] === 'string' && String(e['url']).startsWith('https://')
			)
			.map((e) => ({ name: String(e['name']), url: String(e['url']) }))
	} catch (err) {
		return { error: `envs ไม่ใช่ JSON: ${err instanceof Error ? err.message : String(err)}` }
	}
}

export function waiting(prs: readonly Pr[], envs: readonly EnvRow[]): string[] {
	const out: string[] = []
	for (const p of prs) {
		if (p.checks === 'fail') out.push(`PR #${p.number} ${p.title} · CI แดง`)
		if (p.review === 'changes') out.push(`PR #${p.number} ${p.title} · ขอแก้จาก review`)
	}
	for (const e of envs) if (e.problem !== null) out.push(`${e.name} · ${e.problem}`)
	return out
}
```

(`catch {}` ใน parseVersion คืนค่าที่อธิบายปัญหา ไม่ใช่กลืนเงียบ)

- [ ] **Step 5: รันให้ผ่าน + commit**

Run: `claude plugin test plugins/mission` · Expected: PASS

```bash
git add -A plugins/mission .claude-plugin/marketplace.json
git commit -m "feat(mission): parse worktrees, PRs, peers and env versions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task C2: pane `/mission`

**Files:**

- Modify: `plugins/mission/hooks/register.tsx`
- Test: `plugins/mission/tests/session.test.ts`

**Interfaces:**

- Consumes: C1
- Produces: คำสั่ง `/mission` (เปิด pane + เริ่มอัปเดตตาม `refreshSeconds`), tool `mcp__mission__snapshot` (JSON MissionSnapshot)

- [ ] **Step 1: เทสต์ที่ล้ม**

`plugins/mission/tests/session.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

const P = { isFullscreen: false, columns: 160 }

test('a snapshot collects every box and explains the ones that failed', async ($, on) => {
	mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('process.run', ($, e) => {
		const cmd = e.argv.join(' ')
		const ok = (stdout: string) => ({
			value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
		})
		if (cmd === 'git rev-parse --show-toplevel') return ok('/r\n')
		if (cmd.startsWith('git worktree list')) return ok('worktree /r\nHEAD a\nbranch refs/heads/main\n')
		if (cmd.startsWith('git -C /r status')) return ok(' M a.ts\n?? b.ts\n')
		if (e.argv[0] === 'gh')
			return {
				value: {
					exitCode: 4,
					stdout: '',
					stderr: 'gh: not logged in',
					isStdoutTruncated: false,
					isStderrTruncated: false,
				},
			}
		return ok('')
	})
	on('tool.call', { tool: 'ListAgents' }, () => ({
		result: 'Peer sessions (1):\n  Fix login [ab6772]  ·  interactive  ·  idle\n',
	}))
	on('http.fetch', () => ({
		value: { status: 200, ok: true, headers: {}, text: '{"version":"1.5.1","commit":"abcdef123"}' },
	}))
	on('ui.open', () => ({ value: { isOpen: true } }))
	on('ui.toast', () => ({ value: undefined }))
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	const snap = await $.tool.call({ tool: 'mcp__mission__snapshot' })
	const text = JSON.stringify(snap)
	expect(text).toContain('"dirty":2')
	expect(text).toContain('not logged in')
	expect(text).toContain('ab6772')
})
```

ทดสอบด้วย option `{ options: { envs: '[{"name":"DEV","url":"https://api.acme.example/v"}]' } }` อีกเคส ให้ `snapshot` มี env `DEV` เวอร์ชัน `1.5.1` (เพิ่มเป็น test ที่สองใน `test(name, { options }, body)`)

- [ ] **Step 2: รันให้เห็นว่าล้ม** — Expected: FAIL (`no implementation for command.run` ของ mission)

- [ ] **Step 3: register.tsx**

`plugins/mission/hooks/register.tsx`:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MissionSnapshot } from '../types'
import { parseEnvConfig, parsePeers, parsePrs, parseVersion, parseWorktrees, waiting } from './parse'
import type { EnvRow } from './parse'

const snapshotAtom = atom({ plugin: 'mission', key: 'snapshot' } as const, null as MissionSnapshot | null)
const openAtom = atom({ plugin: 'mission', key: 'open' } as const, false)
const errorsAtom = atom(
	{ plugin: 'mission', key: 'errors' } as const,
	[] as { at: number; where: string; message: string }[]
)
const PANE = 'mission'
const T = 5000

let ticking = false

async function run(
	$: EngineInterface,
	argv: string[],
	cwd?: string
): Promise<{ ok: boolean; out: string; err: string }> {
	try {
		const res = await $.process.run(argv, { cwd, timeoutMs: T })
		return { ok: res.exitCode === 0, out: res.stdout, err: res.stderr.trim() || `exit ${res.exitCode}` }
	} catch (e) {
		return { ok: false, out: '', err: e instanceof Error ? e.message : String(e) }
	}
}

async function fetchVersion(
	$: EngineInterface,
	url: string
): Promise<{ ok: boolean; status: number; text: string } | { error: string }> {
	try {
		const res = await Promise.race([$.http.fetch(url), $.clock.sleep(T).then(() => null)])
		return res === null
			? { error: `ไม่ตอบภายใน ${T / 1000} วินาที` }
			: { ok: res.ok, status: res.status, text: res.text }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

async function snapshot($: EngineInterface, envsText: string): Promise<MissionSnapshot> {
	const cwd = await $.session.cwd()
	const top = await run($, ['git', 'rev-parse', '--show-toplevel'], cwd)
	const root = top.ok ? top.out.trim() : cwd
	const wt = await run($, ['git', 'worktree', 'list', '--porcelain'], root)
	const worktrees = []
	for (const w of wt.ok ? parseWorktrees(wt.out) : []) {
		const st = await run($, ['git', '-C', w.path, 'status', '--porcelain'])
		worktrees.push({ ...w, dirty: st.ok ? st.out.split('\n').filter(Boolean).length : -1 })
	}
	const gh = await run(
		$,
		['gh', 'pr', 'list', '--author', '@me', '--json', 'number,title,headRefName,reviewDecision,statusCheckRollup'],
		root
	)
	const prs = gh.ok ? parsePrs(gh.out) : { error: gh.err }
	const agents = await $.tool.call({ tool: 'ListAgents' })
	const peers =
		agents.deny !== undefined ? { error: agents.deny } : parsePeers(String(agents.text ?? agents.result ?? ''))
	const envList = parseEnvConfig(envsText)
	const envs: EnvRow[] = []
	if (!('error' in envList))
		for (const env of envList) envs.push(parseVersion(env.name, await fetchVersion($, env.url)))
	return { at: await $.clock.now(), worktrees, prs, peers, envs, waiting: waiting(Array.isArray(prs) ? prs : [], envs) }
}

export const register: Register = (on, options) => {
	const envsText = typeof options['envs'] === 'string' ? options['envs'] : '[]'
	const refreshMs = Math.max(30, typeof options['refreshSeconds'] === 'number' ? options['refreshSeconds'] : 120) * 1000

	async function refresh($: EngineInterface): Promise<void> {
		try {
			await update($, snapshotAtom, () => null)
			const snap = await snapshot($, envsText)
			await update($, snapshotAtom, () => snap)
		} catch (err) {
			const at = await $.clock.now()
			await update($, errorsAtom, (l) =>
				[...l, { at, where: 'refresh', message: err instanceof Error ? err.message : String(err) }].slice(-50)
			)
		}
	}

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({
			name: 'mission',
			description: 'Mission Control: งาน, PR + CI, session อื่น, env · refresh',
		})
		await $.tool.register({
			name: 'snapshot',
			description: 'สรุปสถานะงานของ Mission Control (JSON)',
			inputSchema: { type: 'object', properties: {} },
		})
		return res
	})

	on('command.run', { command: 'mission' }, async ($, e) => {
		await refresh($)
		if (e.args.trim() !== 'refresh') {
			await update($, openAtom, () => true)
			await $.ui.open({ id: PANE, title: 'Mission Control' })
		}
		if (!ticking) {
			ticking = true
			await $.clock.every(refreshMs, async () => {
				if (await read($, openAtom)) await refresh($)
			})
		}
		return { text: 'อัปเดต Mission Control แล้ว' }
	})

	on('tool.call', { tool: 'mcp__mission__snapshot' }, async ($) => ({
		result: JSON.stringify(await read($, snapshotAtom)),
	}))

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const snap = await read($, snapshotAtom)
		if (snap === null) return <Text dimColor>กำลังโหลด…</Text>
		const section = (title: string) => (
			<Text bold color="claude">
				{title}
			</Text>
		)
		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					{section(`รอคุณ · ${snap.waiting.length}`)}
					{snap.waiting.length === 0 ? (
						<Text dimColor>ไม่มี</Text>
					) : (
						snap.waiting.map((w) => (
							<Text key={w} color="warning">
								● {w}
							</Text>
						))
					)}
				</Box>
				<Box flexDirection="column">
					{section('worktree')}
					{snap.worktrees.map((w) => (
						<Text key={w.path}>
							{w.branch ?? '(detached)'} · {w.dirty < 0 ? '?' : w.dirty} ไฟล์ค้าง · <Text dimColor>{w.path}</Text>
						</Text>
					))}
				</Box>
				<Box flexDirection="column">
					{section('PR + CI')}
					{'error' in snap.prs ? (
						<Text color="error">{snap.prs.error}</Text>
					) : (
						snap.prs.map((p) => (
							<Text
								key={`${p.number}`}
								color={p.checks === 'fail' ? 'error' : p.checks === 'pass' ? 'success' : 'warning'}
							>
								#{p.number} {p.title} · CI {p.checks} · review {p.review}
							</Text>
						))
					)}
				</Box>
				<Box flexDirection="column">
					{section('session อื่น')}
					{'error' in snap.peers ? (
						<Text color="error">{snap.peers.error}</Text>
					) : (
						snap.peers
							.filter((p) => p.state !== 'offline')
							.map((p) => (
								<Text key={p.id}>
									{p.name} ·{' '}
									<Text dimColor>
										{p.kind} · {p.state}
									</Text>
								</Text>
							))
					)}
				</Box>
				{snap.envs.length > 0 && (
					<Box flexDirection="column">
						{section('Environments')}
						{snap.envs.map((x) => (
							<Text key={x.name} color={x.problem === null ? 'success' : 'error'}>
								{x.name} · {x.version ?? '-'} · {x.commit ?? '-'}
								{x.problem === null ? '' : ` · ${x.problem}`}
							</Text>
						))}
					</Box>
				)}
			</Box>
		)
	})
}
```

ถ้า `$.clock.every` ต้องการ args ต่างจากนี้ ให้ตาม type (`ClockWait`)

- [ ] **Step 4: รันให้ผ่าน + check + commit**

Run: `claude plugin test plugins/mission && CLAUDE_MOD_TYPES=<path> bash scripts/check.sh` · Expected: PASS

```bash
git add -A plugins/mission
git commit -m "feat(mission): /mission pane with worktrees, PRs, sessions and envs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part E — Mod Manager (`manager`)

### Task E1: `/mods`

**Files:**

- Create: `plugins/manager/.claude-plugin/plugin.json`, `plugins/manager/hooks/hooks.json`, `plugins/manager/hooks/view.ts`, `plugins/manager/hooks/register.tsx`, `plugins/manager/types/index.d.ts`
- Modify: `.claude-plugin/marketplace.json`
- Test: `plugins/manager/tests/view.test.ts`, `plugins/manager/tests/session.test.ts`

**Interfaces:**

- Consumes: tools `mcp__forge__rules`, `mcp__proof__status` (ถ้าไม่ได้ติดตั้ง แสดงว่าไม่มี)
- Produces:
  - `type PluginRow = { name: string; version: string | null; provenance: string; root: string; isSuite: boolean }`
  - `pluginRow(input: { name: string; version?: string; provenance?: string; root: string }): PluginRow` (isSuite = ชื่ออยู่ใน `forge, proof, mission, manager, autopilot`)
  - `disableCommand(row: PluginRow): string` → `claude plugin disable <provenance or name>`
  - `parseRulesTool(result: unknown): { rules: { id: string; source: string; enabled: boolean; hits30: number }[]; errors: string[] } | { error: string }`
  - คำสั่ง `/mods`

- [ ] **Step 1: manifests** — `plugin.json` (`name: manager`, ไม่มี userConfig, `types`), `hooks.json` → `./register.tsx`, marketplace เพิ่ม `{ "name": "manager", "source": "./plugins/manager", "description": "Mod Manager: /mods ดู plugin, กฎ และ error ในจอเดียว" }`

`plugins/manager/types/index.d.ts`:

```ts
export type PluginRowState = {
	name: string
	version: string | null
	provenance: string
	root: string
	isSuite: boolean
}

declare module 'claude-code' {
	interface PluginState {
		manager: { plugins: PluginRowState[] }
	}
}
```

- [ ] **Step 2: เทสต์ที่ล้ม**

`plugins/manager/tests/view.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { disableCommand, parseRulesTool, pluginRow } from '../hooks/view'

describe('manager view', () => {
	test('rows and disable commands', () => {
		const row = pluginRow({ name: 'forge', version: '0.1.0', provenance: 'forge@claude-mods', root: '/p/forge' })
		expect(row.isSuite).toBe(true)
		expect(disableCommand(row)).toBe('claude plugin disable forge@claude-mods')
		expect(pluginRow({ name: 'other', root: '/x' }).isSuite).toBe(false)
	})
	test('rules tool result parsing', () => {
		const ok = parseRulesTool({
			result: JSON.stringify({
				rules: [{ id: 'a', source: 'builtin', action: 'deny', enabled: true, hits30: 2 }],
				errors: [],
			}),
		})
		expect('rules' in ok ? ok.rules[0]?.hits30 : -1).toBe(2)
		expect('error' in parseRulesTool({ deny: 'no such tool' })).toBe(true)
		expect('error' in parseRulesTool({ result: 'nope' })).toBe(true)
	})
})
```

`plugins/manager/tests/session.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

const P = { isFullscreen: false, columns: 160 }

test('/mods lists plugins seen at load and the rules of forge', async ($, on) => {
	on('ui.open', () => ({ value: { isOpen: true } }))
	on('tool.call', { tool: 'mcp__forge__rules' }, () => ({
		result: JSON.stringify({
			rules: [{ id: 'named-stash', source: 'builtin', action: 'deny', enabled: true, hits30: 3 }],
			errors: [],
		}),
	}))
	on('tool.call', { tool: 'mcp__proof__status' }, () => ({ deny: 'no such tool' }))
	await $.plugin.register({
		name: 'forge',
		tier: 'user',
		root: '/p/forge',
		version: '0.1.0',
		provenance: 'forge@claude-mods',
	})
	const res = await $.command.run({ command: 'mods', args: 'text', origin: { kind: 'composer' }, presentation: P })
	expect(res.text).toContain('forge@claude-mods')
	expect(res.text).toContain('named-stash')
	expect(res.text).toContain('proof: ไม่ได้ติดตั้ง')
})
```

`/mods text` คืนสรุปเป็นข้อความ (ใช้ในเทสต์และ terminal แคบ); `/mods` เปล่าเปิด pane; ถ้า `$.plugin.register` ใน kit ต้องการ field อื่น (เช่น `tier`) ให้ใส่ตาม `PluginRegisterInput`

- [ ] **Step 3: รันให้เห็นว่าล้ม** — Expected: FAIL

- [ ] **Step 4: view.ts + register.tsx**

`plugins/manager/hooks/view.ts`:

```ts
export type PluginRow = { name: string; version: string | null; provenance: string; root: string; isSuite: boolean }

const SUITE = new Set(['forge', 'proof', 'mission', 'manager', 'autopilot'])

export function pluginRow(input: { name: string; version?: string; provenance?: string; root: string }): PluginRow {
	return {
		name: input.name,
		version: input.version ?? null,
		provenance: input.provenance ?? input.name,
		root: input.root,
		isSuite: SUITE.has(input.name),
	}
}

export function disableCommand(row: PluginRow): string {
	return `claude plugin disable ${row.provenance}`
}

type RuleRow = { id: string; source: string; enabled: boolean; hits30: number }

export function parseRulesTool(res: unknown): { rules: RuleRow[]; errors: string[] } | { error: string } {
	const r = (typeof res === 'object' && res !== null ? res : {}) as Record<string, unknown>
	if (typeof r['deny'] === 'string') return { error: r['deny'] }
	const text = typeof r['text'] === 'string' ? r['text'] : typeof r['result'] === 'string' ? r['result'] : undefined
	if (text === undefined) return { error: 'ไม่มีผลจาก forge' }
	try {
		const body = JSON.parse(text) as { rules?: RuleRow[]; errors?: string[] }
		return { rules: body.rules ?? [], errors: body.errors ?? [] }
	} catch (err) {
		return { error: `อ่านผล forge ไม่ได้: ${err instanceof Error ? err.message : String(err)}` }
	}
}
```

`plugins/manager/hooks/register.tsx`:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PluginRowState } from '../types'
import { disableCommand, parseRulesTool, pluginRow } from './view'

const pluginsAtom = atom({ plugin: 'manager', key: 'plugins' } as const, [] as PluginRowState[])
const PANE = 'mods'

async function collect(
	$: EngineInterface
): Promise<{ plugins: PluginRowState[]; rules: ReturnType<typeof parseRulesTool>; proof: string }> {
	const plugins = await read($, pluginsAtom)
	const rules = parseRulesTool(await $.tool.call({ tool: 'mcp__forge__rules' }))
	const proofRes = await $.tool.call({ tool: 'mcp__proof__status' })
	const proof =
		proofRes.deny !== undefined ? 'proof: ไม่ได้ติดตั้ง' : `proof: ${String(proofRes.text ?? proofRes.result ?? '')}`
	return { plugins, rules, proof }
}

export const register: Register = (on) => {
	on('plugin.register', async ($, e, next) => {
		const res = await next(e)
		const row = pluginRow({ name: e.name, version: e.version, provenance: e.provenance, root: e.root })
		await update($, pluginsAtom, (l) => [...l.filter((p) => p.name !== row.name), row])
		return res
	})

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({ name: 'mods', description: 'ดู plugin ที่โหลด, กฎของ forge และสถานะ proof · text' })
		return res
	})

	on('command.run', { command: 'mods' }, async ($, e) => {
		if (e.args.trim() !== 'text') {
			await $.ui.open({ id: PANE, title: 'Mods' })
			return { text: 'เปิด /mods แล้ว' }
		}
		const { plugins, rules, proof } = await collect($)
		const lines = [
			`plugins (${plugins.length}):`,
			...plugins.map((p) => `  ${p.isSuite ? '★' : ' '} ${p.provenance} ${p.version ?? ''} · ${p.root}`),
		]
		lines.push(
			'forge:',
			...('error' in rules
				? [`  ${rules.error}`]
				: rules.rules.map((r) => `  ${r.enabled ? '●' : '○'} ${r.id} (${r.source}) · ${r.hits30}/30 วัน`))
		)
		lines.push(proof)
		return { text: lines.join('\n') }
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e)
		const { plugins, rules, proof } = await collect($)
		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					<Text bold color="claude">
						Plugins · {plugins.length}
					</Text>
					{plugins.map((p) => (
						<Box key={p.name} gap={1}>
							<Text>
								{p.isSuite ? '★' : ' '} {p.provenance}
							</Text>
							<Text dimColor>{p.version ?? ''}</Text>
							<Button
								key={`copy-${p.name}`}
								label="คัดลอกคำสั่งปิด"
								plain
								onPress={() => $.ui.copy({ text: disableCommand(pluginRow(p)) })}
							/>
						</Box>
					))}
				</Box>
				<Box flexDirection="column">
					<Text bold color="claude">
						กฎของ forge
					</Text>
					{'error' in rules ? (
						<Text color="error">{rules.error}</Text>
					) : (
						rules.rules.map((r) => (
							<Box key={r.id} gap={1}>
								<Text color={r.enabled ? 'success' : 'inactive'}>
									{r.enabled ? '●' : '○'} {r.id}
								</Text>
								<Text dimColor>
									{r.source} · {r.hits30}/30 วัน
								</Text>
								{r.source.startsWith('personal') && (
									<Button
										key={`t-${r.id}`}
										label={r.enabled ? 'ปิด' : 'เปิด'}
										plain
										onPress={() =>
											$.command.run({ command: 'lessons', args: `${r.enabled ? 'disable' : 'enable'} ${r.id}` })
										}
									/>
								)}
							</Box>
						))
					)}
				</Box>
				<Text dimColor wrap="wrap">
					{proof}
				</Text>
				<Text dimColor>error ของ plugin อื่นดูได้ด้วย claude --debug (engine ไม่ส่งให้ plugin)</Text>
			</Box>
		)
	})
}
```

- [ ] **Step 5: รันให้ผ่าน + check + commit**

Run: `claude plugin test plugins/manager && CLAUDE_MOD_TYPES=<path> bash scripts/check.sh` · Expected: PASS

```bash
git add -A plugins/manager .claude-plugin/marketplace.json
git commit -m "feat(manager): /mods with loaded plugins, forge rules and proof status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Part D — Autopilot (`autopilot`)

### Task D1: state machine ของขั้นตอน (pure)

**Files:**

- Create: `plugins/autopilot/.claude-plugin/plugin.json`, `plugins/autopilot/hooks/hooks.json`, `plugins/autopilot/hooks/steps.ts`, `plugins/autopilot/hooks/register.tsx` (ขั้นต่ำ), `plugins/autopilot/types/index.d.ts`
- Modify: `.claude-plugin/marketplace.json`
- Test: `plugins/autopilot/tests/steps.test.ts`

**Interfaces:**

- Produces:
  - `type StepId = 'understand' | 'worktree' | 'red-test' | 'fix' | 'proof' | 'review' | 'open-pr'`
  - `type Ship = { issue: string; baseBranch: string; branch: string | null; step: StepId; attempts: number; status: 'running' | 'waiting-person' | 'blocked' | 'done' | 'stopped'; log: string[]; reviewer: string }`
  - `STEPS: readonly { id: StepId; title: string }[]`
  - `startShip(issue: string, baseBranch: string, reviewer: string): Ship`
  - `stepPrompt(ship: Ship): string`
  - `type Evidence = { duplicates?: string[]; worktreeBranch?: string | null; proof?: { fail: number; pass: number; running: number; newFailing: boolean }; review?: { blocking: number } }`
  - `evaluate(ship: Ship, ev: Evidence): 'pass' | 'retry' | 'needs-person'`
  - `advance(ship: Ship, verdict: 'pass' | 'retry' | 'needs-person'): Ship` — pass → ขั้นถัดไป (attempts 0); ขั้นถัดไปเป็น `open-pr` → `waiting-person`; retry → attempts+1, ครบ 3 → `blocked`; needs-person → `waiting-person`
  - `MAX_ATTEMPTS = 3`

- [ ] **Step 1: manifests** — `plugin.json` (`name: autopilot`, userConfig `reviewer` string default `code-review`), `hooks.json`, marketplace `{ "name": "autopilot", "source": "./plugins/autopilot", "description": "Autopilot: /ship เดินงานจาก issue ถึง PR โดยหยุดที่จุดอนุมัติ" }`

`plugins/autopilot/types/index.d.ts`:

```ts
export type ShipState = {
	issue: string
	baseBranch: string
	branch: string | null
	step: 'understand' | 'worktree' | 'red-test' | 'fix' | 'proof' | 'review' | 'open-pr'
	attempts: number
	status: 'running' | 'waiting-person' | 'blocked' | 'done' | 'stopped'
	log: string[]
	reviewer: string
}

declare module 'claude-code' {
	interface PluginState {
		autopilot: { ship: ShipState | null; reviewAgent: string | null; reviewAnswer: string | null }
	}
}
```

- [ ] **Step 2: เทสต์ที่ล้ม**

`plugins/autopilot/tests/steps.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { advance, evaluate, MAX_ATTEMPTS, startShip, stepPrompt } from '../hooks/steps'

describe('ship state machine', () => {
	test('starts at understand and its prompt names the issue and the duplicate check', () => {
		const s = startShip('#4120 ยอดในสลิปไม่ตรง', 'origin/develop', 'code-review')
		expect(s.step).toBe('understand')
		expect(stepPrompt(s)).toContain('#4120')
		expect(stepPrompt(s)).toContain('gh pr list')
	})
	test('evaluate per step', () => {
		const s = startShip('x', 'origin/develop', 'code-review')
		expect(evaluate(s, { duplicates: [] })).toBe('pass')
		expect(evaluate(s, { duplicates: ['PR #9'] })).toBe('needs-person')
		expect(evaluate({ ...s, step: 'worktree', branch: 'fix/x' }, { worktreeBranch: 'fix/x' })).toBe('pass')
		expect(evaluate({ ...s, step: 'red-test' }, { proof: { fail: 1, pass: 0, running: 0, newFailing: true } })).toBe(
			'pass'
		)
		expect(evaluate({ ...s, step: 'red-test' }, { proof: { fail: 0, pass: 1, running: 0, newFailing: false } })).toBe(
			'retry'
		)
		expect(evaluate({ ...s, step: 'fix' }, {})).toBe('pass')
		expect(evaluate({ ...s, step: 'proof' }, { proof: { fail: 0, pass: 2, running: 0, newFailing: false } })).toBe(
			'pass'
		)
		expect(evaluate({ ...s, step: 'proof' }, { proof: { fail: 0, pass: 1, running: 1, newFailing: false } })).toBe(
			'retry'
		)
		expect(evaluate({ ...s, step: 'review' }, { review: { blocking: 0 } })).toBe('pass')
		expect(evaluate({ ...s, step: 'review' }, { review: { blocking: 2 } })).toBe('retry')
	})
	test('advance stops at the PR gate and blocks after too many retries', () => {
		let s = { ...startShip('x', 'origin/develop', 'code-review'), step: 'review' as const }
		s = advance(s, 'pass')
		expect(s.step).toBe('open-pr')
		expect(s.status).toBe('waiting-person')
		let r = { ...startShip('x', 'origin/develop', 'code-review'), step: 'proof' as const }
		for (let i = 0; i < MAX_ATTEMPTS; i++) r = advance(r, 'retry')
		expect(r.status).toBe('blocked')
		expect(r.log.at(-1)).toContain('proof')
	})
})
```

- [ ] **Step 3: รันให้เห็นว่าล้ม** — Expected: FAIL

- [ ] **Step 4: steps.ts**

`plugins/autopilot/hooks/steps.ts`:

```ts
export type StepId = 'understand' | 'worktree' | 'red-test' | 'fix' | 'proof' | 'review' | 'open-pr'

export type Ship = {
	issue: string
	baseBranch: string
	branch: string | null
	step: StepId
	attempts: number
	status: 'running' | 'waiting-person' | 'blocked' | 'done' | 'stopped'
	log: string[]
	reviewer: string
}

export type Evidence = {
	duplicates?: string[]
	worktreeBranch?: string | null
	proof?: { fail: number; pass: number; running: number; newFailing: boolean }
	review?: { blocking: number }
}

export const MAX_ATTEMPTS = 3

export const STEPS: readonly { id: StepId; title: string }[] = [
	{ id: 'understand', title: 'อ่าน issue และเช็กงานซ้ำ' },
	{ id: 'worktree', title: 'สร้าง worktree จากฐาน' },
	{ id: 'red-test', title: 'เขียนเทสต์ที่ต้องล้มก่อน' },
	{ id: 'fix', title: 'แก้โค้ด' },
	{ id: 'proof', title: 'Proof Gate' },
	{ id: 'review', title: 'review' },
	{ id: 'open-pr', title: 'จุดอนุมัติ: เปิด PR' },
]

export function startShip(issue: string, baseBranch: string, reviewer: string): Ship {
	return {
		issue,
		baseBranch,
		branch: null,
		step: 'understand',
		attempts: 0,
		status: 'running',
		log: [`เริ่ม /ship ${issue}`],
		reviewer,
	}
}

export function stepPrompt(ship: Ship): string {
	const head = `[autopilot · ${ship.issue} · ขั้น ${STEPS.findIndex((s) => s.id === ship.step) + 1}/${STEPS.length}]`
	switch (ship.step) {
		case 'understand':
			return `${head} อ่านงานนี้: ${ship.issue}\nถ้าเป็น GitHub issue ให้ gh issue view; เช็กงานซ้ำด้วย gh pr list --search และ git log ${ship.baseBranch} --grep สรุปสิ่งที่ต้องแก้สั้นๆ และบอกว่ามีงานซ้ำไหม ห้ามแก้โค้ดในขั้นนี้`
		case 'worktree':
			return `${head} สร้าง worktree และ branch ใหม่จาก ${ship.baseBranch} สำหรับงานนี้ (ชื่อ branch ตาม convention ของ repo) แล้วบอกชื่อ branch`
		case 'red-test':
			return `${head} เขียนเทสต์ที่จำลองปัญหาและต้องล้มก่อนแก้ แล้วรันให้เห็นว่าล้มด้วยเหตุผลที่ถูก ห้ามแก้โค้ดจริงในขั้นนี้`
		case 'fix':
			return `${head} แก้โค้ดให้น้อยที่สุดจนเทสต์ใหม่ผ่าน`
		case 'proof':
			return `${head} รอ proof ให้รันจบ ถ้ามีคำสั่งพิสูจน์ล้มให้แก้จนผ่านทั้งหมด`
		case 'review':
			return `${head} reviewer ${ship.reviewer} พบปัญหาที่ต้องแก้ (P0/P1) แก้ให้ครบ`
		case 'open-pr':
			return `${head} ผู้ใช้อนุมัติแล้ว: commit, push และเปิด PR เข้า ${ship.baseBranch.replace(/^origin\//, '')} ตาม template ของ repo`
	}
}

export function evaluate(ship: Ship, ev: Evidence): 'pass' | 'retry' | 'needs-person' {
	switch (ship.step) {
		case 'understand':
			return (ev.duplicates ?? []).length > 0 ? 'needs-person' : 'pass'
		case 'worktree':
			return ev.worktreeBranch !== undefined && ev.worktreeBranch !== null && ev.worktreeBranch === ship.branch
				? 'pass'
				: 'retry'
		case 'red-test':
			return ev.proof?.newFailing === true ? 'pass' : 'retry'
		case 'fix':
			return 'pass'
		case 'proof':
			return ev.proof !== undefined && ev.proof.fail === 0 && ev.proof.running === 0 ? 'pass' : 'retry'
		case 'review':
			return ev.review !== undefined && ev.review.blocking === 0 ? 'pass' : 'retry'
		case 'open-pr':
			return 'needs-person'
	}
}

export function advance(ship: Ship, verdict: 'pass' | 'retry' | 'needs-person'): Ship {
	const title = STEPS.find((s) => s.id === ship.step)?.title ?? ship.step
	if (verdict === 'needs-person')
		return { ...ship, status: 'waiting-person', log: [...ship.log, `รอผู้ใช้ที่ขั้น ${ship.step}: ${title}`] }
	if (verdict === 'retry') {
		const attempts = ship.attempts + 1
		if (attempts >= MAX_ATTEMPTS)
			return {
				...ship,
				attempts,
				status: 'blocked',
				log: [...ship.log, `ติดที่ขั้น ${ship.step} (${title}) หลังลอง ${attempts} รอบ`],
			}
		return { ...ship, attempts, log: [...ship.log, `ลองขั้น ${ship.step} อีกครั้ง (${attempts}/${MAX_ATTEMPTS})`] }
	}
	const index = STEPS.findIndex((s) => s.id === ship.step)
	const next = STEPS[index + 1]
	if (next === undefined) return { ...ship, status: 'done', log: [...ship.log, 'เสร็จ'] }
	return {
		...ship,
		step: next.id,
		attempts: 0,
		status: next.id === 'open-pr' ? 'waiting-person' : 'running',
		log: [...ship.log, `ผ่าน: ${title}`],
	}
}
```

- [ ] **Step 5: รันให้ผ่าน + commit**

```bash
git add -A plugins/autopilot .claude-plugin/marketplace.json
git commit -m "feat(autopilot): ship state machine with retry cap and PR gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task D2: `/ship` ใน session

**Files:**

- Modify: `plugins/autopilot/hooks/register.tsx`
- Test: `plugins/autopilot/tests/session.test.ts`

**Interfaces:**

- Consumes: D1, tool `mcp__proof__status` (B2), `$.prompt.submit` (B0)
- Produces: คำสั่ง `/ship <issue>`, `/ship status`, `/ship stop`, `/ship approve` (เฉพาะ composer หรือปุ่ม); pane `ship`; band ที่จุดอนุมัติ

- [ ] **Step 1: เทสต์ที่ล้ม**

`plugins/autopilot/tests/session.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const P = { isFullscreen: false, columns: 160 }

function world(on: On, opts: { prs?: string; proof?: string; submitted: string[] }): void {
	mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('process.run', ($, e) => {
		const ok = (stdout: string) => ({
			value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
		})
		if (e.argv[0] === 'gh') return ok(opts.prs ?? '[]')
		if (e.argv.join(' ').startsWith('git rev-parse --show-toplevel')) return ok('/r\n')
		return ok('')
	})
	on('tool.call', { tool: 'mcp__proof__status' }, () => ({
		result: opts.proof ?? '{"enabled":true,"touched":[],"results":[]}',
	}))
	on('prompt.submit', ($, e) => {
		opts.submitted.push(e.text)
		return { text: e.text }
	})
	on('turn.complete', () => ({ text: 'ok' }))
	on('ui.open', () => ({ value: { isOpen: true } }))
	on('ui.toast', () => ({ value: undefined }))
}

describe('/ship', () => {
	test('starts, submits step 1, and moves on after a clean turn', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted })
		await $.command.run({
			command: 'ship',
			args: '#4120 ยอดในสลิปไม่ตรง',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(submitted[0]).toContain('ขั้น 1/7')
		await $.turn.complete({ reason: 'answer', text: 'ไม่มีงานซ้ำ' })
		expect(submitted[1]).toContain('ขั้น 2/7')
	})

	test('a duplicate PR stops and waits for the person', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted, prs: '[{"number":9,"title":"fix slip"}]' })
		await $.command.run({ command: 'ship', args: '#4120 slip', origin: { kind: 'composer' }, presentation: P })
		await $.turn.complete({ reason: 'answer', text: 'มี PR #9' })
		const status = await $.command.run({
			command: 'ship',
			args: 'status',
			origin: { kind: 'composer' },
			presentation: P,
		})
		expect(status.text).toContain('รอผู้ใช้')
		expect(submitted.length).toBe(1)
	})

	test('approve is refused unless the person typed it', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted })
		await $.command.run({ command: 'ship', args: '#1 x', origin: { kind: 'composer' }, presentation: P })
		const res = await $.command.run({ command: 'ship', args: 'approve', origin: { kind: 'sdk' }, presentation: P })
		expect(res.text).toContain('ผู้ใช้ต้อง')
	})

	test('stop ends the run and no more prompts are sent', async ($, on) => {
		const submitted: string[] = []
		world(on, { submitted })
		await $.command.run({ command: 'ship', args: '#1 x', origin: { kind: 'composer' }, presentation: P })
		await $.command.run({ command: 'ship', args: 'stop', origin: { kind: 'composer' }, presentation: P })
		await $.turn.complete({ reason: 'answer', text: 'x' })
		expect(submitted.length).toBe(1)
	})
})
```

- [ ] **Step 2: รันให้เห็นว่าล้ม** — Expected: FAIL

- [ ] **Step 3: register.tsx**

`plugins/autopilot/hooks/register.tsx`:

```tsx
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShipState } from '../types'
import { advance, evaluate, STEPS, startShip, stepPrompt } from './steps'
import type { Evidence, Ship } from './steps'

const shipAtom = atom({ plugin: 'autopilot', key: 'ship' } as const, null as ShipState | null)
const reviewAgentAtom = atom({ plugin: 'autopilot', key: 'reviewAgent' } as const, null as string | null)
const reviewAnswerAtom = atom({ plugin: 'autopilot', key: 'reviewAnswer' } as const, null as string | null)
const PANE = 'ship'
const T = 5000

async function out($: EngineInterface, argv: string[], cwd?: string): Promise<string | null> {
	try {
		const res = await $.process.run(argv, { cwd, timeoutMs: T })
		return res.exitCode === 0 ? res.stdout : null
	} catch {
		return null
	}
}

function issueTerms(issue: string): string {
	return issue.replace(/^#?\d+\s*/, '').slice(0, 60) || issue
}

async function evidence($: EngineInterface, ship: Ship, answer: string): Promise<Evidence> {
	const cwd = await $.session.cwd()
	if (ship.step === 'understand') {
		const prs = await out(
			$,
			['gh', 'pr', 'list', '--state', 'open', '--search', issueTerms(ship.issue), '--json', 'number,title'],
			cwd
		)
		const list = prs === null ? [] : (JSON.parse(prs) as { number: number; title: string }[])
		return { duplicates: list.map((p) => `PR #${p.number} ${p.title}`) }
	}
	if (ship.step === 'worktree') {
		const m = /branch[^\n`]*?[`"]?([\w./-]+\/[\w.-]+)[`"]?/i.exec(answer)
		const branch = m?.[1] ?? null
		const list = await out($, ['git', 'worktree', 'list', '--porcelain'], cwd)
		const has = branch !== null && list !== null && list.includes(`branch refs/heads/${branch}`)
		await update($, shipAtom, (s) => (s === null ? s : { ...s, branch }))
		return { worktreeBranch: has ? branch : null }
	}
	if (ship.step === 'red-test' || ship.step === 'proof') {
		const res = await $.tool.call({ tool: 'mcp__proof__status' })
		const text = String(res.text ?? res.result ?? '{}')
		let results: { status: string }[] = []
		try {
			results = (JSON.parse(text) as { results?: { status: string }[] }).results ?? []
		} catch {
			results = []
		}
		const fail = results.filter((r) => r.status === 'fail').length
		return {
			proof: {
				fail,
				pass: results.filter((r) => r.status === 'pass').length,
				running: results.filter((r) => r.status === 'running').length,
				newFailing: fail > 0,
			},
		}
	}
	if (ship.step === 'review') {
		const review = (await read($, reviewAnswerAtom)) ?? ''
		return { review: { blocking: (review.match(/\b(P0|P1|Critical|Important)\b/g) ?? []).length } }
	}
	return {}
}

async function kick($: EngineInterface, ship: Ship): Promise<void> {
	await update($, shipAtom, () => ship)
	if (ship.status !== 'running') {
		if (ship.status === 'blocked' || ship.status === 'waiting-person')
			void $.ui.toast(`autopilot: ${ship.log.at(-1) ?? ''}`)
		return
	}
	if (ship.step === 'review') {
		await update($, reviewAnswerAtom, () => null)
		const spawned = await $.agent.spawn({
			prompt: `Review the current branch against ${ship.baseBranch} for: ${ship.issue}. List findings with P0/P1/P2 labels.`,
			description: 'autopilot review',
			subagentType: ship.reviewer,
			tool_use_id: `autopilot-${Date.now()}`,
		})
		if ('agentId' in spawned) await update($, reviewAgentAtom, () => String(spawned.agentId))
		return
	}
	void $.prompt.submit({ text: stepPrompt(ship) })
}

export const register: Register = (on, options) => {
	const reviewer = typeof options['reviewer'] === 'string' ? options['reviewer'] : 'code-review'

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({ name: 'ship', description: 'Autopilot: /ship <issue> · status · stop · approve' })
		return res
	})

	on('command.run', { command: 'ship' }, async ($, e) => {
		const arg = e.args.trim()
		const person = (e.origin as { kind?: string } | undefined)?.kind === 'composer'
		const ship = await read($, shipAtom)
		if (arg === 'status')
			return {
				text:
					ship === null
						? 'ไม่มีงาน /ship'
						: `${ship.issue} · ${ship.step} · ${ship.status === 'waiting-person' ? 'รอผู้ใช้' : ship.status}\n${ship.log.slice(-5).join('\n')}`,
			}
		if (arg === 'stop') {
			if (ship !== null)
				await update($, shipAtom, () => ({ ...ship, status: 'stopped', log: [...ship.log, 'หยุดโดยผู้ใช้'] }))
			return { text: 'หยุด /ship แล้ว' }
		}
		if (arg === 'approve') {
			if (!person) return { text: 'ผู้ใช้ต้องพิมพ์เองหรือกดปุ่มอนุมัติ' }
			if (ship === null || ship.status !== 'waiting-person') return { text: 'ไม่มีขั้นที่รออนุมัติ' }
			const resumed = { ...ship, status: 'running' as const, log: [...ship.log, `ผู้ใช้อนุมัติขั้น ${ship.step}`] }
			await update($, shipAtom, () => resumed)
			void $.prompt.submit({ text: stepPrompt(resumed) })
			return { text: 'อนุมัติแล้ว' }
		}
		if (arg === '') return { text: 'ใช้: /ship <issue หรือคำอธิบาย>' }
		if (ship !== null && (ship.status === 'running' || ship.status === 'waiting-person'))
			return { text: `มีงาน /ship ค้างอยู่ (${ship.issue}) พิมพ์ /ship stop ก่อน` }
		const base =
			(await out($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], await $.session.cwd()))?.trim() ||
			'origin/develop'
		const fresh = startShip(arg, base, reviewer)
		await kick($, fresh)
		await $.ui.open({ id: PANE, title: `ship · ${arg.slice(0, 30)}` })
		return { text: `เริ่ม /ship ${arg}` }
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		const ship = await read($, shipAtom)
		if (ship === null || ship.status !== 'running') return res
		const agentId = (e as unknown as { agentId?: string }).agentId
		const reviewAgent = await read($, reviewAgentAtom)
		if (agentId !== undefined) {
			if (agentId !== reviewAgent) return res
			await update($, reviewAnswerAtom, () => res.text)
		}
		const ev = await evidence($, ship, res.text)
		const current = (await read($, shipAtom)) ?? ship
		await kick($, advance(current, evaluate(current, ev)))
		return res
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const ship = await read($, shipAtom)
		if (ship === null || (ship.status !== 'waiting-person' && ship.status !== 'blocked')) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		const approve = async () => {
			const s = await read($, shipAtom)
			if (s === null || s.status !== 'waiting-person') return
			const resumed = { ...s, status: 'running' as const, log: [...s.log, `ผู้ใช้อนุมัติขั้น ${s.step}`] }
			await update($, shipAtom, () => resumed)
			void $.prompt.submit({ text: stepPrompt(resumed) })
		}
		return (
			<Box gap={1} borderStyle="round" borderColor={ship.status === 'blocked' ? 'error' : 'warning'} paddingX={1}>
				<Text wrap="wrap">
					autopilot · {ship.issue}: {ship.log.at(-1)}
				</Text>
				{ship.status === 'waiting-person' && (
					<Button key="approve" label="อนุมัติ" variant="primary" onPress={approve} />
				)}
				<Button
					key="stop"
					label="หยุด"
					onPress={() =>
						update($, shipAtom, () => ({ ...ship, status: 'stopped', log: [...ship.log, 'หยุดโดยผู้ใช้'] }))
					}
				/>
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const ship = await read($, shipAtom)
		if (ship === null) return <Text dimColor>ไม่มีงาน /ship</Text>
		const index = STEPS.findIndex((s) => s.id === ship.step)
		return (
			<Box flexDirection="column">
				<Text bold>{ship.issue}</Text>
				{STEPS.map((s, i) => (
					<Text
						key={s.id}
						color={i < index ? 'success' : i === index ? (ship.status === 'blocked' ? 'error' : 'claude') : 'inactive'}
					>
						{i < index ? '✓' : i === index ? '▶' : '·'} {i + 1}. {s.title}
					</Text>
				))}
				<Text dimColor wrap="wrap">
					{ship.log.slice(-4).join(' · ')}
				</Text>
			</Box>
		)
	})
}
```

ถ้า B0 สรุปว่า `$.prompt.submit` ใช้ไม่ได้ ให้แทน `void $.prompt.submit({ text })` ด้วย `$.prompt.fill({ text, mode: 'replace' })` + toast "กด Enter เพื่อให้ autopilot ทำขั้นถัดไป" และปรับเทสต์ให้ตรวจ `prompt.fill`; ถ้า `AgentSpawnInput` ไม่ต้องการ `tool_use_id` ให้ตัดออก; ถ้า `Date.now` ใช้ไม่ได้ใน environment ให้ใช้ `await $.clock.now()`

- [ ] **Step 4: รันให้ผ่าน + check + commit**

Run: `claude plugin test plugins/autopilot && CLAUDE_MOD_TYPES=<path> bash scripts/check.sh` · Expected: PASS

```bash
git add -A plugins/autopilot
git commit -m "feat(autopilot): /ship drives steps with proof evidence, reviewer and approval gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task F: ติดตั้งและลองทั้งชุด (ถามผู้ใช้ก่อนติดตั้ง)

- [ ] **Step 1:** `claude plugin install proof@claude-mods --scope user`, `mission@claude-mods`, `manager@claude-mods`, `autopilot@claude-mods`
- [ ] **Step 2:** `/reload-plugins` → `/mods` เห็นทั้ง 5 ตัว → `/mission` → `/lessons` → แก้ไฟล์ .ts ให้ proof รัน
- [ ] **Step 3:** README เพิ่มรายการ plugin และคำสั่งทั้งหมด แล้ว commit `docs: list all plugins`
