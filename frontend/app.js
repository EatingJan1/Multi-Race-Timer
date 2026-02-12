const API_BASE = `http://${window.location.hostname}:5002/race`;
const AUTH_BASE = `http://${window.location.hostname}:5002/auth`;

let participants = [];
let activeIndex = -1;
let currentRace = localStorage.getItem('currentRace') || '';
let currentTag = '';
let pollInterval;
let startMode = localStorage.getItem('startMode') || 'direct';
let editMode = false;
let editingIndex = -1;
let uploadedLogoData = null;

const DEFAULT_COLUMNS = [
    { id: 'number', label: 'STARTNR.', visible: true, required: true, key: 'number' },
    { id: 'name', label: 'NAME', visible: true, required: true, key: 'name' },
    { id: 'status', label: 'STATUS', visible: true, required: true, key: 'status' },
    { id: 'start', label: 'STARTZEIT', visible: true, required: false, key: 'start' },
    { id: 'duration', label: 'DAUER', visible: true, required: false, key: 'duration' },
    { id: 'end', label: 'ENDZEIT', visible: true, required: false, key: 'end' },
    { id: 'rank', label: 'PLATZ', visible: true, required: false, key: 'rank' },
    { id: 'gap', label: 'RÜCKSTAND', visible: true, required: false, key: 'gap' }
];

let columnConfig = JSON.parse(localStorage.getItem('columnConfig')) || [...DEFAULT_COLUMNS];
columnConfig = DEFAULT_COLUMNS.map(def => {
    const existing = columnConfig.find(c => c.id === def.id);
    if (!existing) return def;
    const synced = { ...def, ...existing };
    if (def.required) synced.visible = true;
    return synced;
});
const savedOrderKeys = columnConfig.map(c => c.id);
columnConfig = [...columnConfig].sort((a, b) => savedOrderKeys.indexOf(a.id) - savedOrderKeys.indexOf(b.id));

const startAudio = new Audio('race-start-beeps-125125.mp3');

// DOM Elements
const csvFileInput = document.getElementById('csvFile');
const sessionSelect = document.getElementById('sessionSelect');
const tagFilter = document.getElementById('tagFilter');
const exportBtn = document.getElementById('exportBtn');
const deleteSessionBtn = document.getElementById('deleteSessionBtn');
const raceBody = document.getElementById('raceBody');
const activeSection = document.getElementById('activeSection');
const activeName = document.getElementById('activeName');
const activeStartNumber = document.getElementById('activeStartNumber');
const mainTimer = document.getElementById('mainTimer');
const mainActionBtn = document.getElementById('mainActionBtn');
const importCsvBtn = document.getElementById('importCsvBtn');

// Modals
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const modeSwitch = document.getElementById('modeSwitch');
const editSwitch = document.getElementById('editSwitch');

const editParticipantModal = document.getElementById('editParticipantModal');
const editModalTitle = document.getElementById('editModalTitle');
const editName = document.getElementById('editName');
const editNumber = document.getElementById('editNumber');
const editTags = document.getElementById('editTags');
const availableTagsDatalist = document.getElementById('availableTags');
const saveParticipantBtn = document.getElementById('saveParticipant');
const cancelEditBtn = document.getElementById('cancelEdit');
const addParticipantBtn = document.getElementById('addParticipantBtn');
const editActionsView = document.getElementById('editActions');
const actionsHeader = document.getElementById('actionsHeader');

// Export Modal Elements
const exportModal = document.getElementById('exportModal');
const closeExport = document.getElementById('closeExport');
const exportLogoInput = document.getElementById('exportLogoInput');
const exportLogoPreview = document.getElementById('exportLogoPreview');
const logoPreviewContainer = document.getElementById('logoPreviewContainer');
const exportTagFilter = document.getElementById('exportTagFilter');
const btnPreparePDF = document.getElementById('btnPreparePDF');
const btnPrepareCSV = document.getElementById('btnPrepareCSV');
const btnExportExcel = document.getElementById('btnExportExcel');
const btnExportRace = document.getElementById('btnExportRace');
const printBody = document.getElementById('printBody');
const printLogo = document.getElementById('printLogo');
const printSubtitle = document.getElementById('printSubtitle');
const backendError = document.getElementById('backendError');
const columnConfigList = document.getElementById('columnConfigList');
const resetColumnsBtn = document.getElementById('resetColumnsBtn');
const raceTableHead = document.querySelector('#raceTable thead tr');
const logoutBtn = document.getElementById('logoutBtn');

// Auth Elements
const loginModal = document.getElementById('loginModal');
const loginForm = document.getElementById('loginForm');
const loginUser = document.getElementById('loginUser');
const loginPass = document.getElementById('loginPass');
const loginError = document.getElementById('loginError');

