import { describe, expect, test } from 'claude-code/testing'

import { disableCommand, parseInstalled, parseRulesTool, pluginRow } from '../hooks/view'

describe('manager view', () => {
	test('rows and disable commands', () => {
		const row = pluginRow({ name: 'forge', version: '0.1.0', provenance: 'forge@claude-mods', root: '/p/forge' })
		expect(row.isSuite).toBe(true)
		expect(disableCommand(row)).toBe('claude plugin disable forge@claude-mods')
		expect(pluginRow({ name: 'other', root: '/x' }).isSuite).toBe(false)
	})
	test('rules tool result parsing', () => {
		const ok = parseRulesTool({
			result: JSON.stringify({
				rules: [{ id: 'a', source: 'builtin', action: 'deny', enabled: true, hits30: 2 }],
				errors: [],
			}),
		})
		expect('rules' in ok ? ok.rules[0]?.hits30 : -1).toBe(2)
		expect('error' in parseRulesTool({ deny: 'no such tool' })).toBe(true)
		expect('error' in parseRulesTool({ result: 'nope' })).toBe(true)
	})
	test('installed plugins from claude plugin list --json', () => {
		const rows = parseInstalled(
			JSON.stringify([
				{ id: 'forge@claude-mods', version: '0.1.0', scope: 'user', enabled: true, installPath: '/p/forge' },
				{ id: 'other@x', version: '1.0.0', scope: 'user', enabled: false, installPath: '/p/o' },
			])
		)
		if ('error' in rows) throw new Error(rows.error)
		expect(rows.map((r) => `${r.name}:${r.provenance}:${r.isSuite}:${r.enabled}`)).toEqual([
			'forge:forge@claude-mods:true:true',
			'other:other@x:false:false',
		])
		expect('error' in parseInstalled('nope')).toBe(true)
	})
})
