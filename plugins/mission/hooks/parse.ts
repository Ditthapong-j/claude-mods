export type Worktree = { path: string; branch: string | null }
export type Pr = {
	number: number
	title: string
	branch: string
	checks: 'pass' | 'fail' | 'pending' | 'none'
	review: 'approved' | 'changes' | 'pending'
}
export type Peer = { name: string; id: string; kind: 'interactive' | 'remote'; state: string }
export type EnvRow = { name: string; version: string | null; commit: string | null; problem: string | null }

export function parseWorktrees(porcelain: string): Worktree[] {
	return porcelain
		.split('\n\n')
		.map((block) => block.split('\n'))
		.filter((lines) => lines[0]?.startsWith('worktree ') === true)
		.map((lines) => {
			const branch = lines.find((l) => l.startsWith('branch '))
			return {
				path: (lines[0] ?? '').slice('worktree '.length),
				branch: branch === undefined ? null : branch.slice('branch refs/heads/'.length),
			}
		})
}

function rollup(checks: unknown): Pr['checks'] {
	if (!Array.isArray(checks) || checks.length === 0) return 'none'
	const list = checks as Record<string, unknown>[]
	if (
		list.some((c) =>
			['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT'].includes(String(c['conclusion'] ?? c['state'] ?? ''))
		)
	)
		return 'fail'
	if (
		list.some(
			(c) =>
				c['conclusion'] === null ||
				['PENDING', 'IN_PROGRESS', 'QUEUED'].includes(String(c['status'] ?? c['state'] ?? ''))
		)
	)
		return 'pending'
	return 'pass'
}

export function parsePrs(json: string): Pr[] | { error: string } {
	let raw: unknown
	try {
		raw = JSON.parse(json)
	} catch (err) {
		return { error: `อ่านผล gh ไม่ได้: ${err instanceof Error ? err.message : String(err)}` }
	}
	if (!Array.isArray(raw)) return { error: 'ผล gh ไม่ใช่ array' }
	return (raw as Record<string, unknown>[]).map((p) => ({
		number: Number(p['number']),
		title: String(p['title'] ?? ''),
		branch: String(p['headRefName'] ?? ''),
		checks: rollup(p['statusCheckRollup']),
		review:
			p['reviewDecision'] === 'APPROVED'
				? 'approved'
				: p['reviewDecision'] === 'CHANGES_REQUESTED'
					? 'changes'
					: 'pending',
	}))
}

const PEER = /^\s+(.+?) \[([0-9a-f]+)\]\s+·\s+(interactive|Remote Control)\s+·\s+(\w+)/

export function parsePeers(text: string): Peer[] {
	const out: Peer[] = []
	for (const line of text.split('\n')) {
		const m = PEER.exec(line)
		if (m === null) continue
		out.push({
			name: m[1] ?? '',
			id: m[2] ?? '',
			kind: m[3] === 'interactive' ? 'interactive' : 'remote',
			state: m[4] ?? '',
		})
	}
	return out
}

export function parseVersion(
	name: string,
	res: { ok: boolean; status: number; text: string } | { error: string }
): EnvRow {
	if ('error' in res) return { name, version: null, commit: null, problem: res.error }
	if (!res.ok) return { name, version: null, commit: null, problem: `HTTP ${res.status}` }
	let body: Record<string, unknown> = {}
	try {
		const raw: unknown = JSON.parse(res.text)
		if (typeof raw === 'object' && raw !== null) body = raw as Record<string, unknown>
	} catch {
		return { name, version: null, commit: null, problem: 'ไม่ใช่ JSON' }
	}
	const version = typeof body['version'] === 'string' ? body['version'] : null
	const commit = typeof body['commit'] === 'string' ? body['commit'].slice(0, 7) : null
	const noIdentity = version === '0.0.0-dev' || body['commit'] === 'unknown'
	return { name, version, commit, problem: noIdentity ? 'build args ไม่ถึง Dockerfile (0.0.0-dev / unknown)' : null }
}

export function parseEnvConfig(text: string): { name: string; url: string }[] | { error: string } {
	try {
		const raw: unknown = JSON.parse(text)
		if (!Array.isArray(raw)) return { error: 'envs ต้องเป็น array' }
		return (raw as Record<string, unknown>[])
			.filter(
				(e) => typeof e['name'] === 'string' && typeof e['url'] === 'string' && String(e['url']).startsWith('https://')
			)
			.map((e) => ({ name: String(e['name']), url: String(e['url']) }))
	} catch (err) {
		return { error: `envs ไม่ใช่ JSON: ${err instanceof Error ? err.message : String(err)}` }
	}
}

export function waiting(prs: readonly Pr[], envs: readonly EnvRow[]): string[] {
	const out: string[] = []
	for (const p of prs) {
		if (p.checks === 'fail') out.push(`PR #${p.number} ${p.title} · CI แดง`)
		if (p.review === 'changes') out.push(`PR #${p.number} ${p.title} · ขอแก้จาก review`)
	}
	for (const e of envs) if (e.problem !== null) out.push(`${e.name} · ${e.problem}`)
	return out
}
