import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { MissionSnapshot } from '../types'
import { parseEnvConfig, parsePeers, parsePrs, parseVersion, parseWorktrees, waiting } from './parse'
import type { EnvRow } from './parse'
import { envTable, layout, prRows, trunc, waitingItems, workRows } from './view'
import type { Cell } from './view'

const snapshotAtom = atom({ plugin: 'mission', key: 'snapshot' } as const, null as MissionSnapshot | null)
const showAllAtom = atom({ plugin: 'mission', key: 'showAll' } as const, false)
const openAtom = atom({ plugin: 'mission', key: 'open' } as const, false)
const errorsAtom = atom(
	{ plugin: 'mission', key: 'errors' } as const,
	[] as { at: number; where: string; message: string }[]
)
const PANE = 'mission'
const T = 5000

async function run(
	$: EngineInterface,
	argv: string[],
	cwd?: string
): Promise<{ ok: boolean; out: string; err: string }> {
	try {
		const res = await $.process.run(argv, { cwd, timeoutMs: T })
		return { ok: res.exitCode === 0, out: res.stdout, err: res.stderr.trim() || `exit ${res.exitCode}` }
	} catch (e) {
		return { ok: false, out: '', err: e instanceof Error ? e.message : String(e) }
	}
}

async function fetchVersion(
	$: EngineInterface,
	url: string
): Promise<{ ok: boolean; status: number; text: string } | { error: string }> {
	try {
		const res = await Promise.race([$.http.fetch(url), $.clock.sleep(T).then(() => null)])
		return res === null
			? { error: `ไม่ตอบภายใน ${T / 1000} วินาที` }
			: { ok: res.ok, status: res.status, text: res.text }
	} catch (e) {
		return { error: e instanceof Error ? e.message : String(e) }
	}
}

async function snapshot($: EngineInterface, envsText: string): Promise<MissionSnapshot> {
	const cwd = await $.session.cwd()
	const top = await run($, ['git', 'rev-parse', '--show-toplevel'], cwd)
	const root = top.ok ? top.out.trim() : cwd
	const wt = await run($, ['git', 'worktree', 'list', '--porcelain'], root)
	const worktreeError = wt.ok ? null : wt.err
	const worktrees = []
	for (const w of wt.ok ? parseWorktrees(wt.out) : []) {
		const st = await run($, ['git', '-C', w.path, 'status', '--porcelain'])
		worktrees.push({ ...w, dirty: st.ok ? st.out.split('\n').filter(Boolean).length : -1 })
	}
	const gh = await run(
		$,
		['gh', 'pr', 'list', '--author', '@me', '--json', 'number,title,headRefName,reviewDecision,statusCheckRollup,updatedAt'],
		root
	)
	const prs = gh.ok ? parsePrs(gh.out) : { error: gh.err }
	let peers: MissionSnapshot['peers']
	try {
		const agents = await $.tool.call({ tool: 'ListAgents' })
		peers = agents.deny !== undefined ? { error: agents.deny } : parsePeers(String(agents.text ?? agents.result ?? ''))
	} catch (err) {
		peers = { error: err instanceof Error ? err.message : String(err) }
	}
	const envList = parseEnvConfig(envsText)
	const envs: EnvRow[] = []
	// ตั้งค่า envs ผิด: แสดงเป็นแถวปัญหา ไม่ซ่อนกล่อง
	if ('error' in envList) envs.push({ name: 'envs', service: null, version: null, commit: null, problem: envList.error })
	else for (const env of envList) envs.push(parseVersion(env.name, await fetchVersion($, env.url), env.service))
	return {
		at: await $.clock.now(),
		worktrees,
		worktreeError,
		here: top.ok ? top.out.trim() : null,
		prs,
		peers,
		envs,
		waiting: waiting(Array.isArray(prs) ? prs : [], envs),
	}
}

async function refresh($: EngineInterface, envsText: string): Promise<void> {
	try {
		// เก็บ snapshot เดิมไว้ระหว่างอัปเดต pane จะไม่กระพริบกลับไปหน้าโหลด
		const snap = await snapshot($, envsText)
		await update($, snapshotAtom, () => snap)
	} catch (err) {
		const at = await $.clock.now()
		await update($, errorsAtom, (l) =>
			[...l, { at, where: 'refresh', message: err instanceof Error ? err.message : String(err) }].slice(-50)
		)
	}
}

