import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

type RunAnswer = { exitCode: number; stdout: string; stderr?: string }

export type World = {
	cwd?: string
	cwdThrows?: boolean
	root?: string | null
	files?: Record<string, string>
	run?: (argv: readonly string[]) => RunAnswer | undefined
	fetch?: (url: string) => { status: number; text: string }
	toasts?: string[]
	ran?: string[]
}

// แทน engine ใต้ plugin: git root, ไฟล์, process, http, toast และ Bash ที่ "รันจริง"
// hook ของ test ที่ตอบการเรียก noun ของ $ ต้องตอบเป็น { value }
export function world(on: On, w: World): void {
	const cwd = w.cwd ?? '/repo'
	const root = w.root === undefined ? '/repo' : w.root
	mock.clock(on)
	on('session.cwd', () => {
		if (w.cwdThrows === true) throw new Error('boom')
		return { value: cwd }
	})
	on('process.run', ($, e) => {
		const custom = w.run?.(e.argv)
		const gitRoot: RunAnswer = { exitCode: root === null ? 128 : 0, stdout: root === null ? '' : `${root}\n` }
		const res = custom ?? (e.argv.join(' ') === 'git rev-parse --show-toplevel' ? gitRoot : ({ exitCode: 1, stdout: '' } as RunAnswer))
		return {
			value: {
				exitCode: res.exitCode,
				stdout: res.stdout,
				stderr: res.stderr ?? '',
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		}
	})
	on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }))
	on('fs.read', ($, e) => {
		const text = w.files?.[e.path]
		if (text === undefined) throw new Error(`no file ${e.path}`)
		return { value: text }
	})
	on('http.fetch', ($, e) => {
		const res = w.fetch?.(e.url) ?? { status: 599, text: 'offline' }
		return { value: { status: res.status, ok: res.status >= 200 && res.status < 300, headers: {}, text: res.text } }
	})
	on('ui.toast', ($, e) => {
		w.toasts?.push(e.text)
		return { value: undefined }
	})
	on('ui.status', () => ({ value: undefined }))
	on('tool.call', { tool: 'Bash' }, ($, e) => {
		w.ran?.push(e.command)
		return { result: { stdout: 'ok', stderr: '', interrupted: false } }
	})
	on('tool.call', { tool: 'Read' }, () => ({
		result: { type: 'text', file: { filePath: '/x', content: '', numLines: 0, startLine: 1, totalLines: 0 } },
	}))
}

export function guardsAt(root: string, guards: unknown): Record<string, string> {
	return { [`${root}/.claude/guards.json`]: JSON.stringify(guards) }
}
