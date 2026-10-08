import { describe, expect, test } from 'claude-code/testing'

import { parseGuards } from '../hooks/config'

const CHECKS = new Set(['version-bumped'])
const noParams = (): string[] => []

describe('parseGuards', () => {
	test('normalizes rules and adds repoRoot to vars', () => {
		const cfg = parseGuards(
			{
				vars: { baseBranch: 'origin/develop' },
				rules: [
					{
						id: 'prod-ref-main',
						tool: 'Bash',
						match: 'deploy-environment=PROD',
						unless: '--ref main\\b',
						action: 'deny',
						why: 'PROD ต้องรันจาก main',
						examples: {
							hit: ['gh workflow run api.yaml --ref develop -f deploy-environment=PROD'],
							miss: ['gh workflow run api.yaml --ref main -f deploy-environment=PROD'],
						},
					},
				],
			},
			'/r',
			CHECKS,
			noParams
		)
		expect(cfg.errors).toEqual([])
		expect(cfg.vars).toEqual({ baseBranch: 'origin/develop', repoRoot: '/r' })
		expect(cfg.rules[0]?.tools).toEqual(['Bash'])
		expect(cfg.rules[0]?.field).toBe('command')
		expect(cfg.rules[0]?.enabled).toBe(true)
	})
	test('drops invalid rules with a reason and keeps the rest', () => {
		const cfg = parseGuards(
			{
				rules: [
					{ id: 'bad', tool: 'Bash', match: '(', action: 'deny', why: 'x' },
					{ id: 'good', tool: 'Bash', match: 'x', action: 'warn', why: 'y' },
				],
			},
			'/r',
			CHECKS,
			noParams
		)
		expect(cfg.rules.map((r) => r.id)).toEqual(['good'])
		expect(cfg.errors[0]).toContain('bad')
	})
	test('non-object, non-string vars and non-array rules are errors, not crashes', () => {
		expect(parseGuards(42, '/r', CHECKS, noParams).errors.length).toBeGreaterThan(0)
		expect(parseGuards({ vars: { a: 1 } }, '/r', CHECKS, noParams).errors).toContain('vars.a ต้องเป็นข้อความ')
		expect(parseGuards({ rules: {} }, '/r', CHECKS, noParams).errors).toContain('rules ต้องเป็น array')
	})
	test('check params are validated by the check', () => {
		const cfg = parseGuards(
			{
				rules: [
					{
						id: 'vb',
						tool: 'Bash',
						check: 'version-bumped',
						params: {},
						action: 'deny',
						why: 'x',
					},
				],
			},
			'/r',
			CHECKS,
			(check) => (check === 'version-bumped' ? ['params.versionUrl ต้องมี'] : [])
		)
		expect(cfg.rules).toEqual([])
		expect(cfg.errors[0]).toContain('params.versionUrl ต้องมี')
	})
})
