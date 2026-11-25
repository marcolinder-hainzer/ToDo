let csrfToken = null;

export function setCsrfToken(token) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, url, data) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (data instanceof FormData) {
    options.body = data;
  } else if (data !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  if (method !== 'GET' && csrfToken) options.headers['X-CSRF-Token'] = csrfToken;

  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new ApiError(0, 'Keine Verbindung zum Server', 'NETWORK');
  }
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const error = new ApiError(res.status, payload?.error || `Fehler ${res.status}`, payload?.code);
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new CustomEvent('auth:expired'));
    if (payload?.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new CustomEvent('auth:password-required'));
    throw error;
  }
  return payload;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, data = {}) => request('POST', url, data),
  put: (url, data = {}) => request('PUT', url, data),
  patch: (url, data = {}) => request('PATCH', url, data),
  del: (url) => request('DELETE', url),
  upload: (url, formData) => request('POST', url, formData),
};
