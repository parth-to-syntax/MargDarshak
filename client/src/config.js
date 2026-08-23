const fromEnv = import.meta.env.VITE_API_URL || 'http://localhost:8000'

let fromStorage = ''
if (typeof window !== 'undefined') {
	fromStorage = window.localStorage.getItem('MARGDARSHAK_API_BASE_URL') || ''
}

export const API_BASE_URL = fromStorage || fromEnv