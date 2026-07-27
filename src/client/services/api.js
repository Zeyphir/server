const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:4141';

let token = localStorage.getItem('secureMessengerToken') || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Erreur réseau.');
  return data;
}

export const authApi = {
  getToken: () => token,
  setToken(nextToken) {
    token = nextToken || '';
    if (token) localStorage.setItem('secureMessengerToken', token);
    else localStorage.removeItem('secureMessengerToken');
  },
  register: (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) }),
  verifyEmail: (payload) => request('/auth/verify-email', { method: 'POST', body: JSON.stringify(payload) }),
  login: (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  me: () => request('/me')
};

export const friendsApi = {
  list: () => request('/friends'),
  add: (friendCode) => request('/friends/add', { method: 'POST', body: JSON.stringify({ friendCode }) })
};