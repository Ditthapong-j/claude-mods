import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ProofResultState } from '../types'
import { commandsFor, parseProofConfig } from './plan'
import type { ProofCommand } from './plan'
import { bandText, continuePrompt, settle, statusLine } from './results'

// ทุกการเรียก $ และ atom อยู่ในไฟล์นี้ (engine ไม่ตาม $ ข้าม import และสแกน state ต่อไฟล์)

const touchedAtom = atom({ plugin: 'proof', key: 'touched' } as const, [] as string[])
const resultsAtom = atom({ plugin: 'proof', key: 'results' } as const, [] as ProofResultState[])
const bandHiddenAtom = atom({ plugin: 'proof', key: 'bandHidden' } as const, true)
const enabledAtom = atom({ plugin: 'proof', key: 'enabled' } as const, true)
const busyAtom = atom({ plugin: 'proof', key: 'busy' } as const, false)
const lastEditAtom = atom({ plugin: 'proof', key: 'lastEdit' } as const, null as number | null)
const errorsAtom = atom(
	{ plugin: 'proof', key: 'errors' } as const,
	[] as { at: number; where: string; message: string }[]
)

const PANE = 'proof'
const DEBOUNCE_MS = 5000
// host รับ timeoutMs ได้สูงสุด 600000 (10 นาที)
const RUN_TIMEOUT_MS = 600_000
const RETRIES = 2
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

const TICK_MS = 1000

async function recordError($: EngineInterface, where: string, err: unknown): Promise<void> {
	const at = await $.clock.now()
	const message = err instanceof Error ? err.message : String(err)
	await update($, errorsAtom, (l) => [...l, { at, where, message }].slice(-50))
}

async function repoRoot($: EngineInterface): Promise<string | null> {
	try {
		const res = await $.process.run(['git', 'rev-parse', '--show-toplevel'], {
			cwd: await $.session.cwd(),
			timeoutMs: 5000,
		})
		return res.exitCode === 0 ? res.stdout.trim() : null
	} catch (err) {
		await recordError($, 'git', err)
		return null
	}
}

async function plan($: EngineInterface, root: string, paths: readonly string[]): Promise<ProofCommand[]> {
	const guards = `${root}/.claude/guards.json`
	const text = (await $.fs.exists(guards)) ? await $.fs.read(guards) : null
	const config = parseProofConfig(typeof text === 'string' ? text : null)
	for (const err of config.errors) await recordError($, 'guards.json', err)
	// fs.ancestors รับเฉพาะชื่อไฟล์ .md (host check) จึงไล่ขึ้นทีละโฟลเดอร์จนถึงราก repo เอง
	const projects: { dir: string; kind: 'tsc' | 'vitest' }[] = []
	const seen = new Set<string>()
	for (const path of paths) {
		let dir = path.slice(0, path.lastIndexOf('/'))
		while (dir.startsWith(root) && !seen.has(dir)) {
			seen.add(dir)
			if (await $.fs.exists(`${dir}/tsconfig.json`)) projects.push({ dir, kind: 'tsc' })
			if ((await $.fs.exists(`${dir}/vitest.config.ts`)) || (await $.fs.exists(`${dir}/vitest.config.mts`))) {
				projects.push({ dir, kind: 'vitest' })
			}
			if (dir === root) break
			dir = dir.slice(0, dir.lastIndexOf('/'))
		}
	}
	return commandsFor(paths, root, config.rules, projects)
}

