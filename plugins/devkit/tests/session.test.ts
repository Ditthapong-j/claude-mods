import { describe, expect, test } from 'claude-code/testing'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

type W = {
	files?: Record<string, string>
	written?: Record<string, string>
	run?: (cmd: string) => { code: number; out: string } | undefined
	toasts?: string[]
	status?: (string | undefined)[]
	sounds?: string[]
	bashHang?: Promise<void>
}

const P = { isFullscreen: false, columns: 120 }

function world(on: On, w: W): MockClock {
	const clock = mock.clock(on)
	mock.store(on)
	const ok = (code: number, stdout: string) => ({ value: { exitCode: code, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
	on('session.cwd', () => ({ value: '/r' }))
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	on('command.register', ($, e) => ({ value: { command: e.name } }))
	on('process.run', ($, e) => {
		const cmd = e.argv.join(' ')
		const custom = w.run?.(cmd)
		if (custom !== undefined) return ok(custom.code, custom.out)
		if (cmd === 'git rev-parse --show-toplevel') return ok(0, '/r\n')
		if (cmd === 'git rev-parse --abbrev-ref HEAD') return ok(0, 'fix/a\n')
		if (cmd.startsWith('git symbolic-ref')) return ok(0, 'origin/develop\n')
		if (cmd.startsWith('git rev-list --count')) return ok(0, '3\n')
		if (cmd === 'git status --porcelain') return ok(0, ' M a\n M b\n')
		if (cmd === 'df -k /') return ok(0, 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 1 1 104857600 1% /\n')
		if (e.argv[0] === 'docker') return ok(0, '')
		return ok(1, '')
	})
	on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }))
	on('fs.read', ($, e) => ({ value: w.files?.[e.path] ?? '' }))
	on('fs.write', ($, e) => {
		if (w.written !== undefined) w.written[e.path] = e.text
		if (w.files !== undefined) w.files[e.path] = e.text
		return { value: undefined }
	})
	on('ui.toast', ($, e) => {
		w.toasts?.push(e.text)
		return { value: undefined }
	})
	on('ui.status', ($, e) => {
		w.status?.push(e.text)
		return { value: undefined }
	})
	on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 62_000, window: 100_000, percent: 62 }, rateLimits: [] } }))
	on('audio.play', ($, e) => {
		w.sounds?.push(String((e as unknown as { clip: { asset?: string } }).clip.asset))
		return { value: undefined }
	})
	on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
	on('turn.complete', ($, e) => ({ text: e.answer }))
	on('tool.call', { tool: 'Edit' }, ($, e) => {
		// จำลอง Edit: แทนข้อความ (Edit tool เขียนบรรทัดใหม่เป็น LF)
		const before = w.files?.[e.file_path] ?? ''
		if (w.files !== undefined) w.files[e.file_path] = before.replace(e.old_string, e.new_string).replace(/\r\n/g, '\n')
		return { result: { filePath: e.file_path, oldString: '', newString: '', originalFile: '', structuredPatch: [], userModified: false, replaceAll: false } }
	})
	on('tool.call', { tool: 'Bash' }, async () => {
		if (w.bashHang !== undefined) await w.bashHang
		return { result: { stdout: 'ok', stderr: '', interrupted: false } }
	})
	return clock
}

const turn = (ms: number) => ({ reason: 'answer' as const, answer: 'x', durationMs: ms, isAborted: false, turnId: 't' })

