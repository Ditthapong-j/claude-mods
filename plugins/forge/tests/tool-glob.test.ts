import { describe, expect, test } from 'claude-code/testing'

import { toolMatches } from '../hooks/match'
import { guardsAt, world } from './helpers'

const GATE = {
	id: 'write-gate',
	tools: ['mcp__acme-write__*'],
	field: '*',
	match: '.',
	action: 'deny',
	why: 'เขียน Help Center บน PROD ต้องให้ผู้ใช้อนุญาตก่อน',
}

describe('tool name globs', () => {
	test('toolMatches treats * as a wildcard and everything else literally', () => {
		expect(toolMatches(['mcp__acme-write__*'], 'mcp__acme-write__help_articles_create')).toBe(true)
		expect(toolMatches(['mcp__acme-write__*'], 'mcp__acme-read__help_search')).toBe(false)
		expect(toolMatches(['Bash'], 'Bash')).toBe(true)
		expect(toolMatches(['mcp__a.b__*'], 'mcp__aXb__x')).toBe(false)
	})

	test('a glob rule with field "*" gates every tool of an MCP server', async ($, on) => {
		world(on, { files: guardsAt('/repo', { rules: [GATE] }) })
		on('tool.call', { tool: 'mcp__acme-read__help_search' }, () => ({ result: 'ok' }))
		const write = await $.tool.call({ tool: 'mcp__acme-write__help_articles_publish', id: 'a1' } as never)
		expect(write.deny).toContain('write-gate')
		const read = await $.tool.call({ tool: 'mcp__acme-read__help_search', query: 'x' } as never)
		expect(read.deny).toBeUndefined()
	})

	test('/guards allow lets one call through', async ($, on) => {
		world(on, { files: guardsAt('/repo', { rules: [GATE] }) })
		on('tool.call', { tool: 'mcp__acme-write__help_articles_publish' }, () => ({ result: 'published' }))
		await $.command.run({ command: 'guards', args: 'allow write-gate', origin: { kind: 'composer' } } as never)
		const first = await $.tool.call({ tool: 'mcp__acme-write__help_articles_publish', id: 'a1' } as never)
		expect(first.deny).toBeUndefined()
		const second = await $.tool.call({ tool: 'mcp__acme-write__help_articles_publish', id: 'a2' } as never)
		expect(second.deny).toContain('write-gate')
	})
})