async function init() {
    updateSettingsUI();
    try {
        await checkAuthStatus();
        await fetchSessions();
        if (currentRace) {
            sessionSelect.value = currentRace;
            await fetchParticipants();
        }
    } catch (e) {
        console.log("Initial load failed or auth required");
    }
    renderColumnConfig();
    startPolling();
}

async function checkAuthStatus() {
    try {
        const res = await fetch(`${AUTH_BASE}/status`, { signal: AbortSignal.timeout(2000), credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            if (data.logged_in) {
                if (loginModal) loginModal.style.display = 'none';
                return true;
            }
        }
    } catch (e) {
        console.log("Auth check failed", e);
    }
    return false;
}

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
                credentials: 'include'
            });
            if (res.ok) {
                loginModal.style.display = 'none';
                loginError.style.display = 'none';
                loginPass.value = '';
                await fetchSessions();
                if (currentRace) await fetchParticipants();
            } else {
                loginError.style.display = 'block';
            }
        } catch (err) {
            loginError.textContent = "Verbindungsfehler";
            loginError.style.display = 'block';
        }
    };
}

if (logoutBtn) {
    logoutBtn.onclick = async () => {
        if (!confirm('Wirklich abmelden?')) return;
        try {
            await fetch(`${AUTH_BASE}/logout`, { method: 'POST', credentials: 'include' });
            window.location.reload();
        } catch (e) {
            console.error("Logout failed", e);
            window.location.reload();
        }
    };
}

function updateSettingsUI() {
    if (modeSwitch) modeSwitch.checked = (startMode === 'delayed');
    if (editSwitch) editSwitch.checked = editMode;
    if (editActionsView) editActionsView.style.display = (editMode && currentRace) ? 'block' : 'none';
    if (actionsHeader) actionsHeader.style.display = (editMode && currentRace) ? 'table-cell' : 'none';
    renderTable();
}

async function fetchSessions() {
    try {
        const sessions = await apiCall('/list', 'GET');
        const prevValue = sessionSelect.value;
        sessionSelect.innerHTML = '<option value="">-- Lauf wählen --</option>';
        sessions.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s.replace(/_/g, ' ');
            sessionSelect.appendChild(opt);
        });
        sessionSelect.value = prevValue;
    } catch (err) {
        console.error('Failed to fetch sessions', err);
    }
}

async function fetchParticipants() {
    if (!currentRace) {
        participants = [];
        renderTable();
        updateActiveDisplay();
        return;
    }
    try {
        participants = await apiCall(`/${currentRace}/people`, 'GET');
        updateTagFilter();
        renderTable();
        updateActiveDisplay();
    } catch (err) {
        console.error('Failed to fetch participants', err);
    }
}

function updateTagFilter() {
    const allTags = new Set();
    participants.forEach(p => {
        if (p.tags) p.tags.forEach(t => allTags.add(t));
    });

    const prevTag = tagFilter.value;
    const prevExportTag = exportTagFilter.value;

    const filterHtml = '<option value="">Alle Kategorien</option>';
    tagFilter.innerHTML = filterHtml;
    exportTagFilter.innerHTML = filterHtml;

    availableTagsDatalist.innerHTML = '';

    Array.from(allTags).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        tagFilter.appendChild(opt);

        const exportOpt = document.createElement('option');
        exportOpt.value = tag;
        exportOpt.textContent = tag;
        exportTagFilter.appendChild(exportOpt);

        const dlOpt = document.createElement('option');
        dlOpt.value = tag;
        availableTagsDatalist.appendChild(dlOpt);
    });

    tagFilter.value = prevTag;
    exportTagFilter.value = prevExportTag;
}

function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        await fetchSessions();
        if (currentRace && !editMode) await fetchParticipants();
    }, 2000);
}

