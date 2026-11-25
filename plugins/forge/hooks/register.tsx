import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DraftState, ErrorRecord, HitRecord, RecentCallState } from '../types'
import { BUILTIN_RULES } from './builtin'
import { draftCard } from './card'
import { CHECK_NAMES, validateCheckParams } from './checks/index'
import { isVerdict } from './checks/types'
import type { Probe, ProbeResult } from './checks/types'
import { handleGuardsCommand } from './commands'
import { GUARDS_FILE, parseGuardsText, toRule } from './config'
import { mergeRules, newOutcome, record, startRule } from './engine'
import { ruleToJson, withRule } from './guards-file'
import { draftPrompt, isLessonCandidate, parseDraft, tooBroad } from './lessons'
import { personalFor, remove, setEnabled, upsert } from './personal'
import type { PersonalRule } from './personal'
import { parseLessonsArgs, ruleRows } from './rules-view'
import type { LessonsAction, RuleRow } from './rules-view'
import { validateRule } from './safety'
import { commandDir, needsHome } from './target'
import type { RepoConfig, Rule, ToolInput, Vars } from './types'

// ทุกการเรียก $ อยู่ในไฟล์นี้: engine ไม่ยอมให้ส่ง $ เข้าฟังก์ชันที่ import มา

// atom ต้องประกาศเป็น const ในไฟล์ที่อ่าน/เขียนมัน (engine สแกนหารายการ state ของ module)
const allowOnceAtom = atom({ plugin: 'forge', key: 'allowOnce' } as const, [] as string[])
const hitsAtom = atom({ plugin: 'forge', key: 'hits' } as const, [] as HitRecord[])
const warnedAtom = atom({ plugin: 'forge', key: 'warned' } as const, [] as string[])
const draftAtom = atom({ plugin: 'forge', key: 'draft' } as const, null as DraftState | null)
const pendingAtom = atom(
	{ plugin: 'forge', key: 'pending' } as const,
	null as { text: string; calls: RecentCallState[] } | null
)
const recentAtom = atom({ plugin: 'forge', key: 'recent' } as const, [] as RecentCallState[])
const historyAtom = atom({ plugin: 'forge', key: 'history' } as const, [] as string[])
const importQueueAtom = atom({ plugin: 'forge', key: 'importQueue' } as const, [] as DraftState[])
const errorsAtom = atom({ plugin: 'forge', key: 'errors' } as const, [] as ErrorRecord[])

const PANE = 'lessons'

// probe ทุกตัวต้องจบในเวลาที่กำหนด guard ต้องไม่ค้าง
const PROBE_TIMEOUT_MS = 5000

const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite'])

const rootByCwd = new Map<string, string | null>()
const homeByRoot = new Map<string, string>()

// repo หลักจาก git-common-dir: worktree ได้ path ของ checkout หลัก · ถามไม่ได้ = ใช้ root เดิม
async function repoHome($: EngineInterface, root: string): Promise<string> {
	const known = homeByRoot.get(root)
	if (known !== undefined) return known
	let home = root
	try {
		const res = await $.process.run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'], {
			cwd: root,
			timeoutMs: PROBE_TIMEOUT_MS,
		})
		const dir = res.stdout.trim()
		if (res.exitCode === 0 && dir.endsWith('/.git')) home = dir.slice(0, -'/.git'.length)
	} catch {
		// git ตอบไม่ได้: ผูกกับ root ของ worktree เหมือนเดิม กฎที่ผูกไว้ยังเจอผ่าน worktreeHome
	}
	homeByRoot.set(root, home)
	return home
}

