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
}

export type Evidence = {
	duplicates?: string[]
	worktreeBranch?: string | null
	proof?: { fail: number; pass: number; running: number; newFailing: boolean }
	review?: { blocking: number }
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

export function startShip(issue: string, baseBranch: string, reviewer: string): Ship {
	return {
		issue,
		baseBranch,
		branch: null,
		step: 'understand',
		attempts: 0,
		status: 'running',
		log: [`เริ่ม /ship ${issue}`],
		reviewer,
	}
}

export function stepPrompt(ship: Ship): string {
	const head = `[autopilot · ${ship.issue} · ขั้น ${STEPS.findIndex((s) => s.id === ship.step) + 1}/${STEPS.length}]`
	switch (ship.step) {
		case 'understand':
			return `${head} อ่านงานนี้: ${ship.issue}\nถ้าเป็น GitHub issue ให้ gh issue view; เช็กงานซ้ำด้วย gh pr list --search และ git log ${ship.baseBranch} --grep สรุปสิ่งที่ต้องแก้สั้นๆ และบอกว่ามีงานซ้ำไหม ห้ามแก้โค้ดในขั้นนี้`
		case 'worktree':
			return `${head} สร้าง worktree และ branch ใหม่จาก ${ship.baseBranch} สำหรับงานนี้ (ชื่อ branch ตาม convention ของ repo) แล้วบอกชื่อ branch`
		case 'red-test':
			return `${head} เขียนเทสต์ที่จำลองปัญหาและต้องล้มก่อนแก้ แล้วรันให้เห็นว่าล้มด้วยเหตุผลที่ถูก ห้ามแก้โค้ดจริงในขั้นนี้`
		case 'fix':
			return `${head} แก้โค้ดให้น้อยที่สุดจนเทสต์ใหม่ผ่าน`
		case 'proof':
			return `${head} รอ proof ให้รันจบ ถ้ามีคำสั่งพิสูจน์ล้มให้แก้จนผ่านทั้งหมด`
		case 'review':
			return `${head} reviewer ${ship.reviewer} พบปัญหาที่ต้องแก้ (P0/P1) แก้ให้ครบ`
		case 'open-pr':
			return `${head} ผู้ใช้อนุมัติแล้ว: commit, push และเปิด PR เข้า ${ship.baseBranch.replace(/^origin\//, '')} ตาม template ของ repo`
	}
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
			return ev.proof?.newFailing === true ? 'pass' : 'retry'
		case 'fix':
			return 'pass'
		case 'proof':
			return ev.proof !== undefined && ev.proof.fail === 0 && ev.proof.running === 0 ? 'pass' : 'retry'
		case 'review':
			return ev.review !== undefined && ev.review.blocking === 0 ? 'pass' : 'retry'
		case 'open-pr':
			return 'needs-person'
	}
}

export function advance(ship: Ship, verdict: 'pass' | 'retry' | 'needs-person'): Ship {
	const title = STEPS.find((s) => s.id === ship.step)?.title ?? ship.step
	if (verdict === 'needs-person')
		return { ...ship, status: 'waiting-person', log: [...ship.log, `รอผู้ใช้ที่ขั้น ${ship.step}: ${title}`] }
	if (verdict === 'retry') {
		const attempts = ship.attempts + 1
		if (attempts >= MAX_ATTEMPTS)
			return {
				...ship,
				attempts,
				status: 'blocked',
				log: [...ship.log, `ติดที่ขั้น ${ship.step} (${title}) หลังลอง ${attempts} รอบ`],
			}
		return { ...ship, attempts, log: [...ship.log, `ลองขั้น ${ship.step} อีกครั้ง (${attempts}/${MAX_ATTEMPTS})`] }
	}
	const index = STEPS.findIndex((s) => s.id === ship.step)
	const next = STEPS[index + 1]
	if (next === undefined) return { ...ship, status: 'done', log: [...ship.log, 'เสร็จ'] }
	return {
		...ship,
		step: next.id,
		attempts: 0,
		status: next.id === 'open-pr' ? 'waiting-person' : 'running',
		log: [...ship.log, `ผ่าน: ${title}`],
	}
}
