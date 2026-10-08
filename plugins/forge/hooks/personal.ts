import type { Rule } from './types'

export type Scope = { kind: 'any-repo' } | { kind: 'repo'; root: string }

export type PersonalRule = { rule: Rule; scope: Scope; createdAt: number; lesson: string }

export function personalFor(list: readonly PersonalRule[], root: string | null): { repo: Rule[]; any: Rule[] } {
	return {
		repo: list.filter((p) => p.scope.kind === 'repo' && p.scope.root === root).map((p) => p.rule),
		any: list.filter((p) => p.scope.kind === 'any-repo').map((p) => p.rule),
	}
}

export function upsert(list: readonly PersonalRule[], item: PersonalRule): PersonalRule[] {
	return [...list.filter((p) => p.rule.id !== item.rule.id), item]
}

export function setEnabled(list: readonly PersonalRule[], id: string, enabled: boolean): PersonalRule[] {
	return list.map((p) => (p.rule.id === id ? { ...p, rule: { ...p.rule, enabled } } : p))
}

export function remove(list: readonly PersonalRule[], id: string): PersonalRule[] {
	return list.filter((p) => p.rule.id !== id)
}
