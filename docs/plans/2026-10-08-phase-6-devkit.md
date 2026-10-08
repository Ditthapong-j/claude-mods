# Phase 6: devkit (mod เล็ก 7 ตัว) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** plugin `devkit` รวม mod เล็ก 7 ตัวจาก spec §9 (eol-guard, branch-watch, prior-work, long-run-watch, disk-band, usage-meter, turn-done-sound) เปิด/ปิดทีละตัวด้วย userConfig

**Architecture:** เหมือน plugin อื่นในชุด: logic ล้วนใน `hooks/*.ts` ที่เทสต์ได้, `$` และ atom อยู่ใน `hooks/register.tsx` ไฟล์เดียว, งานตามเวลาเริ่มจาก ticker ใน `session.start` (S1b/C2 rulings), คำสั่งที่ลบของต้องมาจาก `composer`

**Spec:** `docs/specs/2026-10-08-claude-mods-suite-design.md` §9 (secret-guard อยู่ใน forge, pr-pane อยู่ใน mission แล้ว)

## Global Constraints

- ทุกข้อของแผน 0–1 และ 2–5 ยังใช้ (ไม่มี `$` ข้าม import, atom อยู่ในไฟล์ที่ใช้, test hooks ตอบ `{ value }`, probe มี timeout ≤ 5 s ยกเว้นระบุ)
- `/cleanup confirm` ลบ container ได้เฉพาะ `origin.kind === 'composer'`; ไม่ลบอะไรโดยไม่มีคำยืนยันนั้น
- eol-guard แตะไฟล์เฉพาะเมื่อไฟล์เดิมเป็น CRLF ล้วน; ไฟล์ผสมไม่แตะ (เตือนอย่างเดียว)
- prior-work ไม่ขวาง prompt นานกว่า 5 s และไม่ส่งอะไรออกนอกเครื่องนอกจาก `gh`/`git`
- status line เดียวของ devkit รวม branch-watch + usage-meter

## Review Focus

1. **eol-guard ทำไฟล์เสีย** (ไฟล์ binary, ไฟล์ใหม่ที่ยังไม่มี, ไฟล์ผสม) — ต้องไม่เขียนทับเมื่อไม่แน่ใจ → เทสต์ใน K1, K2
2. **prior-work ช้าหรือ `gh` ไม่มี** — prompt ต้องส่งได้เสมอ → เทสต์ใน K2
3. **disk-band ลบของโดยไม่ได้รับอนุญาต** — `/cleanup` จาก origin อื่นถูกปฏิเสธ → เทสต์ใน K2
4. **branch-watch เตือนผิดตอน Claude สลับ branch เอง** → เทสต์ใน K1 (isClaudeSwitch) และ K2
5. **long-run-watch เตือนคำสั่งสั้นที่ปกติเร็ว** → เทสต์ใน K1 (threshold)

---

### Task K1: logic ล้วนของทั้ง 7 ตัว

**Files:** `plugins/devkit/{.claude-plugin/plugin.json, hooks/hooks.json, hooks/register.tsx (ขั้นต่ำ), hooks/eol.ts, hooks/branch.ts, hooks/prior.ts, hooks/longrun.ts, hooks/disk.ts, types/index.d.ts, tests/logic.test.ts}`, `.claude-plugin/marketplace.json`

**Interfaces (Produces):**

- `detectEol(text: string): 'crlf' | 'lf' | 'mixed' | 'none'` · `toCrlf(text: string): string` · `looksBinary(text: string): boolean`
- `isClaudeSwitch(command: string): boolean` · `statusText(s: { branch: string | null; behind: number | null; dirty: number | null; ctxPercent: number | null }): string | undefined`
- `issueIds(text: string): string[]` (สูงสุด 3) · `priorContext(id: string, prs: { number: number; title: string; url: string }[], commits: string[]): string | null`
- `commandKey(command: string): string` · `isKnownSlow(command: string): boolean` · `thresholdMs(avgMs: number | undefined, knownSlow: boolean): number` · `nextAvg(prev: { avg: number; n: number } | undefined, ms: number): { avg: number; n: number }`
- `parseDfFreeGb(df: string): number | null` · `diskAlert(s: { freeGb: number | null; containers: number }, limits: { minFreeGb: number; maxContainers: number }): string | null`

- [ ] **Step 1:** manifests + register ขั้นต่ำ + marketplace entry
- [ ] **Step 2:** เขียน `tests/logic.test.ts` (ด้านล่าง) รันให้เห็นว่าล้ม
- [ ] **Step 3:** เขียนโมดูลทั้ง 5 ไฟล์ รันให้ผ่าน + check.sh
- [ ] **Step 4:** commit `feat(devkit): pure logic for the seven small mods`

`plugins/devkit/tests/logic.test.ts`:

