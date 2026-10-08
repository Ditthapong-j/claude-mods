import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ShipState } from '../types'
import { advance, evaluate, STEPS, startShip, stepPrompt } from './steps'
import type { Evidence, Ship } from './steps'

const shipAtom = atom({ plugin: 'autopilot', key: 'ship' } as const, null as ShipState | null)
const reviewAgentAtom = atom({ plugin: 'autopilot', key: 'reviewAgent' } as const, null as string | null)
const reviewAnswerAtom = atom({ plugin: 'autopilot', key: 'reviewAnswer' } as const, null as string | null)
const PANE = 'ship'
const T = 5000

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

async function evidence($: EngineInterface, ship: Ship, answer: string): Promise<Evidence> {
	const cwd = await $.session.cwd()
	if (ship.step === 'understand') {
		const prs = await out(
			$,
			['gh', 'pr', 'list', '--state', 'open', '--search', issueTerms(ship.issue), '--json', 'number,title'],
			cwd
		)
		const list = prs === null ? [] : (JSON.parse(prs) as { number: number; title: string }[])
		return { duplicates: list.map((p) => `PR #${p.number} ${p.title}`) }
	}
	if (ship.step === 'worktree') {
		const m = /branch[^\n`]*?[`"]?([\w./-]+\/[\w.-]+)[`"]?/i.exec(answer)
		const branch = m?.[1] ?? null
		const list = await out($, ['git', 'worktree', 'list', '--porcelain'], cwd)
		const has = branch !== null && list !== null && list.includes(`branch refs/heads/${branch}`)
		await update($, shipAtom, (s) => (s === null ? s : { ...s, branch }))
		return { worktreeBranch: has ? branch : null }
	}
	if (ship.step === 'red-test' || ship.step === 'proof') {
		const res = await $.tool.call({ tool: 'mcp__proof__status' })
		const text = String(res.text ?? res.result ?? '{}')
		let results: { status: string }[] = []
		try {
			results = (JSON.parse(text) as { results?: { status: string }[] }).results ?? []
		} catch {
			results = []
		}
		const fail = results.filter((r) => r.status === 'fail').length
		return {
			proof: {
				fail,
				pass: results.filter((r) => r.status === 'pass').length,
				running: results.filter((r) => r.status === 'running').length,
				newFailing: fail > 0,
			},
		}
	}
	if (ship.step === 'review') {
		const review = (await read($, reviewAnswerAtom)) ?? ''
		return { review: { blocking: (review.match(/\b(P0|P1|Critical|Important)\b/g) ?? []).length } }
	}
	return {}
}

// S1b: prompt.submit ใช้ได้จาก turn.complete แต่ host ปฏิเสธใน command.run/tool.call → ใส่ช่องพิมพ์ให้ผู้ใช้กด Enter
async function handOff($: EngineInterface, text: string): Promise<void> {
	try {
		await $.prompt.submit({ text })
	} catch {
		await $.prompt.fill({ text, mode: 'replace' })
		void $.ui.toast('autopilot: กด Enter เพื่อเริ่มขั้นนี้')
	}
}

async function kick($: EngineInterface, ship: Ship): Promise<void> {
	await update($, shipAtom, () => ship)
	if (ship.status !== 'running') {
		if (ship.status === 'blocked' || ship.status === 'waiting-person')
			void $.ui.toast(`autopilot: ${ship.log.at(-1) ?? ''}`)
		return
	}
	if (ship.step === 'review') {
		await update($, reviewAnswerAtom, () => null)
		const spawned = await $.agent.spawn({
			prompt: `Review the current branch against ${ship.baseBranch} for: ${ship.issue}. List findings with P0/P1/P2 labels.`,
			description: 'autopilot review',
			subagentType: ship.reviewer,
		})
		if ('agentId' in spawned) await update($, reviewAgentAtom, () => String(spawned.agentId))
		return
	}
	await handOff($, stepPrompt(ship))
}

