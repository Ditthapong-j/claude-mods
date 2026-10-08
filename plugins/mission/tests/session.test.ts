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
	on('ui.open', () => ({ value: { isPlaced: true as const } }))
	on('ui.toast', () => ({ value: undefined }))
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	const snap = await $.tool.call({ tool: 'mcp__mission__snapshot' })
	const text = String(snap.result)
	expect(text).toContain('"dirty":2')
	expect(text).toContain('not logged in')
	expect(text).toContain('ab6772')
})

test(
	'envs from userConfig become version rows',
	{ options: { envs: '[{"name":"DEV","url":"https://api.acme.example/v"}]' } },
	async ($, on) => {
		mock.clock(on)
		on('session.cwd', () => ({ value: '/r' }))
		on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: 'no', isStdoutTruncated: false, isStderrTruncated: false } }))
		on('tool.call', { tool: 'ListAgents' }, () => ({ result: '' }))
		on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.5.1","commit":"abcdef123"}' } }))
		on('ui.toast', () => ({ value: undefined }))
		await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
		const snap = await $.tool.call({ tool: 'mcp__mission__snapshot' })
		expect(String(snap.result)).toContain('"version":"1.5.1"')
		expect(String(snap.result)).toContain('"name":"DEV"')
	}
)