function renderTable() {
    if (!raceBody) return;

    // 1. Render Header
    const visibleCols = columnConfig.filter(c => c.visible);
    raceTableHead.innerHTML = '';
    visibleCols.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.id === 'status' || col.id === 'start' || col.id === 'end') th.classList.add('desktop-only');
        raceTableHead.appendChild(th);
    });
    if (editMode && currentRace) {
        const th = document.createElement('th');
        th.id = 'actionsHeader';
        th.textContent = 'Aktionen';
        raceTableHead.appendChild(th);
    }

    raceBody.innerHTML = '';

    let displayList = participants.filter(p => !currentTag || (p.tags && p.tags.includes(currentTag)));

    // 2. Pre-calculate Ranks based on duration
    const finishedFiltered = displayList
        .filter(p => p.duration)
        .sort((a, b) => a.duration - b.duration);

    finishedFiltered.forEach((p, i) => {
        if (i > 0 && p.duration === finishedFiltered[i - 1].duration) {
            p.rank = finishedFiltered[i - 1].rank;
        } else {
            p.rank = i + 1;
        }
    });

    const winnerDuration = finishedFiltered.length > 0 ? finishedFiltered[0].duration : null;

    // 3. Sort display list by Start Number
    displayList.sort((a, b) => a.start_number - b.start_number);

    displayList.forEach((p) => {
        const globalIndex = participants.findIndex(orgP => orgP.start_number === p.start_number);
        const row = document.createElement('tr');
        if (globalIndex === activeIndex) row.classList.add('active-row');

        let status = 'Bereit';
        let badgeClass = 'status-ready';
        let durationDisplay = '-';
        let rankDisplay = '-';
        let diffDisplay = '-';
        let diffClass = 'diff-col';

        if (p.start_time && !p.end_time) {
            status = 'Läuft';
            badgeClass = 'status-running';
            durationDisplay = `<span class="row-live-timer" data-start="${p.start_time}">-</span>`;
        } else if (p.end_time) {
            status = 'Fertig';
            badgeClass = 'status-finished';
            durationDisplay = (p.duration || 0).toFixed(3) + 's';
            const rank = p.rank;
            rankDisplay = rank + '.';

            if (winnerDuration && p.duration > winnerDuration) {
                const diff = p.duration - winnerDuration;
                diffDisplay = `+${diff.toFixed(3)}s`;
                diffClass = 'diff-col';
            } else if (rank === 1) {
                diffDisplay = 'Bestzeit';
                diffClass = 'best-time';
            }
        }

        if (!editMode) {
            row.onclick = () => selectParticipant(globalIndex);
        }

        const tagsHtml = p.tags && p.tags.length > 0
            ? `<div class="tag-badges mobile-hideable-tags">${p.tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>`
            : '';

        let rowHtml = '';
        visibleCols.forEach(col => {
            if (col.id === 'number') rowHtml += `<td data-label="Startnr.">#${p.start_number}</td>`;
            else if (col.id === 'name') rowHtml += `<td data-label="Name">${p.name}${tagsHtml}</td>`;
            else if (col.id === 'status') rowHtml += `<td class="desktop-only"><span class="status-badge ${badgeClass}">${status}</span></td>`;
            else if (col.id === 'start') rowHtml += `<td data-label="Startzeit" class="desktop-only">${p.start_time ? formatTime(p.start_time) : '-'}</td>`;
            else if (col.id === 'duration') rowHtml += `<td data-label="Dauer">${durationDisplay}</td>`;
            else if (col.id === 'end') rowHtml += `<td data-label="Endzeit" class="desktop-only">${p.end_time ? formatTime(p.end_time) : '-'}</td>`;
            else if (col.id === 'rank') rowHtml += `<td data-label="Platz" class="rank-col">${rankDisplay}</td>`;
            else if (col.id === 'gap') rowHtml += `<td data-label="Rückstand" class="${diffClass}">${diffDisplay}</td>`;
        });

        if (editMode && currentRace) {
            rowHtml += `
                <td data-label="Aktionen">
                    <div class="edit-row-actions">
                        <button class="btn-icon" onclick="event.stopPropagation(); openEditModal(${globalIndex})" title="Bearbeiten">✏️</button>
                        <button class="btn-icon danger-icon" onclick="event.stopPropagation(); deleteParticipant(${globalIndex})" title="Löschen">🗑️</button>
                    </div>
                </td>
            `;
        }

        row.innerHTML = rowHtml;
        raceBody.appendChild(row);
    });

    if (!editMode && activeIndex === -1 && participants.length > 0) {
        const nextIdx = participants.findIndex(p => !p.end_time);
        if (nextIdx !== -1) selectParticipant(nextIdx);
    }
}

setInterval(() => {
    if (activeIndex !== -1 && participants[activeIndex]) {
        const p = participants[activeIndex];
        if (p.start_time && !p.end_time) {
            updateLiveTimerDisplay(p.start_time, mainTimer);
        }
    }
    document.querySelectorAll('.row-live-timer').forEach(span => {
        updateLiveTimerDisplay(span.dataset.start, span);
    });
}, 100);

function updateLiveTimerDisplay(startTimeIso, element) {
    const start = new Date(startTimeIso).getTime();
    const now = Date.now();
    const diff = now - start;
    if (diff < 0) return;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const ms = String(diff % 1000).padStart(3, '0');

    if (element === mainTimer) {
        element.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
    } else {
        element.textContent = `${(diff / 1000).toFixed(3)}s`;
    }
}

function selectParticipant(index) {
    activeIndex = index;
    updateActiveDisplay();
    renderTable();
}

function updateActiveDisplay() {
    if (activeIndex === -1 || !participants[activeIndex]) {
        activeSection.style.display = 'none';
        return;
    }
    const p = participants[activeIndex];
    activeSection.style.display = 'block';
    const tagsHtml = p.tags && p.tags.length > 0
        ? `<div class="tag-badges center-tags mobile-hideable-tags">${p.tags.map(t => `<span class="tag-badge">${t}</span>`).join('')}</div>`
        : '';
    activeName.innerHTML = `${p.name}${tagsHtml}`;
    activeStartNumber.textContent = `#${p.start_number}`;
    if (p.start_time && !p.end_time) {
        mainActionBtn.textContent = 'STOP DRÜCKEN';
        mainActionBtn.style.background = 'var(--accent-red)';
    } else {
        mainActionBtn.textContent = 'START DRÜCKEN';
        mainActionBtn.style.background = 'var(--accent-green)';
        mainTimer.textContent = p.duration ? p.duration.toFixed(1) + 's' : '00:00:00.0';
    }
}

