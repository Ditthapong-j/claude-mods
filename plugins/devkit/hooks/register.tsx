import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { DevkitStatus, DiskState, RunningCommand } from '../types'
import { isClaudeSwitch, statusText } from './branch'
import { diskAlert, parseDfFreeGb } from './disk'
import { detectEol, looksBinary, toCrlf } from './eol'
import { commandKey, isKnownSlow, nextAvg, thresholdMs } from './longrun'
import { issueIds, priorContext } from './prior'

// ทุกการเรียก $ และ atom อยู่ในไฟล์นี้ (engine ไม่ตาม $ ข้าม import และสแกน state ต่อไฟล์)

const statusAtom = atom(
	{ plugin: 'devkit', key: 'status' } as const,
	{ branch: null, behind: null, dirty: null, ctxPercent: null } as DevkitStatus
)
const lastBranchAtom = atom({ plugin: 'devkit', key: 'lastBranch' } as const, null as string | null)
const claudeSwitchAtAtom = atom({ plugin: 'devkit', key: 'claudeSwitchAt' } as const, -Infinity as number)
// คำสั่ง Bash ที่กำลังรัน แยกตาม tool_use_id (Claude และ subagent รันขนานกันได้)
const runningAtom = atom({ plugin: 'devkit', key: 'running' } as const, {} as Record<string, RunningCommand>)
const diskAtom = atom({ plugin: 'devkit', key: 'disk' } as const, null as DiskState | null)
const diskHiddenAtom = atom({ plugin: 'devkit', key: 'diskHidden' } as const, false)
const errorsAtom = atom(
	{ plugin: 'devkit', key: 'errors' } as const,
	[] as { at: number; where: string; message: string }[]
)

const STATUS_MS = 30_000
const LONG_RUN_TICK_MS = 5_000
const DISK_MS = 10 * 60_000
// Claude สลับ branch เองภายในช่วงนี้ = ไม่เตือน
const SWITCH_GRACE_MS = 60_000
const MAX_CONTAINERS = 20
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
// Write ที่เขียนทั้งไฟล์เป็น LF = ตั้งใจเปลี่ยน line ending ไม่แปลงกลับ
const PATCH_TOOLS = new Set(['Edit', 'MultiEdit'])
const TESTCONTAINERS = 'label=org.testcontainers=true'

type Flags = {
	eolGuard: boolean
	branchWatch: boolean
	priorWork: boolean
	longRunWatch: boolean
	diskBand: boolean
	usageMeter: boolean
	turnDoneSound: boolean
	diskMinFreeGb: number
	turnSoundSeconds: number
}

async function recordError($: EngineInterface, where: string, err: unknown): Promise<void> {
	const at = await $.clock.now()
	const message = err instanceof Error ? err.message : String(err)
	await update($, errorsAtom, (l) => [...l, { at, where, message }].slice(-50))
}

async function sh($: EngineInterface, argv: string[], timeoutMs = 5000): Promise<{ ok: boolean; out: string }> {
	try {
		const res = await $.process.run(argv, { cwd: await $.session.cwd(), timeoutMs })
		return { ok: res.exitCode === 0, out: res.stdout }
	} catch (err) {
		await recordError($, argv.slice(0, 2).join(' '), err)
		return { ok: false, out: '' }
	}
}

async function baseBranch($: EngineInterface, timeoutMs = 3000): Promise<string | null> {
	const head = await sh($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], timeoutMs)
	return head.ok && head.out.trim() !== '' ? head.out.trim() : null
}

