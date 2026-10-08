import type { Check } from './types'

export const CHECKS: Readonly<Record<string, Check>> = {}

export const CHECK_NAMES: ReadonlySet<string> = new Set(Object.keys(CHECKS))

export function validateCheckParams(check: string, params: unknown): string[] {
	const found = CHECKS[check]
	return found === undefined ? [`ไม่รู้จัก check "${check}"`] : found.validate(params)
}
