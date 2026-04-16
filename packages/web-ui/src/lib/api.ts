const BASE = '/api';

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
	const res = await fetch(`${BASE}${path}`, {
		headers: { 'Content-Type': 'application/json' },
		...opts
	});
	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(err.error || res.statusText);
	}
	return res.json();
}

export const api = {
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
		test: (id: number) =>
			request<{ ok: boolean; error?: string }>('/repos/' + id + '/test'),
		detectProjects: (id: number) =>
			request<{ name: string; path: string; dockerfilePath: string }[]>('/repos/' + id + '/detect-projects')
	},
	projects: {
		list: () => request<any[]>('/projects'),
		get: (id: number) => request<any>('/projects/' + id),
		create: (data: any) =>
			request('/projects', { method: 'POST', body: JSON.stringify(data) }),
		remove: (id: number) => request('/projects/' + id, { method: 'DELETE' }),
		deploy: (id: number) =>
			request('/projects/' + id + '/deploy', { method: 'POST' })
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
	environments: {
		list: (projectId: number) => request<any[]>('/projects/' + projectId + '/environments'),
		get: (id: number) => request<any>('/environments/' + id),
		create: (projectId: number, environment: string) =>
			request('/projects/' + projectId + '/environments', {
				method: 'POST',
				body: JSON.stringify({ environment })
			}),
		remove: (id: number) => request('/environments/' + id, { method: 'DELETE' }),
		addVar: (envId: number, data: any) =>
			request('/environments/' + envId + '/vars', {
				method: 'POST',
				body: JSON.stringify(data)
			}),
		updateVar: (id: number, data: any) =>
			request('/env-vars/' + id, { method: 'PUT', body: JSON.stringify(data) }),
		removeVar: (id: number) => request('/env-vars/' + id, { method: 'DELETE' }),
		setActive: (projectId: number, environment: string) =>
			request('/projects/' + projectId + '/active-environment', {
				method: 'PUT',
				body: JSON.stringify({ environment })
			})
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
