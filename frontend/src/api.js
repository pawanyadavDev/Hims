export const session = {
  get token() { return localStorage.getItem('hims_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('hims_user')); } catch { return null; } },
  save(token, user) { localStorage.setItem('hims_token', token); localStorage.setItem('hims_user', JSON.stringify(user)); },
  clear() { localStorage.removeItem('hims_token'); localStorage.removeItem('hims_user'); },
};

export async function api(path, options = {}) {
  const res = await fetch(`/api/v1${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(session.token && { Authorization: `Bearer ${session.token}` }) },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && session.token) { session.clear(); location.reload(); }
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
