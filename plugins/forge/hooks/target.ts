// หา folder ที่คำสั่ง Bash จะทำงานจริง เพื่อโหลดกฎของ repo ปลายทาง ไม่ใช่ของ repo ที่ session เปิดอยู่
// รองรับ `cd <path> && …` / `cd <path>; …` ที่ต้นคำสั่ง และ `git -C <path> …` ที่ต้นคำสั่ง
// คืน undefined เมื่อไม่มีหรืออ่าน path ไม่ได้ (เช่นมีตัวแปรอื่นนอกจาก $HOME) → ใช้ cwd ของ session ตามเดิม

function unquote(token: string): string | undefined {
	const m = /^(["'])(.*)\1$/.exec(token)
	return m === null ? token : m[2]
}

export function needsHome(command: string): boolean {
	return /^\s*(?:cd|git\s+-C)\s+["']?(?:~|\$HOME\b|\$\{HOME\})/.test(command)
}

function resolve(raw: string, cwd: string, home: string | undefined): string | undefined {
	let path = unquote(raw)
	if (path === undefined || path === '' || path === '-') return undefined
	if (path === '~' || path.startsWith('~/')) {
		if (home === undefined) return undefined
		path = home + path.slice(1)
	} else if (/^\$(?:HOME\b|\{HOME\})/.test(path)) {
		if (home === undefined) return undefined
		path = path.replace(/^\$(?:HOME|\{HOME\})/, home)
	}
	if (/[$`*?]/.test(path)) return undefined
	if (!path.startsWith('/')) path = `${cwd.replace(/\/+$/, '')}/${path}`
	// ทำ . และ .. ให้เป็น path จริง
	const parts: string[] = []
	for (const part of path.split('/')) {
		if (part === '' || part === '.') continue
		if (part === '..') parts.pop()
		else parts.push(part)
	}
	return `/${parts.join('/')}`
}

const PATH = `("[^"]*"|'[^']*'|[^\\s;&|]+)`
const LEADING_CD = new RegExp(`^\\s*cd\\s+${PATH}\\s*(?:&&|;)`)
const LEADING_GIT_C = new RegExp(`^\\s*git\\s+-C\\s+${PATH}\\s`)

export function commandDir(command: string, cwd: string, home: string | undefined): string | undefined {
	const m = LEADING_CD.exec(command) ?? LEADING_GIT_C.exec(command)
	const raw = m?.[1]
	return raw === undefined ? undefined : resolve(raw, cwd, home)
}
