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
	onRead?: (path: string) => string | undefined
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
		if (cmd === 'git --no-optional-locks status --porcelain') return ok(0, ' M a\n M b\n')
		if (cmd === 'df -k /') return ok(0, 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/x 1 1 104857600 1% /\n')
		if (e.argv[0] === 'docker') return ok(0, '')
		return ok(1, '')
	})
	on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }))
	on('fs.read', ($, e) => ({ value: w.onRead?.(e.path) ?? w.files?.[e.path] ?? '' }))
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
		expect(removed).toEqual(['docker rm -v c1 c2'])
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

describe('devkit review fixes', () => {
	test('prior-work runs ids in parallel with short timeouts and only for the person\'s prompts', async ($, on) => {
		const calls: { cmd: string; timeoutMs?: number }[] = []
		const order: string[] = []
		mock.store(on)
		on('session.cwd', () => ({ value: '/r' }))
		on('process.run', async ($, e) => {
			const cmd = e.argv.join(' ')
			calls.push({ cmd, timeoutMs: e.init?.timeoutMs })
			if (cmd.startsWith('gh pr list')) {
				// ขนานกัน = gh ของทั้งสอง id เริ่มก่อนตัวแรกจบ
				order.push('start')
				for (let i = 0; i < 20; i++) await Promise.resolve()
				order.push('end')
			}
			const out = cmd.startsWith('git symbolic-ref') ? 'origin/develop\n' : '[]'
			return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
		})
		on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
		await $.prompt.submit({ text: 'OB-1 กับ OB-2', origin: { kind: 'composer' }, wait: false })
		expect(order).toEqual(['start', 'start', 'end', 'end'])
		const per = (p: string) => Math.max(...calls.filter((c) => c.cmd.startsWith(p)).map((c) => c.timeoutMs ?? 99_999))
		expect(per('git symbolic-ref') + per('gh pr list') + per('git log')).toBeLessThanOrEqual(4500)
		calls.length = 0
		await $.prompt.submit({ text: 'OB-3', origin: { kind: 'task-notification' } as never, wait: false })
		expect(calls.filter((c) => c.cmd.startsWith('gh'))).toEqual([])
	})

	test('long-run-watch tracks parallel commands separately', async ($, on) => {
		const toasts: string[] = []
		let releaseA: () => void = () => undefined
		const hangA = new Promise<void>((r) => (releaseA = r))
		const clock = mock.clock(on)
		mock.store(on)
		on('session.cwd', () => ({ value: '/r' }))
		on('session.start', ($, e) => ({ cwd: e.cwd }))
		on('command.register', ($, e) => ({ value: { command: e.name } }))
		on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
		on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
		on('ui.status', () => ({ value: undefined }))
		on('ui.toast', ($, e) => {
			toasts.push(e.text)
			return { value: undefined }
		})
		on('tool.call', { tool: 'Bash' }, async ($, e) => {
			if (e.command.includes('gradlew')) await hangA
			return { result: { stdout: '', stderr: '', interrupted: false } }
		})
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		const a = $.tool.call({ tool: 'Bash', command: './gradlew assembleRelease', tool_use_id: 'a' } as never)
		await $.tool.call({ tool: 'Bash', command: 'ls', tool_use_id: 'b' } as never)
		await clock.advance(11 * 60_000)
		expect(toasts.some((t) => t.includes('gradlew'))).toBe(true)
		releaseA()
		await a
	})

	test('/cleanup only lists stopped testcontainers and removes their volumes', async ($, on) => {
		const cmds: string[] = []
		world(on, {
			run: (cmd) => {
				cmds.push(cmd)
				if (cmd.startsWith('docker ps')) return { code: 0, out: 'c1\n' }
				if (cmd.startsWith('docker rm')) return { code: 0, out: '' }
				return undefined
			},
		})
		await $.command.run({ command: 'cleanup', args: 'confirm', origin: { kind: 'composer' }, presentation: P })
		expect(cmds.find((c) => c.startsWith('docker ps'))).toContain('status=exited')
		expect(cmds.filter((c) => c.startsWith('docker rm'))).toEqual(['docker rm -v c1'])
	})

	test('eol-guard keeps an intended LF Write and never overwrites a file changed meanwhile', async ($, on) => {
		const files: Record<string, string> = { '/r/a.sh': 'x\r\ny\r\n', '/r/b.cs': 'a\r\nb\r\n' }
		let reads = 0
		world(on, {
			files,
			onRead: (path) => {
				if (path !== '/r/b.cs') return undefined
				reads += 1
				// การอ่านครั้งที่ 3 = ไฟล์ถูกแก้โดยคนอื่นระหว่างที่ eol-guard กำลังจะเขียน
				return reads >= 3 ? 'other\n' : undefined
			},
		})
		on('tool.call', { tool: 'Write' }, ($, e) => {
			files[e.file_path] = e.content
			return { result: { type: 'update', filePath: e.file_path, content: e.content, structuredPatch: [], originalFile: null } } as never
		})
		await $.tool.call({ tool: 'Write', file_path: '/r/a.sh', content: 'x\ny\n' })
		expect(files['/r/a.sh']).toBe('x\ny\n')
		await $.tool.call({ tool: 'Edit', file_path: '/r/b.cs', old_string: 'b', new_string: 'c' })
		expect(files['/r/b.cs']).toBe('a\nc\n')
	})

	test('status uses git without optional locks, skips a detached HEAD, and disk is checked at start', async ($, on) => {
		const cmds: string[] = []
		const toasts: string[] = []
		let branch = 'fix/a'
		const clock = world(on, {
			toasts,
			run: (cmd) => {
				cmds.push(cmd)
				if (cmd === 'git rev-parse --abbrev-ref HEAD') return { code: 0, out: `${branch}\n` }
				if (cmd === 'git --no-optional-locks status --porcelain') return { code: 0, out: '' }
				return undefined
			},
		})
		await $.session.start({ cwd: '/r', surface: null, isInteractive: true })
		expect(cmds).toContain('git --no-optional-locks status --porcelain')
		expect(cmds).not.toContain('git status --porcelain')
		expect(cmds.some((c) => c.startsWith('df -k'))).toBe(true)
		branch = 'HEAD'
		await clock.advance(30_000)
		branch = 'fix/a'
		await clock.advance(30_000)
		expect(toasts.filter((t) => t.includes('branch'))).toEqual([])
	})

	test('turn-done-sound stays quiet for an interrupted turn', async ($, on) => {
		const sounds: string[] = []
		world(on, { sounds })
		await $.turn.complete({ ...turn(600_000), isAborted: true })
		expect(sounds).toEqual([])
	})
})
