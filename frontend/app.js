const API_BASE = `http://${window.location.hostname}:5002/race`;
const AUTH_BASE = `http://${window.location.hostname}:5002/auth`;
const PUBLIC_BASE = `http://${window.location.hostname}:5002/public`;

// Set PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let participants = [];
let activeIndex = -1;
let currentRace = localStorage.getItem('currentRace') || '';
let currentTag = '';
let pollInterval;
let startMode = localStorage.getItem('startMode') || 'direct';
let editMode = false;
let editingIndex = -1;
let uploadedLogoData = null;
let currentRaceSettings = {};
let signaturePad = null;
let pdfTextFields = [];
let isRegistrationPreview = false;
let isKioskMode = false;

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
const cancelLoginBtn = document.getElementById('cancelLoginBtn');

// New Landing Page Elements
const landingPage = document.getElementById('landingPage');
const registrationPage = document.getElementById('registrationPage');
const adminApp = document.getElementById('adminApp');
const upcomingRacesList = document.getElementById('upcomingRacesList');
const finishedRacesList = document.getElementById('finishedRacesList');
const adminLoginBtn = document.getElementById('adminLoginBtn');
const backToLandingBtn = document.getElementById('backToLandingBtn');
const startNumMinInput = document.getElementById('startNumMin');
const startNumMaxInput = document.getElementById('startNumMax');
const addFieldBtn = document.getElementById('addFieldBtn');
const formFieldsList = document.getElementById('formFieldsList');
const regA4Title = document.getElementById('regA4Title');
const dynamicFormContainer = document.getElementById('dynamicFormContainer');
const submitRegistrationBtn = document.getElementById('submitRegistrationBtn');
const clearSignatureBtn = document.getElementById('clearSignatureBtn');

// Status Select for Settings
const raceStatusSelect = document.getElementById('raceStatusSelect');
const startKioskBnt = document.getElementById('startKioskBnt');
const viewActivePdfBtn = document.getElementById('viewActivePdfBtn');

// Public Results Elements
const publicResultsPage = document.getElementById('publicResultsPage');
const resultsTitle = document.getElementById('resultsTitle');
const resultsSubtitle = document.getElementById('resultsSubtitle');
const publicResultsHeader = document.getElementById('publicResultsHeader');
const publicResultsBody = document.getElementById('publicResultsBody');
const backToLandingResultsBtn = document.getElementById('backToLandingResultsBtn');

async function init() {
    // Check if we are on a page with the main application UI (index.html)
    // If not, we stop here to avoid errors looking for non-existent elements.
    if (!landingPage && !adminApp && !registrationPage) return;

    const params = new URLSearchParams(window.location.search);
    const kioskParam = params.get('k');

    if (kioskParam) {
        try {
            const raceName = atob(kioskParam);
            const res = await fetch(`${PUBLIC_BASE}/races`);
            const races = await res.json();
            const race = races.find(r => r.name === raceName);
            if (race) {
                // Force Kiosk Mode
                await openRegistration(race, false, true);
                startPolling();
                return;
            }
        } catch (e) {
            console.error("Kiosk boot failed", e);
        }
    }

    updateSettingsUI();
    const isLoggedIn = await checkAuthStatus();

    if (isLoggedIn) {
        showAdminApp();
    } else {
        showLandingPage();
    }

    renderColumnConfig();
    startPolling();
}

function hideAllViews() {
    if (landingPage) landingPage.style.display = 'none';
    if (registrationPage) registrationPage.style.display = 'none';
    if (adminApp) adminApp.style.display = 'none';
    if (publicResultsPage) publicResultsPage.style.display = 'none';
}

async function showAdminApp() {
    hideAllViews();
    if (adminApp) adminApp.style.display = 'block';
    await fetchSessions();
    if (currentRace) {
        sessionSelect.value = currentRace;
        await fetchParticipants();
        await fetchRaceSettings();
    }
}

async function showLandingPage() {
    hideAllViews();
    if (landingPage) landingPage.style.display = 'block';
    await fetchPublicRaces();
}

