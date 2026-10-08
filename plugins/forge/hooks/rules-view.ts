import type { Rule } from './types'

export type RuleRow = {
	id: string
	source: 'repo' | 'personal-repo' | 'personal' | 'builtin'
	action: string
	enabled: boolean
	hits30: number
}

const THIRTY_DAYS = 30 * 86_400_000

export function ruleRows(
	sources: {
		repo: readonly Rule[]
		personalRepo: readonly Rule[]
		personal: readonly Rule[]
		builtin: readonly Rule[]
	},
	hitlog: readonly { ruleId: string; at: number }[],
	now: number
): RuleRow[] {
	const since = now - THIRTY_DAYS
	const hits = new Map<string, number>()
	for (const h of hitlog) if (h.at >= since) hits.set(h.ruleId, (hits.get(h.ruleId) ?? 0) + 1)
	const rows: RuleRow[] = []
	const add = (list: readonly Rule[], source: RuleRow['source']): void => {
		for (const r of list) {
			if (rows.some((x) => x.id === r.id)) continue
			rows.push({
				id: r.id,
				source,
				action: r.check === undefined ? r.action : `${r.action} · ${r.check}`,
				enabled: r.enabled,
				hits30: hits.get(r.id) ?? 0,
			})
		}
	}
	add(sources.repo, 'repo')
	add(sources.personalRepo, 'personal-repo')
	add(sources.personal, 'personal')
	add(sources.builtin, 'builtin')
	return rows
}

export type LessonsAction =
	| { kind: 'open' }
	| { kind: 'accept'; scope: 'any-repo' | 'repo' | 'file' }
	| { kind: 'reject' }
	| { kind: 'set'; id: string; enabled: boolean }
	| { kind: 'remove'; id: string }
	| { kind: 'import'; dir?: string }
	| { kind: 'refused'; text: string }
	| { kind: 'help'; text: string }

const USAGE = '/lessons · accept any-repo|repo|file · reject · enable|disable|remove <id> · import-memory [dir]'

export function parseLessonsArgs(args: string, origin: { kind: string; name?: string }): LessonsAction {
	const [verb, arg] = args.trim().split(/\s+/)
	const person = origin.kind === 'composer'
	const manager = origin.kind === 'plugin' && origin.name === 'manager'
	if (verb === undefined || verb === '') return { kind: 'open' }
	const refused = {
		kind: 'refused',
		text: 'ผู้ใช้ต้องพิมพ์เองที่ช่องพิมพ์ หรือกดปุ่มใน /lessons /mods เปลี่ยนกฎแทนผู้ใช้ไม่ได้',
	} as const
	if (verb === 'accept') {
		if (!person) return refused
		return arg === 'any-repo' || arg === 'repo' || arg === 'file'
			? { kind: 'accept', scope: arg }
			: { kind: 'help', text: USAGE }
	}
	if (verb === 'reject') return person ? { kind: 'reject' } : refused
	if (verb === 'enable' || verb === 'disable' || verb === 'remove') {
		if (!person && !manager) return refused
		if (arg === undefined) return { kind: 'help', text: USAGE }
		return verb === 'remove' ? { kind: 'remove', id: arg } : { kind: 'set', id: arg, enabled: verb === 'enable' }
	}
	if (verb === 'import-memory') return person ? { kind: 'import', dir: arg } : refused
	return { kind: 'help', text: USAGE }
}
