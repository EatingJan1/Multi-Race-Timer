/**
 * js/users.js – Benutzerverwaltung (Admin-Tab)
 */

/* ── DOM refs ────────────────────────────────────────────────── */
const userListBody       = document.getElementById('userListBody');
const addUserBtn         = document.getElementById('addUserBtn');
const userEditTitle      = document.getElementById('userEditTitle');
const targetUsernameInput = document.getElementById('targetUsername');
const targetPasswordInput = document.getElementById('targetPassword');
const saveUserBtn        = document.getElementById('saveUserBtn');
const cancelUserEditBtn  = document.getElementById('cancelUserEditBtn');
const userListSearch     = document.getElementById('userListSearch');
const rolePresetSelect   = document.getElementById('rolePresetSelect');
const userRaceList       = document.getElementById('userRaceList');
const addRaceSelect      = document.getElementById('addRaceSelect');
const addRaceAccessBtn   = document.getElementById('addRaceAccessBtn');
const racePermsModal     = document.getElementById('racePermsModal');
const racePermsTitle     = document.getElementById('racePermsTitle');
const racePermGrid       = document.getElementById('racePermGrid');
const saveRacePermsBtn   = document.getElementById('saveRacePermsBtn');
const closeRacePermsBtn  = document.getElementById('closeRacePermsBtn');

/* ── User Fetch ──────────────────────────────────────────────── */
async function fetchUsers() {
    try {
        const users = await apiCall('/users', 'GET', null, AUTH_BASE);
        allUsersLocal = users;
        renderUserList(users);
    } catch (e) { console.error('Failed to fetch users', e); }
}

if (userListSearch) {
    userListSearch.oninput = () => {
        const query    = userListSearch.value.toLowerCase();
        const filtered = allUsersLocal.filter(u => u.username.toLowerCase().includes(query));
        renderUserList(filtered);
    };
}

/* ── Role Preset ─────────────────────────────────────────────── */
if (rolePresetSelect) {
    rolePresetSelect.onchange = () => {
        const role = rolePresetSelect.value;
        const config = {
            admin:   { is_admin: true, can_see_all: true },
            timer:   { can_start: true, can_stop: true, can_see_all: true },
            manager: { can_edit_participants: true, can_add_participants: true, can_edit_settings: true, can_see_all: true },
            observer: { can_see_all: true },
        }[role];
        if (!config) return;

        const amIAdmin = userPermissions.permissions && userPermissions.permissions.is_admin;
        GLOBAL_PERM_KEYS.forEach(key => {
            const cb = document.getElementById(`perm-${key}`);
            if (cb) cb.checked = (key === 'is_admin' && config[key] && !amIAdmin) ? false : !!config[key];
        });
    };
}

