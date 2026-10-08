// การตรวจและแปลง line ending (pure)

export function detectEol(text: string): 'crlf' | 'lf' | 'mixed' | 'none' {
	const crlf = (text.match(/\r\n/g) ?? []).length
	const lf = (text.match(/(?<!\r)\n/g) ?? []).length
	if (crlf === 0 && lf === 0) return 'none'
	if (crlf > 0 && lf > 0) return 'mixed'
	return crlf > 0 ? 'crlf' : 'lf'
}

export function toCrlf(text: string): string {
	return text.replace(/(?<!\r)\n/g, '\r\n')
}

// มี NUL = ไม่ใช่ไฟล์ข้อความ ไม่แตะ
export function looksBinary(text: string): boolean {
	return text.includes('\u0000')
}
