import { expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'

const GUARDS = '{"proof":{"apps/web/**":"npx tsc -p apps/web/tsconfig.app.json --noEmit"}}'
const edit = (file_path: string) => ({ tool: 'Edit' as const, file_path, old_string: 'a', new_string: 'b' })
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

test('#7 a file edited while proof runs gets its own run afterwards', async ($, on) => {
	const clock = mock.clock(on)
	const runs: string[] = []
	let release: () => void = () => undefined
	let started: () => void = () => undefined
	const firstStarted = new Promise<void>((r) => (started = r))
	on('session.cwd', () => ({ value: '/r' }))
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	on('command.register', ($, e) => ({ value: { command: e.name } }))
	on('tool.register', ($, e) => ({ value: { tool: e.name } }))
	on('fs.exists', ($, e) => ({ value: e.path === '/r/.claude/guards.json' }))
	on('fs.read', () => ({ value: GUARDS }))
	on('ui.status', () => ({ value: undefined }))
	on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/x', oldString: '', newString: '', originalFile: '', structuredPatch: [], userModified: false, replaceAll: false } }))
	on('process.run', async ($, e) => {
		if (e.argv.join(' ') === 'git rev-parse --show-toplevel') return ok('/r\n')
		runs.push(e.argv.join(' '))
		if (runs.length === 1) {
			started()
			await new Promise<void>((r) => (release = r))
		}
		return ok('ok')
	})
	await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
	await $.tool.call(edit('/r/apps/web/src/a.tsx'))
	const ticking = clock.advance(5000)
	await firstStarted
	await $.tool.call(edit('/r/apps/web/src/b.tsx'))
	// tick ยังทำงานระหว่างที่รอบแรก busy อยู่
	const whileBusy = clock.advance(6000)
	for (let i = 0; i < 50; i++) await Promise.resolve()
	release()
	await ticking
	await whileBusy
	await clock.advance(10_000)
	expect(runs.length).toBe(2)
})

test('#8 a run cut off by a reload does not leave proof busy or running forever', async ($, on) => {
	const clock = mock.clock(on)
	const runs: string[] = []
	let started: () => void = () => undefined
	const firstStarted = new Promise<void>((r) => (started = r))
	on('session.cwd', () => ({ value: '/r' }))
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	on('command.register', ($, e) => ({ value: { command: e.name } }))
	on('tool.register', ($, e) => ({ value: { tool: e.name } }))
	on('fs.exists', ($, e) => ({ value: e.path === '/r/.claude/guards.json' }))
	on('fs.read', () => ({ value: GUARDS }))
	on('ui.status', () => ({ value: undefined }))
	on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/x', oldString: '', newString: '', originalFile: '', structuredPatch: [], userModified: false, replaceAll: false } }))
	on('process.run', async ($, e) => {
		if (e.argv.join(' ') === 'git rev-parse --show-toplevel') return ok('/r\n')
		runs.push(e.argv.join(' '))
		if (runs.length === 1) {
			started()
			await new Promise<void>(() => undefined)
		}
		return ok('ok')
	})
	await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
	await $.tool.call(edit('/r/apps/web/src/a.tsx'))
	void clock.advance(5000)
	await firstStarted
	await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
	const status = await $.tool.call({ tool: 'mcp__proof__status' })
	expect(String(status.result)).toContain('ถูกขัดจังหวะ')
	await $.tool.call(edit('/r/apps/web/src/b.tsx'))
	await clock.advance(10_000)
	expect(runs.length).toBe(2)
})