if (backToLandingResultsBtn) backToLandingResultsBtn.onclick = showLandingPage;

async function fetchPublicRaces() {
    try {
        const res = await fetch(`${PUBLIC_BASE}/races`);
        if (res.ok) {
            const races = await res.json();
            renderRaceGrid(races);
        }
    } catch (e) {
        console.error("Public fetch failed", e);
    }
}


function renderRaceGrid(races) {
    upcomingRacesList.innerHTML = '';
    finishedRacesList.innerHTML = '';

    const upcoming = races.filter(r => !r.settings.finished && !r.settings.hidden);
    const finished = races.filter(r => r.settings.finished && !r.settings.hidden);

    if (upcoming.length === 0) {
        upcomingRacesList.innerHTML = '<div class="race-card-skeleton">Keine aktiven Rennen</div>';
    }

    upcoming.forEach(race => {
        const card = createRaceCard(race);
        upcomingRacesList.appendChild(card);
    });

    finished.forEach(race => {
        const card = createRaceCard(race);
        finishedRacesList.appendChild(card);
    });
}

function createRaceCard(race) {
    const card = document.createElement('div');
    card.className = 'race-card';
    let statusBadge = '';
    if (race.settings.finished) {
        statusBadge = '<span class="badge badge-closed">Beendet</span>';
    } else if (race.settings.allow_registration && !race.settings.registration_stop) {
        statusBadge = '<span class="badge badge-live">Anmeldung Offen</span>';
    } else if (race.settings.registration_stop) {
        statusBadge = '<span class="badge badge-closed">Anmeldung geschlossen</span>';
    } else {
        statusBadge = '<span class="badge badge-future">Vorbereitung</span>';
    }

    card.innerHTML = `
        <div>
            <h3 class="race-card-title">${race.name.replace(/_/g, ' ')}</h3>
            <div class="race-card-info">
                ${statusBadge}
            </div>
        </div>
        <button class="btn btn-primary small">
            ${(race.settings.finished || race.settings.registration_stop) ? 'Ergebnisse / Liste' : 'Details / Anmeldung'}
        </button>
    `;

    card.onclick = () => {
        if (race.settings.allow_registration && !race.settings.registration_stop) {
            openRegistration(race);
        } else {
            showPublicResults(race);
        }
    };
    return card;
}

async function showPublicResults(race) {
    hideAllViews();
    currentRace = race.name;
    resultsTitle.textContent = race.name.replace(/_/g, ' ');
    resultsSubtitle.textContent = race.settings.finished ? 'Offizielle Endergebnisse' : 'Aktuelle Teilnehmerliste';

    if (publicResultsPage) publicResultsPage.style.display = 'block';

    publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Lade Daten...</td></tr>';

    try {
        const res = await fetch(`${PUBLIC_BASE}/results/${race.name}`);
        if (!res.ok) throw new Error("Fehler beim Laden");
        const people = await res.json();

        // Sort if finished
        if (race.settings.finished) {
            people.sort((a, b) => {
                if (a.duration && b.duration) return a.duration - b.duration;
                if (a.duration) return -1;
                if (b.duration) return 1;
                return 0;
            });
        } else {
            people.sort((a, b) => a.start_number - b.start_number);
        }

        // Header
        let headerHtml = `<th>#</th><th>Name</th><th>Kategorie</th>`;
        if (race.settings.finished) headerHtml += `<th>Zeit</th><th>Platz</th>`;
        else headerHtml += `<th>Status</th>`;
        publicResultsHeader.innerHTML = headerHtml;

        // Body
        publicResultsBody.innerHTML = '';
        people.forEach((p, i) => {
            const tr = document.createElement('tr');
            let timeStr = p.duration ? p.duration.toFixed(3) + 's' : '-';
            let statusStr = p.end_time ? 'Fertig' : (p.start_time ? 'Unterwegs' : 'Bereit');

            let html = `<td>${p.start_number}</td><td>${p.name}</td><td>${p.tags.join(', ')}</td>`;
            if (race.settings.finished) {
                html += `<td>${timeStr}</td><td>${i + 1}.</td>`;
            } else {
                html += `<td>${statusStr}</td>`;
            }
            tr.innerHTML = html;
            publicResultsBody.appendChild(tr);
        });

        if (people.length === 0) {
            publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Noch keine Teilnehmer angemeldet.</td></tr>';
        }

    } catch (e) {
        publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Daten konnten nicht geladen werden.</td></tr>';
    }
}

