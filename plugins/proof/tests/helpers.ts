import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

export type ProofWorld = {
	files?: Record<string, string>
	runs?: { argv: readonly string[]; cwd?: string }[]
	exit?: (argv: readonly string[]) => number
	toasts?: string[]
	status?: (string | undefined)[]
	submitted?: string[]
	filled?: string[]
}

export function proofWorld(on: On, w: ProofWorld): MockClock {
	const clock = mock.clock(on)
	on('session.cwd', () => ({ value: '/r' }))
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	on('command.register', ($, e) => ({ value: { command: e.name } }))
	on('tool.register', ($, e) => ({ value: { tool: e.name } }))
	on('process.run', ($, e) => {
		if (e.argv.join(' ') === 'git rev-parse --show-toplevel')
			return { value: { exitCode: 0, stdout: '/r\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
		w.runs?.push({ argv: e.argv, cwd: e.init?.cwd })
		const code = w.exit?.(e.argv) ?? 0
		return {
			value: {
				exitCode: code,
				stdout: code === 0 ? 'ok' : 'FAIL x.test.ts',
				stderr: '',
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		}
	})
	on('fs.exists', ($, e) => ({ value: w.files?.[e.path] !== undefined }))
	on('fs.read', ($, e) => ({ value: w.files?.[e.path] ?? '' }))
	on('ui.toast', ($, e) => {
		w.toasts?.push(e.text)
		return { value: undefined }
	})
	on('ui.status', ($, e) => {
		w.status?.push(e.text)
		return { value: undefined }
	})
	on('prompt.fill', ($, e) => {
		w.filled?.push(e.text)
		return { isFilled: true }
	})
	on('prompt.submit', ($, e) => {
		w.submitted?.push(e.text)
		return { text: e.text }
	})
	on('tool.call', { tool: 'Edit' }, () => ({
		result: {
			filePath: '/x',
			oldString: '',
			newString: '',
			originalFile: '',
			structuredPatch: [],
			userModified: false,
			replaceAll: false,
		},
	}))
	on('turn.complete', ($, e) => ({ text: e.answer }))
	return clock
}
