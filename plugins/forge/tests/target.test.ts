import { describe, expect, test } from 'claude-code/testing'

import { commandDir } from '../hooks/target'
import { guardsAt, world } from './helpers'

describe('commandDir', () => {
	test('reads a leading cd or git -C', () => {
		expect(commandDir('cd /other && git status', '/repo', undefined)).toBe('/other')
		expect(commandDir('cd ../other; ls', '/repo/sub', undefined)).toBe('/repo/other')
		expect(commandDir('cd "/a b" && ls', '/repo', undefined)).toBe('/a b')
		expect(commandDir('git -C /other push', '/repo', undefined)).toBe('/other')
		expect(commandDir('cd ~/Documents/x && ls', '/repo', '/Users/me')).toBe('/Users/me/Documents/x')
		expect(commandDir('cd $HOME/x && ls', '/repo', '/Users/me')).toBe('/Users/me/x')
	})
	test('stays with the session folder when the target is not knowable', () => {
		expect(commandDir('git status', '/repo', undefined)).toBeUndefined()
		expect(commandDir('npm test && cd /other && ls', '/repo', undefined)).toBeUndefined()
		expect(commandDir('cd $PROJECT && ls', '/repo', undefined)).toBeUndefined()
		expect(commandDir('cd ~/x && ls', '/repo', undefined)).toBeUndefined()
		expect(commandDir('cd /other', '/repo', undefined)).toBeUndefined()
	})
})

// session อยู่ใน /repo (ฐาน origin/develop) แต่คำสั่ง cd ไป /other (ฐาน main)
const roots = (argv: readonly string[], init?: { cwd?: string }) => {
	if (argv.join(' ') !== 'git rev-parse --show-toplevel') return undefined
	const cwd = init?.cwd ?? '/repo'
	if (cwd.startsWith('/other')) return { exitCode: 0, stdout: '/other\n' }
	if (cwd.startsWith('/nogit')) return { exitCode: 128, stdout: '' }
	return { exitCode: 0, stdout: '/repo\n' }
}
const files = {
	...guardsAt('/repo', { vars: { baseBranch: 'origin/develop' }, rules: [] }),
	...guardsAt('/other', {
		vars: { baseBranch: 'main' },
		rules: [
			{ id: 'no-push', tool: 'Bash', segments: true, match: '\\bpush\\b', action: 'deny', why: 'ห้าม push ใน other' },
		],
	}),
}

describe('rules follow the folder a command cds into', () => {
	test('cd into another repo uses that repo base branch', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, files, run: roots })
		await $.tool.call({ tool: 'Bash', command: 'cd /other && git switch -c feat/x' })
		expect(ran).toEqual(['cd /other && git switch -c feat/x main'])
	})
	test('without cd the session repo still applies', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, files, run: roots })
		await $.tool.call({ tool: 'Bash', command: 'git switch -c feat/x' })
		expect(ran).toEqual(['git switch -c feat/x origin/develop'])
	})
	test('git -C picks up the other repo rules', async ($, on) => {
		world(on, { files, run: roots })
		const res = await $.tool.call({ tool: 'Bash', command: 'git -C /other push origin feat/x' })
		expect(res.deny).toContain('no-push')
	})
	test('cd into a folder outside git applies builtin rules only', async ($, on) => {
		const ran: string[] = []
		world(on, { ran, files, run: roots })
		await $.tool.call({ tool: 'Bash', command: 'cd /nogit && git switch -c feat/x' })
		expect(ran).toEqual(['cd /nogit && git switch -c feat/x'])
	})
	test('~ is expanded with HOME', async ($, on) => {
		const ran: string[] = []
		world(on, {
			ran,
			files,
			run: (argv, init) => roots(argv, { cwd: init?.cwd?.replace('/Users/me/other', '/other') }),
		})
		on('env.get', () => ({ value: '/Users/me' }))
		await $.tool.call({ tool: 'Bash', command: 'cd ~/other && git switch -c feat/x' })
		expect(ran).toEqual(['cd ~/other && git switch -c feat/x main'])
	})
})
