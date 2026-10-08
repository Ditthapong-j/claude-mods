export type ProofCommand = { id: string; cwd: string; argv: string[]; label: string }

type ConfigRule = { glob: string; command: string }

function globToRegExp(glob: string): RegExp {
	let out = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob.charAt(i)
		if (c === '*') {
			if (glob.charAt(i + 1) === '*') {
				out += '.*'
				i++
				if (glob.charAt(i + 1) === '/') i++
			} else out += '[^/]*'
		} else if (c === '?') out += '[^/]'
		else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
	}
	return new RegExp(`^${out}$`)
}

export function parseProofConfig(text: string | null): { rules: ConfigRule[]; errors: string[] } {
	if (text === null || text.trim() === '') return { rules: [], errors: [] }
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch (err) {
		return {
			rules: [],
			errors: [`.claude/guards.json ไม่ใช่ JSON: ${err instanceof Error ? err.message : String(err)}`],
		}
	}
	const proof = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['proof'] : undefined
	if (proof === undefined) return { rules: [], errors: [] }
	if (typeof proof !== 'object' || proof === null)
		return { rules: [], errors: ['proof ต้องเป็น object ของ glob → คำสั่ง'] }
	const rules: ConfigRule[] = []
	const errors: string[] = []
	for (const [glob, command] of Object.entries(proof)) {
		if (typeof command === 'string' && splitCommand(command).length > 0) rules.push({ glob, command })
		else errors.push(`proof["${glob}"] ต้องเป็นคำสั่งเดียว ไม่มี ; && |`)
	}
	return { rules, errors }
}

export function splitCommand(command: string): string[] {
	const out: string[] = []
	let cur = ''
	let quote: string | null = null
	for (const c of command) {
		if (quote !== null) {
			if (c === quote) quote = null
			else cur += c
		} else if (c === '"' || c === "'") quote = c
		else if (c === ';' || c === '|' || c === '`' || c === '>' || c === '<') return []
		else if (c === '&') {
			return []
		} else if (/\s/.test(c)) {
			if (cur !== '') out.push(cur)
			cur = ''
		} else cur += c
	}
	if (cur !== '') out.push(cur)
	return quote === null ? out : []
}

function rel(path: string, base: string): string {
	return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

function nearest(
	path: string,
	projects: readonly { dir: string; kind: 'tsc' | 'vitest' }[],
	kind: 'tsc' | 'vitest'
): string | undefined {
	return projects
		.filter((p) => p.kind === kind && path.startsWith(`${p.dir}/`))
		.sort((a, b) => b.dir.length - a.dir.length)[0]?.dir
}

export function commandsFor(
	paths: readonly string[],
	root: string,
	config: readonly ConfigRule[],
	projects: readonly { dir: string; kind: 'tsc' | 'vitest' }[]
): ProofCommand[] {
	const out: ProofCommand[] = []
	const add = (cmd: ProofCommand): void => {
		if (!out.some((c) => c.id === cmd.id)) out.push(cmd)
	}
	const vitest = new Map<string, string[]>()
	for (const path of paths) {
		const relPath = rel(path, root)
		const hit = config.find((c) => globToRegExp(c.glob).test(relPath))
		if (hit !== undefined) {
			add({ id: hit.command, cwd: root, argv: splitCommand(hit.command), label: hit.command })
			continue
		}
		if (!/\.(tsx?|jsx?|mts|cts)$/.test(path)) continue
		const tsc = nearest(path, projects, 'tsc')
		if (tsc !== undefined) {
			const label = `npx tsc --noEmit -p ${tsc}`
			add({ id: label, cwd: tsc, argv: ['npx', 'tsc', '--noEmit', '-p', tsc], label })
		}
		const vdir = nearest(path, projects, 'vitest')
		if (vdir !== undefined) vitest.set(vdir, [...(vitest.get(vdir) ?? []), rel(path, vdir)])
	}
	for (const [dir, files] of vitest) {
		const label = `npx vitest related --run ${files.join(' ')} (${dir})`
		add({ id: `vitest:${dir}`, cwd: dir, argv: ['npx', 'vitest', 'related', '--run', ...files], label })
	}
	return out
}