async function openRegistration(race, isPreview = false, isKiosk = false) {
    hideAllViews();
    isRegistrationPreview = isPreview;
    isKioskMode = isKiosk;
    currentRace = race.name;
    currentRaceSettings = race.settings || {};

    if (backToLandingBtn) {
        backToLandingBtn.style.display = isKiosk ? 'none' : 'block';
    }

    if (isKiosk) {
        // Prevent browser back navigation
        window.history.pushState(null, null, window.location.href);
        window.onpopstate = () => window.history.go(1);
    }
    if (regA4Title) regA4Title.textContent = race.name.replace(/_/g, ' ');
    if (registrationPage) registrationPage.style.display = 'block';

    // Render the dynamic form from config in A4 look
    renderDynamicForm(currentRaceSettings.form_config || []);

    // Handle Preview Mode
    if (isPreview) {
        submitRegistrationBtn.textContent = "VORSCHAU-MODUS (Kein Absenden)";
        submitRegistrationBtn.disabled = true;
        submitRegistrationBtn.style.opacity = "0.5";
    } else {
        submitRegistrationBtn.textContent = "JETZT REGESTRIEREN";
        submitRegistrationBtn.disabled = false;
        submitRegistrationBtn.style.opacity = "1";
    }

    // Init Signature Pad
    const canvas = document.getElementById('signaturePad');
    signaturePad = new SignaturePad(canvas);

    const resizeSignatureCanvas = () => {
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext("2d").scale(ratio, ratio);
        if (signaturePad) signaturePad.clear();
    };
    window.addEventListener("resize", resizeSignatureCanvas);
    resizeSignatureCanvas();
}

function renderDynamicForm(config) {
    dynamicFormContainer.innerHTML = '';

    config.forEach(field => {
        if (field.type === 'paragraph') {
            const p = document.createElement('span'); // Changed to span for better inline flow
            p.className = 'a4-text-block';
            p.textContent = field.label;
            dynamicFormContainer.appendChild(p);
        } else {
            const group = document.createElement('span'); // Changed to span
            group.className = 'a4-form-field';

            const label = document.createElement('label');
            label.className = 'a4-label';
            label.textContent = field.label;
            group.appendChild(label);

            let input;
            if (field.type === 'select') {
                input = document.createElement('select');
                input.className = 'a4-input';
                const options = field.options ? field.options.split(',') : [];
                options.forEach(opt => {
                    const o = document.createElement('option');
                    o.value = opt.trim();
                    o.textContent = opt.trim();
                    input.appendChild(o);
                });
            } else {
                input = document.createElement('input');
                input.type = 'text';
                input.className = 'a4-input';
                input.placeholder = '';
            }

            input.id = `field_${field.id}`;
            input.dataset.name = field.label;
            input.required = true;

            group.appendChild(input);
            dynamicFormContainer.appendChild(group);
        }
    });
}

async function loadPdfTemplate(raceName) {
    try {
        const url = `${PUBLIC_BASE}/template/${raceName}`;
        console.log("Fetching PDF from:", url);
        const res = await fetch(url);
        if (!res.ok) {
            console.error("PDF Fetch failed:", res.status, res.statusText);
            throw new Error(`PDF nicht gefunden (${res.status})`);
        }

        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();
        console.log("PDF loaded, size:", arrayBuffer.byteLength);

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);

        const scale = 1.5;
        const viewport = page.getViewport({ scale });
        const canvas = document.getElementById('regPdfCanvas');
        if (!canvas) throw new Error("Canvas 'regPdfCanvas' nicht gefunden");

        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport }).promise;
        console.log("PDF page rendered");

        const textContent = await page.getTextContent();
        extractTextFields(textContent, viewport);
    } catch (e) {
        console.error("Detailed PDF load error:", e);
        alert("Fehler beim Laden der PDF-Vorlage: " + e.message);
    }
}