async function handleMainAction() {
    if (!currentRace || activeIndex === -1 || editMode) return;
    const p = participants[activeIndex];
    const now = new Date().toISOString();
    if (!p.start_time || p.end_time) {
        if (startMode === 'delayed') {
            mainActionBtn.disabled = true;
            mainActionBtn.textContent = 'WARTE AUF START...';
            startAudio.play();
            setTimeout(async () => {
                const delayedNow = new Date().toISOString();
                await apiCall(`/${currentRace}/start/${p.start_number}`, 'POST', { timestamp: delayedNow });
                mainActionBtn.disabled = false;
                await fetchParticipants();
            }, 3000);
        } else {
            await apiCall(`/${currentRace}/start/${p.start_number}`, 'POST', { timestamp: now });
            await fetchParticipants();
        }
    } else {
        await apiCall(`/${currentRace}/stop/${p.start_number}`, 'POST', { timestamp: now });
        const sortedLocal = [...participants].sort((a, b) => a.start_number - b.start_number);
        const currentLocalIdx = sortedLocal.findIndex(person => person.start_number === p.start_number);
        const nextPerson = sortedLocal.find((person, i) => i > currentLocalIdx && !person.end_time);
        if (nextPerson) {
            activeIndex = participants.findIndex(person => person.start_number === nextPerson.start_number);
        }
        await fetchParticipants();
    }
}

addParticipantBtn.onclick = () => {
    editingIndex = -1;
    editModalTitle.textContent = "Neuer Teilnehmer";
    editName.value = "";
    editNumber.value = participants.length > 0 ? Math.max(...participants.map(p => p.start_number)) + 1 : 1;
    editTags.value = "";
    editParticipantModal.classList.add('active');
};
window.openEditModal = (index) => {
    editingIndex = index;
    const p = participants[index];
    editModalTitle.textContent = "Teilnehmer bearbeiten";
    editName.value = p.name;
    editNumber.value = p.start_number;
    editTags.value = p.tags ? p.tags.join(', ') : '';
    editParticipantModal.classList.add('active');
};
cancelEditBtn.onclick = () => editParticipantModal.classList.remove('active');
saveParticipantBtn.onclick = async () => {
    const name = editName.value.trim();
    const sn = parseInt(editNumber.value);
    const tags = editTags.value.split(',').map(t => t.trim()).filter(t => t !== "");
    if (!name || isNaN(sn)) {
        alert("Bitte Name und Startnummer korrekt ausfüllen.");
        return;
    }
    const dup = participants.find((p, i) => p.start_number === sn && i !== editingIndex);
    if (dup) {
        alert(`Startnummer ${sn} wird bereits von ${dup.name} verwendet.`);
        return;
    }
    if (editingIndex === -1) {
        participants.push({
            id: sn.toString(), name: name, start_number: sn, tags: tags,
            start_time: null, end_time: null, duration: null
        });
    } else {
        const p = participants[editingIndex];
        p.name = name; p.start_number = sn; p.id = sn.toString(); p.tags = tags;
    }
    participants.sort((a, b) => a.start_number - b.start_number);
    await apiCall(`/${currentRace}/people`, 'POST', participants);
    editParticipantModal.classList.remove('active');
    await fetchParticipants();
};
window.deleteParticipant = async (index) => {
    if (!confirm(`Teilnehmer ${participants[index].name} wirklich löschen?`)) return;
    participants.splice(index, 1);
    await apiCall(`/${currentRace}/people`, 'POST', participants);
    await fetchParticipants();
};