async function refreshStatus($: EngineInterface, flags: Flags): Promise<void> {
	const next: DevkitStatus = { branch: null, behind: null, dirty: null, ctxPercent: null }
	if (flags.branchWatch) {
		const head = await sh($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], 3000)
		// "HEAD" = detached ระหว่าง rebase/bisect: ไม่นับเป็นการสลับ branch
		if (head.ok && head.out.trim() !== 'HEAD') {
			next.branch = head.out.trim()
			const base = await baseBranch($)
			if (base !== null) {
				const behind = await sh($, ['git', 'rev-list', '--count', `HEAD..${base}`], 3000)
				next.behind = behind.ok ? Number(behind.out.trim()) || 0 : null
			}
			const dirty = await sh($, ['git', '--no-optional-locks', 'status', '--porcelain'], 3000)
			next.dirty = dirty.ok ? dirty.out.split('\n').filter(Boolean).length : null
			const last = await read($, lastBranchAtom)
			const switchedAt = await read($, claudeSwitchAtAtom)
			const now = await $.clock.now()
			if (last !== null && last !== next.branch && now - switchedAt > SWITCH_GRACE_MS) {
				void $.ui.toast(`devkit: branch เปลี่ยนจาก ${last} เป็น ${next.branch} ระหว่างทำงาน (ไม่ใช่คำสั่งของ Claude)`)
			}
			await update($, lastBranchAtom, () => next.branch)
		}
	}
	if (flags.usageMeter) {
		try {
			const usage = await $.session.usage({})
			const ctx = usage.context
			next.ctxPercent =
				ctx.percent ?? (ctx.tokens !== undefined && ctx.window > 0 ? (ctx.tokens / ctx.window) * 100 : null)
		} catch (err) {
			await recordError($, 'session.usage', err)
		}
	}
	await update($, statusAtom, () => next)
	void $.ui.status(statusText(next))
}

// เวลานับจากตอนเรียก tool รวมช่วงที่รอผู้ใช้กดอนุญาตด้วย (engine ไม่มี event ตอนเริ่มรันจริง)
async function checkLongRun($: EngineInterface): Promise<void> {
	const running = await read($, runningAtom)
	const now = await $.clock.now()
	for (const [id, run] of Object.entries(running)) {
		if (run.warning !== null) continue
		const elapsed = now - run.startedAt
		const avg = await $.store.get(`avg:${run.key}`)
		const avgMs = typeof avg === 'object' && avg !== null ? (avg as { avg: number }).avg : undefined
		if (elapsed < thresholdMs(avgMs, run.knownSlow)) continue
		const minutes = Math.round(elapsed / 60_000)
		const usual = avgMs === undefined ? '' : ` ปกติใช้ ${Math.max(1, Math.round(avgMs / 60_000))} นาที`
		const text = `${run.command.slice(0, 60)} รันมา ${minutes} นาที${usual} · กด Esc ถ้าค้าง`
		await update($, runningAtom, (m) => (m[id] === undefined ? m : { ...m, [id]: { ...run, warning: text } }))
		void $.ui.toast(`devkit: ${text}`)
	}
}

async function refreshDisk($: EngineInterface): Promise<DiskState> {
	const df = await sh($, ['df', '-k', '/'], 3000)
	const ps = await sh($, [
		'docker',
		'ps',
		'-a',
		'--filter',
		TESTCONTAINERS,
		'--filter',
		'status=exited',
		'--format',
		'{{.ID}}',
	], 5000)
	const disk: DiskState = {
		freeGb: df.ok ? parseDfFreeGb(df.out) : null,
		containers: ps.ok
			? ps.out
					.split('\n')
					.map((s) => s.trim())
					.filter(Boolean)
			: [],
	}
	await update($, diskAtom, () => disk)
	return disk
}

async function fixEol($: EngineInterface, path: string, before: string | null): Promise<string | null> {
	if (before === null || looksBinary(before)) return null
	const kind = detectEol(before)
	if (kind !== 'crlf' && kind !== 'mixed') return null
	const after = await $.fs.read(path)
	if (typeof after !== 'string' || looksBinary(after) || detectEol(after) === kind) return null
	if (kind === 'mixed') {
		void $.ui.toast(`devkit: ${path} ผสม CRLF/LF อยู่แล้ว จึงไม่แปลง line ending ให้ · เช็ก diff ก่อน commit`)
		return null
	}
	// อ่านซ้ำก่อนเขียน: ถ้ามีคนแก้ไฟล์ระหว่างนี้ ไม่เขียนทับ
	if ((await $.fs.read(path)) !== after) return null
	await $.fs.write(path, toCrlf(after))
	return `[devkit eol-guard] ${path} เป็น CRLF: แปลงบรรทัดที่แก้กลับเป็น CRLF แล้ว diff จะไม่บวมทั้งไฟล์`
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
	try {
		if (!(await $.fs.exists(path))) return null
		const text = await $.fs.read(path)
		return typeof text === 'string' ? text : null
	} catch (err) {
		await recordError($, 'fs.read', err)
		return null
	}
}

