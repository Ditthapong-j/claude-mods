import type { EnvRow, Pr } from './parse'

// จัดข้อมูลของ snapshot ให้พร้อมวาดเป็นการ์ดและตาราง (pure, เทสต์ได้)

export type Tone = 'success' | 'warning' | 'error' | 'inactive' | 'text'
export type Cell = { text: string; tone: Tone }

export function trunc(text: string, max: number): string {
	if (max <= 1) return text.slice(0, Math.max(0, max))
	return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

const CI_ORDER: Record<Pr['checks'], number> = { fail: 0, pending: 1, none: 2, pass: 3 }

function ciCell(p: Pr): Cell {
	if (p.checks === 'fail') return { text: `✗ ${p.checksPass}/${p.checksTotal}`, tone: 'error' }
	if (p.checks === 'pending') return { text: 'กำลังรัน', tone: 'warning' }
	if (p.checks === 'none') return { text: 'ไม่มี check', tone: 'inactive' }
	return { text: `✓ ${p.checksPass}/${p.checksTotal}`, tone: 'success' }
}

function reviewCell(p: Pr): Cell {
	if (p.review === 'approved') return { text: 'อนุมัติ', tone: 'success' }
	if (p.review === 'changes') return { text: 'ขอแก้', tone: 'error' }
	return { text: 'รอ', tone: 'inactive' }
}

export type PrRow = { num: number; title: string; ci: Cell; review: Cell }

// แดงก่อน แล้วกำลังรัน แล้วผ่าน; ภายในกลุ่มใหม่สุดก่อน
export function prRows(prs: readonly Pr[], limit: number): { rows: PrRow[]; more: number } {
	const sorted = [...prs].sort(
		(a, b) => CI_ORDER[a.checks] - CI_ORDER[b.checks] || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
	)
	return {
		rows: sorted.slice(0, limit).map((p) => ({ num: p.number, title: p.title, ci: ciCell(p), review: reviewCell(p) })),
		more: Math.max(0, sorted.length - limit),
	}
}

export type WorkRow = { name: string; branch: string; status: Cell }

function baseName(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1) || path
}

// worktree ที่เปิดอยู่ตรงนี้ + ตัวที่มีไฟล์ค้าง (มากสุดก่อน); ตัวที่สะอาดนับรวมเป็นตัวเลข
export function workRows(
	worktrees: readonly { path: string; branch: string | null; dirty: number }[],
	here: string | null,
	limit: number
): { rows: WorkRow[]; clean: number; more: number } {
	const current = worktrees.filter((w) => w.path === here)
	const dirty = worktrees.filter((w) => w.path !== here && w.dirty > 0).sort((a, b) => b.dirty - a.dirty)
	const shown = [...current, ...dirty]
	const rows = shown.slice(0, limit).map((w) => ({
		name: baseName(w.path),
		branch: w.branch ?? '(detached)',
		status:
			w.path === here
				? { text: 'ที่นี่', tone: 'success' as const }
				: { text: `ค้าง ${w.dirty} ไฟล์`, tone: 'warning' as const },
	}))
	return { rows, clean: worktrees.length - shown.length, more: Math.max(0, shown.length - limit) }
}

// ตาราง env × service (service ไม่ระบุ = คอลัมน์ "version")
export function envTable(envs: readonly EnvRow[]): { columns: string[]; rows: { env: string; cells: Cell[] }[] } {
	const columns: string[] = []
	const names: string[] = []
	for (const e of envs) {
		const col = e.service ?? 'version'
		if (!columns.includes(col)) columns.push(col)
		if (!names.includes(e.name)) names.push(e.name)
	}
	const rows = names.map((env) => ({
		env,
		cells: columns.map((col): Cell => {
			const hit = envs.find((e) => e.name === env && (e.service ?? 'version') === col)
			if (hit === undefined) return { text: '-', tone: 'inactive' }
			if (hit.problem !== null) return { text: hit.version ?? hit.problem, tone: 'error' }
			const text = hit.commit === null ? (hit.version ?? '-') : `${hit.version ?? '-'} · ${hit.commit}`
			return { text, tone: 'success' }
		}),
	}))
	return { columns, rows }
}

export type WaitingItem = { text: string; tone: 'error' | 'warning'; age: string | null }

function ageText(at: number | null, now: number): string | null {
	if (at === null) return null
	const minutes = Math.max(0, Math.round((now - at) / 60_000))
	if (minutes < 60) return `${minutes} นาที`
	const hours = Math.round(minutes / 60)
	return hours < 48 ? `${hours} ชม.` : `${Math.round(hours / 24)} วัน`
}

export function waitingItems(prs: readonly Pr[], envs: readonly EnvRow[], now: number): WaitingItem[] {
	const out: WaitingItem[] = []
	for (const p of prs) {
		if (p.checks === 'fail')
			out.push({ text: `PR #${p.number} ${p.title} · CI แดง`, tone: 'error', age: ageText(p.updatedAt, now) })
		if (p.review === 'changes') {
			out.push({
				text: `PR #${p.number} ${p.title} · ขอแก้จาก review`,
				tone: 'warning',
				age: ageText(p.updatedAt, now),
			})
		}
	}
	for (const e of envs) {
		if (e.problem !== null)
			out.push({
				text: `${e.name}${e.service === null ? '' : ` ${e.service}`} · ${e.problem}`,
				tone: 'warning',
				age: null,
			})
	}
	return out
}

export function layout(bodyColumns: number): 'two' | 'stack' {
	return bodyColumns >= 110 ? 'two' : 'stack'
}