function openExportMenu() {
    updateTagFilter();
    exportTagFilter.value = currentTag;
    exportModal.classList.add('active');
}
exportBtn.onclick = openExportMenu;
closeExport.onclick = () => exportModal.classList.remove('active');
exportLogoInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            uploadedLogoData = event.target.result;
            exportLogoPreview.src = uploadedLogoData;
            logoPreviewContainer.style.display = 'block';
            printLogo.src = uploadedLogoData;
            printLogo.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }
};
btnPreparePDF.onclick = () => prepareAndPrint();
btnExportExcel.onclick = () => {
    const filter = exportTagFilter.value;
    const sortBy = document.getElementById('exportSortBy').value;
    const cols = [
        { id: 'col-rank', label: 'Platz', key: 'rank' },
        { id: 'col-number', label: 'Startnr.', key: 'number' },
        { id: 'col-name', label: 'Name', key: 'name' },
        { id: 'col-tags', label: 'Kategorie', key: 'tags' },
        { id: 'col-start', label: 'Startzeit', key: 'start' },
        { id: 'col-end', label: 'Endzeit', key: 'end' },
        { id: 'col-duration', label: 'Dauer', key: 'duration' },
        { id: 'col-gap', label: 'Rückstand', key: 'gap' }
    ].filter(c => document.getElementById(c.id).checked);

    let list = participants.filter(p => !filter || (p.tags && p.tags.includes(filter)));
    list = list.filter(p => p.duration);
    list.sort((a, b) => a.duration - b.duration);
    list.forEach((p, i) => {
        p.rank = (i > 0 && p.duration === list[i - 1].duration) ? list[i - 1].rank : i + 1;
    });
    const winnerDuration = list.length > 0 ? list[0].duration : null;

    if (sortBy === 'number') list.sort((a, b) => a.start_number - b.start_number);
    else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'startTime') list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    const data = list.map(p => {
        const row = {};
        cols.forEach(c => {
            if (c.key === 'rank') row[c.label] = p.rank;
            if (c.key === 'number') row[c.label] = p.start_number;
            if (c.key === 'name') row[c.label] = p.name;
            if (c.key === 'tags') row[c.label] = p.tags ? p.tags.join(', ') : '';
            if (c.key === 'start') row[c.label] = p.start_time ? formatTime(p.start_time) : '';
            if (c.key === 'end') row[c.label] = p.end_time ? formatTime(p.end_time) : '';
            if (c.key === 'duration') row[c.label] = p.duration;
            if (c.key === 'gap') row[c.label] = p.rank === 1 ? 'Bestzeit' : (winnerDuration ? `+${(p.duration - winnerDuration).toFixed(3)}s` : '');
        });
        return row;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Ergebnisse");
    XLSX.writeFile(wb, `${currentRace || 'Export'}_Ergebnisse.xlsx`);
};

btnExportRace.onclick = async () => {
    if (!currentRace) return;
    try {
        const fullData = await apiCall(`/${currentRace}/full`, 'GET');
        const blob = new Blob([JSON.stringify(fullData, null, 4)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentRace}.race`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        alert('Fehler beim Export: ' + err.message);
    }
};

btnPrepareCSV.onclick = () => {
    const filter = exportTagFilter.value;
    const sortBy = document.getElementById('exportSortBy').value;
    const cols = [
        { id: 'col-rank', label: 'Platz', key: 'rank' },
        { id: 'col-number', label: 'Startnr.', key: 'number' },
        { id: 'col-name', label: 'Name', key: 'name' },
        { id: 'col-tags', label: 'Kategorie', key: 'tags' },
        { id: 'col-start', label: 'Startzeit', key: 'start' },
        { id: 'col-end', label: 'Endzeit', key: 'end' },
        { id: 'col-duration', label: 'Dauer', key: 'duration' },
        { id: 'col-gap', label: 'Rückstand', key: 'gap' }
    ].filter(c => document.getElementById(c.id).checked);

    let list = participants.filter(p => !filter || (p.tags && p.tags.includes(filter)));
    list = list.filter(p => p.duration);
    list.sort((a, b) => a.duration - b.duration);
    list.forEach((p, i) => { p.rank = (i > 0 && p.duration === list[i - 1].duration) ? list[i - 1].rank : i + 1; });
    const winnerDuration = list.length > 0 ? list[0].duration : null;

    if (sortBy === 'number') list.sort((a, b) => a.start_number - b.start_number);
    else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'startTime') list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));

    let csv = cols.map(c => c.label).join(',') + "\n";
    list.forEach(p => {
        const row = cols.map(c => {
            if (c.key === 'rank') return `${p.rank}.`;
            if (c.key === 'number') return `#${p.start_number}`;
            if (c.key === 'name') return p.name;
            if (c.key === 'tags') return p.tags ? p.tags.join(' ') : '-';
            if (c.key === 'start') return formatTime(p.start_time);
            if (c.key === 'end') return formatTime(p.end_time);
            if (c.key === 'duration') return `${p.duration.toFixed(3)}s`;
            if (c.key === 'gap') return p.rank === 1 ? 'Bestzeit' : `+${(p.duration - winnerDuration).toFixed(3)}s`;
            return '';
        });
        csv += row.join(',') + "\n";
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Ergebnisse_${currentRace || 'Race'}_${filter || 'Alle'}.csv`;
    a.click();
};

function prepareAndPrint() {
    const filter = exportTagFilter.value;
    const sortBy = document.getElementById('exportSortBy').value;
    const cols = [
        { id: 'col-rank', label: 'Platz', key: 'rank' },
        { id: 'col-number', label: 'Startnr.', key: 'number' },
        { id: 'col-name', label: 'Name', key: 'name' },
        { id: 'col-tags', label: 'Kategorie', key: 'tags' },
        { id: 'col-start', label: 'Startzeit', key: 'start' },
        { id: 'col-end', label: 'Endzeit', key: 'end' },
        { id: 'col-duration', label: 'Dauer', key: 'duration' },
        { id: 'col-gap', label: 'Abweichung', key: 'gap' } // Label dynamisch angepasst
    ].filter(c => document.getElementById(c.id).checked);

    const raceTitle = currentRace ? currentRace.replace(/_/g, ' ') : 'Wettbewerb';
    let tagTitle = filter ? `Kategorie: ${filter}` : 'Gesamtwertung';
    
    let list = participants.filter(p => !filter || (p.tags && p.tags.includes(filter)));
    list = list.filter(p => p.duration);

    // 1. Durchschnitt berechnen
    const averageDuration = list.length > 0 
        ? list.reduce((sum, p) => sum + p.duration, 0) / list.length 
        : 0;

    if (sortBy === 'mean') {
        tagTitle += ` (Ø: ${averageDuration.toFixed(3)}s)`;
        
        // Sortieren nach absoluter Differenz zum Durchschnitt
        list.sort((a, b) => Math.abs(a.duration - averageDuration) - Math.abs(b.duration - averageDuration));
        
        // Plätze neu vergeben: Wer am nächsten dran ist, bekommt Platz 1
        list.forEach((p, i) => {
            const currentDiff = Math.abs(p.duration - averageDuration);
            const prevDiff = i > 0 ? Math.abs(list[i - 1].duration - averageDuration) : null;
            
            p.rank = (i > 0 && currentDiff === prevDiff) ? list[i - 1].rank : i + 1;
        });
    } else {
        // Klassische Sortierung nach Zeit für das Standard-Ranking
        list.sort((a, b) => a.duration - b.duration);
        list.forEach((p, i) => { 
            p.rank = (i > 0 && p.duration === list[i - 1].duration) ? list[i - 1].rank : i + 1; 
        });

        // Falls danach noch nach Name/Startnummer sortiert werden soll:
        if (sortBy === 'number') list.sort((a, b) => a.start_number - b.start_number);
        else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
        else if (sortBy === 'startTime') list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    }

    document.getElementById('printTitle').textContent = raceTitle;
    document.getElementById('printSubtitle').textContent = tagTitle;

    // Logo Handling
    if (uploadedLogoData) {
        printLogo.src = uploadedLogoData;
        printLogo.style.setProperty('display', 'block', 'important');
    } else {
        printLogo.style.setProperty('display', 'none', 'important');
        printLogo.removeAttribute('src');
    }

    const printTable = document.getElementById('printTable');
    printTable.innerHTML = `<thead><tr>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody id="printBody"></tbody>`;
    const pBody = document.getElementById('printBody');

    const winnerDuration = (sortBy !== 'mean' && list.length > 0) ? list[0].duration : null;

    list.forEach((p) => {
        const row = document.createElement('tr');
        row.innerHTML = cols.map(c => {
            if (c.key === 'rank') return `<td>${p.rank}.</td>`;
            if (c.key === 'number') return `<td>#${p.start_number}</td>`;
            if (c.key === 'name') return `<td>${p.name}</td>`;
            if (c.key === 'tags') return `<td>${p.tags ? p.tags.join(', ') : '-'}</td>`;
            if (c.key === 'start') return `<td>${formatTime(p.start_time)}</td>`;
            if (c.key === 'end') return `<td>${formatTime(p.end_time)}</td>`;
            if (c.key === 'duration') return `<td>${p.duration.toFixed(3)}s</td>`;
            if (c.key === 'gap') {
                if (sortBy === 'mean') {
                    const diff = p.duration - averageDuration;
                    const prefix = diff > 0 ? '+' : '';
                    return `<td>${prefix}${diff.toFixed(3)}s</td>`;
                }
                return `<td>${p.rank === 1 ? 'Bestzeit' : `+${(p.duration - winnerDuration).toFixed(3)}s`}</td>`;
            }
            return '<td></td>';
        }).join('');
        pBody.appendChild(row);
    });

    exportModal.classList.remove('active');
    setTimeout(() => { window.print(); }, 250);
}