function extractTextFields(textContent, viewport) {
    const overlay = document.getElementById('pdfOverlay');
    overlay.innerHTML = '';
    pdfTextFields = [];

    textContent.items.forEach(item => {
        const text = item.str;
        if (text.includes('/@')) {
            const matches = text.match(/\/@(.*?)\@\//g);
            if (matches) {
                matches.forEach(match => {
                    const fieldName = match.replace(/\/@|\@\//g, '');
                    const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);

                    const input = document.createElement('input');
                    input.className = 'pdf-input';
                    input.placeholder = fieldName;
                    input.style.left = `${tx[4]}px`;
                    input.style.top = `${viewport.height - tx[5] - 20}px`;
                    input.style.width = `${item.width * viewport.scale}px`;

                    overlay.appendChild(input);
                    pdfTextFields.push({ name: fieldName, element: input, x: tx[4], y: tx[5], width: item.width });
                });
            }
        }
    });
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
                await showAdminApp();
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

    // Race Status Select
    if (raceStatusSelect) {
        if (currentRaceSettings.allow_registration) raceStatusSelect.value = 'open';
        else if (currentRaceSettings.registration_stop) raceStatusSelect.value = 'registration_stop';
        else if (currentRaceSettings.hidden) raceStatusSelect.value = 'hidden';
        else if (currentRaceSettings.finished) raceStatusSelect.value = 'finished';
        else raceStatusSelect.value = 'preparation';
    }

    if (startNumMinInput) startNumMinInput.value = currentRaceSettings.start_num_min || '';
    if (startNumMaxInput) startNumMaxInput.value = currentRaceSettings.start_num_max || '';

    renderFormDesigner(currentRaceSettings.form_config || []);

    renderTable();
}

function renderFormDesigner(config) {
    if (!formFieldsList) return;
    formFieldsList.innerHTML = '';
    config.forEach((field, index) => {
        const item = document.createElement('div');
        item.className = 'form-field-item';
        item.draggable = true;
        item.dataset.index = index;

        // Drag Events
        item.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', index);
            item.classList.add('dragging');
        };
        item.ondragover = (e) => e.preventDefault();
        item.ondrop = (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;
            if (fromIndex !== toIndex) {
                const moved = currentRaceSettings.form_config.splice(fromIndex, 1)[0];
                currentRaceSettings.form_config.splice(toIndex, 0, moved);
                saveRaceSettings();
                renderFormDesigner(currentRaceSettings.form_config);
            }
        };
        item.ondragend = () => item.classList.remove('dragging');

        const topRow = document.createElement('div');
        topRow.style.display = 'flex';
        topRow.style.gap = '5px';
        topRow.style.alignItems = 'center';
        topRow.innerHTML = `
            <div class="drag-handle">☰</div>
            <select onchange="updateFormField(${index}, 'type', this.value)" style="width: 80px; font-size: 0.8rem;">
                <option value="text" ${field.type === 'text' ? 'selected' : ''}>Eingabe</option>
                <option value="select" ${field.type === 'select' ? 'selected' : ''}>Liste</option>
                <option value="paragraph" ${field.type === 'paragraph' ? 'selected' : ''}>Text</option>
            </select>
            <input type="text" placeholder="${field.type === 'paragraph' ? 'Inhalt...' : ''}" 
                value="${field.label}" onchange="updateFormField(${index}, 'label', this.value)" style="flex-grow: 1;">
            <button class="btn btn-outline tiny" onclick="removeFormField(${index})">×</button>
        `;

        item.appendChild(topRow);

        if (field.type === 'select') {
            const optRow = document.createElement('div');
            optRow.style.marginTop = '5px';
            optRow.innerHTML = `<input type="text" placeholder="Optionen (Kat A, Kat B...)" 
                value="${field.options || ''}" onchange="updateFormField(${index}, 'options', this.value)" style="width: 100%; font-size: 0.8rem;">`;
            item.appendChild(optRow);
        }

        formFieldsList.appendChild(item);
    });

    // Add Preview Button
    if (config.length > 0) {
        const previewBtn = document.createElement('button');
        previewBtn.className = 'btn btn-outline tiny designer-preview-btn';
        previewBtn.textContent = '👁 Vorschau';
        previewBtn.style.display = 'block';
        previewBtn.style.width = '100%';
        previewBtn.onclick = () => {
            const mockRace = {
                name: currentRace || "Vorschau",
                settings: currentRaceSettings,
                form_config: config
            };
            openRegistration(mockRace, true);
        };
        formFieldsList.appendChild(previewBtn);
    }
}

