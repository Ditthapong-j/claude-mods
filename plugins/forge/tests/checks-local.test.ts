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
		expect(key.deny).toContain('private key')
		const conn = await $.tool.call({
			tool: 'Edit',
			file_path: '/repo/appsettings.json',
			old_string: 'a',
			new_string: '"Mongo": "mongodb://admin:hunter22@db:27017"',
		})
		expect(conn.deny).toBeDefined()
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
		expect(placeholder.deny).toBeUndefined()
		const example = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/.env.example',
			content: 'KEY=sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
		})
		expect(example.deny).toBeUndefined()
		const env = await $.tool.call({
			tool: 'Write',
			file_path: '/repo/.env',
			content: 'KEY=sk-ant-aaaaaaaaaaaaaaaaaaaaaaaa',
		})
		expect(env.deny).toBeUndefined()
	})
})

describe('vitest-concurrent', () => {
	test('denies a second vitest while one runs', async ($, on) => {
		world(on, {
			run: (argv) => (argv[0] === 'pgrep' ? { exitCode: 0, stdout: '48211\n' } : undefined),
		})
		const res = await $.tool.call({ tool: 'Bash', command: 'npx vitest run' })
		expect(res.deny).toContain('48211')
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
		expect(res.deny).toContain('18923')
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