/* ── User-Liste rendern ──────────────────────────────────────── */
function renderUserList(users) {
    if (!userListBody) return;
    userListBody.innerHTML = '';
    const amIAdmin   = userPermissions.permissions && userPermissions.permissions.is_admin;
    const myUsername = userPermissions.user;

    users.forEach(u => {
        const username     = u.username;
        const permissions  = u.permissions  || {};
        const race_access  = u.race_access  || {};
        const isTargetAdmin = !!permissions.is_admin;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${escapeHtml(username)}${isTargetAdmin ? ' <span style="font-size:0.7rem;color:var(--accent-orange);">[ADMIN]</span>' : ''}</strong></td>
            <td style="text-align:right">
                <button class="btn btn-outline tiny edit-user">Bearbeiten</button>
                <button class="btn btn-outline danger-text tiny delete-user">Löschen</button>
            </td>
        `;

        const editBtn   = tr.querySelector('.edit-user');
        const deleteBtn = tr.querySelector('.delete-user');

        if (!amIAdmin) {
            if (isTargetAdmin) {
                editBtn.disabled   = true; editBtn.title   = 'Admins können nicht bearbeitet werden.';
                deleteBtn.disabled = true; deleteBtn.title = 'Admins können nicht gelöscht werden.';
            }
            if (username === myUsername) {
                editBtn.disabled   = true; editBtn.title   = "Eigenen User über 'Mein Profil' bearbeiten.";
                deleteBtn.disabled = true; deleteBtn.title = 'Sie können sich nicht selbst löschen.';
            }
        }

        editBtn.onclick = async () => {
            currentEditingUserGlobalPerms = permissions;
            document.getElementById('userEditModal').classList.add('active');
            if (userEditTitle) userEditTitle.textContent = `User: ${username}`;
            if (targetUsernameInput) { targetUsernameInput.value = username; targetUsernameInput.readOnly = true; }
            if (targetPasswordInput) { targetPasswordInput.value = ''; targetPasswordInput.focus(); }
            if (rolePresetSelect) rolePresetSelect.value = '';

            GLOBAL_PERM_KEYS.forEach(key => {
                const cb = document.getElementById(`perm-${key}`);
                if (cb) { cb.checked = !!permissions[key]; if (key === 'is_admin') cb.disabled = !amIAdmin; }
            });

            currentEditingUserRaces = JSON.parse(JSON.stringify(race_access));
            renderUserRaceList();
            populateAddRaceSelect();
        };

        deleteBtn.onclick = () => deleteUser(username);
        userListBody.appendChild(tr);
    });
}

/* ── Race Access ─────────────────────────────────────────────── */
function populateAddRaceSelect() {
    if (!addRaceSelect) return;
    const sessionSelect = document.getElementById('sessionSelect');
    addRaceSelect.innerHTML = '<option value="">-- Rennen wählen --</option>';
    if (sessionSelect) {
        Array.from(sessionSelect.options).forEach(opt => {
            if (opt.value) {
                const o = document.createElement('option');
                o.value = opt.value; o.textContent = opt.textContent;
                addRaceSelect.appendChild(o);
            }
        });
    }
}

function renderUserRaceList() {
    if (!userRaceList) return;
    const races = Object.keys(currentEditingUserRaces);
    if (races.length === 0) {
        userRaceList.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:1rem;">Kein selektiver Zugriff zugewiesen.</td></tr>';
        return;
    }
    userRaceList.innerHTML = '';
    races.forEach(raceName => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${escapeHtml(raceName.replace(/_/g, ' '))}</td>
            <td style="text-align:right">
                <button class="btn btn-outline tiny edit-race-perms">Rechte...</button>
                <button class="btn btn-outline danger-text tiny remove-race-access">Entfernen</button>
            </td>
        `;
        tr.querySelector('.edit-race-perms').onclick   = () => openRacePermsModal(raceName);
        tr.querySelector('.remove-race-access').onclick = () => { delete currentEditingUserRaces[raceName]; renderUserRaceList(); };
        userRaceList.appendChild(tr);
    });
}

function openRacePermsModal(raceName) {
    currentEditingRaceName = raceName;
    if (racePermsTitle) racePermsTitle.textContent = `Rechte für: ${raceName.replace(/_/g, ' ')}`;
    if (racePermsModal) racePermsModal.classList.add('active');

    const perms = currentEditingUserRaces[raceName] || {};
    if (racePermGrid && racePermGrid.children.length === 0) {
        GLOBAL_PERM_KEYS.forEach(key => {
            if (key === 'is_admin' || key === 'can_manage_users') return;
            const sourceEl = document.getElementById(`perm-${key}`);
            if (!sourceEl) return;
            const label = sourceEl.closest('.permission-item').cloneNode(true);
            const input = label.querySelector('input');
            input.id = `rp-${key}`;
            racePermGrid.appendChild(label);
        });
    }

    const baseline = Object.keys(perms).length === 0 ? currentEditingUserGlobalPerms : perms;
    GLOBAL_PERM_KEYS.forEach(key => {
        if (key === 'is_admin' || key === 'can_manage_users') return;
        const cb = document.getElementById(`rp-${key}`);
        if (cb) cb.checked = !!baseline[key];
    });
}

if (saveRacePermsBtn) {
    saveRacePermsBtn.onclick = () => {
        const perms = {};
        GLOBAL_PERM_KEYS.forEach(key => {
            if (key === 'is_admin' || key === 'can_manage_users') return;
            const cb = document.getElementById(`rp-${key}`);
            if (cb && cb.checked) perms[key] = true;
        });
        currentEditingUserRaces[currentEditingRaceName] = perms;
        if (racePermsModal) racePermsModal.classList.remove('active');
    };
}
if (closeRacePermsBtn) closeRacePermsBtn.onclick = () => { if (racePermsModal) racePermsModal.classList.remove('active'); };

