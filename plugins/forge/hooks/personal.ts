import type { Rule } from './types'

export type Scope = { kind: 'any-repo' } | { kind: 'repo'; root: string }

export type PersonalRule = { rule: Rule; scope: Scope; createdAt: number; lesson: string }

// repo หลักของ worktree ตามแบบตั้งชื่อที่ใช้กัน (.claude/worktrees/<ชื่อ>, .worktrees/<ชื่อ>)
// ใช้กับกฎเก่าที่เคยผูกกับ path ของ worktree ซึ่งอาจถูกลบไปแล้ว จึงถาม git ไม่ได้
export function worktreeHome(path: string): string {
	return path.replace(/\/(?:\.claude\/worktrees|\.worktrees)\/[^/]+\/?$/, '')
}

// home = repo หลัก (worktree ทุกอันของ repo เดียวกันได้ค่าเดียวกัน)
export function personalFor(list: readonly PersonalRule[], home: string | null): { repo: Rule[]; any: Rule[] } {
	const mine = (p: PersonalRule): boolean =>
		home !== null && p.scope.kind === 'repo' && (p.scope.root === home || worktreeHome(p.scope.root) === home)
	return {
		repo: list.filter(mine).map((p) => p.rule),
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
