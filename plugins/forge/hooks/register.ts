import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { BUILTIN_RULES } from './builtin'
import { CHECK_NAMES, validateCheckParams } from './checks/index'
import { isVerdict } from './checks/types'
import type { Probe, ProbeResult } from './checks/types'
import { handleGuardsCommand } from './commands'
import { GUARDS_FILE, parseGuardsText } from './config'
import { mergeRules, newOutcome, record, startRule } from './engine'
import type { HitRecord } from '../types'
import type { RepoConfig, ToolInput } from './types'

// ทุกการเรียก $ อยู่ในไฟล์นี้: engine ไม่ยอมให้ส่ง $ เข้าฟังก์ชันที่ import มา

// atom ต้องประกาศเป็น const ในไฟล์ที่อ่าน/เขียนมัน (engine สแกนหารายการ state ของ module)
const allowOnceAtom = atom({ plugin: 'forge', key: 'allowOnce' } as const, [] as string[])
const hitsAtom = atom({ plugin: 'forge', key: 'hits' } as const, [] as HitRecord[])
const warnedAtom = atom({ plugin: 'forge', key: 'warned' } as const, [] as string[])

// probe ทุกตัวต้องจบในเวลาที่กำหนด guard ต้องไม่ค้าง
const PROBE_TIMEOUT_MS = 5000

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite'])

const rootByCwd = new Map<string, string | null>()

async function loadRepo($: EngineInterface): Promise<RepoConfig> {
	const cwd = await $.session.cwd()
	let root = rootByCwd.get(cwd)
	if (root === undefined) {
		try {
			const res = await $.process.run(['git', 'rev-parse', '--show-toplevel'], { cwd, timeoutMs: PROBE_TIMEOUT_MS })
			root = res.exitCode === 0 ? res.stdout.trim() : null
		} catch (err) {
			// git เปิดไม่ได้: ทำงานแบบไม่อยู่ใน repo (กฎในตัวยังทำงาน) แทนที่จะบล็อกทุกคำสั่ง
			void $.ui.toast(`forge: หา git repo ไม่ได้ (${err instanceof Error ? err.message : String(err)}) ใช้เฉพาะกฎในตัว`)
			root = null
		}
		rootByCwd.set(cwd, root)
	}
	if (root === null) return { root: null, vars: {}, rules: [], errors: [] }
	const path = `${root}/${GUARDS_FILE}`
	if (!(await $.fs.exists(path))) return { root, vars: { repoRoot: root }, rules: [], errors: [] }
	const text = await $.fs.read(path)
	return parseGuardsText(typeof text === 'string' ? text : null, root, CHECK_NAMES, validateCheckParams)
}

async function probe($: EngineInterface, p: Probe): Promise<ProbeResult> {
	try {
		if (p.kind === 'run') {
			const res = await $.process.run(p.argv, { cwd: p.cwd, timeoutMs: p.timeoutMs ?? PROBE_TIMEOUT_MS })
			return { kind: 'run', exitCode: res.exitCode, stdout: res.stdout, stderr: res.stderr }
		}
		if (p.kind === 'read') {
			if (!(await $.fs.exists(p.path))) return { kind: 'read', text: null }
			const text = await $.fs.read(p.path)
			return { kind: 'read', text: typeof text === 'string' ? text : null }
		}
		// http.fetch ไม่มี timeout ของตัวเอง จึงแข่งกับนาฬิกา
		const res = await Promise.race([$.http.fetch(p.url), $.clock.sleep(PROBE_TIMEOUT_MS).then(() => null)])
		if (res === null) return { kind: 'error', message: `${p.url} ไม่ตอบภายใน ${PROBE_TIMEOUT_MS / 1000} วินาที` }
		return { kind: 'fetch', status: res.status, ok: res.ok, text: res.text }
	} catch (err) {
		return { kind: 'error', message: err instanceof Error ? err.message : String(err) }
	}
}

