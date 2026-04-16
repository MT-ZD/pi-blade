const BASE = '/api';

function getToken(): string | null {
	if (typeof document === 'undefined') return null;
	const match = document.cookie.match(/(?:^|; )pi_blade_token=([^;]*)/);
	return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string | null) {
	if (typeof document === 'undefined') return;
	if (token) {
		document.cookie = `pi_blade_token=${encodeURIComponent(token)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict`;
	} else {
		document.cookie = 'pi_blade_token=; path=/; max-age=0';
	}
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
	const token = getToken();
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (token) headers['Authorization'] = `Bearer ${token}`;

	const res = await fetch(`${BASE}${path}`, { headers, ...opts });
	if (res.status === 401) {
		setToken(null);
		window.dispatchEvent(new CustomEvent('pi-blade-unauthorized'));
		throw new Error('unauthorized');
	}
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(err.error || res.statusText);
	}
	return res.json();
}

export const api = {
	auth: {
		status: () => request<{ enabled: boolean }>('/auth/status'),
		login: (password: string) => request<{ ok: boolean; token: string }>('/auth/login', {
			method: 'POST', body: JSON.stringify({ password })
		}),
		logout: () => request('/auth/logout', { method: 'POST' }),
		setPassword: (password: string) => request('/auth/password', {
			method: 'PUT', body: JSON.stringify({ password })
		})
	},
	blades: {
		list: () => request<any[]>('/blades'),
		remove: (id: number) => request('/blades/' + id, { method: 'DELETE' })
	},
	repos: {
		list: () => request<any[]>('/repos'),
		create: (data: any) => request('/repos', { method: 'POST', body: JSON.stringify(data) }),
		update: (id: number, data: any) =>
			request('/repos/' + id, { method: 'PUT', body: JSON.stringify(data) }),
		remove: (id: number) => request('/repos/' + id, { method: 'DELETE' }),
		generateKey: (id: number) =>
			request<{ publicKey: string }>('/repos/' + id + '/generate-key', { method: 'POST' }),
		getPublicKey: (id: number) =>
			request<{ publicKey: string }>('/repos/' + id + '/public-key'),
		branches: (id: number) => request<string[]>('/repos/' + id + '/branches'),
		test: (id: number) =>
			request<{ ok: boolean; error?: string }>('/repos/' + id + '/test'),
		detectProjects: (id: number, branch?: string) =>
			request<{ name: string; path: string; dockerfilePath: string }[]>(
				'/repos/' + id + '/detect-projects' + (branch ? '?branch=' + encodeURIComponent(branch) : ''))
	},
	projects: {
		list: () => request<any[]>('/projects'),
		get: (id: number) => request<any>('/projects/' + id),
		create: (data: any) =>
			request('/projects', { method: 'POST', body: JSON.stringify(data) }),
		update: (id: number, data: any) =>
			request('/projects/' + id, { method: 'PUT', body: JSON.stringify(data) }),
		remove: (id: number) => request('/projects/' + id, { method: 'DELETE' }),
		deploy: (id: number) =>
			request('/projects/' + id + '/deploy', { method: 'POST' }),
		addBlade: (projectId: number, bladeId: number, port: number) =>
			request('/projects/' + projectId + '/blades', {
				method: 'POST', body: JSON.stringify({ bladeId, port })
			}),
		updateBlade: (projectId: number, bladeId: number, port: number) =>
			request('/projects/' + projectId + '/blades/' + bladeId, {
				method: 'PUT', body: JSON.stringify({ port })
			}),
		removeBlade: (projectId: number, bladeId: number) =>
			request('/projects/' + projectId + '/blades/' + bladeId, { method: 'DELETE' })
	},
	routes: {
		list: () => request<any[]>('/routes'),
		create: (data: any) =>
			request('/routes', { method: 'POST', body: JSON.stringify(data) }),
		remove: (id: number) => request('/routes/' + id, { method: 'DELETE' }),
		addUpstream: (routeId: number, data: any) =>
			request('/routes/' + routeId + '/upstreams', {
				method: 'POST',
				body: JSON.stringify(data)
			}),
		removeUpstream: (id: number) => request('/upstreams/' + id, { method: 'DELETE' })
	},
	projectVars: {
		list: (projectId: number) => request<any[]>('/projects/' + projectId + '/vars'),
		add: (projectId: number, data: { key: string; value: string; scope?: string }) =>
			request('/projects/' + projectId + '/vars', {
				method: 'POST',
				body: JSON.stringify(data)
			}),
		update: (id: number, data: any) =>
			request('/project-vars/' + id, { method: 'PUT', body: JSON.stringify(data) }),
		remove: (id: number) => request('/project-vars/' + id, { method: 'DELETE' })
	},
	deploys: {
		list: () => request<any[]>('/deploys'),
		byProject: (id: number) => request<any[]>('/deploys/project/' + id)
	},
	alerts: {
		list: () => request<any[]>('/alerts'),
		remove: (id: number) => request('/alerts/' + id, { method: 'DELETE' }),
		clearAll: () => request('/alerts', { method: 'DELETE' })
	},
	metrics: {
		all: () => request<Record<string, any>>('/metrics'),
		history: (bladeId: number, hours = 168) =>
			request<any[]>('/blades/' + bladeId + '/metrics-history?hours=' + hours)
	},
	rollback: (data: { projectId: number; bladeId: number; imageTag: string }) =>
		request('/rollback', { method: 'POST', body: JSON.stringify(data) }),
	nginx: {
		reload: () => request('/nginx/reload', { method: 'POST' })
	},
	version: () => request<{ version: string; short: string }>('/version'),
	discord: {
		get: () => request<{ url: string }>('/settings/discord-webhook'),
		set: (url: string) =>
			request('/settings/discord-webhook', {
				method: 'PUT',
				body: JSON.stringify({ url })
			})
	}
};