window.updateFormField = (index, key, value) => {
    if (!currentRaceSettings.form_config) currentRaceSettings.form_config = [];
    currentRaceSettings.form_config[index][key] = value;
    saveRaceSettings();
    renderFormDesigner(currentRaceSettings.form_config);
};

window.removeFormField = (index) => {
    currentRaceSettings.form_config.splice(index, 1);
    saveRaceSettings();
    renderFormDesigner(currentRaceSettings.form_config);
};

if (addFieldBtn) addFieldBtn.onclick = () => {
    if (!currentRaceSettings.form_config) currentRaceSettings.form_config = [];
    currentRaceSettings.form_config.push({ id: 'field_' + Date.now(), label: 'Neues Feld', type: 'text' });
    saveRaceSettings();
    renderFormDesigner(currentRaceSettings.form_config);
};

async function fetchRaceSettings() {
    if (!currentRace) return;
    try {
        currentRaceSettings = await apiCall(`/${currentRace}/settings`, 'GET');
        updateSettingsUI();
    } catch (e) {
        console.error("Failed to fetch settings", e);
    }
}

async function saveRaceSettings() {
    if (!currentRace || !raceStatusSelect) return;

    const val = raceStatusSelect.value;
    const settingsToSend = {
        allow_registration: val === 'open',
        registration_stop: val === 'registration_stop',
        hidden: val === 'hidden',
        finished: val === 'finished',
        form_config: currentRaceSettings.form_config || [],
        start_num_min: parseInt(startNumMinInput.value) || 0,
        start_num_max: parseInt(startNumMaxInput.value) || 0
    };
    await apiCall(`/${currentRace}/settings`, 'POST', settingsToSend);
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
        if (adminApp.style.display === 'block') {
            await fetchSessions();
            if (currentRace && !editMode) await fetchParticipants();
        } else {
            await fetchPublicRaces();
        }
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

            if (winnerDuration && p.duration === winnerDuration) {
                diffDisplay = 'Bestzeit';
                diffClass = 'best-time';
            } else if (winnerDuration && p.duration > winnerDuration) {
                const diff = p.duration - winnerDuration;
                diffDisplay = `+${diff.toFixed(3)}s`;
                diffClass = 'diff-col';
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
                        <button class="btn-icon" onclick="event.stopPropagation(); downloadSignedPdf(${globalIndex})" title="PDF herunterladen">✉️</button>
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

    activeStartNumber.textContent = `#${p.start_number}`;

    if (viewActivePdfBtn) {
        viewActivePdfBtn.onclick = (e) => {
            e.stopPropagation();
            downloadSignedPdf(activeIndex);
        };
    }

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

    // Checkboxen und deren Daten-Keys definieren
    const checkMapping = [
        { id: 'col-tags', key: 'tags', type: 'array' },
        { id: 'col-start', key: 'start_time', type: 'value' },
        { id: 'col-end', key: 'end_time', type: 'value' },
        { id: 'col-duration', key: 'duration', type: 'value' },
        { id: 'col-gap', key: 'duration', type: 'value' } // Gap basiert auch auf Duration
    ];

    checkMapping.forEach(mapping => {
        const checkbox = document.getElementById(mapping.id);
        const label = checkbox.closest('.check-container');

        // Prüfen, ob IRGENDJEMAND Daten für dieses Feld hat
        const hasData = participants.some(p => {
            if (mapping.type === 'array') {
                return p[mapping.key] && p[mapping.key].length > 0;
            }
            return p[mapping.key] !== null && p[mapping.key] !== undefined && p[mapping.key] !== '';
        });

        if (!hasData) {
            // Wenn keine Daten da sind: uncheck, disable und optisches Feedback
            checkbox.checked = false;
            checkbox.disabled = true;
            if (label) {
                label.style.opacity = '0.4';
                label.style.cursor = 'not-allowed';
                label.title = "Keine Daten in dieser Spalte vorhanden";
            }
        } else {
            // Wenn Daten da sind: wieder aktivierbar machen (Standardmäßig an)
            checkbox.disabled = false;
            checkbox.checked = true; // Optional: true, damit sie bei neuen Daten wieder aktiv ist
            if (label) {
                label.style.opacity = '1';
                label.style.cursor = 'pointer';
                label.title = "";
            }
        }
    });

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
            // Only show login modal if we are clearly in the admin app
            if (adminApp.style.display === 'block' && loginModal && loginModal.style.display !== 'flex') {
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
    const container = document.getElementById('columnConfigList');
    if (!container) return;
    container.innerHTML = '';

    columnConfig.forEach((col, index) => {
        const item = document.createElement('div');
        // Klasse 'disabled-item' nur setzen, wenn die Spalte nicht sichtbar ist
        item.className = `column-config-item ${col.required ? 'required' : ''} ${!col.visible ? 'disabled-item' : ''}`;
        item.draggable = true;
        item.dataset.index = index;

        // Das Schloss wurde entfernt und der Indikator erscheint nur bei !col.required
        item.innerHTML = `
            <div class="drag-icon">
                <span></span><span></span>
                <span></span><span></span>
            </div>
            <span class="col-label">${col.label}</span>
            ${!col.required ? '<div class="visibility-indicator"></div>' : ''}
        `;

        // DOPPELKLICK zum Aktivieren/Deaktivieren
        item.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!col.required) {
                toggleColumn(col.id);
            }
        });

        // Drag & Drop Events
        item.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', index);
            item.classList.add('dragging');
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.column-config-item').forEach(el =>
                el.classList.remove('drag-over-top', 'drag-over-bottom')
            );
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            const draggingItem = document.querySelector('.dragging');
            if (draggingItem === item) return;

            const bounding = item.getBoundingClientRect();
            const offset = e.clientY - bounding.top;

            item.classList.remove('drag-over-top', 'drag-over-bottom');
            if (offset < bounding.height / 2) {
                item.classList.add('drag-over-top');
            } else {
                item.classList.add('drag-over-bottom');
            }
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = index;
            if (fromIndex !== toIndex) {
                const movedItem = columnConfig.splice(fromIndex, 1)[0];
                columnConfig.splice(toIndex, 0, movedItem);
                saveAndRefreshConfig();
            }
        });

        container.appendChild(item);
    });
}