// dir = folder ที่คำสั่งจะทำงานจริง (จาก cd / git -C) · ไม่ใส่ = cwd ของ session
async function loadRepo($: EngineInterface, dir?: string): Promise<RepoConfig> {
	const cwd = dir ?? (await $.session.cwd())
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
	if (root === null) return { root: null, home: null, vars: {}, rules: [], errors: [] }
	const home = await repoHome($, root)
	const path = `${root}/${GUARDS_FILE}`
	if (!(await $.fs.exists(path))) return { root, home, vars: { repoRoot: root }, rules: [], errors: [] }
	const text = await $.fs.read(path)
	return { ...parseGuardsText(typeof text === 'string' ? text : null, root, CHECK_NAMES, validateCheckParams), home }
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

async function recordError($: EngineInterface, where: string, err: unknown): Promise<void> {
	const message = err instanceof Error ? err.message : String(err)
	const at = await $.clock.now()
	await update($, errorsAtom, (list) => [...list, { at, where, message }].slice(-50))
}

// คำสั่ง Bash ที่ cd / git -C ไป repo อื่น ต้องใช้กฎ (และ baseBranch) ของ repo นั้น
async function targetDir($: EngineInterface, input: ToolInput): Promise<string | undefined> {
	const command = input['command']
	if (input['tool'] !== 'Bash' || typeof command !== 'string') return undefined
	let home: string | undefined
	if (needsHome(command)) {
		try {
			home = (await $.env.get('HOME')) ?? undefined
		} catch {
			home = undefined
		}
	}
	return commandDir(command, await $.session.cwd(), home)
}

async function personalRules($: EngineInterface): Promise<PersonalRule[]> {
	const raw = await $.store.get('personalRules')
	return Array.isArray(raw) ? (raw as PersonalRule[]) : []
}

async function hitlog($: EngineInterface): Promise<{ ruleId: string; at: number }[]> {
	const raw = await $.store.get('hitlog')
	return Array.isArray(raw) ? (raw as { ruleId: string; at: number }[]) : []
}

// ลำดับความสำคัญ: กฎของ repo > กฎส่วนตัวที่ผูกกับ repo > กฎส่วนตัวทุก repo > กฎในตัว
async function allRules(
	$: EngineInterface,
	dir?: string
): Promise<{ repo: RepoConfig; personalRepo: Rule[]; personal: Rule[]; merged: Rule[] }> {
	const repo = await loadRepo($, dir)
	const mine = personalFor(await personalRules($), repo.home ?? repo.root)
	return {
		repo,
		personalRepo: mine.repo,
		personal: mine.any,
		merged: mergeRules(repo.rules, mine.repo, mine.any, BUILTIN_RULES),
	}
}

async function rows($: EngineInterface): Promise<{ rows: RuleRow[]; root: string | null; errors: readonly string[] }> {
	const all = await allRules($)
	const list = ruleRows(
		{ repo: all.repo.rules, personalRepo: all.personalRepo, personal: all.personal, builtin: BUILTIN_RULES },
		await hitlog($),
		await $.clock.now()
	)
	return { rows: list, root: all.repo.root, errors: all.repo.errors }
}

// ร่างกฎหนึ่งข้อ: ตรวจ validate + กว้างเกิน; คืนข้อความปัญหาหรือ undefined
async function checkDraft($: EngineInterface, rule: Rule, vars: Vars): Promise<string | undefined> {
	// ร่างกฎใช้เพิ่มกฎเท่านั้น: ปิดหรือแทนที่กฎเดิมผ่านร่างไม่ได้ (ผู้ใช้ไม่เห็นว่ากำลังปิดอะไร)
	if (!rule.enabled) return 'ร่างกฎปิดกฎไม่ได้ (enabled: false) · ปิดกฎด้วย /lessons disable <id>'
	const existing = (await allRules($)).merged.find((r) => r.id === rule.id)
	if (existing !== undefined) return `id "${rule.id}" ซ้ำกับกฎที่มีอยู่ ใช้ id ใหม่`
	const problems = validateRule(rule, vars, CHECK_NAMES)
	if (problems.length > 0) return problems.join(' · ')
	return tooBroad(rule, await read($, historyAtom), vars)
}

// ร่างใหม่ต่อคิวหลังร่างที่อยู่บนจอ ไม่ทับ
async function queueDraft($: EngineInterface, draft: DraftState): Promise<void> {
	if ((await read($, draftAtom)) === null) await update($, draftAtom, () => draft)
	else await update($, importQueueAtom, (q) => [...q, draft])
}

async function showNextDraft($: EngineInterface): Promise<void> {
	const [next, ...rest] = await read($, importQueueAtom)
	await update($, importQueueAtom, () => rest)
	await update($, draftAtom, () => next ?? null)
}

async function importMemory($: EngineInterface, dir: string | undefined): Promise<string> {
	let target = dir
	if (target === undefined) {
		const home = await $.env.get('HOME')
		const cwd = await $.session.cwd()
		target = `${home ?? ''}/.claude/projects/${cwd.replace(/[/.]/g, '-')}/memory`
	}
	if (!(await $.fs.exists(target))) {
		return `ไม่พบโฟลเดอร์ memory: ${target} (ระบุเองด้วย /lessons import-memory <dir>)`
	}
	const names = (await $.fs.list(target))
		.filter((entry) => entry.kind === 'file' && /^feedback.*\.md$/.test(entry.name))
		.map((entry) => entry.name)
	const repo = await loadRepo($)
	const drafts: DraftState[] = []
	const skipped: string[] = []
	for (const name of names) {
		const text = await $.fs.read(`${target}/${name}`)
		if (typeof text !== 'string' || text.trim() === '') {
			skipped.push(`${name}: ไฟล์ว่าง`)
			continue
		}
		const answer = await $.model.complete({
			model: 'haiku',
			prompt: draftPrompt(text.slice(0, 4000), [{ tool: 'memory', summary: name }]),
		})
		if (!answer.isAnswered) {
			skipped.push(`${name}: โมเดลไม่ตอบ (${answer.reason})`)
			continue
		}
		const parsed = parseDraft(answer.text)
		if (!('rule' in parsed)) {
			skipped.push(`${name}: ${parsed.error}`)
			continue
		}
		const problem = await checkDraft($, parsed.rule, repo.vars)
		if (problem !== undefined) {
			skipped.push(`${name}: ${problem}`)
			continue
		}
		drafts.push({ rule: ruleToJson(parsed.rule), lesson: `memory: ${name}` })
	}
	await update($, importQueueAtom, (q) => [...q, ...drafts])
	if ((await read($, draftAtom)) === null) await showNextDraft($)
	const head = `อ่าน memory ${names.length} ไฟล์ · ได้ร่างกฎ ${drafts.length} ข้อ รอยืนยันทีละข้อ · ข้าม ${skipped.length}`
	return skipped.length > 0 ? `${head}\n${skipped.join('\n')}` : head
}

// ปุ่มใน UI เรียกฟังก์ชันนี้ตรงๆ (การกดปุ่มคือการกระทำของผู้ใช้); /lessons เรียกผ่าน parseLessonsArgs ที่ตรวจ origin แล้ว
async function applyLessons($: EngineInterface, action: LessonsAction): Promise<string> {
	if (action.kind === 'refused' || action.kind === 'help') return action.text
	if (action.kind === 'open') {
		await $.ui.open({ id: PANE, title: 'forge · คลังกฎ' })
		return 'เปิดคลังกฎแล้ว'
	}
	if (action.kind === 'reject') {
		await showNextDraft($)
		return 'ทิ้งร่างกฎแล้ว'
	}
	if (action.kind === 'import') return importMemory($, action.dir)
	if (action.kind === 'accept') {
		const draft = await read($, draftAtom)
		if (draft === null) return 'ไม่มีร่างกฎที่รออยู่'
		const { rule } = toRule(draft.rule, 0)
		if (rule === undefined) {
			await showNextDraft($)
			return 'ร่างกฎเสีย ทิ้งแล้ว'
		}
		if (action.id !== undefined && action.id !== rule.id) {
			return `ร่างกฎเปลี่ยนไปแล้ว (ตอนนี้คือ ${rule.id}) ดูร่างใหม่แล้วกดอีกครั้ง`
		}
		const repo = await loadRepo($)
		if (action.scope === 'file') {
			if (repo.root === null) return 'ไม่ได้อยู่ใน git repo จึงเขียน .claude/guards.json ไม่ได้'
			const path = `${repo.root}/${GUARDS_FILE}`
			const current = (await $.fs.exists(path)) ? await $.fs.read(path) : null
			const merged = withRule(typeof current === 'string' ? current : null, rule)
			if ('error' in merged) return merged.error
			await $.fs.write(path, merged.text)
		} else {
			if (action.scope === 'repo' && repo.root === null) return 'ไม่ได้อยู่ใน git repo จึงผูกกับ repo ไม่ได้'
			const scope =
				action.scope === 'repo' && repo.root !== null
					? { kind: 'repo' as const, root: repo.home ?? repo.root }
					: { kind: 'any-repo' as const }
			const item: PersonalRule = { rule, scope, createdAt: await $.clock.now(), lesson: draft.lesson }
			await $.store.set('personalRules', upsert(await personalRules($), item))
		}
		await showNextDraft($)
		void $.ui.toast(`forge: เปิดใช้กฎ ${rule.id} แล้ว`)
		return `เปิดใช้กฎ ${rule.id} (${action.scope}) แล้ว`
	}
	const list = await personalRules($)
	if (!list.some((p) => p.rule.id === action.id)) {
		return `${action.id} ไม่ใช่กฎส่วนตัว · กฎของ repo แก้ใน .claude/guards.json · ปิดกฎในตัวด้วยกฎ repo id เดียวกันที่ "enabled": false`
	}
	if (action.kind === 'remove') {
		await $.store.set('personalRules', remove(list, action.id))
		return `ลบกฎ ${action.id} แล้ว`
	}
	await $.store.set('personalRules', setEnabled(list, action.id, action.enabled))
	return `${action.enabled ? 'เปิด' : 'ปิด'}กฎ ${action.id} แล้ว`
}

export const register: Register = (on, options) => {
	const rewriteAsDeny = options['rewriteAsDeny'] === true

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({
			name: 'guards',
			description: 'ดูกฎที่ทำงานอยู่และสิ่งที่ถูกดัก หรือยกเว้นกฎครั้งเดียว (/guards allow <id>)',
		})
		await $.command.register({
			name: 'lessons',
			description: 'คลังกฎของ forge · accept/reject ร่างกฎ · enable/disable/remove <id> · import-memory [dir]',
		})
		await $.tool.register({
			name: 'propose_rule',
			description: 'เสนอกฎใหม่ให้ forge (JSON แบบ .claude/guards.json) ผู้ใช้ต้องกดยืนยันก่อนกฎทำงาน',
			inputSchema: {
				type: 'object',
				properties: { rule: { type: 'object' }, lesson: { type: 'string' } },
				required: ['rule'],
			},
		})
		await $.tool.register({
			name: 'rules',
			description: 'รายการกฎของ forge ที่ใช้ใน repo นี้ พร้อมจำนวนครั้งที่ดัก (JSON)',
			inputSchema: { type: 'object', properties: {} },
		})
		return res
	})

	on('command.run', { command: 'guards' }, async ($, e) => {
		const all = await allRules($)
		const action = handleGuardsCommand({
			args: e.args,
			// origin ที่ไม่รู้จัก (หรือไม่มี) นับว่าไม่ใช่ผู้ใช้ จึงยกเว้นกฎไม่ได้
			originKind: (e.origin as { kind?: string } | undefined)?.kind ?? 'unknown',
			rules: all.merged,
			hits: await read($, hitsAtom),
			errors: all.repo.errors,
			root: all.repo.root,
		})
		const allow = action.allow
		if (allow !== undefined) await update($, allowOnceAtom, (list) => [...list, allow])
		return { text: action.text }
	})

	on('command.run', { command: 'lessons' }, async ($, e) => {
		const origin = (e.origin as { kind?: string; name?: string } | undefined) ?? {}
		return {
			text: await applyLessons($, parseLessonsArgs(e.args, { kind: origin.kind ?? 'unknown', name: origin.name })),
		}
	})

	on('tool.call', { tool: 'mcp__forge__propose_rule' }, async ($, e) => {
		const input = e as unknown as Record<string, unknown>
		const { rule, error } = toRule(input['rule'], 0)
		if (rule === undefined) return { result: `ร่างกฎใช้ไม่ได้: ${error ?? ''}` }
		const repo = await loadRepo($)
		const problem = await checkDraft($, rule, repo.vars)
		if (problem !== undefined) return { result: `ร่างกฎใช้ไม่ได้: ${problem}` }
		const lesson = typeof input['lesson'] === 'string' ? input['lesson'] : 'เสนอโดย Claude'
		await queueDraft($, { rule: ruleToJson(rule), lesson })
		return { result: `ร่างกฎ ${rule.id} รอผู้ใช้กดยืนยันที่แถบเหนือช่องพิมพ์ (หรือผู้ใช้พิมพ์ /lessons accept ...)` }
	})

	on('tool.call', { tool: 'mcp__forge__rules' }, async ($) => {
		const view = await rows($)
		return { result: JSON.stringify({ rules: view.rows, errors: view.errors }) }
	})

	on('tool.call', async ($, e, next) => {
		const all = await allRules($, await targetDir($, e as unknown as ToolInput))
		const repo = all.repo
		if (repo.errors.length > 0) await warnConfigOnce($, repo.errors)
		const rules = all.merged
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
		if (out.hits.length > 0) {
			await update($, hitsAtom, (list) => [...list, ...out.hits].slice(-100))
			const log = await hitlog($)
			await $.store.set('hitlog', [...log, ...out.hits.map((h) => ({ ruleId: h.ruleId, at: h.at }))].slice(-1000))
		}

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
		if (ran.deny === undefined && ran.isError !== true && !e.tool.startsWith('mcp__forge__')) {
			const summary = e.tool === 'Bash' ? String(out.input['command'] ?? '') : String(out.input['file_path'] ?? e.tool)
			await update($, recentAtom, (list) => [...list, { tool: e.tool, summary: summary.slice(0, 300) }].slice(-3))
			if (e.tool === 'Bash') await update($, historyAtom, (list) => [...list, summary].slice(-200))
		}
		if (out.notes.length === 0 || ran.deny !== undefined) return ran
		return { ...ran, context: [...(ran.context ?? []), ...out.notes.map((n) => `[forge] ${n}`)] }
	}).catch(($, e, next) => {
		if (next.called) return next(e)
		if (READ_ONLY.has(e.tool)) return next(e)
		return {
			deny: 'forge: ตัวตรวจกฎล้มเหลว จึงไม่รันคำสั่งนี้ · พิมพ์ /guards เพื่อดูสถานะ หรือรัน claude --debug เพื่อดูสาเหตุ',
		}
	})

	on('prompt.submit', async ($, e, next) => {
		try {
			if ((e.origin as { kind?: string } | undefined)?.kind === 'composer') {
				await update($, pendingAtom, () => null)
				const calls = await read($, recentAtom)
				if (isLessonCandidate(e.text, calls)) await update($, pendingAtom, () => ({ text: e.text, calls }))
				await update($, recentAtom, () => [])
			}
		} catch (err) {
			await recordError($, 'prompt.submit', err)
		}
		return next(e)
	})

	// S4: classify ใช้ราว 1.5 วินาที จึงไม่ทำตอนส่ง prompt แต่ทำตอนจบเทิร์น
	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		if ((e as unknown as { agentId?: string }).agentId !== undefined) return res
		const pending = await read($, pendingAtom)
		if (pending === null) return res
		await update($, pendingAtom, () => null)
		try {
			const label = await $.model.classify(pending.text, ['correction', 'task'])
			if (label !== 'correction') return res
			const answer = await $.model.complete({ model: 'haiku', prompt: draftPrompt(pending.text, pending.calls) })
			if (!answer.isAnswered) {
				await recordError($, 'lesson-draft', `โมเดลไม่ตอบ (${answer.reason})`)
				return res
			}
			const parsed = parseDraft(answer.text)
			if (!('rule' in parsed)) {
				await recordError($, 'lesson-draft', parsed.error)
				return res
			}
			const repo = await loadRepo($)
			const problem = await checkDraft($, parsed.rule, repo.vars)
			if (problem !== undefined) {
				await recordError($, 'lesson-draft', `${parsed.rule.id}: ${problem}`)
				return res
			}
			await queueDraft($, { rule: ruleToJson(parsed.rule), lesson: pending.text })
		} catch (err) {
			await recordError($, 'turn.complete', err)
		}
		return res
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const draft = await read($, draftAtom)
		if (draft === null) return next(e)
		const { rule } = toRule(draft.rule, 0)
		if (rule === undefined) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		const act = (a: LessonsAction) => () => applyLessons($, a)
		// โชว์ผลกับตัวอย่างคำสั่งจริง ไม่โชว์ regex (ผู้ใช้อ่าน regex ไม่ออก)
		const card = draftCard(rule, draft.lesson, (await loadRepo($)).vars)
		return (
			<Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
				<Text bold>{card.title}</Text>
				<Text wrap="wrap">{card.why}</Text>
				<Text wrap="wrap">{card.effect}</Text>
				{card.examples.map((x) => (
					<Box key={x.label} gap={1}>
						<Text dimColor>{x.label}:</Text>
						<Text wrap="wrap">{x.text}</Text>
					</Box>
				))}
				{card.hint !== undefined && (
					<Text dimColor wrap="wrap">
						{card.hint}
					</Text>
				)}
				<Text dimColor wrap="wrap">
					{card.source}
				</Text>
				<Box gap={1}>
					<Button
						key="any"
						label="ใช้ทุก repo"
						variant="primary"
						onPress={act({ kind: 'accept', scope: 'any-repo', id: rule.id })}
					/>
					<Button key="repo" label="เฉพาะ repo นี้" onPress={act({ kind: 'accept', scope: 'repo', id: rule.id })} />
					<Button
						key="file"
						label="เขียนลง guards.json"
						onPress={act({ kind: 'accept', scope: 'file', id: rule.id })}
					/>
					<Button
						key="edit"
						label="แก้ก่อน"
						onPress={() =>
							$.prompt.fill({
								text: `ช่วยปรับกฎนี้แล้วส่งใหม่ด้วย tool propose_rule:\n${JSON.stringify(draft.rule)}\n`,
								mode: 'replace',
							})
						}
					/>
					<Button key="no" label="ไม่ต้อง" role="dismiss" onPress={act({ kind: 'reject' })} />
				</Box>
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e)
		const view = await rows($)
		const errors = await read($, errorsAtom)
		const act = (a: LessonsAction) => () => applyLessons($, a)
		return (
			<Box flexDirection="column">
				<Text dimColor>
					repo: {view.root ?? '(ไม่อยู่ใน git repo)'} · กฎ {view.rows.length} ข้อ
				</Text>
				{view.rows.map((r) => (
					<Box key={r.id} gap={1}>
						<Text color={r.enabled ? 'success' : 'inactive'}>{r.enabled ? '●' : '○'}</Text>
						<Text>{r.id}</Text>
						<Text dimColor>
							{r.source} · {r.action} · ดัก {r.hits30} ครั้ง/30 วัน
						</Text>
						{r.source.startsWith('personal') && (
							<Button
								key={`t-${r.id}`}
								label={r.enabled ? 'ปิด' : 'เปิด'}
								plain
								onPress={act({ kind: 'set', id: r.id, enabled: !r.enabled })}
							/>
						)}
					</Box>
				))}
				{view.errors.map((err) => (
					<Text key={err} color="error">
						{err}
					</Text>
				))}
				{errors.slice(-3).map((x) => (
					<Text key={`${x.at}-${x.where}`} dimColor>
						{x.where}: {x.message}
					</Text>
				))}
			</Box>
		)
	})
}
