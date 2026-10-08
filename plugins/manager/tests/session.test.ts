import { expect, test } from 'claude-code/testing'

const P = { isFullscreen: false, columns: 160 }

test('/mods lists plugins seen at load and the rules of forge', async ($, on) => {
	on('process.run', () => ({
		value: {
			exitCode: 0,
			stdout: JSON.stringify([{ id: 'forge@claude-mods', version: '0.1.0', scope: 'user', enabled: true, installPath: '/p/forge' }]),
			stderr: '',
			isStdoutTruncated: false,
			isStderrTruncated: false,
		},
	}))
	on('ui.open', () => ({ value: { isPlaced: true as const } }))
	on('tool.call', { tool: 'mcp__forge__rules' }, () => ({
		result: JSON.stringify({
			rules: [{ id: 'named-stash', source: 'builtin', action: 'deny', enabled: true, hits30: 3 }],
			errors: [],
		}),
	}))
	on('tool.call', { tool: 'mcp__proof__status' }, () => ({ deny: 'no such tool' }))
	const res = await $.command.run({ command: 'mods', args: 'text', origin: { kind: 'composer' }, presentation: P })
	expect(res.text).toContain('forge@claude-mods')
	expect(res.text).toContain('named-stash')
	expect(res.text).toContain('proof: ไม่ได้ติดตั้ง')
})