describe('devkit in a session', () => {
	test('eol-guard puts CRLF back on a CRLF file and leaves mixed files alone', async ($, on) => {
		const files: Record<string, string> = { '/r/a.cs': 'a\r\nb\r\n', '/r/m.cs': 'a\r\nb\n' }
		const toasts: string[] = []
		world(on, { files, toasts })
		const res = await $.tool.call({ tool: 'Edit', file_path: '/r/a.cs', old_string: 'b', new_string: 'c' })
		expect(files['/r/a.cs']).toBe('a\r\nc\r\n')
		expect(res.context?.join('\n')).toContain('CRLF')
		await $.tool.call({ tool: 'Edit', file_path: '/r/m.cs', old_string: 'b', new_string: 'c' })
		expect(files['/r/m.cs']).toBe('a\nc\n')
		expect(toasts.some((t) => t.includes('ผสม'))).toBe(true)
	})

	test('prior-work attaches open PRs and commits for an issue id; gh failing still lets the prompt through', async ($, on) => {
		world(on, {
			run: (cmd) =>
				cmd.startsWith('gh pr list')
					? { code: 0, out: '[{"number":9,"title":"fix OB-123","url":"https://x/9"}]' }
					: cmd.startsWith('git log')
						? { code: 0, out: 'abc123 fix(OB-123): first\n' }
						: undefined,
		})
		const res = await $.prompt.submit({ text: 'ช่วยแก้ OB-123 หน่อย', origin: { kind: 'composer' }, wait: false })
		expect(JSON.stringify(res)).toContain('PR #9')
	})

	test('prior-work with gh unavailable passes the prompt unchanged', async ($, on) => {
		world(on, { run: (cmd) => (cmd.startsWith('gh') || cmd.startsWith('git log') ? { code: 127, out: '' } : undefined) })
		const res = await $.prompt.submit({ text: 'ช่วยแก้ OB-123 หน่อย', origin: { kind: 'composer' }, wait: false })
		expect(res.text).toBe('ช่วยแก้ OB-123 หน่อย')
		expect(JSON.stringify(res)).not.toContain('prior-work')
	})

	test('status line shows branch, behind, dirty and context', async ($, on) => {
		const status: (string | undefined)[] = []
		world(on, { status })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		expect(status.at(-1)).toBe('fix/a ↓3 · ค้าง 2 · ctx 62%')
	})

	test('branch-watch toasts when the branch changes outside Claude, not when Claude switched it', async ($, on) => {
		const toasts: string[] = []
		let branch = 'fix/a'
		const clock = world(on, { toasts, run: (cmd) => (cmd === 'git rev-parse --abbrev-ref HEAD' ? { code: 0, out: `${branch}\n` } : undefined) })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		branch = 'develop'
		await clock.advance(30_000)
		expect(toasts.some((t) => t.includes('fix/a') && t.includes('develop'))).toBe(true)
		toasts.length = 0
		await $.tool.call({ tool: 'Bash', command: 'git checkout main' })
		branch = 'main'
		await clock.advance(30_000)
		expect(toasts.filter((t) => t.includes('branch'))).toEqual([])
	})

	test('turn-done-sound plays only for long turns', async ($, on) => {
		const sounds: string[] = []
		world(on, { sounds })
		await $.turn.complete(turn(30_000))
		expect(sounds).toEqual([])
		await $.turn.complete(turn(180_000))
		expect(sounds).toEqual(['sounds/done.wav'])
	})

	test('/cleanup lists first and deletes only on the person\'s confirm', async ($, on) => {
		const removed: string[] = []
		world(on, {
			run: (cmd) => {
				if (cmd.startsWith('docker ps')) return { code: 0, out: 'c1\nc2\n' }
				if (cmd.startsWith('docker rm')) {
					removed.push(cmd)
					return { code: 0, out: '' }
				}
				return undefined
			},
		})
		const list = await $.command.run({ command: 'cleanup', args: '', origin: { kind: 'composer' }, presentation: P })
		expect(list.text).toContain('2')
		expect(removed).toEqual([])
		const byModel = await $.command.run({ command: 'cleanup', args: 'confirm', origin: { kind: 'sdk' }, presentation: P })
		expect(byModel.text).toContain('ผู้ใช้ต้อง')
		expect(removed).toEqual([])
		await $.command.run({ command: 'cleanup', args: 'confirm', origin: { kind: 'composer' }, presentation: P })
		expect(removed).toEqual(['docker rm -f c1 c2'])
	})

	test('long-run-watch warns while a command runs past its threshold', async ($, on) => {
		let release: () => void = () => undefined
		const toasts: string[] = []
		const clock = world(on, { toasts, bashHang: new Promise<void>((r) => (release = r)) })
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		const running = $.tool.call({ tool: 'Bash', command: './gradlew assembleRelease' })
		await clock.advance(11 * 60_000)
		expect(toasts.some((t) => t.includes('gradlew'))).toBe(true)
		release()
		await running
	})

	test('a switched-off mod does nothing', { options: { turnDoneSound: false } }, async ($, on) => {
		const sounds: string[] = []
		world(on, { sounds })
		await $.turn.complete(turn(600_000))
		expect(sounds).toEqual([])
	})
})