export const register: Register = (on, options) => {
	const envsText = typeof options['envs'] === 'string' ? options['envs'] : '[]'
	const refreshMs = Math.max(30, typeof options['refreshSeconds'] === 'number' ? options['refreshSeconds'] : 120) * 1000

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({
			name: 'mission',
			description: 'Mission Control: งาน, PR + CI, session อื่น, env · refresh',
		})
		// timer ต้องเริ่มจาก session.start จึงจะอยู่ข้าม dispatch; อัปเดตเฉพาะตอนเปิด pane
		// อัปเดตเฉพาะตอนที่ pane ยังเปิดอยู่จริง ปิดแล้วหยุดเรียก gh / git
		$.clock.every(refreshMs, async () => {
			if (!(await read($, openAtom))) return
			const panes = await $.ui.panes()
			if (!panes.some((p) => p.id === PANE)) {
				await update($, openAtom, () => false)
				return
			}
			await refresh($, envsText)
		})
		await $.tool.register({
			name: 'snapshot',
			description: 'สรุปสถานะงานของ Mission Control (JSON)',
			inputSchema: { type: 'object', properties: {} },
		})
		return res
	})

	on('command.run', { command: 'mission' }, async ($, e) => {
		await refresh($, envsText)
		if (e.args.trim() !== 'refresh') {
			await update($, openAtom, () => true)
			await $.ui.open({ id: PANE, title: 'Mission Control' })
		}
		return { text: 'อัปเดต Mission Control แล้ว' }
	})

	on('tool.call', { tool: 'mcp__mission__snapshot' }, async ($) => ({
		result: JSON.stringify({ ...((await read($, snapshotAtom)) ?? {}), errors: (await read($, errorsAtom)).slice(-5) }),
	}))


	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e)
		const snap = await read($, snapshotAtom)
		const errors = await read($, errorsAtom)
		const showAll = await read($, showAllAtom)
		const width = Math.max(40, e.props.bodyColumns)
		if (snap === null) {
			return (
				<Box flexDirection="column">
					<Text dimColor>กำลังโหลด…</Text>
					{errors.slice(-3).map((x) => (
						<Text key={`${x.at}`} color="error">
							{x.where}: {x.message}
						</Text>
					))}
				</Box>
			)
		}

		const two = layout(width) === 'two'
		const half = two ? Math.floor((width - 1) / 2) : width
		const inner = (w: number) => Math.max(10, w - 4)
		const limit = showAll ? 50 : 5
		const prs = Array.isArray(snap.prs) ? snap.prs : []
		const items = waitingItems(prs, snap.envs, snap.at)
		const work = workRows(snap.worktrees, snap.here, limit)
		const prView = prRows(prs, limit)
		const env = envTable(snap.envs)
		const online = Array.isArray(snap.peers) ? snap.peers.filter((p) => p.state !== 'offline').length : 0

		const title = (text: string) => (
			<Text bold color="claude">
				{text}
			</Text>
		)
		const rule = (w: number) => <Text dimColor>{'─'.repeat(inner(w))}</Text>
		// ตาราง: หัวคอลัมน์สีจาง + เส้นคั่นทุกแถว; ความกว้างคอลัมน์เป็นสัดส่วนของการ์ด
		const table = (w: number, ratios: number[], head: string[], rows: { key: string; cells: Cell[] }[]) => {
			const cols = ratios.map((r) => Math.max(4, Math.floor(inner(w) * r)))
			const line = (key: string, cells: Cell[], isHead: boolean) => (
				<Box key={key}>
					{cells.map((c, i) => (
						<Box key={`${key}-${i}`} width={cols[i] ?? 8}>
							<Text dimColor={isHead} color={isHead || c.tone === 'text' ? undefined : c.tone} wrap="truncate-end">
								{trunc(c.text, (cols[i] ?? 8) - 1)}
							</Text>
						</Box>
					))}
				</Box>
			)
			return (
				<Box flexDirection="column">
					{line('head', head.map((h) => ({ text: h, tone: 'text' as const })), true)}
					{rule(w)}
					{rows.map((r) => (
						<Box key={r.key} flexDirection="column">
							{line(r.key, r.cells, false)}
							{rule(w)}
						</Box>
					))}
				</Box>
			)
		}
		const card = (key: string, w: number, children: RenderChildren, accent?: 'warning' | 'error') => (
			<Box key={key} width={w} flexDirection="column" borderStyle="round" borderColor={accent ?? 'subtle'} paddingX={1}>
				{children}
			</Box>
		)

		const waitingCard = card(
			'waiting',
			width,
			<Box flexDirection="column">
				{title(`รอคุณ · ${items.length}`)}
				{items.length === 0 && <Text dimColor>ไม่มีอะไรรอคุณ</Text>}
				{items.map((it) => (
					<Box key={it.text} justifyContent="space-between">
						<Text wrap="truncate-end">
							<Text color={it.tone}>●</Text> {trunc(it.text, inner(width) - 10)}
						</Text>
						<Text dimColor>{it.age ?? ''}</Text>
					</Box>
				))}
			</Box>,
			items.some((i) => i.tone === 'error') ? 'error' : items.length > 0 ? 'warning' : undefined
		)

		const workCard = card(
			'work',
			half,
			<Box flexDirection="column">
				{title('กำลังทำ')}
				{snap.worktreeError !== null && <Text color="error">{snap.worktreeError}</Text>}
				{table(
					half,
					[0.3, 0.45, 0.25],
					['worktree', 'branch', 'สถานะ'],
					work.rows.map((r) => ({
						key: r.name,
						cells: [{ text: r.name, tone: 'text' }, { text: r.branch, tone: 'text' }, r.status],
					}))
				)}
				<Text dimColor>
					{work.clean > 0 ? `+${work.clean} ตัวที่สะอาด` : ''}
					{work.more > 0 ? ` · อีก ${work.more} ตัวที่ค้าง` : ''}
				</Text>
			</Box>
		)

		const prCard = card(
			'pr',
			half,
			<Box flexDirection="column">
				{title('PR + CI')}
				{'error' in snap.prs && <Text color="error">{snap.prs.error}</Text>}
				{table(
					half,
					[0.55, 0.2, 0.25],
					['PR', 'CI', 'review'],
					prView.rows.map((r) => ({ key: `${r.num}`, cells: [{ text: `#${r.num} ${r.title}`, tone: 'text' }, r.ci, r.review] }))
				)}
				{prView.more > 0 && <Text dimColor>อีก {prView.more} ตัว</Text>}
			</Box>
		)

		const envCard = card(
			'env',
			width,
			<Box flexDirection="column">
				{title('Environments')}
				{env.rows.length === 0 ? (
					<Text dimColor>ยังไม่ได้ตั้งค่า · /plugin configure mission@claude-mods → envs</Text>
				) : (
					table(
						width,
						[0.12, ...env.columns.map(() => 0.88 / env.columns.length)],
						['env', ...env.columns],
						env.rows.map((r) => ({ key: r.env, cells: [{ text: r.env, tone: 'text' }, ...r.cells] }))
					)
				)}
			</Box>
		)

		return (
			<Box flexDirection="column" gap={1}>
				{waitingCard}
				{two ? (
					<Box gap={1}>
						{workCard}
						{prCard}
					</Box>
				) : (
					<Box flexDirection="column" gap={1}>
						{workCard}
						{prCard}
					</Box>
				)}
				{envCard}
				<Box justifyContent="space-between">
					<Text dimColor>
						/mission · อัปเดตทุก {Math.round(refreshMs / 60_000)} นาที · session ที่เปิดอยู่ {online}
					</Text>
					<Box gap={1}>
						<Button key="all" label={showAll ? 'ย่อ' : 'แสดงทั้งหมด'} plain onPress={() => update($, showAllAtom, (v) => !v)} />
						<Button key="refresh" label="รีเฟรช" plain onPress={() => refresh($, envsText)} />
						<Text bold color="claude">
							รอคุณ {items.length}
						</Text>
					</Box>
				</Box>
			</Box>
		)
	})
}