// prompt รอได้ไม่เกิน ~4 วินาที: base 1 s แล้วแต่ละ id ขนานกัน (gh 2.5 s + git log 1 s)
async function priorOne($: EngineInterface, id: string, base: string): Promise<string | null> {
	const [gh, log] = await Promise.all([
		sh($, ['gh', 'pr', 'list', '--state', 'open', '--search', id, '--json', 'number,title,url'], 2500),
		sh($, ['git', 'log', base, '--oneline', '-5', `--grep=${id}`], 1000),
	])
	let prs: { number: number; title: string; url: string }[] = []
	try {
		prs = gh.ok ? (JSON.parse(gh.out) as typeof prs) : []
	} catch {
		prs = []
	}
	const commits = log.ok ? log.out.split('\n').filter(Boolean) : []
	return priorContext(id, prs, commits)
}

async function priorWork($: EngineInterface, text: string): Promise<string[]> {
	const base = (await baseBranch($, 1000)) ?? 'HEAD'
	const found = await Promise.all(issueIds(text).slice(0, 2).map((id) => priorOne($, id, base)))
	return found.filter((c): c is string => c !== null)
}

export const register: Register = (on, options) => {
	const bool = (key: string) => options[key] !== false
	const num = (key: string, fallback: number) =>
		typeof options[key] === 'number' ? (options[key] as number) : fallback
	const flags: Flags = {
		eolGuard: bool('eolGuard'),
		branchWatch: bool('branchWatch'),
		priorWork: bool('priorWork'),
		longRunWatch: bool('longRunWatch'),
		diskBand: bool('diskBand'),
		usageMeter: bool('usageMeter'),
		turnDoneSound: bool('turnDoneSound'),
		diskMinFreeGb: num('diskMinFreeGb', 15),
		turnSoundSeconds: num('turnSoundSeconds', 120),
	}

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({
			name: 'cleanup',
			description: 'ดู container ของ testcontainers ที่ค้าง · /cleanup confirm เพื่อลบ',
		})
		if (flags.branchWatch || flags.usageMeter) {
			await refreshStatus($, flags)
			$.clock.every(STATUS_MS, () => refreshStatus($, flags))
		}
		if (flags.longRunWatch) $.clock.every(LONG_RUN_TICK_MS, () => checkLongRun($))
		if (flags.diskBand) {
			await refreshDisk($)
			$.clock.every(DISK_MS, () => refreshDisk($))
		}
		return res
	})

	on('tool.call', async ($, e, next) => {
		const input = e as unknown as Record<string, unknown>
		const path = typeof input['file_path'] === 'string' ? input['file_path'] : null
		const watchEol = flags.eolGuard && EDIT_TOOLS.has(e.tool) && path !== null
		const runId = typeof input['tool_use_id'] === 'string' ? input['tool_use_id'] : null
		const before = watchEol && path !== null ? await readText($, path) : null
		const command = e.tool === 'Bash' && typeof input['command'] === 'string' ? input['command'] : null
		if (command !== null) {
			if (isClaudeSwitch(command)) {
				const now = await $.clock.now()
				await update($, claudeSwitchAtAtom, () => now)
			}
		}
		const startedAt = await $.clock.now()
		const key = runId ?? `${startedAt}:${Math.random()}`
		if (command !== null && flags.longRunWatch) {
			const run: RunningCommand = {
				key: commandKey(command),
				command,
				startedAt,
				knownSlow: isKnownSlow(command),
				warning: null,
			}
			await update($, runningAtom, (m) => ({ ...m, [key]: run }))
		}

		const ran = await next(e)

		if (command !== null && isClaudeSwitch(command)) {
			// นับช่วงผ่อนผันจากตอนคำสั่งจบ ไม่ใช่ตอนขอ เพราะอาจรอผู้ใช้อนุญาตนานเกิน 1 นาที
			const now = await $.clock.now()
			await update($, claudeSwitchAtAtom, () => now)
		}
		if (command !== null && flags.longRunWatch) {
			const run = (await read($, runningAtom))[key]
			if (run !== undefined && ran.deny === undefined) {
				const ms = (await $.clock.now()) - run.startedAt
				const prev = await $.store.get(`avg:${run.key}`)
				await $.store.set(`avg:${run.key}`, nextAvg(prev as { avg: number; n: number } | undefined, ms))
			}
			await update($, runningAtom, (m) => {
				const { [key]: _done, ...rest } = m
				return rest
			})
		}
		if (!watchEol || path === null || ran.deny !== undefined || ran.isError === true) return ran
		if (!PATCH_TOOLS.has(e.tool) && before !== null && detectEol(before) === 'crlf') {
			// Write: แปลงกลับเฉพาะเมื่อผลยังผสม (เขียน LF ทั้งไฟล์ = ตั้งใจ)
			const after = await readText($, path)
			if (after === null || detectEol(after) !== 'mixed') return ran
		}
		try {
			const note = await fixEol($, path, before)
			if (note === null) return ran
			return { ...ran, context: [...(ran.context ?? []), note] }
		} catch (err) {
			await recordError($, 'eol-guard', err)
			return ran
		}
	})

	on('prompt.submit', async ($, e, next) => {
		// เฉพาะ prompt ที่ผู้ใช้พิมพ์เอง: งานจาก notification/peer ไม่ต้องรอ gh
		if (!flags.priorWork || e.origin?.kind !== 'composer' || issueIds(e.text).length === 0) return next(e)
		try {
			const extra = await priorWork($, e.text)
			if (extra.length === 0) return next(e)
			return next({ ...e, context: [...(e.context ?? []), ...extra] })
		} catch (err) {
			await recordError($, 'prior-work', err)
			return next(e)
		}
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		if (!flags.turnDoneSound || e.agentId !== undefined || e.isAborted) return res
		if (e.durationMs < flags.turnSoundSeconds * 1000) return res
		try {
			await $.audio.play({ asset: 'sounds/done.wav' })
		} catch (err) {
			await recordError($, 'audio', err)
		}
		void $.ui.toast(`devkit: เสร็จแล้ว · ใช้ ${Math.round(e.durationMs / 60_000)} นาที`)
		return res
	})

	on('command.run', { command: 'cleanup' }, async ($, e) => {
		const disk = await refreshDisk($)
		const ids = disk.containers
		if (e.args.trim() !== 'confirm') {
			const free = disk.freeGb === null ? 'ไม่ทราบ' : `${disk.freeGb} GB`
			if (ids.length === 0) return { text: `ไม่มี container ของ testcontainers ค้าง · ดิสก์เหลือ ${free}` }
			return {
				text: `container ของ testcontainers ที่หยุดแล้วค้าง ${ids.length} ตัว · ดิสก์เหลือ ${free}\nพิมพ์ /cleanup confirm เพื่อลบ (ลบเฉพาะตัวที่หยุดแล้วและมี ${TESTCONTAINERS} ตัวที่ยังรันไม่แตะ)`,
			}
		}
		if ((e.origin as { kind?: string } | undefined)?.kind !== 'composer')
			return { text: 'ผู้ใช้ต้องพิมพ์ /cleanup confirm เอง ลบแทนผู้ใช้ไม่ได้' }
		if (ids.length === 0) return { text: 'ไม่มีอะไรให้ลบ' }
		// เฉพาะ container ที่หยุดแล้ว (-v ลบ volume นิรนามที่กินดิสก์จริงด้วย); ตัวที่ยังรันเป็นเทสต์ที่ใช้อยู่
		const rm = await sh($, ['docker', 'rm', '-v', ...ids], 60_000)
		const after = await refreshDisk($)
		await update($, diskHiddenAtom, () => false)
		return {
			text: rm.ok
				? `ลบ container ${ids.length} ตัวแล้ว · เหลือ ${after.containers.length}`
				: 'ลบไม่สำเร็จ ลองรัน docker เองดูข้อความ error',
		}
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const warnings = flags.longRunWatch
			? Object.values(await read($, runningAtom))
					.map((r) => r.warning)
					.filter((w): w is string => w !== null)
			: []
		const longRun = warnings.length === 0 ? null : warnings.join(' · ')
		const disk = flags.diskBand && !(await read($, diskHiddenAtom)) ? await read($, diskAtom) : null
		const diskText =
			disk === null
				? null
				: diskAlert(
						{ freeGb: disk.freeGb, containers: disk.containers.length },
						{ minFreeGb: flags.diskMinFreeGb, maxContainers: MAX_CONTAINERS }
					)
		if (longRun === null && diskText === null) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		return (
			<Box flexDirection="column" borderStyle="round" borderColor="warning" paddingX={1}>
				{longRun !== null && <Text wrap="wrap">⏱ {longRun}</Text>}
				{diskText !== null && (
					<Box gap={1}>
						<Text wrap="wrap">{diskText}</Text>
						<Button key="hide-disk" label="ซ่อน" plain onPress={() => update($, diskHiddenAtom, () => true)} />
					</Box>
				)}
			</Box>
		)
	})
}
