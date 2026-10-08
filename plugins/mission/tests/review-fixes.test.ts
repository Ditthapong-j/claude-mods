import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { On } from 'claude-code'

const P = { isFullscreen: false, columns: 160 }

function base(on: On, opts: { worktreeFails?: boolean; agentsThrow?: boolean } = {}): void {
	mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('process.run', ($, e) => {
		const res = (code: number, stdout: string, stderr = '') => ({ value: { exitCode: code, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } })
		const cmd = e.argv.join(' ')
		if (cmd === 'git rev-parse --show-toplevel') return res(0, '/r\n')
		if (cmd.startsWith('git worktree list')) return opts.worktreeFails === true ? res(128, '', 'fatal: not a git repository') : res(0, 'worktree /r\nHEAD a\nbranch refs/heads/main\n')
		if (e.argv[0] === 'gh') return res(0, '[]')
		return res(0, '')
	})
	on('tool.call', { tool: 'ListAgents' }, () => {
		if (opts.agentsThrow === true) throw new Error('ListAgents unavailable')
		return { result: '' }
	})
	on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.0.0","commit":"abcdef1"}' } }))
	on('ui.toast', () => ({ value: undefined }))
}

test('#9 a broken envs setting shows up as a problem row, not a missing box', { options: { envs: '{ nope' } }, async ($, on) => {
	base(on)
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	const snap = String((await $.tool.call({ tool: 'mcp__mission__snapshot' })).result)
	expect(snap).toContain('envs')
	expect(snap).toContain('"problem"')
})

test('#9 a failing worktree list says why', async ($, on) => {
	base(on, { worktreeFails: true })
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	const snap = String((await $.tool.call({ tool: 'mcp__mission__snapshot' })).result)
	expect(snap).toContain('not a git repository')
})

test('#9 ListAgents failing shows the reason in the sessions box and keeps the snapshot', async ($, on) => {
	base(on, { agentsThrow: true })
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	const snap = String((await $.tool.call({ tool: 'mcp__mission__snapshot' })).result)
	// engine ห่อ error ที่ hook โยน ข้อความจึงไม่ตรงตัว: ต้องมี error ในกล่อง peers และ snapshot ส่วนอื่นยังอยู่
	expect(snap).toContain('"peers":{"error"')
	expect(snap).toContain('"worktrees":[{')
})
