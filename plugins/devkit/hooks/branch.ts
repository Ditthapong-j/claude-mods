// branch-watch + usage-meter: ข้อความ status line และการแยกว่า Claude เป็นคนสลับ branch เอง (pure)

// git checkout <branch> / git switch ... ในท่อนไหนของคำสั่งก็ได้; checkout -- <file> คือการกู้ไฟล์ ไม่ใช่สลับ branch
export function isClaudeSwitch(command: string): boolean {
	return command
		.split(/&&|\|\||[;|&]/)
		.map((s) => s.trim())
		.some((s) => /^(?:\w+=\S*\s+)*git\s+(?:-C\s+\S+\s+)?(?:switch\b|checkout\b(?!\s+--(?:\s|$)))/.test(s))
}

export function statusText(s: {
	branch: string | null
	behind: number | null
	dirty: number | null
	ctxPercent: number | null
}): string | undefined {
	const parts: string[] = []
	if (s.branch !== null) {
		let head = s.branch
		if (s.behind !== null && s.behind > 0) head += ` ↓${s.behind}`
		parts.push(head)
		if (s.dirty !== null && s.dirty > 0) parts.push(`ค้าง ${s.dirty}`)
	}
	if (s.ctxPercent !== null) parts.push(`ctx ${Math.round(s.ctxPercent)}%`)
	return parts.length === 0 ? undefined : parts.join(' · ')
}