export const register: Register = (on, options) => {
	const reviewer = typeof options['reviewer'] === 'string' ? options['reviewer'] : 'code-review'

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({ name: 'ship', description: 'Autopilot: /ship <issue> · status · stop · approve' })
		return res
	})

	on('command.run', { command: 'ship' }, async ($, e) => {
		const arg = e.args.trim()
		const person = (e.origin as { kind?: string } | undefined)?.kind === 'composer'
		const ship = await read($, shipAtom)
		if (arg === 'status')
			return {
				text:
					ship === null
						? 'ไม่มีงาน /ship'
						: `${ship.issue} · ${ship.step} · ${ship.status === 'waiting-person' ? 'รอผู้ใช้' : ship.status}\n${ship.log.slice(-5).join('\n')}`,
			}
		if (arg === 'stop') {
			if (ship !== null)
				await update($, shipAtom, () => ({ ...ship, status: 'stopped', log: [...ship.log, 'หยุดโดยผู้ใช้'] }))
			return { text: 'หยุด /ship แล้ว' }
		}
		if (arg === 'approve') {
			if (!person) return { text: 'ผู้ใช้ต้องพิมพ์เองหรือกดปุ่มอนุมัติ' }
			if (ship === null || ship.status !== 'waiting-person') return { text: 'ไม่มีขั้นที่รออนุมัติ' }
			const resumed = { ...ship, status: 'running' as const, log: [...ship.log, `ผู้ใช้อนุมัติขั้น ${ship.step}`] }
			await update($, shipAtom, () => resumed)
			await handOff($, stepPrompt(resumed))
			return { text: 'อนุมัติแล้ว' }
		}
		if (arg === '') return { text: 'ใช้: /ship <issue หรือคำอธิบาย>' }
		if (ship !== null && (ship.status === 'running' || ship.status === 'waiting-person'))
			return { text: `มีงาน /ship ค้างอยู่ (${ship.issue}) พิมพ์ /ship stop ก่อน` }
		const base =
			(await out($, ['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], await $.session.cwd()))?.trim() ||
			'origin/develop'
		const fresh = startShip(arg, base, reviewer)
		await kick($, fresh)
		await $.ui.open({ id: PANE, title: `ship · ${arg.slice(0, 30)}` })
		return { text: `เริ่ม /ship ${arg}` }
	})

	on('turn.complete', async ($, e, next) => {
		const res = await next(e)
		const ship = await read($, shipAtom)
		if (ship === null || ship.status !== 'running') return res
		const agentId = (e as unknown as { agentId?: string }).agentId
		const reviewAgent = await read($, reviewAgentAtom)
		if (agentId !== undefined) {
			if (agentId !== reviewAgent) return res
			await update($, reviewAnswerAtom, () => e.answer)
		}
		const ev = await evidence($, ship, e.answer)
		const current = (await read($, shipAtom)) ?? ship
		await kick($, advance(current, evaluate(current, ev)))
		return res
	})

	on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
		const ship = await read($, shipAtom)
		if (ship === null || (ship.status !== 'waiting-person' && ship.status !== 'blocked')) return next(e)
		const { Box, Button, Text } = $.ui.resolve(e)
		const approve = async () => {
			const s = await read($, shipAtom)
			if (s === null || s.status !== 'waiting-person') return
			const resumed = { ...s, status: 'running' as const, log: [...s.log, `ผู้ใช้อนุมัติขั้น ${s.step}`] }
			await update($, shipAtom, () => resumed)
			await handOff($, stepPrompt(resumed))
		}
		return (
			<Box gap={1} borderStyle="round" borderColor={ship.status === 'blocked' ? 'error' : 'warning'} paddingX={1}>
				<Text wrap="wrap">
					autopilot · {ship.issue}: {ship.log.at(-1)}
				</Text>
				{ship.status === 'waiting-person' && (
					<Button key="approve" label="อนุมัติ" variant="primary" onPress={approve} />
				)}
				<Button
					key="stop"
					label="หยุด"
					onPress={() =>
						update($, shipAtom, () => ({ ...ship, status: 'stopped', log: [...ship.log, 'หยุดโดยผู้ใช้'] }))
					}
				/>
			</Box>
		)
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Text } = $.ui.resolve(e)
		const ship = await read($, shipAtom)
		if (ship === null) return <Text dimColor>ไม่มีงาน /ship</Text>
		const index = STEPS.findIndex((s) => s.id === ship.step)
		return (
			<Box flexDirection="column">
				<Text bold>{ship.issue}</Text>
				{STEPS.map((s, i) => (
					<Text
						key={s.id}
						color={i < index ? 'success' : i === index ? (ship.status === 'blocked' ? 'error' : 'claude') : 'inactive'}
					>
						{i < index ? '✓' : i === index ? '▶' : '·'} {i + 1}. {s.title}
					</Text>
				))}
				<Text dimColor wrap="wrap">
					{ship.log.slice(-4).join(' · ')}
				</Text>
			</Box>
		)
	})
}