window.onkeydown = (e) => {
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable;
    if (e.key === ' ' && !isInput) { e.preventDefault(); handleMainAction(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isInput) {
        e.preventDefault();
        let displayList = participants.filter(p => !currentTag || (p.tags && p.tags.includes(currentTag)));
        displayList.sort((a, b) => a.start_number - b.start_number);
        if (displayList.length === 0) return;
        let pIndex = displayList.findIndex(p => participants.indexOf(p) === activeIndex);
        if (e.key === 'ArrowDown') pIndex = Math.min(pIndex + 1, displayList.length - 1);
        else pIndex = Math.max(pIndex - 1, 0);
        selectParticipant(participants.indexOf(displayList[pIndex]));
        const activeRow = document.querySelector('.active-row');
        if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); openExportMenu(); }
};

async function apiCall(endpoint, method, body = null) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : null,
            credentials: 'include'
        });
        if (backendError) backendError.style.display = 'none';
        if (res.status === 401) {
            if (loginModal && loginModal.style.display !== 'flex') {
                loginModal.style.display = 'flex';
                loginUser.focus();
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

function renderColumnConfig() {
    if (!columnConfigList) return;
    columnConfigList.innerHTML = '';
    columnConfig.forEach((col, index) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'column-config-item-wrapper' + (!col.visible ? ' showing' : '');
        const item = document.createElement('div');
        item.className = 'column-config-item' + (col.required ? ' required' : '');
        item.draggable = true;
        item.dataset.index = index;
        if (window.currentlyDraggingId === col.id) {
            item.classList.add('dragging');
            item.style.opacity = '0.4';
        }

        const visibilityToggle = col.required
            ? '<label class="check-container" style="margin: 0; padding:0;"><input type="checkbox" checked disabled><span class="checkmark" style="background-color: var(--primary); opacity: 0.5;"></span></label>'
            : `<label class="check-container" style="margin: 0; padding:0;"><input type="checkbox" ${col.visible ? 'checked' : ''} onchange="toggleColumn('${col.id}')"><span class="checkmark"></span></label>`;

        item.innerHTML = `
            <div class="drag-icon"><div></div><div></div><div></div><div></div><div></div><div></div></div>
            ${visibilityToggle}
            <span class="col-label">${col.label}</span>
            <span class="swipe-hint">${col.visible ? 'Ausblenden' : 'Einblenden'}</span>
        `;

        wrapper.appendChild(item);

        item.addEventListener('mousedown', (e) => {
            // Only allow dragging if clicking the handle
            item.draggable = !!e.target.closest('.drag-icon');
        });

        item.addEventListener('dragstart', (e) => {
            window.currentlyDraggingId = col.id;
            window.dragFromIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.setData('text/plain', index);
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => item.style.opacity = '0.4', 0);
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const fromIndex = window.dragFromIndex;
            const toIndex = index;

            if (fromIndex !== undefined && fromIndex !== toIndex) {
                // Determine if we should swap based on vertical cursor position
                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;

                if ((fromIndex < toIndex && e.clientY > midpoint) ||
                    (fromIndex > toIndex && e.clientY < midpoint)) {

                    const movedItem = columnConfig.splice(fromIndex, 1)[0];
                    columnConfig.splice(toIndex, 0, movedItem);
                    window.dragFromIndex = toIndex;

                    // Instant re-render for fluid movement
                    renderColumnConfig();
                    renderTable();
                    localStorage.setItem('columnConfig', JSON.stringify(columnConfig));
                }
            }
        });

        item.addEventListener('dragend', () => {
            window.currentlyDraggingId = null;
            window.dragFromIndex = undefined;
            renderColumnConfig();
        });

        // TOUCH SUPPORT (SWIPE & DRAG)
        let touchStart = { x: 0, y: 0 };
        let isHorizontalSwipe = false;

        item.addEventListener('touchstart', (e) => {
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            isHorizontalSwipe = false;

            const handle = e.target.closest('.drag-icon');
            if (handle) {
                window.currentlyDraggingId = col.id;
                window.dragFromIndex = index;
                item.classList.add('dragging');
                item.style.opacity = '0.4';
            }
        }, { passive: true });

        item.addEventListener('touchmove', (e) => {
            const touch = e.touches[0];
            const deltaX = touch.clientX - touchStart.x;
            const deltaY = touch.clientY - touchStart.y;

            if (!window.currentlyDraggingId && Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 10) {
                isHorizontalSwipe = true;
            }

            if (isHorizontalSwipe && !col.required) {
                const move = Math.min(0, deltaX);
                item.style.transform = `translateX(${move}px)`;
                item.classList.add('swiping');
            } else if (window.currentlyDraggingId) {
                const elementUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
                const targetItem = elementUnderTouch ? elementUnderTouch.closest('.column-config-item') : null;
                if (targetItem && targetItem !== item) {
                    const toIndex = parseInt(targetItem.dataset.index);
                    const fromIndex = window.dragFromIndex;
                    if (fromIndex !== toIndex) {
                        const rect = targetItem.getBoundingClientRect();
                        const midpoint = rect.top + rect.height / 2;
                        if ((fromIndex < toIndex && touch.clientY > midpoint) || (fromIndex > toIndex && touch.clientY < midpoint)) {
                            const movedItem = columnConfig.splice(fromIndex, 1)[0];
                            columnConfig.splice(toIndex, 0, movedItem);
                            window.dragFromIndex = toIndex;
                            renderColumnConfig();
                            renderTable();
                            localStorage.setItem('columnConfig', JSON.stringify(columnConfig));
                        }
                    }
                }
            }
        });

        item.addEventListener('touchend', (e) => {
            if (isHorizontalSwipe && !col.required) {
                const deltaX = e.changedTouches[0].clientX - touchStart.x;
                if (deltaX < -80) {
                    toggleColumn(col.id);
                }
            }

            window.currentlyDraggingId = null;
            window.dragFromIndex = undefined;
            item.style.transform = '';
            item.classList.remove('swiping');
            setTimeout(() => renderColumnConfig(), 300);
        });

        columnConfigList.appendChild(wrapper);
    });
}