window.toggleColumn = (id) => {
    const col = columnConfig.find(c => c.id === id);
    if (col && !col.required) {
        col.visible = !col.visible;
        saveAndRefreshConfig();
    }
};

function saveAndRefreshConfig() {
    localStorage.setItem('columnConfig', JSON.stringify(columnConfig));
    renderColumnConfig();
    renderTable(); // Aktualisiert die Haupttabelle sofort
}


if (resetColumnsBtn) resetColumnsBtn.onclick = () => {
    if (confirm('Spalten-Einstellungen auf Standard zurücksetzen?')) {
        columnConfig = DEFAULT_COLUMNS.map(c => ({ ...c }));
        saveAndRefreshConfig();
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
    settingsModal.classList.remove('active');
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

if (raceStatusSelect) raceStatusSelect.onchange = saveRaceSettings;


if (adminLoginBtn) adminLoginBtn.onclick = () => {
    loginModal.style.display = 'flex';
    loginUser.focus();
};

if (cancelLoginBtn) cancelLoginBtn.onclick = () => {
    loginModal.style.display = 'none';
    loginError.style.display = 'none';
};

if (startKioskBnt) startKioskBnt.onclick = () => {
    if (!currentRace) return;
    // Open in new tab with obfuscated hash
    const hash = btoa(currentRace);
    const url = `${window.location.origin}${window.location.pathname}?k=${hash}`;
    window.open(url, '_blank');
};

if (backToLandingBtn) backToLandingBtn.onclick = () => {
    if (isRegistrationPreview) showAdminApp();
    else showLandingPage();
};

if (clearSignatureBtn) clearSignatureBtn.onclick = () => signaturePad.clear();

if (submitRegistrationBtn) {
    submitRegistrationBtn.onclick = async () => {
        if (signaturePad.isEmpty()) {
            alert("Bitte unterschreiben Sie das Formular.");
            return;
        }

        let participantName = ""; // Initialize empty
        let participantTags = [];
        let finalPdfUri = null;

        // Pre-check mandatory fields
        const config = currentRaceSettings.form_config || [];
        for (const field of config) {
            if (field.type !== 'paragraph') {
                const input = document.getElementById(`field_${field.id}`);
                if (input && !input.value.trim()) {
                    alert(`Bitte füllen Sie das Feld "${field.label}" aus.`);
                    input.focus();
                    return;
                }
            }
        }

        // Generate final A4 PDF using pdf-lib
        let signedPdfBase64 = null;
        try {
            const pdfDoc = await PDFLib.PDFDocument.create();
            const page = pdfDoc.addPage([595.28, 841.89]); // A4
            const { width, height } = page.getSize();
            const font = await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold);
            const fontRegular = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);

            // Improved Helper for True Inline Text Flow
            const drawInFlow = (text, size, fontObj, isValue = false) => {
                if (!text) return;
                const words = text.split(/(\s+)/); // Keep whitespace
                words.forEach(part => {
                    if (part === '\n') {
                        xOffset = 50;
                        yOffset -= size * 1.5;
                        return;
                    }
                    const partWidth = fontObj.widthOfTextAtSize(part, size);
                    if (xOffset + partWidth > 550) {
                        xOffset = 50;
                        yOffset -= size * 1.5;
                    }

                    if (part.trim() || isValue) {
                        page.drawText(part, { x: xOffset, y: yOffset, size, font: fontObj });
                        if (isValue) {
                            page.drawLine({
                                start: { x: xOffset, y: yOffset - 2 },
                                end: { x: xOffset + partWidth, y: yOffset - 2 },
                                thickness: 0.8,
                                color: PDFLib.rgb(0, 0, 0)
                            });
                        }
                    }
                    xOffset += partWidth;
                });
                if (isValue) xOffset += 5; // Extra spacing after values
            };

            page.drawText(`${currentRace.replace(/_/g, ' ')}`, { x: 50, y: height - 60, size: 24, font });
            page.drawLine({ start: { x: 50, y: height - 75 }, end: { x: 550, y: height - 75 }, thickness: 1, color: PDFLib.rgb(0, 0, 0) });

            let yOffset = height - 120;
            let xOffset = 50;
            const config = currentRaceSettings.form_config || [];

            config.forEach(field => {
                if (field.type === 'paragraph') {
                    drawInFlow(field.label, 11, fontRegular);
                } else {
                    const input = document.getElementById(`field_${field.id}`);
                    if (!input) return;

                    const value = input.value;
                    const label = field.label;

                    if (label.toLowerCase().includes('name') && !participantName) participantName = value;
                    if (label.toLowerCase().includes('tag') || label.toLowerCase().includes('kategorie')) {
                        participantTags = value.split(',').map(t => t.trim());
                    }

                    drawInFlow(value, 12, fontRegular, true);
                }
                // Very simple page boundary check
                if (yOffset < 100) { /* Next page logic would go here */ }
            });

            if (!participantName || participantName === "Gast") {
                alert("Bitte stellen Sie sicher, dass ein Feld für den 'Namen' vorhanden und ausgefüllt ist.");
                return;
            }

            const signatureData = signaturePad.toDataURL();
            const pngImage = await pdfDoc.embedPng(signatureData);
            const pngDims = pngImage.scale(0.4);

            yOffset -= 40;
            page.drawText("Unterschrift:", { x: 50, y: yOffset, size: 12, font });
            page.drawImage(pngImage, {
                x: 50,
                y: yOffset - 110,
                width: pngDims.width,
                height: pngDims.height,
            });

            page.drawText(`Datum: ${new Date().toLocaleString()}`, { x: 50, y: 50, size: 10, font: fontRegular });

            finalPdfUri = await pdfDoc.saveAsBase64({ dataUri: true });
            signedPdfBase64 = finalPdfUri;
        } catch (e) {
            console.error("PDF creation failed", e);
        }

        const regData = {
            name: participantName,
            tags: participantTags,
            signed_pdf: signedPdfBase64
        };

        try {
            const res = await fetch(`${PUBLIC_BASE}/register/${currentRace}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regData)
            });
            if (res.ok) {
                const result = await res.json();

                if (isKioskMode) {
                    alert(`Erfolgreich angemeldet!\nDeine Startnummer: ${result.start_number}`);
                    // Reset Form for next user
                    signaturePad.clear();
                    renderDynamicForm(currentRaceSettings.form_config || []);
                    window.scrollTo(0, 0);
                } else {
                    alert(`Erfolgreich angemeldet! Deine Startnummer: ${result.start_number}\n\nDeine Anmeldung wird nun heruntergeladen.`);
                    // Trigger Download
                    const link = document.createElement('a');
                    link.href = finalPdfUri;
                    link.download = `Anmeldung_${participantName.replace(/\s+/g, '_')}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showLandingPage();
                }
            }
            else {
                const err = await res.json();
                alert("Fehler: " + (err.message || "Anmeldung fehlgeschlagen"));
            }
        } catch (e) {
            alert("Fehler bei der Anmeldung.");
        }
    };
}

