export type StepId = 'understand' | 'worktree' | 'red-test' | 'fix' | 'proof' | 'review' | 'open-pr'

export type Ship = {
	issue: string
	baseBranch: string
	branch: string | null
	step: StepId
	attempts: number
	status: 'running' | 'waiting-person' | 'blocked' | 'done' | 'stopped'
	log: string[]
	reviewer: string
	// เวลาเริ่มขั้นปัจจุบัน: หลักฐานของ proof ต้องใหม่กว่านี้
	stepStartedAt: number
	// push / gh pr create ทำได้หลังผู้ใช้อนุมัติขั้นเปิด PR เท่านั้น
	pushApproved: boolean
	// เทิร์นที่กำลังรันเป็นของ autopilot (prompt ขึ้นต้นด้วย [autopilot ·)
	ours: boolean
	// ขั้น review: รอผล reviewer หรือรอ Claude แก้ตามผล
	reviewPhase: 'reviewing' | 'fixing' | null
	// ขั้น red-test / proof: รอ proof รันจบก่อนตัดสิน
	awaitingProof: boolean
}

export type ProofEvidence = { fresh: { status: string }[] } | null

export type Evidence = {
	duplicates?: string[]
	worktreeBranch?: string | null
	proof?: ProofEvidence
	review?: { blocking: number | null }
	approved?: boolean
}

export const MAX_ATTEMPTS = 3

export const STEPS: readonly { id: StepId; title: string }[] = [
	{ id: 'understand', title: 'อ่าน issue และเช็กงานซ้ำ' },
	{ id: 'worktree', title: 'สร้าง worktree จากฐาน' },
	{ id: 'red-test', title: 'เขียนเทสต์ที่ต้องล้มก่อน' },
	{ id: 'fix', title: 'แก้โค้ด' },
	{ id: 'proof', title: 'Proof Gate' },
	{ id: 'review', title: 'review' },
	{ id: 'open-pr', title: 'จุดอนุมัติ: เปิด PR' },
]

const PREFIX = '[autopilot ·'

export function startShip(issue: string, baseBranch: string, reviewer: string, now = 0): Ship {
	return {
		issue,
		baseBranch,
		branch: null,
		step: 'understand',
		attempts: 0,
		status: 'running',
		log: [`เริ่ม /ship ${issue}`],
		reviewer,
		stepStartedAt: now,
		pushApproved: false,
		ours: false,
		reviewPhase: null,
		awaitingProof: false,
	}
}

export function isActive(ship: Ship | null): ship is Ship {
	return ship !== null && (ship.status === 'running' || ship.status === 'waiting-person' || ship.status === 'blocked')
}

export function isOurPrompt(text: string): boolean {
	return text.trimStart().startsWith(PREFIX)
}

function head(ship: Ship): string {
	return `${PREFIX} ${ship.issue} · ขั้น ${STEPS.findIndex((s) => s.id === ship.step) + 1}/${STEPS.length}]`
}

export function stepPrompt(ship: Ship): string {
	const h = head(ship)
	switch (ship.step) {
		case 'understand':
			return `${h} อ่านงานนี้: ${ship.issue}\nถ้าเป็น GitHub issue ให้ gh issue view; เช็กงานซ้ำด้วย gh pr list --search และ git log ${ship.baseBranch} --grep สรุปสิ่งที่ต้องแก้สั้นๆ และบอกว่ามีงานซ้ำไหม ห้ามแก้โค้ดในขั้นนี้`
		case 'worktree':
			return `${h} สร้าง worktree และ branch ใหม่จาก ${ship.baseBranch} สำหรับงานนี้ (ชื่อ branch ตาม convention ของ repo) แล้วจบคำตอบด้วยบรรทัด BRANCH: <ชื่อ branch>`
		case 'red-test':
			return `${h} เขียนเทสต์ที่จำลองปัญหาและต้องล้มก่อนแก้ แล้วรันให้เห็นว่าล้มด้วยเหตุผลที่ถูก ห้ามแก้โค้ดจริงในขั้นนี้`
		case 'fix':
			return `${h} แก้โค้ดให้น้อยที่สุดจนเทสต์ใหม่ผ่าน`
		case 'proof':
			return `${h} ตรวจผล proof ให้ผ่านทั้งหมด ถ้ามีคำสั่งพิสูจน์ล้มให้แก้จนผ่าน`
		case 'review':
			return `${h} แก้ปัญหาที่ reviewer พบ`
		case 'open-pr':
			return `${h} ผู้ใช้อนุมัติแล้ว: commit, push และเปิด PR เข้า ${ship.baseBranch.replace(/^origin\//, '')} ตาม template ของ repo`
	}
}

