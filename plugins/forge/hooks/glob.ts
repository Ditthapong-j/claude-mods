const SPECIAL = /[.+^${}()|[\]\\]/g

export function globToRegExp(glob: string): RegExp {
	let out = ''
	for (let i = 0; i < glob.length; i++) {
		const c = glob.charAt(i)
		if (c === '*') {
			if (glob.charAt(i + 1) === '*') {
				out += '.*'
				i++
				if (glob.charAt(i + 1) === '/') i++
			} else {
				out += '[^/]*'
			}
		} else if (c === '?') {
			out += '[^/]'
		} else {
			out += c.replace(SPECIAL, '\\$&')
		}
	}
	return new RegExp(`^${out}$`)
}