async function warnConfigOnce($: EngineInterface, errors: readonly string[]): Promise<void> {
	const seen = await read($, warnedAtom)
	const fresh = errors.filter((e) => !seen.includes(e))
	if (fresh.length === 0) return
	await update($, warnedAtom, (list) => [...list, ...fresh])
	void $.ui.toast(`forge: ${GUARDS_FILE} มีปัญหา ${fresh.length} จุด ใช้กฎที่เหลือต่อ · ${fresh[0] ?? ''}`)
}

export const register: Register = (on, options) => {
	const rewriteAsDeny = options['rewriteAsDeny'] === true

	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: 'guards',
			description: 'ดูกฎที่ทำงานอยู่และสิ่งที่ถูกดัก หรือยกเว้นกฎครั้งเดียว (/guards allow <id>)',
		})
		return next(e)
	})

	on('command.run', { command: 'guards' }, async ($, e) => {
		const repo = await loadRepo($)
		const action = handleGuardsCommand({
			args: e.args,
			// origin ที่ไม่รู้จัก (หรือไม่มี) นับว่าไม่ใช่ผู้ใช้ จึงยกเว้นกฎไม่ได้
			originKind: (e.origin as { kind?: string } | undefined)?.kind ?? 'unknown',
			rules: mergeRules(repo.rules, BUILTIN_RULES),
			hits: await read($, hitsAtom),
			errors: repo.errors,
			root: repo.root,
		})
		const allow = action.allow
		if (allow !== undefined) await update($, allowOnceAtom, (list) => [...list, allow])
		return { text: action.text }
	})

	on('tool.call', async ($, e, next) => {
		const repo = await loadRepo($)
		if (repo.errors.length > 0) await warnConfigOnce($, repo.errors)
		const rules = mergeRules(repo.rules, BUILTIN_RULES)
		const allowed = new Set(await read($, allowOnceAtom))
		const now = await $.clock.now()
		const out = newOutcome(e as unknown as ToolInput)

		for (const rule of rules) {
			let step = startRule(rule, e.tool, out.input, repo.vars)
			if (step === null) continue
			while (!isVerdict(step)) {
				const results: ProbeResult[] = []
				for (const p of step.probes) results.push(await probe($, p))
				step = step.next(results)
			}
			if (record(out, rule, step, e.tool, allowed, now) === 'stop') break
		}

		if (out.consumed.length > 0) {
			await update($, allowOnceAtom, (list) => list.filter((id) => !out.consumed.includes(id)))
		}
		if (out.hits.length > 0) await update($, hitsAtom, (list) => [...list, ...out.hits].slice(-100))

		if (out.deny !== undefined) {
			return { deny: `[forge · ${out.deny.ruleId}] ${out.deny.message}` }
		}
		const rewrites = out.hits.filter((h) => h.kind === 'rewrite')
		if (rewriteAsDeny && rewrites.length > 0) {
			const first = rules.find((r) => r.id === rewrites[0]?.ruleId)
			const fixed = first === undefined ? '' : String(out.input[first.field] ?? '')
			return { deny: `[forge] ใช้คำสั่งนี้แทน: ${fixed} · ${rewrites.map((r) => r.summary).join(' · ')}` }
		}
		for (const r of rewrites) void $.ui.toast(`forge แก้คำสั่ง (${r.ruleId})`)
		for (const w of out.warns) void $.ui.toast(`forge: ${w}`)

		const ran = await next(out.input as typeof e)
		if (out.notes.length === 0 || ran.deny !== undefined) return ran
		return { ...ran, context: [...(ran.context ?? []), ...out.notes.map((n) => `[forge] ${n}`)] }
	}).catch(($, e, next) => {
		if (next.called) return next(e)
		if (READ_ONLY.has(e.tool)) return next(e)
		return {
			deny: 'forge: ตัวตรวจกฎล้มเหลว จึงไม่รันคำสั่งนี้ · พิมพ์ /guards เพื่อดูสถานะ หรือรัน claude --debug เพื่อดูสาเหตุ',
		}
	})
}
