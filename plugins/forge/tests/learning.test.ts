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
		on('turn.complete', ($, e) => ({ text: e.answer }))
		await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/a' })
		await $.prompt.submit({
			text: 'อย่าแตก branch ตรงนี้ ให้แตกจาก origin/develop เสมอนะ',
			origin: { kind: 'composer' },
			wait: false,
		})
		await $.turn.complete({ reason: 'answer', answer: 'ขอโทษครับ', durationMs: 1000, isAborted: false, turnId: 't1' })
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
		on('turn.complete', ($, e) => ({ text: e.answer }))
		await $.tool.call({ tool: 'Bash', command: 'git checkout -b fix/a' })
		await $.prompt.submit({
			text: 'ช่วยเพิ่มปุ่ม export CSV ในหน้ารายการออเดอร์ให้หน่อย',
			origin: { kind: 'composer' },
			wait: false,
		})
		await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1' })
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
		const res = await $.tool.call({ tool: 'mcp__forge__rules' })
		expect(JSON.stringify(res)).toContain('named-stash')
	})
})
