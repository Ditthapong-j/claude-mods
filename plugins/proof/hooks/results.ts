export type ProofResult = {
	id: string
	label: string
	status: 'running' | 'pass' | 'fail' | 'flaky'
	exitCode: number | null
	tail: string
	at: number
	durationMs: number
}

export function statusLine(results: readonly ProofResult[]): string | undefined {
	if (results.length === 0) return undefined
	const n = (s: ProofResult['status']) => results.filter((r) => r.status === s).length
	const parts = [`${n('pass')} ✓`, `${n('fail')} ✗`]
	if (n('flaky') > 0) parts.push(`${n('flaky')} flaky`)
	if (n('running') > 0) parts.push(`รันอยู่ ${n('running')}`)
	return `proof: ${parts.join(' · ')}`
}

export function bandText(results: readonly ProofResult[]): string | undefined {
	const fails = results.filter((r) => r.status === 'fail').length
	const running = results.filter((r) => r.status === 'running').length
	if (fails > 0)
		return `Claude ปิดงานแล้ว แต่ยังมีคำสั่งพิสูจน์ที่ล้ม ${fails} ชุด${running > 0 ? ` (ยังรันอีก ${running})` : ''}`
	if (running > 0) return `Claude ปิดงานแล้ว แต่ยังรันคำสั่งพิสูจน์อยู่ ${running} ชุด`
	return undefined
}

export function continuePrompt(results: readonly ProofResult[]): string {
	const fails = results.filter((r) => r.status === 'fail')
	const body = fails.map((r) => `### ${r.label} (exit ${r.exitCode ?? '?'})\n\`\`\`\n${r.tail}\n\`\`\``).join('\n\n')
	return `คำสั่งพิสูจน์เหล่านี้ยังล้มหลังการแก้ล่าสุด แก้ให้ผ่านแล้วรันใหม่ยืนยัน:\n\n${body}`
}

export function settle(runs: readonly { exitCode: number }[]): 'pass' | 'fail' | 'flaky' {
	if (runs[0]?.exitCode === 0) return 'pass'
	return runs.slice(1).some((r) => r.exitCode === 0) ? 'flaky' : 'fail'
}