async function runOne($: EngineInterface, cmd: ProofCommand): Promise<void> {
	const started = await $.clock.now()
	await update($, resultsAtom, (l) => [
		...l.filter((r) => r.id !== cmd.id),
		{ id: cmd.id, label: cmd.label, status: 'running' as const, exitCode: null, tail: '', at: started, durationMs: 0 },
	])
	const runs: { exitCode: number; tail: string }[] = []
	// ล้มแล้วรันซ้ำอีกสูงสุด 2 รอบ เพื่อแยก flaky ออกจากล้มจริง
	for (let i = 0; i <= RETRIES; i++) {
		try {
			const res = await $.process.run(cmd.argv, { cwd: cmd.cwd, timeoutMs: RUN_TIMEOUT_MS })
			const tail = `${res.stdout}\n${res.stderr}`.trim().split('\n').slice(-40).join('\n')
			runs.push({ exitCode: res.exitCode, tail })
			if (res.exitCode === 0) break
		} catch (err) {
			// รันไม่ได้เลย (ไม่มีโปรแกรม, host ปฏิเสธ): นับเป็นล้ม ไม่ใช่ค้างที่ running
			runs.push({ exitCode: 127, tail: err instanceof Error ? err.message : String(err) })
			break
		}
	}
	const status = settle(runs)
	const last = runs.at(-1)
	const done = await $.clock.now()
	await update($, resultsAtom, (l) => [
		...l.filter((r) => r.id !== cmd.id),
		{
			id: cmd.id,
			label: cmd.label,
			status,
			exitCode: last?.exitCode ?? null,
			tail: last?.tail ?? '',
			at: done,
			durationMs: done - started,
		},
	])
}

// คิวเดียว: ระหว่างรันอยู่ การเรียกซ้ำจะไม่รันซ้อน ไฟล์ที่แก้ระหว่างนั้นรอรอบถัดไป
async function runAll($: EngineInterface): Promise<void> {
	if (await read($, busyAtom)) return
	await update($, busyAtom, () => true)
	try {
		const root = await repoRoot($)
		const paths = await read($, touchedAtom)
		if (root === null || paths.length === 0) return
		await update($, touchedAtom, () => [])
		for (const cmd of await plan($, root, paths)) await runOne($, cmd)
	} catch (err) {
		await recordError($, 'run', err)
	} finally {
		await update($, busyAtom, () => false)
		void $.ui.status(statusLine(await read($, resultsAtom)))
	}
}

async function tick($: EngineInterface): Promise<void> {
	const last = await read($, lastEditAtom)
	if (last === null || !(await read($, enabledAtom))) return
	if ((await $.clock.now()) - last < DEBOUNCE_MS) return
	await update($, lastEditAtom, () => null)
	await runAll($)
}

// S1b: prompt.submit ใช้ได้เมื่อไม่ได้อยู่ระหว่าง hook ที่ถือเทิร์น
async function continueWithClaude($: EngineInterface): Promise<string> {
	const results = await read($, resultsAtom)
	if (!results.some((r) => r.status === 'fail')) return 'ไม่มีคำสั่งพิสูจน์ที่ล้ม'
	await update($, bandHiddenAtom, () => true)
	try {
		await $.prompt.submit({ text: continuePrompt(results) })
		return 'ส่งให้ Claude แก้ต่อแล้ว (เริ่มเมื่อ session ว่าง)'
	} catch {
		// host ไม่ให้ submit ระหว่าง hook ที่ถือเทิร์น (เช่น command.run): ใส่ไว้ในช่องพิมพ์ให้ผู้ใช้กด Enter เอง
		await $.prompt.fill({ text: continuePrompt(results), mode: 'replace' })
		return 'ใส่คำสั่งให้ Claude แก้ต่อไว้ในช่องพิมพ์แล้ว กด Enter เพื่อส่ง'
	}
}

