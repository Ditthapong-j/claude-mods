import { describe, expect, test } from 'claude-code/testing'

import { handleGuardsCommand } from '../hooks/commands'
import type { Rule } from '../hooks/types'
import { world } from './helpers'

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

describe('/guards wiring', () => {
	test('the command answers with the active rules', async ($, on) => {
		world(on, {})
		const res = await $.command.run({ command: 'guards', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
		expect(res.text).toContain('named-stash')
	})
	test('an allow that did not come from the person leaves the rule on', async ($, on) => {
		world(on, {})
		const res = await $.command.run({ command: 'guards', args: 'allow named-stash', origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 120 } })
		expect(res.text).toContain('ผู้ใช้ต้องพิมพ์เอง')
		const stash = await $.tool.call({ tool: 'Bash', command: 'git stash' })
		expect(stash.deny).toContain('named-stash')
	})
	test('an allow typed by the person lets the rule pass once', async ($, on) => {
		const ran: string[] = []
		world(on, { ran })
		await $.command.run({ command: 'guards', args: 'allow named-stash', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
		await $.tool.call({ tool: 'Bash', command: 'git stash' })
		const second = await $.tool.call({ tool: 'Bash', command: 'git stash' })
		expect(ran).toEqual(['git stash'])
		expect(second.deny).toContain('named-stash')
	})
})
