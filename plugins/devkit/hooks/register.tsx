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
const runningAtom = atom({ plugin: 'devkit', key: 'running' } as const, null as RunningCommand | null)
const longRunAtom = atom({ plugin: 'devkit', key: 'longRunWarning' } as const, null as string | null)
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

async function baseBranch($: EngineInterface): Promise<string | null> {
	const head = await sh($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 3000)
	return head.ok && head.out.trim() !== '' ? head.out.trim() : null
}

async function refreshStatus($: EngineInterface, flags: Flags): Promise<void> {
	const next: DevkitStatus = { branch: null, behind: null, dirty: null, ctxPercent: null }
	if (flags.branchWatch) {
		const head = await sh($, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], 3000)
		if (head.ok) {
			next.branch = head.out.trim()
			const base = await baseBranch($)
			if (base !== null) {
				const behind = await sh($, ['git', 'rev-list', '--count', `HEAD..${base}`], 3000)
				next.behind = behind.ok ? Number(behind.out.trim()) || 0 : null
			}
			const dirty = await sh($, ['git', 'status', '--porcelain'], 3000)
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

async function checkLongRun($: EngineInterface): Promise<void> {
	const running = await read($, runningAtom)
	if (running === null || (await read($, longRunAtom)) !== null) return
	const elapsed = (await $.clock.now()) - running.startedAt
	const avg = await $.store.get(`avg:${running.key}`)
	const avgMs = typeof avg === 'object' && avg !== null ? (avg as { avg: number }).avg : undefined
	if (elapsed < thresholdMs(avgMs, running.knownSlow)) return
	const minutes = Math.round(elapsed / 60_000)
	const usual = avgMs === undefined ? '' : ` ปกติใช้ ${Math.max(1, Math.round(avgMs / 60_000))} นาที`
	const text = `${running.command.slice(0, 60)} รันมา ${minutes} นาที${usual} · กด Esc ถ้าค้าง`
	await update($, longRunAtom, () => text)
	void $.ui.toast(`devkit: ${text}`)
}

async function refreshDisk($: EngineInterface): Promise<DiskState> {
	const df = await sh($, ['df', '-k', '/'], 3000)
	const ps = await sh($, ['docker', 'ps', '-a', '--filter', TESTCONTAINERS, '--format', '{{.ID}}'], 5000)
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

async function priorWork($: EngineInterface, text: string): Promise<string[]> {
	const out: string[] = []
	const base = (await baseBranch($)) ?? 'HEAD'
	for (const id of issueIds(text).slice(0, 2)) {
		const gh = await sh($, ['gh', 'pr', 'list', '--state', 'open', '--search', id, '--json', 'number,title,url'], 3000)
		let prs: { number: number; title: string; url: string }[] = []
		try {
			prs = gh.ok ? (JSON.parse(gh.out) as typeof prs) : []
		} catch {
			prs = []
		}
		const log = await sh($, ['git', 'log', base, '--oneline', '-5', `--grep=${id}`], 1500)
		const commits = log.ok ? log.out.split('\n').filter(Boolean) : []
		const ctx = priorContext(id, prs, commits)
		if (ctx !== null) out.push(ctx)
	}
	return out
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
		if (flags.diskBand) $.clock.every(DISK_MS, () => refreshDisk($))
		return res
	})

	on('tool.call', async ($, e, next) => {
		const input = e as unknown as Record<string, unknown>
		const path = typeof input['file_path'] === 'string' ? input['file_path'] : null
		const watchEol = flags.eolGuard && EDIT_TOOLS.has(e.tool) && path !== null
		const before = watchEol && path !== null ? await readText($, path) : null
		const command = e.tool === 'Bash' && typeof input['command'] === 'string' ? input['command'] : null
		if (command !== null) {
			if (isClaudeSwitch(command)) {
				const now = await $.clock.now()
				await update($, claudeSwitchAtAtom, () => now)
			}
			if (flags.longRunWatch) {
				const startedAt = await $.clock.now()
				await update($, runningAtom, () => ({
					key: commandKey(command),
					command,
					startedAt,
					knownSlow: isKnownSlow(command),
				}))
			}
		}

		const ran = await next(e)

		if (command !== null && flags.longRunWatch) {
			const running = await read($, runningAtom)
			if (running !== null) {
				const ms = (await $.clock.now()) - running.startedAt
				const prev = await $.store.get(`avg:${running.key}`)
				await $.store.set(`avg:${running.key}`, nextAvg(prev as { avg: number; n: number } | undefined, ms))
			}
			await update($, runningAtom, () => null)
			await update($, longRunAtom, () => null)
		}
		if (!watchEol || path === null || ran.deny !== undefined || ran.isError === true) return ran
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
		if (!flags.priorWork || issueIds(e.text).length === 0) return next(e)
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
		if (!flags.turnDoneSound || (e as unknown as { agentId?: string }).agentId !== undefined) return res
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
				text: `container ของ testcontainers ค้าง ${ids.length} ตัว · ดิสก์เหลือ ${free}\nพิมพ์ /cleanup confirm เพื่อลบ (ลบเฉพาะ container ที่มี ${TESTCONTAINERS})`,
			}
		}
		if ((e.origin as { kind?: string } | undefined)?.kind !== 'composer')
			return { text: 'ผู้ใช้ต้องพิมพ์ /cleanup confirm เอง ลบแทนผู้ใช้ไม่ได้' }
		if (ids.length === 0) return { text: 'ไม่มีอะไรให้ลบ' }
		const rm = await sh($, ['docker', 'rm', '-f', ...ids], 60_000)
		const after = await refreshDisk($)
		await update($, diskHiddenAtom, () => false)
		return {
			text: rm.ok
				? `ลบ container ${ids.length} ตัวแล้ว · เหลือ ${after.containers.length}`
				: 'ลบไม่สำเร็จ ลองรัน docker เองดูข้อความ error',
		}
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const longRun = flags.longRunWatch ? await read($, longRunAtom) : null
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