export const register: Register = (on, options) => {
	const autoRun = options['autoRun'] !== false

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await update($, enabledAtom, () => autoRun)
		// งานที่อยู่ข้าม dispatch ต้องเริ่มจาก session.start (timer ที่ตั้งใน hook อื่นจบพร้อม dispatch นั้น)
		$.clock.every(TICK_MS, () => tick($))
		await $.command.register({ name: 'proof', description: 'หลักฐานเทสต์: เปิด pane · run · on · off · continue' })
		await $.tool.register({
			name: 'status',
			description: 'สถานะคำสั่งพิสูจน์ของ proof (JSON)',
			inputSchema: { type: 'object', properties: {} },
		})
		return res
	})

	on('tool.call', async ($, e, next) => {
		const ran = await next(e)
		try {
			if (!EDIT_TOOLS.has(e.tool) || ran.deny !== undefined || ran.isError === true) return ran
			const input = e as unknown as Record<string, unknown>
			const path = input['file_path'] ?? input['notebook_path']
			if (typeof path !== 'string') return ran
			await update($, touchedAtom, (l) => (l.includes(path) ? l : [...l, path]))
			await update($, bandHiddenAtom, () => true)
			// debounce: ticker ที่เริ่มใน session.start จะรันเมื่อไม่มีการแก้ไฟล์ครบ DEBOUNCE_MS
			await update($, lastEditAtom, () => null)
			const now = await $.clock.now()
			await update($, lastEditAtom, () => now)
		} catch (err) {
			await recordError($, 'tool.call', err)
		}
		return ran
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		if ((e as unknown as { agentId?: string }).agentId !== undefined) return res
		if (bandText(await read($, resultsAtom)) !== undefined) await update($, bandHiddenAtom, () => false)
		return res
	})

	on('tool.call', { tool: 'mcp__proof__status' }, async ($) => ({
		result: JSON.stringify({
			enabled: await read($, enabledAtom),
			touched: await read($, touchedAtom),
			results: await read($, resultsAtom),
			errors: (await read($, errorsAtom)).slice(-5),
		}),
	}))

	on('command.run', { command: 'proof' }, async ($, e) => {
		const verb = e.args.trim()
		if (verb === 'off' || verb === 'on') {
			await update($, enabledAtom, () => verb === 'on')
			return { text: `proof ${verb === 'on' ? 'เปิด' : 'ปิด'}การรันอัตโนมัติแล้ว` }
		}
		if (verb === 'run') {
			await runAll($)
			return { text: statusLine(await read($, resultsAtom)) ?? 'ไม่มีไฟล์ที่แก้รอพิสูจน์' }
		}
		if (verb === 'continue') return { text: await continueWithClaude($) }
		await $.ui.open({ id: PANE, title: 'proof · หลักฐาน' })
		return { text: 'เปิด pane proof แล้ว' }
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		if (await read($, bandHiddenAtom)) return next(e)
		const text = bandText(await read($, resultsAtom))
		if (text === undefined) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		return (
			<Box gap={1} borderStyle="round" borderColor="error" paddingX={1}>
				<Text wrap="wrap">{text}</Text>
				<Button key="continue" label="ให้ Claude แก้ต่อ" variant="primary" onPress={() => continueWithClaude($)} />
				<Button key="log" label="ดู log" onPress={() => $.ui.open({ id: PANE, title: 'proof · หลักฐาน' })} />
				<Button key="hide" label="ข้าม" role="dismiss" onPress={() => update($, bandHiddenAtom, () => true)} />
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const results = await read($, resultsAtom)
		const errors = await read($, errorsAtom)
		const enabled = await read($, enabledAtom)
		return (
			<Box flexDirection="column">
				<Text dimColor>
					{statusLine(results) ?? 'ยังไม่มีผล'} · อัตโนมัติ {enabled ? 'เปิด' : 'ปิด'}
				</Text>
				{results.map((r) => (
					<Box key={r.id} flexDirection="column">
						<Text color={r.status === 'pass' ? 'success' : r.status === 'fail' ? 'error' : 'warning'}>
							{r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : r.status === 'flaky' ? '~' : '…'} {r.label} ·{' '}
							{Math.round(r.durationMs / 1000)}s
						</Text>
						{r.status !== 'pass' && (
							<Text dimColor wrap="wrap">
								{r.tail}
							</Text>
						)}
					</Box>
				))}
				{errors.slice(-3).map((x) => (
					<Text key={`${x.at}-${x.where}`} color="error">
						{x.where}: {x.message}
					</Text>
				))}
			</Box>
		)
	})
}
