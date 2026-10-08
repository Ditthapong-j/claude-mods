import { costEstimate } from './cost-estimate'
import { prHeadRename } from './pr-head-rename'
import { secret } from './secret'
import type { Check } from './types'
import { versionBumped } from './version-bumped'
import { vitestConcurrent } from './vitest-concurrent'

export const CHECKS: Readonly<Record<string, Check>> = {
	secret,
	'vitest-concurrent': vitestConcurrent,
	'pr-head-rename': prHeadRename,
	'version-bumped': versionBumped,
	'cost-estimate': costEstimate,
}

export const CHECK_NAMES: ReadonlySet<string> = new Set(Object.keys(CHECKS))

export function validateCheckParams(check: string, params: unknown): string[] {
	const found = CHECKS[check]
	return found === undefined ? [`ไม่รู้จัก check "${check}"`] : found.validate(params)
}
