import { describe, expect, test } from 'claude-code/testing'

import { isClaudeSwitch, statusText } from '../hooks/branch'
import { diskAlert, parseDfFreeGb } from '../hooks/disk'
import { detectEol, looksBinary, toCrlf } from '../hooks/eol'
import { commandKey, isKnownSlow, nextAvg, thresholdMs } from '../hooks/longrun'
import { issueIds, priorContext } from '../hooks/prior'

describe('eol', () => {
	test('detects line endings', () => {
		expect(detectEol('a\r\nb\r\n')).toBe('crlf')
		expect(detectEol('a\nb\n')).toBe('lf')
		expect(detectEol('a\r\nb\n')).toBe('mixed')
		expect(detectEol('one line')).toBe('none')
	})
	test('toCrlf converts bare LF only and is idempotent', () => {
		expect(toCrlf('a\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n')
		expect(toCrlf(toCrlf('a\nb'))).toBe('a\r\nb')
	})
	test('binary content is recognised', () => {
		expect(looksBinary('abc\u0000def')).toBe(true)
		expect(looksBinary('plain text')).toBe(false)
	})
})

describe('branch', () => {
	test('Claude-run switches are recognised anywhere in the command', () => {
		expect(isClaudeSwitch('git checkout develop')).toBe(true)
		expect(isClaudeSwitch('cd x && git switch -c fix/a')).toBe(true)
		expect(isClaudeSwitch('git checkout -- file.ts')).toBe(false)
		expect(isClaudeSwitch('git status')).toBe(false)
	})
	test('status text joins what is known', () => {
		expect(statusText({ branch: 'fix/a', behind: 3, dirty: 2, ctxPercent: 62 })).toBe('fix/a ↓3 · ค้าง 2 · ctx 62%')
		expect(statusText({ branch: 'main', behind: 0, dirty: 0, ctxPercent: null })).toBe('main')
		expect(statusText({ branch: null, behind: null, dirty: null, ctxPercent: 10 })).toBe('ctx 10%')
		expect(statusText({ branch: null, behind: null, dirty: null, ctxPercent: null })).toBeUndefined()
	})
})

describe('prior', () => {
	test('issue ids from a prompt', () => {
		expect(issueIds('แก้ OB-123 กับ #45 ด้วย และ OB-123 อีกที')).toEqual(['OB-123', '#45'])
		expect(issueIds('ไม่มีเลข')).toEqual([])
		expect(issueIds('UTF-8 SHA-256 ISO-8601 HTTP-2 color: #333; RFC-7231')).toEqual([])
		expect(issueIds('OB-1 OB-2 OB-3 OB-4')).toHaveLength(3)
	})
	test('context lists open PRs and commits, or nothing', () => {
		const ctx = priorContext(
			'OB-123',
			[{ number: 9, title: 'fix OB-123', url: 'https://x/9' }],
			['abc123 fix(OB-123): first try']
		)
		expect(ctx).toContain('PR #9')
		expect(ctx).toContain('abc123')
		expect(priorContext('OB-1', [], [])).toBeNull()
	})
})

describe('longrun', () => {
	test('command key is the first two words of the first segment', () => {
		expect(commandKey('npx vitest run src')).toBe('npx vitest')
		expect(commandKey('cd /r/backend && dotnet test')).toBe('dotnet test')
		expect(commandKey('FOO=1 npm test')).toBe('npm test')
		expect(commandKey('cd /r')).toBe('cd /r')
	})
	test('known slow commands and thresholds', () => {
		expect(isKnownSlow('./gradlew assembleRelease')).toBe(true)
		expect(isKnownSlow('eas build --local')).toBe(true)
		expect(isKnownSlow('ls')).toBe(false)
		expect(thresholdMs(undefined, false)).toBe(5 * 60_000)
		expect(thresholdMs(undefined, true)).toBe(10 * 60_000)
		expect(thresholdMs(10_000, false)).toBe(60_000)
		expect(thresholdMs(200_000, false)).toBe(400_000)
		expect(thresholdMs(10_000, true)).toBe(10 * 60_000)
	})
	test('running average', () => {
		expect(nextAvg(undefined, 100)).toEqual({ avg: 100, n: 1 })
		expect(nextAvg({ avg: 100, n: 1 }, 300)).toEqual({ avg: 200, n: 2 })
	})
})

describe('disk', () => {
	test('free space from df -k', () => {
		const df =
			'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 971350180 900000000 15728640 99% /\n'
		expect(parseDfFreeGb(df)).toBe(15)
		expect(parseDfFreeGb('nope')).toBeNull()
	})
	test('alert when low on space or many containers', () => {
		const limits = { minFreeGb: 15, maxContainers: 20 }
		expect(diskAlert({ freeGb: 9, containers: 3 }, limits)).toContain('9 GB')
		expect(diskAlert({ freeGb: 100, containers: 42 }, limits)).toContain('42')
		expect(diskAlert({ freeGb: 100, containers: 3 }, limits)).toBeNull()
	})
})