export function reviewerPrompt(ship: Ship): string {
	return `Review the changes on the current branch against ${ship.baseBranch} for: ${ship.issue}. List each finding with a P0/P1/P2/P3 label. End your answer with exactly one line: BLOCKING: <number of P0 and P1 findings>`
}

export function reviewFixPrompt(ship: Ship, findings: string): string {
	return `${head(ship)} reviewer พบปัญหาที่ต้องแก้ (P0/P1) แก้ให้ครบ:\n\n${findings.slice(0, 6000)}`
}

export function parseBlocking(answer: string): number | null {
	const m = /^\s*BLOCKING:\s*(\d+)\s*$/m.exec(answer)
	return m === null ? null : Number(m[1])
}

export function parseBranch(answer: string): string | null {
	const m = /^\s*BRANCH:\s*`?([\w./-]+)`?\s*$/m.exec(answer)
	return m?.[1] ?? null
}

export function evaluate(ship: Ship, ev: Evidence): 'pass' | 'retry' | 'needs-person' {
	switch (ship.step) {
		case 'understand':
			return (ev.duplicates ?? []).length > 0 ? 'needs-person' : 'pass'
		case 'worktree':
			return ev.worktreeBranch !== undefined && ev.worktreeBranch !== null && ev.worktreeBranch === ship.branch
				? 'pass'
				: 'retry'
		case 'red-test':
			if (ev.proof === undefined || ev.proof === null) return 'needs-person'
			return ev.proof.fresh.some((r) => r.status === 'fail') ? 'pass' : 'retry'
		case 'fix':
			return 'pass'
		case 'proof':
			if (ev.proof === undefined || ev.proof === null) return 'needs-person'
			if (ev.proof.fresh.length === 0) return 'retry'
			return ev.proof.fresh.every((r) => r.status === 'pass' || r.status === 'flaky') ? 'pass' : 'retry'
		case 'review':
			if (ev.review === undefined || ev.review.blocking === null) return 'needs-person'
			return ev.review.blocking === 0 ? 'pass' : 'retry'
		case 'open-pr':
			return ev.approved === true ? 'pass' : 'needs-person'
	}
}

export function advance(ship: Ship, verdict: 'pass' | 'retry' | 'needs-person'): Ship {
	const title = STEPS.find((s) => s.id === ship.step)?.title ?? ship.step
	const base = { ...ship, ours: false, awaitingProof: false }
	if (verdict === 'needs-person') {
		return { ...base, status: 'waiting-person', log: [...ship.log, `รอผู้ใช้ที่ขั้น ${ship.step}: ${title}`] }
	}
	if (verdict === 'retry') {
		const attempts = ship.attempts + 1
		if (attempts >= MAX_ATTEMPTS) {
			return {
				...base,
				attempts,
				status: 'blocked',
				log: [...ship.log, `ติดที่ขั้น ${ship.step} (${title}) หลังลอง ${attempts} รอบ`],
			}
		}
		return { ...base, attempts, log: [...ship.log, `ลองขั้น ${ship.step} อีกครั้ง (${attempts}/${MAX_ATTEMPTS})`] }
	}
	const index = STEPS.findIndex((s) => s.id === ship.step)
	const next = STEPS[index + 1]
	if (next === undefined) return { ...base, status: 'done', log: [...ship.log, 'เสร็จ'] }
	return {
		...base,
		step: next.id,
		attempts: 0,
		reviewPhase: null,
		status: next.id === 'open-pr' ? 'waiting-person' : 'running',
		log: [...ship.log, `ผ่าน: ${title}`],
	}
}

// ผู้ใช้กดอนุมัติ: ขั้น 1 ที่มีงานซ้ำ = ยืนยันว่าทำต่อ; ขั้นเปิด PR = อนุญาต push; ขั้นอื่นที่รอผู้ใช้ = ลองขั้นเดิมอีกครั้ง
export function approve(ship: Ship): Ship {
	if (ship.step === 'understand') return advance({ ...ship, status: 'running' }, 'pass')
	if (ship.step === 'open-pr') {
		return { ...ship, status: 'running', pushApproved: true, log: [...ship.log, 'ผู้ใช้อนุมัติเปิด PR'] }
	}
	return { ...ship, status: 'running', attempts: 0, log: [...ship.log, `ผู้ใช้ให้ลองขั้น ${ship.step} ต่อ`] }
}
