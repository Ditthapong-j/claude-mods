// prior-work: หาเลข issue ใน prompt และสรุปงานที่มีอยู่แล้ว (pure)

const MAX_IDS = 3

export function issueIds(text: string): string[] {
	const found = text.match(/\b[A-Z][A-Z0-9]+-\d+\b|(?<![\w&])#\d+\b/g) ?? []
	return [...new Set(found)].slice(0, MAX_IDS)
}

export function priorContext(
	id: string,
	prs: readonly { number: number; title: string; url: string }[],
	commits: readonly string[]
): string | null {
	if (prs.length === 0 && commits.length === 0) return null
	const lines = [`[prior-work] งานที่เกี่ยวกับ ${id} มีอยู่แล้ว เช็กก่อนเริ่มเพื่อไม่ทำซ้ำ:`]
	for (const p of prs) lines.push(`- PR #${p.number} (เปิดอยู่) ${p.title} ${p.url}`)
	for (const c of commits) lines.push(`- commit ${c}`)
	return lines.join('\n')
}