```ts
import { describe, expect, test } from 'claude-code/testing'

import { isClaudeSwitch, statusText } from '../hooks/branch'
import { diskAlert, parseDfFreeGb } from '../hooks/disk'
import { detectEol, looksBinary, toCrlf } from '../hooks/eol'
import { commandKey, isKnownSlow, nextAvg, thresholdMs } from '../hooks/longrun'
import { issueIds, priorContext } from '../hooks/prior'

describe('eol', () => {
	test('detects line endings', () => {
		expect(detectEol('a\r\nb\r\n')).toBe('crlf')
		expect(detectEol('a\nb\n')).toBe('lf')
		expect(detectEol('a\r\nb\n')).toBe('mixed')
		expect(detectEol('one line')).toBe('none')
	})
	test('toCrlf converts bare LF only and is idempotent', () => {
		expect(toCrlf('a\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n')
		expect(toCrlf(toCrlf('a\nb'))).toBe('a\r\nb')
	})
	test('binary content is recognised', () => {
		expect(looksBinary('abc\u0000def')).toBe(true)
		expect(looksBinary('plain text')).toBe(false)
	})
})

describe('branch', () => {
	test('Claude-run switches are recognised anywhere in the command', () => {
		expect(isClaudeSwitch('git checkout develop')).toBe(true)
		expect(isClaudeSwitch('cd x && git switch -c fix/a')).toBe(true)
		expect(isClaudeSwitch('git checkout -- file.ts')).toBe(false)
		expect(isClaudeSwitch('git status')).toBe(false)
	})
	test('status text joins what is known', () => {
		expect(statusText({ branch: 'fix/a', behind: 3, dirty: 2, ctxPercent: 62 })).toBe('fix/a ↓3 · ค้าง 2 · ctx 62%')
		expect(statusText({ branch: 'main', behind: 0, dirty: 0, ctxPercent: null })).toBe('main')
		expect(statusText({ branch: null, behind: null, dirty: null, ctxPercent: 10 })).toBe('ctx 10%')
		expect(statusText({ branch: null, behind: null, dirty: null, ctxPercent: null })).toBeUndefined()
	})
})

describe('prior', () => {
	test('issue ids from a prompt', () => {
		expect(issueIds('แก้ OB-123 กับ #45 ด้วย และ OB-123 อีกที')).toEqual(['OB-123', '#45'])
		expect(issueIds('ไม่มีเลข')).toEqual([])
		expect(issueIds('OB-1 OB-2 OB-3 OB-4')).toHaveLength(3)
	})
	test('context lists open PRs and commits, or nothing', () => {
		const ctx = priorContext(
			'OB-123',
			[{ number: 9, title: 'fix OB-123', url: 'https://x/9' }],
			['abc123 fix(OB-123): first try']
		)
		expect(ctx).toContain('PR #9')
		expect(ctx).toContain('abc123')
		expect(priorContext('OB-1', [], [])).toBeNull()
	})
})

describe('longrun', () => {
	test('command key is the first two words of the first segment', () => {
		expect(commandKey('npx vitest run src')).toBe('npx vitest')
		expect(commandKey('cd apps/web && npm test')).toBe('cd apps/web')
	})
	test('known slow commands and thresholds', () => {
		expect(isKnownSlow('./gradlew assembleRelease')).toBe(true)
		expect(isKnownSlow('eas build --local')).toBe(true)
		expect(isKnownSlow('ls')).toBe(false)
		expect(thresholdMs(undefined, false)).toBe(5 * 60_000)
		expect(thresholdMs(undefined, true)).toBe(10 * 60_000)
		expect(thresholdMs(10_000, false)).toBe(60_000)
		expect(thresholdMs(200_000, false)).toBe(400_000)
	})
	test('running average', () => {
		expect(nextAvg(undefined, 100)).toEqual({ avg: 100, n: 1 })
		expect(nextAvg({ avg: 100, n: 1 }, 300)).toEqual({ avg: 200, n: 2 })
	})
})

describe('disk', () => {
	test('free space from df -k', () => {
		const df =
			'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 971350180 900000000 15728640 99% /\n'
		expect(parseDfFreeGb(df)).toBe(15)
		expect(parseDfFreeGb('nope')).toBeNull()
	})
	test('alert when low on space or many containers', () => {
		const limits = { minFreeGb: 15, maxContainers: 20 }
		expect(diskAlert({ freeGb: 9, containers: 3 }, limits)).toContain('9 GB')
		expect(diskAlert({ freeGb: 100, containers: 42 }, limits)).toContain('42')
		expect(diskAlert({ freeGb: 100, containers: 3 }, limits)).toBeNull()
	})
})
```

(โค้ดของโมดูลอยู่ใน commit ของ task นี้; แต่ละฟังก์ชันตาม Interfaces ด้านบน)

### Task K2: devkit ใน session

**Files:** `plugins/devkit/hooks/register.tsx`, `plugins/devkit/sounds/done.wav`, `plugins/devkit/tests/session.test.ts`

พฤติกรรมที่เทสต์ต้องพิสูจน์:

- eol-guard: Edit ไฟล์ CRLF ล้วนแล้วผลเป็น LF → เขียนกลับเป็น CRLF + context; ไฟล์ผสม → ไม่เขียน + toast; ไฟล์ binary/ไม่มี → ไม่แตะ
- prior-work: prompt มี `OB-123` → context มี PR และ commit; `gh` ล้ม/ช้า → prompt ผ่านโดยไม่มี context
- branch-watch: branch เปลี่ยนโดยไม่มีคำสั่ง switch ของ Claude → toast; Claude สั่ง `git checkout` เอง → ไม่ toast
- long-run-watch: คำสั่งที่ค้างเกิน threshold → band; จบแล้ว band หาย
- disk-band: พื้นที่น้อย → band; `/cleanup` แสดงรายการ; `/cleanup confirm` จาก sdk ถูกปฏิเสธ; จาก composer ลบเฉพาะ container ที่มี label testcontainers
- usage-meter: status line มี `ctx N%`
- turn-done-sound: เทิร์นนานเกินเกณฑ์ → `audio.play({ asset: 'sounds/done.wav' })` + toast; สั้นกว่า → ไม่เล่น
- ปิดตัวไหนใน userConfig แล้วตัวนั้นไม่ทำงาน

- [ ] เทสต์ล้ม → เขียน register → ผ่าน → check.sh → commit `feat(devkit): wire the seven mods into the session`

### Task K3: review + ติดตั้ง + push

- [ ] review ทั้งช่วง (subagent, opus) → fix pass
- [ ] `claude plugin install devkit@claude-mods --scope user` → `/reload-plugins` → ลองใน session
- [ ] README เพิ่ม devkit → push