if (addRaceAccessBtn) {
    addRaceAccessBtn.onclick = () => {
        if (!addRaceSelect) return;
        const raceName = addRaceSelect.value;
        if (!raceName) return;
        if (currentEditingUserRaces[raceName]) { showToast('Benutzer hat bereits Zugriff!', 'warning'); return; }
        const permissions = {};
        GLOBAL_PERM_KEYS.forEach(key => {
            if (key === 'is_admin' || key === 'can_manage_users') return;
            const cb = document.getElementById(`perm-${key}`);
            if (cb && cb.checked) permissions[key] = true;
        });
        currentEditingUserRaces[raceName] = permissions;
        renderUserRaceList();
    };
}

/* ── Neuen User / Speichern ──────────────────────────────────── */
if (addUserBtn) {
    addUserBtn.onclick = () => {
        document.getElementById('userEditModal').classList.add('active');
        if (userEditTitle) userEditTitle.textContent = 'Neuer Benutzer';
        if (targetUsernameInput) { targetUsernameInput.value = ''; targetUsernameInput.readOnly = false; targetUsernameInput.focus(); }
        if (targetPasswordInput) targetPasswordInput.value = '';
        if (rolePresetSelect) rolePresetSelect.value = '';
        currentEditingUserRaces = {};
        renderUserRaceList();
        GLOBAL_PERM_KEYS.forEach(key => {
            const cb = document.getElementById(`perm-${key}`);
            if (cb) cb.checked = (key === 'can_see_all');
        });
        populateAddRaceSelect();
    };
}

if (cancelUserEditBtn) {
    cancelUserEditBtn.onclick = () => { document.getElementById('userEditModal').classList.remove('active'); };
}

if (saveUserBtn) {
    saveUserBtn.onclick = async () => {
        const username = targetUsernameInput?.value || '';
        const password = targetPasswordInput?.value || '';
        if (!username) { showToast('Benutzername erforderlich!', 'warning'); return; }
        const isNew = !targetUsernameInput.readOnly;
        if (isNew && !password) { showToast('Passwort erforderlich!', 'warning'); return; }

        const permissions = {};
        GLOBAL_PERM_KEYS.forEach(key => {
            const cb = document.getElementById(`perm-${key}`);
            if (cb && cb.checked) permissions[key] = true;
        });

        try {
            await apiCall('/users', 'POST', { username, password, permissions, race_access: currentEditingUserRaces }, AUTH_BASE);
            document.getElementById('userEditModal').classList.remove('active');
            fetchUsers();
        } catch (e) { showToast('Speichern fehlgeschlagen: ' + e.message, 'error'); }
    };
}

async function deleteUser(username) {
    if (!confirm(`Benutzer ${username} wirklich löschen?`)) return;
    try {
        await apiCall(`/users/${username}`, 'DELETE', null, AUTH_BASE);
        fetchUsers();
    } catch (e) { showToast('Löschen fehlgeschlagen: ' + e.message, 'error'); }
}

/* ── Profil ──────────────────────────────────────────────────── */
const saveProfileBtn = document.getElementById('saveProfileBtn');
if (saveProfileBtn) {
    saveProfileBtn.onclick = async () => {
        const password = document.getElementById('selfNewPassword')?.value || '';
        const msg      = document.getElementById('profileMessage');
        if (!password || password.length < 8) { showToast('Das Passwort muss mindestens 8 Zeichen lang sein.', 'warning'); return; }
        try {
            await apiCall('/profile', 'POST', { password }, AUTH_BASE);
            if (msg) {
                msg.textContent = 'Passwort erfolgreich gespeichert!';
                msg.style.color = 'var(--accent-green)';
                msg.style.display = 'block';
                document.getElementById('selfNewPassword').value = '';
                setTimeout(() => { msg.style.display = 'none'; }, 3000);
            }
        } catch (e) { showToast('Fehler beim Speichern: ' + e.message, 'error'); }
    };
}