window.onclick = (e) => {
    if (e.target == settingsModal) settingsModal.classList.remove('active');
    if (e.target == editParticipantModal) editParticipantModal.classList.remove('active');
    if (e.target == exportModal) exportModal.classList.remove('active');
    if (e.target == loginModal && !adminApp.style.display) loginModal.style.display = 'none';
};

if (importCsvBtn) {
    importCsvBtn.onclick = () => csvFileInput.click();
}

activeSection.addEventListener('click', handleMainAction);
async function downloadSignedPdf(index) {
    const p = participants[index];
    if (!p || !currentRace) return;

    // Matches backend sanitization
    const sanitizeFilename = (num, name) => {
        const cleanName = name.trim().split(/\s+/).join('_').replace(/[^a-zA-Z0-9_-]/g, '');
        return `${num}_${cleanName}.pdf`;
    };

    const filename = sanitizeFilename(p.start_number, p.name);
    const url = `${API_BASE}/${encodeURIComponent(currentRace)}/pdf/${encodeURIComponent(filename)}`;

    try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            alert(`PDF wurde nicht gefunden.\n\nDatei: ${filename}\nGrund: ${errBody.message || response.statusText}`);
            return;
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
    } catch (e) {
        console.error("Download failed", e);
        alert(`Konnte PDF nicht laden: ${e.message}\n\nBitte prüfen Sie die Internetverbindung.`);
    }
}

window.downloadSignedPdf = downloadSignedPdf;

init();
