// long-run-watch: เกณฑ์ว่าคำสั่งไหน "นานผิดปกติ" (pure)

const KNOWN_SLOW = /\bgradlew?\b|\btestcontainers\b|\beas\s+build\b|\bdotnet\s+test\b|\bpod\s+install\b|\bxcodebuild\b/

const MIN_MS = 60_000
const DEFAULT_MS = 5 * 60_000
const SLOW_MS = 10 * 60_000

export function commandKey(command: string): string {
	const first = command.split(/&&|\|\||[;|&]/)[0] ?? command
	return first.trim().split(/\s+/).slice(0, 2).join(' ')
}

export function isKnownSlow(command: string): boolean {
	return KNOWN_SLOW.test(command)
}

// ยังไม่รู้ค่าเฉลี่ย: 5 นาที (คำสั่งที่รู้ว่าช้า 10 นาที); รู้แล้ว: 2 เท่าของค่าเฉลี่ย แต่ไม่ต่ำกว่า 1 นาที
export function thresholdMs(avgMs: number | undefined, knownSlow: boolean): number {
	if (avgMs === undefined) return knownSlow ? SLOW_MS : DEFAULT_MS
	return Math.max(MIN_MS, avgMs * 2)
}

export function nextAvg(prev: { avg: number; n: number } | undefined, ms: number): { avg: number; n: number } {
	if (prev === undefined) return { avg: ms, n: 1 }
	const n = Math.min(prev.n + 1, 50)
	return { avg: Math.round(prev.avg + (ms - prev.avg) / n), n }
}
