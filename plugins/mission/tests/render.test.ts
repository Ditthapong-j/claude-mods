import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

const P = { isFullscreen: false, columns: 160 }
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('the /mission pane draws cards on every surface that has panes', { options: { envs: '[{"name":"DEV","service":"api","url":"https://api.acme.example/v"}]' } }, async ($, on) => {
	mock.clock(on)
	on('session.cwd', () => ({ value: '/r/.wt/here' }))
	on('process.run', ($, e) => {
		const cmd = e.argv.join(' ')
		if (cmd === 'git rev-parse --show-toplevel') return ok('/r/.wt/here\n')
		if (cmd.startsWith('git worktree list')) return ok('worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /r/.wt/here\nHEAD b\nbranch refs/heads/claude/here\n\nworktree /r/.wt/big\nHEAD c\nbranch refs/heads/feat/big\n')
		if (cmd === 'git -C /r/.wt/big status --porcelain') return ok(' M a\n M b\n')
		if (e.argv[0] === 'gh') {
			return ok(JSON.stringify([{ number: 3933, title: 'slip amount', headRefName: 'fix/x', reviewDecision: '', statusCheckRollup: [{ conclusion: 'FAILURE' }, { conclusion: 'SUCCESS' }], updatedAt: '2026-10-08T00:00:00Z' }]))
		}
		return ok('')
	})
	on('tool.call', { tool: 'ListAgents' }, () => ({ result: '' }))
	on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: '{"version":"1.5.1","commit":"5647c83aa"}' } }))
	on('ui.toast', () => ({ value: undefined }))
	await $.command.run({ command: 'mission', args: 'refresh', origin: { kind: 'composer' }, presentation: P })
	for (const surface of ['terminal', 'desktop'] as const) {
		for (const bodyColumns of [150, 80]) {
			const ui = await $.ui.mount({
				plugin: 'mission',
				surface,
				component: 'Pane',
				requestId: 'mission',
				props: { title: 'Mission Control', isFocused: false, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
			})
			expect(await ui.find({ text: /รอคุณ · 1/ })).toBeDefined()
			expect(await ui.find({ text: /PR \+ CI/ })).toBeDefined()
			expect(await ui.find({ text: /✗ 1\/2/ })).toBeDefined()
			expect(await ui.find({ text: /ค้าง 2 ไฟล์/ })).toBeDefined()
			expect(await ui.find({ text: /1\.5\.1 · 5647c83/ })).toBeDefined()
			await ui.unmount()
		}
	}
})
