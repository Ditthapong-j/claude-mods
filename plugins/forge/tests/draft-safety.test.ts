import { describe, expect, test } from 'claude-code/testing'

import { parseLessonsArgs } from '../hooks/rules-view'
import { world } from './helpers'

const P = { isFullscreen: false, columns: 120 }
const rule = (id: string, extra: Record<string, unknown> = {}) => ({
	id,
	tool: 'Bash',
	match: `^echo ${id}$`,
	action: 'deny',
	why: 'x',
	examples: { hit: [`echo ${id}`], miss: ['git status', 'npm test'] },
	...extra,
})
const accept = (args: string) => ({ command: 'lessons', args, origin: { kind: 'composer' as const }, presentation: P })

describe('draft safety', () => {
	test('a draft may not switch a rule off or reuse an existing id', async ($, on) => {
		world(on, { root: null })
		const off = await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: rule('aaa', { enabled: false }) })
		expect(String(off.result)).toContain('ปิดกฎ')
		const clash = await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: rule('named-stash') })
		expect(String(clash.result)).toContain('named-stash')
		const res = await $.command.run(accept('accept any-repo'))
		expect(res.text).toContain('ไม่มีร่างกฎ')
	})

	test('a second draft queues behind the one on screen', async ($, on) => {
		world(on, { root: null })
		await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: rule('first') })
		await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: rule('second') })
		const one = await $.command.run(accept('accept any-repo'))
		expect(one.text).toContain('first')
		const two = await $.command.run(accept('accept any-repo'))
		expect(two.text).toContain('second')
	})

	test('accept bound to a shown id refuses when the draft changed', async ($, on) => {
		world(on, { root: null })
		await $.tool.call({ tool: 'mcp__forge__propose_rule', rule: rule('shown') })
		const res = await $.command.run(accept('accept any-repo other'))
		expect(res.text).toContain('เปลี่ยน')
		const ok = await $.command.run(accept('accept any-repo shown'))
		expect(ok.text).toContain('shown')
	})

	test('parse keeps the optional id', () => {
		expect(parseLessonsArgs('accept repo abc', { kind: 'composer' })).toEqual({ kind: 'accept', scope: 'repo', id: 'abc' })
	})
})