window.toggleColumn = (id) => {
    const col = columnConfig.find(c => c.id === id);
    if (col && !col.required) {
        col.visible = !col.visible;
        saveAndRefill();
    }
};

function saveAndRefill() {
    localStorage.setItem('columnConfig', JSON.stringify(columnConfig));
    renderColumnConfig();
    renderTable();
}

if (resetColumnsBtn) resetColumnsBtn.onclick = () => {
    if (confirm('Spalten-Einstellungen auf Standard zurücksetzen?')) {
        columnConfig = DEFAULT_COLUMNS.map(c => ({ ...c }));
        saveAndRefill();
    }
};

function formatTime(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

sessionSelect.addEventListener('change', (e) => {
    currentRace = e.target.value;
    localStorage.setItem('currentRace', currentRace);
    activeIndex = -1;
    fetchParticipants();
    updateSettingsUI();
});

tagFilter.addEventListener('change', (e) => {
    currentTag = e.target.value;
    renderTable();
});

csvFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const fileName = file.name.toLowerCase();
    const raceName = file.name.replace(/\.[^/.]+$/, "").replace(/\s+/g, '_');

    try {
        if (fileName.endsWith('.race')) {
            const text = await file.text();
            const fullData = JSON.parse(text);
            await apiCall(`/${raceName}/full`, 'POST', fullData);
        } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(sheet);

            // Map common headers to our person structure
            const people = json.map((item, i) => {
                const sn = parseInt(item['Startnummer'] || item['Startnr.'] || item['Number'] || item['#']) || (i + 1);
                const tagsRaw = item['Kategorie'] || item['Tags'] || item['Kategorien'] || '';
                const tags = tagsRaw.toString().split(/[,\s]+/).filter(t => t.length > 0);
                return {
                    id: sn.toString(),
                    name: item['Name'] || item['Full Name'] || `Person ${i + 1}`,
                    start_number: sn,
                    tags: tags,
                    start_time: null,
                    end_time: null,
                    duration: null
                };
            });
            await apiCall(`/${raceName}/people`, 'POST', people);
        } else {
            // Assume CSV
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            const people = lines.map((line, i) => {
                const parts = line.split(/[;,]/);
                const sn = parseInt(parts[1]?.trim()) || (i + 1);
                let tags = [];
                if (parts[2]) {
                    const tagsRaw = parts[2].trim();
                    const match = tagsRaw.match(/\[(.*?)\]/);
                    tags = match ? match[1].split(/[,\s]+/).filter(t => t.length > 0) : tagsRaw.split(/[,\s]+/).filter(t => t.length > 0);
                }
                return {
                    id: sn.toString(), name: parts[0]?.trim() || `Person ${i + 1}`,
                    start_number: sn, tags: tags, start_time: null, end_time: null, duration: null
                };
            });
            await apiCall(`/${raceName}/people`, 'POST', people);
        }

        currentRace = raceName;
        localStorage.setItem('currentRace', currentRace);
        await fetchSessions();
        sessionSelect.value = currentRace;
        await fetchParticipants();
        updateSettingsUI();
    } catch (err) {
        alert('Fehler beim Import: ' + err.message);
    }
});

deleteSessionBtn.onclick = async () => {
    if (!currentRace || !confirm(`Soll der Lauf "${currentRace}" wirklich gelöscht werden?`)) return;
    await apiCall(`/${currentRace}/delete`, 'DELETE');
    currentRace = ''; localStorage.removeItem('currentRace');
    await fetchSessions(); await fetchParticipants(); updateSettingsUI();
};

settingsBtn.onclick = () => settingsModal.classList.add('active');
closeSettings.onclick = () => settingsModal.classList.remove('active');

if (modeSwitch) modeSwitch.onchange = () => {
    startMode = modeSwitch.checked ? 'delayed' : 'direct';
    localStorage.setItem('startMode', startMode);
    updateSettingsUI();
};

if (editSwitch) editSwitch.onchange = () => {
    editMode = editSwitch.checked;
    updateSettingsUI();
};

window.onclick = (e) => {
    if (e.target == settingsModal) settingsModal.classList.remove('active');
    if (e.target == editParticipantModal) editParticipantModal.classList.remove('active');
    if (e.target == exportModal) exportModal.classList.remove('active');
};

if (importCsvBtn) {
    importCsvBtn.onclick = () => csvFileInput.click();
}

activeSection.addEventListener('click', handleMainAction);
init();
