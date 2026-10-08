// prior-work: หาเลข issue ใน prompt และสรุปงานที่มีอยู่แล้ว (pure)

const MAX_IDS = 3

// คำที่หน้าตาเหมือนเลข ticket แต่เป็นชื่อมาตรฐาน (UTF-8, SHA-256, ...)
const NOT_TICKET = /^(?:UTF|SHA|ISO|ES|HTTP|TLS|SSL|RFC|IPV|MD|AES|RSA|CVE|X|H|P|U|PR)-/

export function issueIds(text: string): string[] {
	// #123 ที่ตามหลัง ":" หรือตามด้วย ";" คือสีใน CSS ไม่ใช่เลข PR
	const found = text.match(/\b[A-Z][A-Z0-9]+-\d+\b|(?<![\w&]|:\s*)#\d+\b(?!;)/g) ?? []
	return [...new Set(found.filter((id) => !NOT_TICKET.test(id)))].slice(0, MAX_IDS)
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
