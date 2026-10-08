import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShipState } from '../types'
import {
	advance,
	approve,
	evaluate,
	isActive,
	isOurPrompt,
	parseBlocking,
	parseBranch,
	reviewerPrompt,
	reviewFixPrompt,
	STEPS,
	startShip,
	stepPrompt,
} from './steps'
import type { Evidence, ProofEvidence, Ship } from './steps'

// ทุกการเรียก $ และ atom อยู่ในไฟล์นี้ (engine ไม่ตาม $ ข้าม import และสแกน state ต่อไฟล์)

const shipAtom = atom({ plugin: 'autopilot', key: 'ship' } as const, null as ShipState | null)
const reviewAgentAtom = atom({ plugin: 'autopilot', key: 'reviewAgent' } as const, null as string | null)

const PANE = 'ship'
const T = 5000
const TICK_MS = 3000
const PROOF_WAIT_MS = 15 * 60_000
// push / เปิด PR / merge ก่อนผู้ใช้อนุมัติขั้นเปิด PR ถูกบล็อก
const PUBLISH = /(?:^|[;&|(]\s*|\s)(?:git\s+(?:-C\s+\S+\s+)?push\b|gh\s+pr\s+(?:create|merge)\b)/

async function out($: EngineInterface, argv: string[], cwd?: string): Promise<string | null> {
	try {
		const res = await $.process.run(argv, { cwd, timeoutMs: T })
		return res.exitCode === 0 ? res.stdout : null
	} catch {
		return null
	}
}

function issueTerms(issue: string): string {
	return issue.replace(/^#?\d+\s*/, '').slice(0, 60) || issue
}

async function save($: EngineInterface, ship: Ship): Promise<void> {
	await update($, shipAtom, () => ship)
}

async function proofEvidence($: EngineInterface, since: number): Promise<{ ev: ProofEvidence; settled: boolean }> {
	const res = await $.tool.call({ tool: 'mcp__proof__status' })
	if (res.deny !== undefined) return { ev: null, settled: true }
	let body: { touched?: string[]; results?: { status: string; at: number }[] } = {}
	try {
		body = JSON.parse(String(res.text ?? res.result ?? '{}')) as typeof body
	} catch {
		return { ev: null, settled: true }
	}
	const results = body.results ?? []
	const settled = (body.touched ?? []).length === 0 && !results.some((r) => r.status === 'running')
	return { ev: { fresh: results.filter((r) => r.at >= since) }, settled }
}

async function evidence($: EngineInterface, ship: Ship, answer: string): Promise<Evidence> {
	const cwd = await $.session.cwd()
	if (ship.step === 'understand') {
		const prs = await out(
			$,
			['gh', 'pr', 'list', '--state', 'open', '--search', issueTerms(ship.issue), '--json', 'number,title'],
			cwd
		)
		let list: { number: number; title: string }[] = []
		try {
			list = prs === null ? [] : (JSON.parse(prs) as { number: number; title: string }[])
		} catch {
			list = []
		}
		return { duplicates: list.map((p) => `PR #${p.number} ${p.title}`) }
	}
	if (ship.step === 'worktree') {
		const branch = parseBranch(answer)
		const list = await out($, ['git', 'worktree', 'list', '--porcelain'], cwd)
		await save($, { ...ship, branch })
		const has = branch !== null && list !== null && list.includes(`branch refs/heads/${branch}`)
		return { worktreeBranch: has ? branch : null }
	}
	if (ship.step === 'open-pr') return { approved: ship.pushApproved }
	return {}
}

// S1b: prompt.submit ใช้ได้จาก turn.complete/timer แต่ host ปฏิเสธใน command.run/tool.call → ใส่ช่องพิมพ์ให้ผู้ใช้กด Enter
async function handOff($: EngineInterface, text: string): Promise<void> {
	try {
		await $.prompt.submit({ text })
	} catch {
		await $.prompt.fill({ text, mode: 'replace' })
		void $.ui.toast('autopilot: กด Enter เพื่อเริ่มขั้นนี้')
	}
}

async function spawnReviewer($: EngineInterface, ship: Ship): Promise<void> {
	const spawned = await $.agent.spawn({
		prompt: reviewerPrompt(ship),
		description: 'autopilot review',
		subagentType: ship.reviewer,
	})
	if ('agentId' in spawned && spawned.agentId !== undefined) {
		await update($, reviewAgentAtom, () => String(spawned.agentId))
		await save($, { ...ship, reviewPhase: 'reviewing' })
		return
	}
	const reason = 'deny' in spawned ? String(spawned.deny) : 'ไม่ทราบสาเหตุ'
	await save($, {
		...ship,
		status: 'blocked',
		log: [...ship.log, `เปิด reviewer "${ship.reviewer}" ไม่ได้: ${reason}`],
	})
	void $.ui.toast(`autopilot: เปิด reviewer "${ship.reviewer}" ไม่ได้ (${reason}) ตั้ง reviewer ในเมนู config`)
}

async function kick($: EngineInterface, next: Ship): Promise<void> {
	const ship = { ...next, stepStartedAt: await $.clock.now() }
	await save($, ship)
	if (ship.status !== 'running') {
		if (ship.status === 'blocked' || ship.status === 'waiting-person')
			void $.ui.toast(`autopilot: ${ship.log.at(-1) ?? ''}`)
		return
	}
	if (ship.step === 'review') {
		await spawnReviewer($, ship)
		return
	}
	await handOff($, stepPrompt(ship))
}

async function settleProof($: EngineInterface): Promise<void> {
	const ship = await read($, shipAtom)
	if (ship === null || ship.status !== 'running' || !ship.awaitingProof) return
	const { ev, settled } = await proofEvidence($, ship.stepStartedAt)
	if (!settled) {
		if ((await $.clock.now()) - ship.stepStartedAt > PROOF_WAIT_MS) await kick($, advance(ship, 'needs-person'))
		return
	}
	await kick($, advance(ship, evaluate(ship, { proof: ev })))
}

async function onApprove($: EngineInterface): Promise<string> {
	const ship = await read($, shipAtom)
	if (ship === null || ship.status !== 'waiting-person') return 'ไม่มีขั้นที่รออนุมัติ'
	await kick($, approve(ship))
	return 'อนุมัติแล้ว'
}

async function onStop($: EngineInterface): Promise<void> {
	await update($, shipAtom, (s) => (s === null ? s : { ...s, status: 'stopped' as const, log: [...s.log, 'หยุดโดยผู้ใช้'] }))
}

export const register: Register = (on, options) => {
	const reviewer = typeof options['reviewer'] === 'string' ? options['reviewer'] : 'general-purpose'

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({ name: 'ship', description: 'Autopilot: /ship <issue> · status · stop · approve' })
		// ขั้น red-test / proof รอ proof รันจบก่อนตัดสิน: ตรวจจาก timer ที่เริ่มตรงนี้
		$.clock.every(TICK_MS, () => settleProof($))
		return res
	})

	on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
		const ship = await read($, shipAtom)
		if (isActive(ship) && !ship.pushApproved && PUBLISH.test(e.command)) {
			return {
				deny: '[autopilot] push / เปิด PR / merge ต้องรอผู้ใช้อนุมัติขั้นเปิด PR ก่อน (/ship approve ที่ขั้น 7)',
			}
		}
		return next(e)
	}).catch(($, e, next) => (next.called ? next(e) : { deny: '[autopilot] ตัวตรวจ push ล้มเหลว จึงไม่รันคำสั่งนี้' }))

	on('prompt.submit', async ($, e, next) => {
		const ship = await read($, shipAtom)
		if (isActive(ship)) await save($, { ...ship, ours: isOurPrompt(e.text) })
		return next(e)
	})

	on('command.run', { command: 'ship' }, async ($, e) => {
		const arg = e.args.trim()
		const person = (e.origin as { kind?: string } | undefined)?.kind === 'composer'
		const ship = await read($, shipAtom)
		if (arg === 'status') {
			if (ship === null) return { text: 'ไม่มีงาน /ship' }
			const state = ship.status === 'waiting-person' ? 'รอผู้ใช้' : ship.status
			return { text: `${ship.issue} · ${ship.step} · ${state}\n${ship.log.slice(-5).join('\n')}` }
		}
		if (arg === 'stop') {
			await onStop($)
			return { text: 'หยุด /ship แล้ว' }
		}
		if (!person) return { text: 'ผู้ใช้ต้องพิมพ์ /ship เองที่ช่องพิมพ์ หรือกดปุ่ม' }
		if (arg === 'approve') return { text: await onApprove($) }
		if (arg === '') return { text: 'ใช้: /ship <issue หรือคำอธิบาย>' }
		if (isActive(ship)) return { text: `มีงาน /ship ค้างอยู่ (${ship.issue}) พิมพ์ /ship stop ก่อน` }
		const cwd = await $.session.cwd()
		const head = (await out($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd))?.trim()
		const fresh = startShip(arg, head !== undefined && head !== '' ? head : 'origin/main', reviewer)
		await kick($, fresh)
		await $.ui.open({ id: PANE, title: `ship · ${arg.slice(0, 30)}` })
		return { text: `เริ่ม /ship ${arg}` }
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		const ship = await read($, shipAtom)
		if (!isActive(ship) || ship.status !== 'running') return res
		const agentId = (e as unknown as { agentId?: string }).agentId

		// ผล reviewer
		if (agentId !== undefined) {
			if (agentId !== (await read($, reviewAgentAtom)) || ship.step !== 'review') return res
			const verdict = evaluate(ship, { review: { blocking: parseBlocking(e.answer) } })
			const moved = advance(ship, verdict)
			if (verdict === 'retry' && moved.status === 'running') {
				await save($, { ...moved, reviewPhase: 'fixing', stepStartedAt: await $.clock.now() })
				await handOff($, reviewFixPrompt(moved, e.answer))
				return res
			}
			await kick($, moved)
			return res
		}

		if (e.isAborted) {
			await save($, {
				...ship,
				ours: false,
				status: 'waiting-person',
				log: [...ship.log, `ผู้ใช้หยุดกลางขั้น ${ship.step}`],
			})
			return res
		}
		// เทิร์นที่ผู้ใช้เริ่มเองเรื่องอื่น ไม่นับเป็นผลของขั้น
		if (!ship.ours) return res
		const current = { ...ship, ours: false }

		if (current.step === 'review') {
			if (current.reviewPhase === 'fixing') await spawnReviewer($, current)
			return res
		}
		if (current.step === 'red-test' || current.step === 'proof') {
			await save($, { ...current, awaitingProof: true })
			return res
		}
		const ev = await evidence($, current, e.answer)
		const latest = (await read($, shipAtom)) ?? current
		await kick($, advance({ ...latest, ours: false }, evaluate(latest, ev)))
		return res
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const ship = await read($, shipAtom)
		if (ship === null || (ship.status !== 'waiting-person' && ship.status !== 'blocked')) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		return (
			<Box gap={1} borderStyle="round" borderColor={ship.status === 'blocked' ? 'error' : 'warning'} paddingX={1}>
				<Text wrap="wrap">
					autopilot · {ship.issue}: {ship.log.at(-1)}
				</Text>
				<Button
					key="approve"
					label={ship.step === 'open-pr' ? 'อนุมัติเปิด PR' : 'ทำต่อ'}
					variant="primary"
					onPress={() => onApprove($)}
				/>
				<Button key="stop" label="หยุด" onPress={() => onStop($)} />
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const ship = await read($, shipAtom)
		if (ship === null) return <Text dimColor>ไม่มีงาน /ship</Text>
		const index = STEPS.findIndex((s) => s.id === ship.step)
		const done = ship.status === 'done'
		return (
			<Box flexDirection="column">
				<Text bold>{ship.issue}</Text>
				{STEPS.map((s, i) => (
					<Text
						key={s.id}
						color={
							done || i < index
								? 'success'
								: i === index
									? ship.status === 'blocked'
										? 'error'
										: 'claude'
									: 'inactive'
						}
					>
						{done || i < index ? '✓' : i === index ? '▶' : '·'} {i + 1}. {s.title}
					</Text>
				))}
				<Text dimColor wrap="wrap">
					{ship.log.slice(-4).join(' · ')}
				</Text>
			</Box>
		)
	})
}
