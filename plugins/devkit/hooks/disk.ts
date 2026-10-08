// disk-band: พื้นที่ว่างและ container ที่ค้าง (pure)

export function parseDfFreeGb(df: string): number | null {
	const line = df.trim().split('\n')[1]
	const avail = line?.trim().split(/\s+/)[3]
	if (avail === undefined || !/^\d+$/.test(avail)) return null
	return Math.floor(Number(avail) / 1024 / 1024)
}

export function diskAlert(
	s: { freeGb: number | null; containers: number },
	limits: { minFreeGb: number; maxContainers: number }
): string | null {
	const parts: string[] = []
	if (s.freeGb !== null && s.freeGb < limits.minFreeGb) parts.push(`ดิสก์เหลือ ${s.freeGb} GB`)
	if (s.containers > limits.maxContainers) parts.push(`container ของ testcontainers ค้าง ${s.containers} ตัว`)
	return parts.length === 0 ? null : `${parts.join(' · ')} · พิมพ์ /cleanup เพื่อดูรายการ`
}
