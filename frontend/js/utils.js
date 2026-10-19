/**
 * js/utils.js – Utilities: escapeHtml, showToast, renderTagBadges,
 *               formatTime, hasPermission, version comparison
 */

/* ── HTML-Escaping ───────────────────────────────────────────── */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderTagBadges(tags, extraClasses = '') {
    if (!Array.isArray(tags) || tags.length === 0) return '';
    const classes = ['tag-badges', extraClasses].filter(Boolean).join(' ');
    return `<div class="${classes}">${tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}</div>`;
}

/* ── Toast ────────────────────────────────────────────────────── */
function showToast(message, type = 'info', timeoutMs = 4200, title = '') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const heading = title || (
        type === 'success' ? 'Erfolg' :
        type === 'warning' ? 'Hinweis' :
        type === 'error'   ? 'Fehler' : 'Info'
    );

    const safeMessage = String(message ?? '').trim() || 'Unbekannte Meldung';
    toast.innerHTML = `<div><strong>${escapeHtml(heading)}</strong><p>${escapeHtml(safeMessage)}</p></div>`;
    container.appendChild(toast);

    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, timeoutMs);
}

window.showToast = showToast;
window.alert     = (message) => showToast(message, 'info');

/* ── Time formatting ─────────────────────────────────────────── */
function formatTime(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/* ── Permission helper ───────────────────────────────────────── */
function hasPermission(perm) {
    const isRestriction   = (perm === 'hide_ranking' || perm === 'hide_duration');
    const isGlobalAdmin   = !!(userPermissions.permissions && userPermissions.permissions.is_admin);
    const canSeeAll       = !!(userPermissions.permissions && userPermissions.permissions.can_see_all);

    if (isGlobalAdmin) return !isRestriction;

    const globalOnly = ['can_manage_users'];
    if (globalOnly.includes(perm)) {
        return !!userPermissions.permissions && !!userPermissions.permissions[perm];
    }

    if (currentRace) {
        if (canSeeAll) {
            if (userPermissions.race_access &&
                userPermissions.race_access[currentRace] &&
                typeof userPermissions.race_access[currentRace][perm] !== 'undefined') {
                return !!userPermissions.race_access[currentRace][perm];
            }
            return !!userPermissions.permissions && !!userPermissions.permissions[perm];
        } else {
            if (userPermissions.race_access && userPermissions.race_access[currentRace]) {
                return !!userPermissions.race_access[currentRace][perm];
            }
            return false;
        }
    }

    return !!userPermissions.permissions && !!userPermissions.permissions[perm];
}

/* ── Version comparison ──────────────────────────────────────── */
function normalizeTagVersion(tag) {
    if (!tag) return [];
    const cleaned = String(tag).trim().replace(/^v/i, '').split('-')[0];
    return cleaned.split('.').map(v => parseInt(v, 10)).filter(Number.isFinite);
}

function compareVersionTags(currentTag, latestTag) {
    const current = normalizeTagVersion(currentTag);
    const latest  = normalizeTagVersion(latestTag);
    const maxLen  = Math.max(current.length, latest.length);
    for (let i = 0; i < maxLen; i++) {
        const a = current[i] || 0;
        const b = latest[i]  || 0;
        if (a < b) return -1;
        if (a > b) return  1;
    }
    return 0;
}
