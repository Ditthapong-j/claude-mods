import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MissionSnapshot } from '../types'
import { parseEnvConfig, parsePeers, parsePrs, parseVersion, parseWorktrees, waiting } from './parse'
import type { EnvRow } from './parse'

const snapshotAtom = atom({ plugin: 'mission', key: 'snapshot' } as const, null as MissionSnapshot | null)
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
	const worktrees = []
	for (const w of wt.ok ? parseWorktrees(wt.out) : []) {
		const st = await run($, ['git', '-C', w.path, 'status', '--porcelain'])
		worktrees.push({ ...w, dirty: st.ok ? st.out.split('\n').filter(Boolean).length : -1 })
	}
	const gh = await run(
		$,
		['gh', 'pr', 'list', '--author', '@me', '--json', 'number,title,headRefName,reviewDecision,statusCheckRollup'],
		root
	)
	const prs = gh.ok ? parsePrs(gh.out) : { error: gh.err }
	const agents = await $.tool.call({ tool: 'ListAgents' })
	const peers =
		agents.deny !== undefined ? { error: agents.deny } : parsePeers(String(agents.text ?? agents.result ?? ''))
	const envList = parseEnvConfig(envsText)
	const envs: EnvRow[] = []
	if (!('error' in envList))
		for (const env of envList) envs.push(parseVersion(env.name, await fetchVersion($, env.url)))
	return { at: await $.clock.now(), worktrees, prs, peers, envs, waiting: waiting(Array.isArray(prs) ? prs : [], envs) }
}

async function refresh($: EngineInterface, envsText: string): Promise<void> {
	try {
		await update($, snapshotAtom, () => null)
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
		$.clock.every(refreshMs, async () => {
			if (await read($, openAtom)) await refresh($, envsText)
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
		result: JSON.stringify(await read($, snapshotAtom)),
	}))

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const snap = await read($, snapshotAtom)
		if (snap === null) return <Text dimColor>กำลังโหลด…</Text>
		const section = (title: string) => (
			<Text bold color="claude">
				{title}
			</Text>
		)
		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					{section(`รอคุณ · ${snap.waiting.length}`)}
					{snap.waiting.length === 0 ? (
						<Text dimColor>ไม่มี</Text>
					) : (
						snap.waiting.map((w) => (
							<Text key={w} color="warning">
								● {w}
							</Text>
						))
					)}
				</Box>
				<Box flexDirection="column">
					{section('worktree')}
					{snap.worktrees.map((w) => (
						<Text key={w.path}>
							{w.branch ?? '(detached)'} · {w.dirty < 0 ? '?' : w.dirty} ไฟล์ค้าง · <Text dimColor>{w.path}</Text>
						</Text>
					))}
				</Box>
				<Box flexDirection="column">
					{section('PR + CI')}
					{'error' in snap.prs ? (
						<Text color="error">{snap.prs.error}</Text>
					) : (
						snap.prs.map((p) => (
							<Text
								key={`${p.number}`}
								color={p.checks === 'fail' ? 'error' : p.checks === 'pass' ? 'success' : 'warning'}
							>
								#{p.number} {p.title} · CI {p.checks} · review {p.review}
							</Text>
						))
					)}
				</Box>
				<Box flexDirection="column">
					{section('session อื่น')}
					{'error' in snap.peers ? (
						<Text color="error">{snap.peers.error}</Text>
					) : (
						snap.peers
							.filter((p) => p.state !== 'offline')
							.map((p) => (
								<Text key={p.id}>
									{p.name} ·{' '}
									<Text dimColor>
										{p.kind} · {p.state}
									</Text>
								</Text>
							))
					)}
				</Box>
				{snap.envs.length > 0 && (
					<Box flexDirection="column">
						{section('Environments')}
						{snap.envs.map((x) => (
							<Text key={x.name} color={x.problem === null ? 'success' : 'error'}>
								{x.name} · {x.version ?? '-'} · {x.commit ?? '-'}
								{x.problem === null ? '' : ` · ${x.problem}`}
							</Text>
						))}
					</Box>
				)}
			</Box>
		)
	})
}
