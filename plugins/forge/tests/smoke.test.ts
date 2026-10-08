import { expect, test } from 'claude-code/testing'

test('forge registers the /guards command on session start', async ($, on) => {
	const names: string[] = []
	on('command.register', ($, e) => {
		names.push(e.name)
		return { value: { command: e.name } }
	})
	on('session.start', ($, e) => ({ cwd: e.cwd }))
	await $.session.start({ cwd: '/repo', surface: null, isInteractive: true })
	expect(names).toContain('guards')
})
