export type PluginRow = {
	name: string
	version: string | null
	provenance: string
	root: string
	isSuite: boolean
	enabled?: boolean
}

const SUITE = new Set(['forge', 'proof', 'mission', 'manager', 'autopilot'])

export function pluginRow(input: { name: string; version?: string; provenance?: string; root: string }): PluginRow {
	return {
		name: input.name,
		version: input.version ?? null,
		provenance: input.provenance ?? input.name,
		root: input.root,
		isSuite: SUITE.has(input.name),
	}
}

export function disableCommand(row: PluginRow): string {
	return `claude plugin disable ${row.provenance}`
}

type RuleRow = { id: string; source: string; enabled: boolean; hits30: number }

export function parseRulesTool(res: unknown): { rules: RuleRow[]; errors: string[] } | { error: string } {
	const r = (typeof res === 'object' && res !== null ? res : {}) as Record<string, unknown>
	if (typeof r['deny'] === 'string') return { error: r['deny'] }
	const text = typeof r['text'] === 'string' ? r['text'] : typeof r['result'] === 'string' ? r['result'] : undefined
	if (text === undefined) return { error: 'ไม่มีผลจาก forge' }
	try {
		const body = JSON.parse(text) as { rules?: RuleRow[]; errors?: string[] }
		return { rules: body.rules ?? [], errors: body.errors ?? [] }
	} catch (err) {
		return { error: `อ่านผล forge ไม่ได้: ${err instanceof Error ? err.message : String(err)}` }
	}
}

// claude plugin list --json: รายการที่ติดตั้งทั้งหมด (plugin.register เห็นเฉพาะตัวที่โหลดหลัง manager)
export function parseInstalled(json: string): PluginRow[] | { error: string } {
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch (err) {
		return { error: `อ่านผล claude plugin list ไม่ได้: ${err instanceof Error ? err.message : String(err)}` }
	}
	if (!Array.isArray(raw)) return { error: 'ผล claude plugin list ไม่ใช่ array' }
	return (raw as Record<string, unknown>[]).map((p) => {
		const id = String(p['id'] ?? '')
		const name = id.split('@')[0] ?? id
		return {
			...pluginRow({
				name,
				version: typeof p['version'] === 'string' ? p['version'] : undefined,
				provenance: id,
				root: String(p['installPath'] ?? ''),
			}),
			enabled: p['enabled'] === true,
		}
	})
}
