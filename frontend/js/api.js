/**
 * js/api.js – Zentraler fetch-Wrapper für alle API-Calls
 */

async function apiCall(endpoint, method, body = null, base = API_BASE) {
    const backendError = document.getElementById('backendError');
    const loginModal   = document.getElementById('loginModal');
    const adminApp     = document.getElementById('adminApp');
    const loginUser    = document.getElementById('loginUser');

    try {
        const res = await fetch(`${base}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
            credentials: 'include',
        });

        if (backendError) backendError.style.display = 'none';

        if (res.status === 401) {
            if (adminApp && adminApp.style.display === 'block' &&
                loginModal && loginModal.style.display !== 'flex') {
                loginModal.style.display = 'flex';
                if (loginUser) loginUser.focus();
            }
            throw new Error('Unauthorized');
        }

        if (!res.ok) throw new Error('API Error');
        if (res.status === 204) return null;

        return await res.json();
    } catch (err) {
        if (err.message === 'Unauthorized') throw err;
        if (backendError) backendError.style.display = 'block';
        throw err;
    }
}
