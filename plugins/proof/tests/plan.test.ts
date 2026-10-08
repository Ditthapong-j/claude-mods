import { describe, expect, test } from 'claude-code/testing'

import { commandsFor, parseProofConfig, splitCommand } from '../hooks/plan'

describe('parseProofConfig', () => {
	test('reads the proof map and reports bad entries', () => {
		const out = parseProofConfig('{"proof":{"apps/web/**":"npx tsc -p apps/web/tsconfig.app.json --noEmit","x/**":42}}')
		expect(out.rules).toEqual([{ glob: 'apps/web/**', command: 'npx tsc -p apps/web/tsconfig.app.json --noEmit' }])
		expect(out.errors[0]).toContain('x/**')
		expect(parseProofConfig(null)).toEqual({ rules: [], errors: [] })
		expect(parseProofConfig('{ nope').errors.length).toBe(1)
	})
})

describe('splitCommand', () => {
	test('keeps quoted args and refuses shell operators', () => {
		expect(splitCommand('dotnet test --filter "A&B"')).toEqual(['dotnet', 'test', '--filter', 'A&B'])
		expect(splitCommand('npm test && rm -rf x')).toEqual([])
		expect(splitCommand('a | b')).toEqual([])
	})
})

describe('commandsFor', () => {
	test('config first, then the nearest project, deduplicated', () => {
		const cmds = commandsFor(
			['/r/apps/web/src/a.tsx', '/r/apps/web/src/b.tsx', '/r/libs/x/y.ts', '/r/README.md'],
			'/r',
			[{ glob: 'apps/web/**', command: 'npx tsc -p apps/web/tsconfig.app.json --noEmit' }],
			[
				{ dir: '/r/libs/x', kind: 'tsc' },
				{ dir: '/r/libs/x', kind: 'vitest' },
			]
		)
		expect(cmds.map((c) => c.label)).toEqual([
			'npx tsc -p apps/web/tsconfig.app.json --noEmit',
			'npx tsc --noEmit -p /r/libs/x',
			'npx vitest related --run y.ts (/r/libs/x)',
		])
		expect(cmds[0]?.cwd).toBe('/r')
		expect(cmds[2]?.cwd).toBe('/r/libs/x')
	})
})
