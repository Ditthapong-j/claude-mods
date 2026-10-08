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
		expect(res.deny).toContain('no-x')
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
		expect(bash.deny).toContain('forge')
		const read = await $.tool.call({ tool: 'Read', file_path: '/x' })
		expect(read.deny).toBeUndefined()
	})
})
