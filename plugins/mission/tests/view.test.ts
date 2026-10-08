import { describe, expect, test } from 'claude-code/testing'

import { envTable, layout, prRows, trunc, waitingItems, workRows } from '../hooks/view'
import type { EnvRow, Pr } from '../hooks/parse'

const pr = (n: number, checks: Pr['checks'], review: Pr['review'], extra: Partial<Pr> = {}): Pr => ({
	number: n,
	title: `title ${n}`,
	branch: `b${n}`,
	checks,
	review,
	checksPass: checks === 'pass' ? 6 : 1,
	checksTotal: 6,
	updatedAt: null,
	...extra,
})

describe('mission view', () => {
	test('trunc keeps short text and ends long text with …', () => {
		expect(trunc('abc', 5)).toBe('abc')
		expect(trunc('abcdefgh', 5)).toBe('abcd…')
	})

	test('PR rows put red first, then running, then green, and count the rest', () => {
		const out = prRows([pr(1, 'pass', 'approved'), pr(2, 'fail', 'pending'), pr(3, 'pending', 'changes'), pr(4, 'pass', 'pending')], 3)
		expect(out.rows.map((r) => r.num)).toEqual([2, 3, 1])
		expect(out.rows[0]?.ci).toEqual({ text: '✗ 1/6', tone: 'error' })
		expect(out.rows[1]?.ci).toEqual({ text: 'กำลังรัน', tone: 'warning' })
		expect(out.rows[2]?.ci).toEqual({ text: '✓ 6/6', tone: 'success' })
		expect(out.rows[1]?.review).toEqual({ text: 'ขอแก้', tone: 'error' })
		expect(out.rows[2]?.review).toEqual({ text: 'อนุมัติ', tone: 'success' })
		expect(out.more).toBe(1)
	})

	test('work rows show this worktree and the dirty ones; clean ones are counted', () => {
		const out = workRows(
			[
				{ path: '/r', branch: 'main', dirty: 0 },
				{ path: '/r/.wt/here', branch: 'claude/here', dirty: 0 },
				{ path: '/r/.wt/busy', branch: 'fix/busy', dirty: 4 },
				{ path: '/r/.wt/big', branch: 'feat/big', dirty: 32 },
			],
			'/r/.wt/here',
			10
		)
		expect(out.rows.map((r) => `${r.name}:${r.status.text}`)).toEqual(['here:ที่นี่', 'big:ค้าง 32 ไฟล์', 'busy:ค้าง 4 ไฟล์'])
		expect(out.rows[0]?.status.tone).toBe('success')
		expect(out.rows[1]?.status.tone).toBe('warning')
		expect(out.clean).toBe(1)
	})

	test('env table pivots env × service and flags problems', () => {
		const envs: EnvRow[] = [
			{ name: 'DEV', service: 'api', version: '1.5.1', commit: '5647c83', problem: null },
			{ name: 'DEV', service: 'ai', version: '0.0.0-dev', commit: null, problem: 'build args' },
			{ name: 'PROD', service: 'api', version: '1.5.1', commit: '5cd01cd', problem: null },
		]
		const t = envTable(envs)
		expect(t.columns).toEqual(['api', 'ai'])
		expect(t.rows.map((r) => r.env)).toEqual(['DEV', 'PROD'])
		expect(t.rows[0]?.cells).toEqual([
			{ text: '1.5.1 · 5647c83', tone: 'success' },
			{ text: '0.0.0-dev', tone: 'error' },
		])
		expect(t.rows[1]?.cells[1]).toEqual({ text: '-', tone: 'inactive' })
	})

	test('waiting items carry a tone and age when known', () => {
		const items = waitingItems(
			[pr(3933, 'fail', 'pending', { title: 'slip amount', updatedAt: 1_000_000 - 12 * 60_000 })],
			[{ name: 'DEV', service: 'ai', version: null, commit: null, problem: 'timeout' }],
			1_000_000
		)
		expect(items).toEqual([
			{ text: 'PR #3933 slip amount · CI แดง', tone: 'error', age: '12 นาที' },
			{ text: 'DEV ai · timeout', tone: 'warning', age: null },
		])
	})

	test('layout goes side by side only when wide', () => {
		expect(layout(140)).toBe('two')
		expect(layout(80)).toBe('stack')
	})
})
