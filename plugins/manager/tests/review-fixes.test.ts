import { expect, test } from 'claude-code/testing'

const P = { isFullscreen: false, columns: 160 }

test('#10 drawing /mods reads collected data and never spawns the CLI', async ($, on) => {
	let cli = 0
	on('process.run', () => {
		cli++
		return {
			value: {
				exitCode: 0,
				stdout: JSON.stringify([{ id: 'forge@claude-mods', version: '0.1.0', scope: 'user', enabled: true, installPath: '/p/forge' }]),
				stderr: '',
				isStdoutTruncated: false,
				isStderrTruncated: false,
			},
		}
	})
	on('ui.open', () => ({ value: { isPlaced: true as const } }))
	on('tool.call', { tool: 'mcp__forge__rules' }, () => ({ result: JSON.stringify({ rules: [], errors: [] }) }))
	on('tool.call', { tool: 'mcp__proof__status' }, () => ({ deny: 'no such tool' }))
	await $.command.run({ command: 'mods', args: '', origin: { kind: 'composer' }, presentation: P })
	expect(cli).toBe(1)
	const ui = await $.ui.mount({
		plugin: 'manager',
		surface: 'terminal',
		component: 'Pane',
		requestId: 'mods',
		props: { title: 'Mods', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
	})
	expect(await ui.find({ text: /forge@claude-mods/ })).toBeDefined()
	expect(cli).toBe(1)
	await ui.unmount()
})
