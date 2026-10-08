import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PluginRowState } from '../types'
import { disableCommand, parseInstalled, parseRulesTool, pluginRow } from './view'

const pluginsAtom = atom({ plugin: 'manager', key: 'plugins' } as const, [] as PluginRowState[])
const viewAtom = atom(
	{ plugin: 'manager', key: 'view' } as const,
	null as { plugins: PluginRowState[]; rules: ReturnType<typeof parseRulesTool>; proof: string } | null
)
const PANE = 'mods'

async function collect(
	$: EngineInterface
): Promise<{ plugins: PluginRowState[]; rules: ReturnType<typeof parseRulesTool>; proof: string }> {
	const seen = await read($, pluginsAtom)
	let plugins: PluginRowState[] = seen
	try {
		const res = await $.process.run(['claude', 'plugin', 'list', '--json'], { timeoutMs: 10_000 })
		const installed = res.exitCode === 0 ? parseInstalled(res.stdout) : { error: res.stderr }
		if (!('error' in installed)) plugins = [...installed, ...seen.filter((s) => !installed.some((i) => i.name === s.name))]
	} catch {
		plugins = seen
	}
	const rules = parseRulesTool(await $.tool.call({ tool: 'mcp__forge__rules' }))
	const proofRes = await $.tool.call({ tool: 'mcp__proof__status' })
	const proof = proofRes.deny !== undefined ? 'proof: ไม่ได้ติดตั้ง' : `proof: ${String(proofRes.text ?? proofRes.result ?? '')}`
	return { plugins, rules, proof }
}

// เก็บผลไว้ใน atom: การวาด pane อ่าน atom อย่างเดียว ไม่เรียก CLI ทุกครั้งที่วาดใหม่
async function refreshView($: EngineInterface): Promise<NonNullable<Awaited<ReturnType<typeof collect>>>> {
	const view = await collect($)
	await update($, viewAtom, () => view)
	return view
}

async function toggle($: EngineInterface, id: string, enabled: boolean): Promise<void> {
	await $.command.run({ command: 'lessons', args: `${enabled ? 'disable' : 'enable'} ${id}` })
	await refreshView($)
}

export const register: Register = (on) => {
	on('plugin.register', async ($, e, next) => {
		const res = await next(e)
		const row = pluginRow({ name: e.name, version: e.version, provenance: e.provenance, root: e.root })
		await update($, pluginsAtom, (l) => [...l.filter((p) => p.name !== row.name), row])
		return res
	})

	on('session.start', async ($, e, next) => {
		const res = await next(e)
		await $.command.register({ name: 'mods', description: 'ดู plugin ที่โหลด, กฎของ forge และสถานะ proof · text' })
		return res
	})

	on('command.run', { command: 'mods' }, async ($, e) => {
		const { plugins, rules, proof } = await refreshView($)
		if (e.args.trim() !== 'text') {
			await $.ui.open({ id: PANE, title: 'Mods' })
			return { text: 'เปิด /mods แล้ว' }
		}
		const lines = [
			`plugins (${plugins.length}):`,
			...plugins.map((p) => `  ${p.isSuite ? '★' : ' '} ${p.provenance} ${p.version ?? ''} · ${p.root}`),
		]
		lines.push(
			'forge:',
			...('error' in rules
				? [`  ${rules.error}`]
				: rules.rules.map((r) => `  ${r.enabled ? '●' : '○'} ${r.id} (${r.source}) · ${r.hits30}/30 วัน`))
		)
		lines.push(proof)
		return { text: lines.join('\n') }
	})

	on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
		const { Box, Button, Text } = $.ui.resolve(e)
		const view = await read($, viewAtom)
		if (view === null) return <Text dimColor>พิมพ์ /mods เพื่อโหลดข้อมูล</Text>
		const { plugins, rules, proof } = view
		return (
			<Box flexDirection="column" gap={1}>
				<Box flexDirection="column">
					<Text bold color="claude">
						Plugins · {plugins.length}
					</Text>
					{plugins.map((p) => (
						<Box key={p.name} gap={1}>
							<Text>
								{p.isSuite ? '★' : ' '} {p.provenance}
							</Text>
							<Text dimColor>{p.version ?? ''}</Text>
							<Button
								key={`copy-${p.name}`}
								label="คัดลอกคำสั่งปิด"
								plain
								onPress={() => $.ui.copy({ text: disableCommand(p) })}
							/>
						</Box>
					))}
				</Box>
				<Box flexDirection="column">
					<Text bold color="claude">
						กฎของ forge
					</Text>
					{'error' in rules ? (
						<Text color="error">{rules.error}</Text>
					) : (
						rules.rules.map((r) => (
							<Box key={r.id} gap={1}>
								<Text color={r.enabled ? 'success' : 'inactive'}>
									{r.enabled ? '●' : '○'} {r.id}
								</Text>
								<Text dimColor>
									{r.source} · {r.hits30}/30 วัน
								</Text>
								{r.source.startsWith('personal') && (
									<Button
										key={`t-${r.id}`}
										label={r.enabled ? 'ปิด' : 'เปิด'}
										plain
										onPress={() => toggle($, r.id, r.enabled)}
									/>
								)}
							</Box>
						))
					)}
				</Box>
				<Text dimColor wrap="wrap">
					{proof}
				</Text>
				<Text dimColor>error ของ plugin อื่นดูได้ด้วย claude --debug (engine ไม่ส่งให้ plugin)</Text>
			</Box>
		)
	})
}
