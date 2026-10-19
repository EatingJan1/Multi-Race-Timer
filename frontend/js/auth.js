/**
 * js/auth.js – Login, Logout, Status-Check, Permission-UI, Release-Notice
 */

/* ── DOM refs ────────────────────────────────────────────────── */
const loginModal     = document.getElementById('loginModal');
const loginForm      = document.getElementById('loginForm');
const loginUser      = document.getElementById('loginUser');
const loginPass      = document.getElementById('loginPass');
const loginError     = document.getElementById('loginError');
const logoutBtn      = document.getElementById('logoutBtn');
const cancelLoginBtn = document.getElementById('cancelLoginBtn');
const adminLoginBtn  = document.getElementById('adminLoginBtn');

/* ── Auth Status ─────────────────────────────────────────────── */
async function checkAuthStatus() {
    try {
        const res = await fetch(`${AUTH_BASE}/status`, {
            signal: AbortSignal.timeout(2000),
            credentials: 'include',
        });
        if (res.ok) {
            const data = await res.json();
            if (data.logged_in) {
                userPermissions = data;
                if (loginModal) loginModal.style.display = 'none';
                return true;
            }
        }
    } catch (e) {
        console.log('Auth check failed', e);
    }
    return false;
}

/* ── Login ───────────────────────────────────────────────────── */
if (loginForm) {
    loginForm.onsubmit = async (e) => {
        e.preventDefault();
        const username = loginUser.value;
        const password = loginPass.value;
        try {
            const res = await fetch(`${AUTH_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
                credentials: 'include',
            });
            if (res.ok) {
                const data = await res.json();
                userPermissions = {
                    user:        data.user,
                    permissions: data.permissions || {},
                    race_access: data.race_access || {},
                };
                loginModal.style.display = 'none';
                if (loginError) loginError.style.display = 'none';
                loginPass.value = '';
                await showAdminApp();
            } else {
                loginError.textContent = 'Benutzername oder Passwort ist nicht korrekt.';
                loginError.style.display = 'block';
            }
        } catch (err) {
            console.error('Login failed', err);
            loginError.textContent = 'Anmeldung aktuell nicht möglich. Bitte Verbindung zum Backend prüfen.';
            loginError.style.display = 'block';
        }
    };
}

/* ── Logout ──────────────────────────────────────────────────── */
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        if (!confirm('Wirklich abmelden?')) return;
        try {
            await fetch(`${AUTH_BASE}/logout`, { method: 'POST', credentials: 'include' });
        } catch (e) {
            console.error('Logout failed', e);
        } finally {
            releaseInfoCache = null;
            window.location.reload();
        }
    };
}

if (adminLoginBtn) adminLoginBtn.onclick = () => {
    loginModal.style.display = 'flex';
    if (loginUser) loginUser.focus();
};
if (cancelLoginBtn) cancelLoginBtn.onclick = () => {
    loginModal.style.display = 'none';
    if (loginError) loginError.style.display = 'none';
};

/* ── Permission-UI ───────────────────────────────────────────── */
function updateUIPermissions() {
    const navRace       = document.getElementById('nav-tab-race');
    const navLayout     = document.getElementById('nav-tab-layout');
    const navReg        = document.getElementById('nav-tab-registration');
    const navUsers      = document.getElementById('nav-tab-users');
    const navUsersLabel = document.getElementById('nav-tab-users-label');
    const adminView     = document.getElementById('adminUserView');
    const profileView   = document.getElementById('selfProfileView');
    const overlay       = document.getElementById('noPermissionOverlay');

    if (navRace)   navRace.style.display   = hasPermission('can_edit_settings') ? 'flex' : 'none';
    if (navLayout) navLayout.style.display = hasPermission('can_edit_settings') ? 'flex' : 'none';
    if (navReg)    navReg.style.display    = (hasPermission('can_edit_form') || hasPermission('can_edit_stats')) ? 'flex' : 'none';

    if (navUsers) {
        navUsers.style.display = 'flex';
        if (navUsersLabel) {
            navUsersLabel.textContent = hasPermission('can_manage_users') ? 'Benutzer' : 'Mein Profil';
        }
    }
    if (adminView)   adminView.style.display   = hasPermission('can_manage_users') ? 'block' : 'none';
    if (profileView) profileView.style.display = 'block';

    const hasAnyRacePerm = hasPermission('can_start') || hasPermission('can_stop') ||
        hasPermission('can_edit_participants') || hasPermission('can_add_participants') ||
        hasPermission('can_edit_settings')    || hasPermission('can_edit_form') ||
        hasPermission('can_edit_stats')        || hasPermission('can_see_all');

    const isValidRace   = currentRace && currentRace !== 'null' && currentRace !== 'undefined';
    const isAdminProfile = userPermissions.permissions && userPermissions.permissions.is_admin;
    const shouldShowOverlay = isValidRace && !isAdminProfile && !hasAnyRacePerm;

    if (overlay) {
        overlay.style.display = shouldShowOverlay ? 'flex' : 'none';
        if (shouldShowOverlay) {
            const mainTimer      = document.getElementById('mainTimer');
            const activeName     = document.getElementById('activeName');
            const activeStartNum = document.getElementById('activeStartNumber');
            const mainActionBtn  = document.getElementById('mainActionBtn');
            if (mainTimer)      mainTimer.textContent      = '---';
            if (activeName)     activeName.textContent     = 'KEINE BERECHTIGUNG';
            if (activeStartNum) activeStartNum.textContent = '#--';
            if (mainActionBtn)  mainActionBtn.disabled     = true;
        }
    }

    const addParticipantBtn = document.getElementById('addParticipantBtn');
    const importBtn         = document.getElementById('importCsvBtn');
    const deleteBtn         = document.getElementById('deleteSessionBtn');
    const designerBtn       = document.getElementById('openFormDesignerBtn');
    const rankMethodBest    = document.getElementById('rankMethodBest');
    const rankMethodAverage = document.getElementById('rankMethodAverage');
    const editSwitch        = document.getElementById('editSwitch');

    if (addParticipantBtn) addParticipantBtn.style.display = hasPermission('can_add_participants') ? 'flex' : 'none';
    if (importBtn) importBtn.style.display = (hasPermission('can_add_participants') || hasPermission('can_edit_settings')) ? 'flex' : 'none';
    if (deleteBtn) deleteBtn.style.display = hasPermission('can_edit_settings') ? 'flex' : 'none';
    if (designerBtn) designerBtn.disabled  = !hasPermission('can_edit_form');
    if (rankMethodBest)    rankMethodBest.disabled    = !hasPermission('can_edit_stats');
    if (rankMethodAverage) rankMethodAverage.disabled = !hasPermission('can_edit_stats');

    if (editSwitch) {
        if (!hasPermission('can_edit_participants')) {
            editMode = false;
            editSwitch.checked  = false;
            editSwitch.disabled = true;
            localStorage.setItem('editMode', false);
        } else {
            editSwitch.disabled = false;
        }
    }
}

/* ── Release Notice ──────────────────────────────────────────── */
async function updateAdminReleaseNotice() {
    const releaseEl = document.getElementById('adminReleaseNotice');
    if (!releaseEl) return;

    const isAdmin = !!(userPermissions.permissions && userPermissions.permissions.is_admin);
    if (!isAdmin) { releaseEl.style.display = 'none'; releaseEl.textContent = ''; return; }

    try {
        if (!releaseInfoCache) {
            const [infoRes, releaseRes] = await Promise.all([
                fetch(`${PUBLIC_BASE}/info`),
                fetch(GITHUB_LATEST_RELEASE_API, { headers: { 'Accept': 'application/vnd.github+json' } }),
            ]);
            if (!infoRes.ok || !releaseRes.ok) throw new Error('Could not fetch release metadata');

            const appInfo       = await infoRes.json();
            const latestRelease = await releaseRes.json();
            const currentVersion = appInfo.version   || 'v0.0.0';
            const latestVersion  = latestRelease.tag_name || latestRelease.name || 'v0.0.0';

            releaseInfoCache = {
                hasUpdate:          compareVersionTags(currentVersion, latestVersion) < 0,
                currentVersion,
                latestVersion,
                latestUrl:          latestRelease.html_url || 'https://github.com/EatingJan1/Multi-Race-Timer/releases',
                selfUpdateSupported: !!appInfo.self_update_supported,
            };
        }

        if (!releaseInfoCache.hasUpdate) { releaseEl.style.display = 'none'; releaseEl.textContent = ''; return; }

        releaseEl.textContent = '';
        releaseEl.style.display = 'inline-flex';

        const prefix = document.createElement('span');
        prefix.textContent = `Neue Version verfügbar (${releaseInfoCache.currentVersion} -> ${releaseInfoCache.latestVersion}):`;
        releaseEl.appendChild(prefix);

        const actionWrap = document.createElement('span');
        actionWrap.className = 'admin-release-actions';

        const link = document.createElement('a');
        link.href = releaseInfoCache.latestUrl;
        link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.textContent = 'Release öffnen';
        actionWrap.appendChild(link);

        if (releaseInfoCache.selfUpdateSupported) {
            const updateBtn = document.createElement('button');
            updateBtn.type = 'button';
            updateBtn.className = 'admin-release-update-btn';
            updateBtn.textContent = 'Jetzt updaten';
            updateBtn.onclick = async () => {
                updateBtn.disabled = true; updateBtn.textContent = 'Update läuft...';
                try {
                    const frontendPathInput = prompt('Frontend-Pfad für Prüfung (leer = "frontend"):', 'frontend');
                    if (frontendPathInput === null) { updateBtn.disabled = false; updateBtn.textContent = 'Jetzt updaten'; return; }
                    const normalizedPath = frontendPathInput.trim();

                    const precheckRes = await fetch(`${AUTH_BASE}/update/precheck`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        credentials: 'include', body: JSON.stringify({ frontend_path: normalizedPath }),
                    });
                    const precheck = await precheckRes.json().catch(() => ({}));
                    if (!precheckRes.ok) throw new Error(precheck.message || 'Precheck fehlgeschlagen');
                    if (!precheck.ok) {
                        const errors = Array.isArray(precheck.errors) ? precheck.errors.join('\n- ') : 'Unbekannter Fehler';
                        throw new Error(`Frontend-Check fehlgeschlagen:\n- ${errors}`);
                    }

                    let allowNonstandardManifest = false;
                    if (precheck.requires_confirmation) {
                        const warnings = Array.isArray(precheck.warnings) ? precheck.warnings.join('\n- ') : 'Manifest-Prüfung fehlgeschlagen';
                        if (!confirm(`Manifest-Warnung:\n- ${warnings}\n\nTrotzdem installieren?`)) {
                            updateBtn.disabled = false; updateBtn.textContent = 'Jetzt updaten'; return;
                        }
                        allowNonstandardManifest = true;
                    }

                    const applyRes = await fetch(`${AUTH_BASE}/update/apply`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ frontend_path: normalizedPath, allow_nonstandard_manifest: allowNonstandardManifest }),
                    });
                    const applyPayload = await applyRes.json().catch(() => ({}));
                    if (!applyRes.ok) throw new Error(applyPayload.message || 'Update fehlgeschlagen');
                    updateBtn.textContent = applyPayload.updated ? 'Update installiert' : 'Schon aktuell';
                } catch (err) {
                    console.error(err);
                    updateBtn.disabled = false; updateBtn.textContent = 'Update fehlgeschlagen';
                    showToast(err.message || 'Update fehlgeschlagen', 'error');
                }
            };
            actionWrap.appendChild(updateBtn);
        }

        releaseEl.appendChild(actionWrap);
    } catch (err) {
        console.warn('Release check failed:', err);
        releaseEl.style.display = 'none'; releaseEl.textContent = '';
    }
}
