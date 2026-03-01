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
let publicParticipants = [];
let publicRaceData = null;

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
const uploadBtn = document.getElementById('uploadParticipantsBtn');
const fileInput = document.getElementById('tableFileAdd');
const createEmptyRaceBtn = document.getElementById('createEmptyRaceBtn');

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

// User Management Elements
const userListBody = document.getElementById('userListBody');
const addUserBtn = document.getElementById('addUserBtn');
const userEditArea = document.getElementById('userEditArea');
const userEditTitle = document.getElementById('userEditTitle');
const targetUsernameInput = document.getElementById('targetUsername');
const targetPasswordInput = document.getElementById('targetPassword');
const saveUserBtn = document.getElementById('saveUserBtn');
const cancelUserEditBtn = document.getElementById('cancelUserEditBtn');

// Tab Buttons
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
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
const publicTagFilter = document.getElementById('publicTagFilter');
const rankingMethodContainer = document.getElementById('rankingMethodContainer');
const rankMethodBest = document.getElementById('rankMethodBest');
const rankMethodAverage = document.getElementById('rankMethodAverage');

// Form Designer Elements
const formDesignerModal = document.getElementById('formDesignerModal');
const openFormDesignerBtn = document.getElementById('openFormDesignerBtn');
const closeFormDesigner = document.getElementById('closeFormDesigner');
const saveFormDesigner = document.getElementById('saveFormDesigner');
const designerContent = document.getElementById('designerContent');
const designerFooter = document.getElementById('designerFooter');
const toggleFooterBtn = document.getElementById('toggleFooterBtn');
const designerLogoUpload = document.getElementById('designerLogoUpload');

// Block Print Command (Command + P)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.keyCode === 80)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        console.log("Print command blocked.");
        return false;
    }
}, true);

window.onbeforeprint = (e) => {
    e.preventDefault();
    return false;
};

async function init() {
    // Check if we are on a page with the main application UI (index.html)
    // If not, we stop here to avoid errors looking for non-existent elements.
    if (!landingPage && !adminApp && !registrationPage) return;

    const params = new URLSearchParams(window.location.search);
    const kioskParam = params.get('k');
    const key = params.get('y');

    if (kioskParam && key) {
        try {
            const raceName = atob(kioskParam);

            const res = await fetch(`${PUBLIC_BASE}/kiosk/register/${raceName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'SECKEY': key }),
                credentials: 'include'
            });

            const race = await res.json();
            settings = race["Race"]["settings"];
            race_temp = { settings };
            race_temp.name = raceName


            if (race) {
                // Force Kiosk Mode
                await openRegistration(race_temp, false, true);
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

    if (publicTagFilter) publicTagFilter.onchange = renderPublicResults;
    document.getElementsByName('rankingMethod').forEach(r => {
        r.onchange = renderPublicResults;
    });

    if (openFormDesignerBtn) {
        openFormDesignerBtn.onclick = () => {
            // Überprüfen, ob das Gerät ein Mobilgerät ist (z.B. Bildschirmbreite kleiner als 768px)
            if (window.matchMedia("(max-width: 1024px)").matches && ('ontouchstart' in window)) {
                alert("Der Formular-Designer ist nur auf dem Desktop verfügbar.");
                return; // Funktion hier abbrechen
            }

            try {
                let config = currentRaceSettings.form_config || {};
                if (typeof config === 'string') {
                    config = { content: config, footer: "", footerEnabled: false };
                }
                designerContent.innerHTML = config.content || "";
                designerFooter.innerHTML = config.footer || "";
                designerFooter.style.display = config.footerEnabled ? 'block' : 'none';
                formDesignerModal.classList.add('active');
                formDesignerModal.style.display = 'flex';

                // Initialize draggable listeners for any existing logos
                setTimeout(() => {
                    designerContent.querySelectorAll('.draggable-logo').forEach(makeLogoDraggable);
                    // Selection listener for non-draggable items (signatures)
                    designerContent.querySelectorAll('.form-signature-block').forEach(addSelectionListener);
                }, 100);
            } catch (err) {
                console.error("Error opening designer:", err);
            }
        };
    }

    function addSelectionListener(el) {
        el.addEventListener('mousedown', (e) => {
            designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
            el.classList.add('selected-item');
            designerContent.focus();
            // Removed stopPropagation to allow drag logic on logos
        });
    }

    if (closeFormDesigner) closeFormDesigner.onclick = () => {
        formDesignerModal.classList.remove('active');
        formDesignerModal.style.display = 'none';
    };

    if (saveFormDesigner) saveFormDesigner.onclick = async () => {
        currentRaceSettings.form_config = {
            content: designerContent.innerHTML,
            footer: designerFooter.innerHTML,
            footerEnabled: designerFooter.style.display !== 'none'
        };
        await saveRaceSettings();
        formDesignerModal.classList.remove('active');
        formDesignerModal.style.display = 'none';
        alert("Formular gespeichert!");
    };

    if (toggleFooterBtn) toggleFooterBtn.onclick = () => {
        designerFooter.style.display = designerFooter.style.display === 'none' ? 'block' : 'none';
    };

    if (designerLogoUpload) designerLogoUpload.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            insertDraggableLogo(ev.target.result);
        };
        reader.readAsDataURL(file);
    };

    // Designer Toolbar logic - Bold, Italic, etc.
    document.querySelectorAll('.tool-btn[data-command]').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const command = btn.dataset.command;

            // Smart select word if no character is selected
            smartWordSelection();

            document.execCommand(command, false, null);
            designerContent.focus();
        };
    });

    // Font, Size, Color
    const fontSelect = document.getElementById('fontFamilySelect');
    if (fontSelect) fontSelect.onchange = () => {
        smartWordSelection();
        document.execCommand('fontName', false, fontSelect.value);
    };

    const sizeSelect = document.getElementById('fontSizeSelect');
    if (sizeSelect) sizeSelect.onchange = () => {
        smartWordSelection();
        document.execCommand('fontSize', false, sizeSelect.value);
    };

    const colorPicker = document.getElementById('textColorPicker');
    if (colorPicker) colorPicker.oninput = () => {
        smartWordSelection();
        document.execCommand('foreColor', false, colorPicker.value);
    };

    // Tab key handling and Deletion via key
    designerContent.onkeydown = (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            const selected = designerContent.querySelector('.selected-item');
            // If we have a selected atomic item (logo/signature), delete it
            if (selected) {
                e.preventDefault();
                selected.remove();
            }
        }
    };

    // Placeholder buttons
    document.querySelectorAll('.placeholder-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const val = btn.dataset.value;
            designerContent.focus();
            document.execCommand('insertText', false, val);
        };
    });

    designerContent.onclick = (e) => {
        if (!e.target.closest('.selected-item')) {
            designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
        }
    };

    // Global Context Menu handling
    designerContent.oncontextmenu = (e) => {
        const target = e.target.closest('.draggable-logo, .form-line, .form-signature-block');
        if (target) {
            e.preventDefault();
            showDesignerContextMenu(e.pageX, e.pageY, target);
        }
    };

    document.addEventListener('click', () => {
        const cm = document.getElementById('designerContextMenu');
        if (cm) cm.style.display = 'none';
    });

    function smartWordSelection() {
        const selection = window.getSelection();
        if (selection.rangeCount > 0 && selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            const node = range.startContainer;
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.textContent;
                let start = range.startOffset;
                let end = range.startOffset;

                while (start > 0 && /\w/.test(text[start - 1])) start--;
                while (end < text.length && /\w/.test(text[end])) end++;

                if (start !== end) {
                    const newRange = document.createRange();
                    newRange.setStart(node, start);
                    newRange.setEnd(node, end);
                    selection.removeAllRanges();
                    selection.addRange(newRange);
                }
            }
        }
    }

    document.querySelectorAll('.insert-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            const type = btn.dataset.type;
            insertDesignerElement(type);
        };
    });

    startPolling();
}

function insertDesignerElement(type) {
    designerContent.focus();
    let html = "";
    if (type === 'text') {
        const label = prompt("Feld-Name (z.B. Verein):", "Neues Feld");
        if (!label) return;
        html = `<span class="designer-field-helper">[</span><input type="text" class="form-input-inline" data-field-name="${label}" placeholder="${label}"><span class="designer-field-helper">]</span>&nbsp;`;
        document.execCommand('insertHTML', false, html);
    } else if (type === 'select') {
        const label = prompt("Name der Auswahl:", "Optionen");
        const options = prompt("Optionen (kommagetrennt):", "Ja, Kein");
        if (!label || !options) return;
        const optsHtml = options.split(',').map(o => `<option>${o.trim()}</option>`).join('');
        html = `<span class="designer-field-helper">[</span><select class="form-select-inline" data-field-name="${label}">${optsHtml}</select><span class="designer-field-helper">]</span>&nbsp;`;
        document.execCommand('insertHTML', false, html);
    } else if (type === 'line') {
        html = '<div class="form-line" contenteditable="false"></div>';
        document.execCommand('insertHTML', false, html);
        // Add listener to new line for selection
        setTimeout(() => {
            const lines = designerContent.querySelectorAll('.form-line');
            addSelectionListener(lines[lines.length - 1]);
        }, 50);
    } else if (type === 'logo') {
        designerLogoUpload.click();
    } else if (type === 'signature') {
        html = `<div class="form-signature-block" contenteditable="false" style="margin-top: 20px;">
                    <div class="form-signature-box"></div>
                    <div class="form-signature-label">Unterschrift Teilnehmer</div>
                </div>`;
        document.execCommand('insertHTML', false, html);
        // Add listener to new signature for selection
        setTimeout(() => {
            const sigs = designerContent.querySelectorAll('.form-signature-block');
            addSelectionListener(sigs[sigs.length - 1]);
        }, 50);
    }
}

function showDesignerContextMenu(x, y, target) {
    const cm = document.getElementById('designerContextMenu');
    cm.innerHTML = '';
    cm.style.display = 'block';
    cm.style.left = x + 'px';
    cm.style.top = y + 'px';

    if (target.classList.contains('draggable-logo')) {
        addCMItem("Bild löschen", () => target.remove(), "danger");
    } else if (target.classList.contains('form-line')) {
        addCMItem("Linie löschen", () => target.remove(), "danger");
        addCMItem("Farbe ändern", () => {
            const color = prompt("Strichfarbe (Hex oder Name):", "#000");
            if (color) target.style.backgroundColor = color;
        });
        addCMItem("Stil: Gepunktet", () => {
            target.style.height = "1px";
            target.style.backgroundColor = "transparent";
            target.style.borderBottom = "2px dotted #000";
        });
        addCMItem("Stil: Durchgezogen", () => {
            target.style.height = "2px";
            target.style.borderBottom = "none";
            target.style.backgroundColor = "#000";
        });
    } else if (target.classList.contains('form-signature-block')) {
        addCMItem("Unterschrift löschen", () => target.remove(), "danger");
    }

    function addCMItem(text, action, type = "") {
        const item = document.createElement('div');
        item.className = 'context-item ' + type;
        item.textContent = text;
        item.onclick = () => {
            action();
            cm.style.display = 'none';
        };
        cm.appendChild(item);
    }
}

function insertDraggableLogo(src) {
    const id = 'logo_' + Date.now();
    const div = document.createElement('div');
    div.className = 'draggable-logo';
    div.id = id;
    div.style.left = '50px';
    div.style.top = '100px';
    div.style.width = '100px';
    div.setAttribute('contenteditable', 'false');

    div.innerHTML = `
        <img src="${src}">
        <div class="resize-handle"></div>
    `;

    designerContent.appendChild(div);
    makeLogoDraggable(div);
}

function makeLogoDraggable(el) {
    let isDragging = false;
    let isResizing = false;
    let startX, startY, startWidth, startLeft, startTop;

    el.onmousedown = (e) => {
        // Prevent text selection on drag/resize, but allow it elsewhere
        if (e.target.classList.contains('resize-handle') || e.target === el) {
            e.preventDefault();
        }

        // Selection handling
        designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
        el.classList.add('selected-item');
        designerContent.focus();

        if (e.target.classList.contains('resize-handle')) {
            isResizing = true;
        } else {
            isDragging = true;
        }

        startX = e.clientX;
        startY = e.clientY;
        startWidth = el.offsetWidth;
        startLeft = el.offsetLeft;
        startTop = el.offsetTop;

        document.onmousemove = (me) => {
            if (isDragging) {
                el.style.left = (startLeft + me.clientX - startX) + 'px';
                el.style.top = (startTop + me.clientY - startY) + 'px';
            } else if (isResizing) {
                el.style.width = (startWidth + me.clientX - startX) + 'px';
            }
        };

        document.onmouseup = () => {
            isDragging = false;
            isResizing = false;
            document.onmousemove = null;
            document.onmouseup = null;
        };

        // Prevent default only if intentionally dragging/resizing
        // but we need selection to work, so we don't preventDefault here
    };
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

    const upcoming = races.filter(r => r.settings.displaytype !== 'finished' && r.settings.displaytype !== 'hidden');
    const finished = races.filter(r => r.settings.displaytype === 'finished' && r.settings.displaytype !== 'hidden');

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
    if (race.settings.displaytype === 'finished') {
        statusBadge = '<span class="badge badge-closed">Beendet</span>';
    } else if (race.settings.displaytype === "open") {
        statusBadge = '<span class="badge badge-live">Anmeldung Offen</span>';
    } else if (race.settings.displaytype === 'registration_stop') {
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
            ${(race.settings.displaytype === 'finished' || race.settings.displaytype === 'registration_stop') ? 'Ergebnisse / Liste' : 'Details / Anmeldung'}
        </button>
    `;

    card.onclick = () => {
        if (race.settings.displaytype === "open") {
            openRegistration(race);
        } else {
            showPublicResults(race);
        }
    };
    return card;
}

async function showPublicResults(race) {
    hideAllViews();
    publicRaceData = race;
    currentRace = race.name;
    resultsTitle.textContent = race.name.replace(/_/g, ' ');
    resultsSubtitle.textContent = race.settings.displaytype === 'finished' ? 'Offizielle Endergebnisse' : 'Aktuelle Teilnehmerliste';

    if (publicResultsPage) publicResultsPage.style.display = 'block';

    // Reset controls
    if (publicTagFilter) publicTagFilter.value = "";

    // Check ranking options
    if (rankingMethodContainer) {
        const canBest = race.settings.rank_method_best !== false;
        const canAvg = race.settings.rank_method_average === true;

        if (canBest && canAvg) {
            rankingMethodContainer.style.display = 'flex';
        } else {
            rankingMethodContainer.style.display = 'none';
        }

        // Force correct radio selection based on available methods
        if (canAvg && !canBest) {
            const avgRadio = document.querySelector('input[name="rankingMethod"][value="average"]');
            if (avgRadio) avgRadio.checked = true;
        } else {
            const bestRadio = document.querySelector('input[name="rankingMethod"][value="best"]');
            if (bestRadio) bestRadio.checked = true;
        }
    }

    publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Lade Daten...</td></tr>';

    try {
        const res = await fetch(`${PUBLIC_BASE}/results/${race.name}`);
        if (!res.ok) throw new Error("Fehler beim Laden");
        publicParticipants = await res.json();

        // Fill tag filter
        const tags = new Set();
        publicParticipants.forEach(p => p.tags.forEach(t => tags.add(t)));
        if (publicTagFilter) {
            const currentVal = publicTagFilter.value;
            publicTagFilter.innerHTML = '<option value="">Alle Kategorien</option>';
            Array.from(tags).sort().forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t;
                publicTagFilter.appendChild(opt);
            });
            publicTagFilter.value = currentVal;
        }

        renderPublicResults();

    } catch (e) {
        console.error(e);
        publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:red;">Daten konnten nicht geladen werden.</td></tr>';
    }
}

function renderPublicResults() {
    if (!publicRaceData || !publicParticipants) return;

    const race = publicRaceData;
    const selectedTag = publicTagFilter ? publicTagFilter.value : "";
    const methodRadio = document.querySelector('input[name="rankingMethod"]:checked');
    const rankingMethod = methodRadio ? methodRadio.value : "best";

    let filtered = publicParticipants.filter(p => !selectedTag || p.tags.includes(selectedTag));

    // Calculate Average for the filtered set if needed
    const finishedFiltered = filtered.filter(p => p.duration);
    const avgDuration = finishedFiltered.length > 0
        ? finishedFiltered.reduce((acc, p) => acc + p.duration, 0) / finishedFiltered.length
        : 0;

    // Sort
    if (race.settings.displaytype === 'finished') {
        if (rankingMethod === 'average' && finishedFiltered.length > 0) {
            filtered.sort((a, b) => {
                if (a.duration && b.duration) return Math.abs(a.duration - avgDuration) - Math.abs(b.duration - avgDuration);
                if (a.duration) return -1;
                if (b.duration) return 1;
                return 0;
            });
        } else {
            filtered.sort((a, b) => {
                if (a.duration && b.duration) return a.duration - b.duration;
                if (a.duration) return -1;
                if (b.duration) return 1;
                return 0;
            });
        }
    } else {
        filtered.sort((a, b) => a.start_number - b.start_number);
    }

    // Header
    let headerHtml = `<th>#</th><th>Name</th><th>Kategorie</th>`;
    if (race.settings.displaytype === 'finished') {
        headerHtml += `<th>Zeit</th>`;
        if (rankingMethod === 'average') headerHtml += `<th>Abw.</th>`;
        headerHtml += `<th>Platz</th>`;
    } else {
        headerHtml += `<th>Status</th>`;
    }
    publicResultsHeader.innerHTML = headerHtml;

    // Body
    publicResultsBody.innerHTML = '';

    // Rank calculation
    if (race.settings.displaytype === 'finished') {
        filtered.forEach((p, i) => {
            if (p.duration) {
                let currentVal = p.duration;
                let prevVal = i > 0 ? filtered[i - 1].duration : null;

                if (rankingMethod === 'average') {
                    currentVal = Math.abs(p.duration - avgDuration);
                    prevVal = i > 0 ? Math.abs(filtered[i - 1].duration - avgDuration) : null;
                }

                if (i > 0 && currentVal === prevVal) {
                    p.rank = filtered[i - 1].rank;
                } else {
                    p.rank = i + 1;
                }
            } else {
                p.rank = '-';
            }
        });
    }

    filtered.forEach((p) => {
        const tr = document.createElement('tr');
        if (race.settings.displaytype === 'finished' && p.rank === 1) {
            tr.classList.add('rank-1');
        }

        let timeStr = p.duration ? p.duration.toFixed(3) + 's' : '-';

        let statusStr = '';
        if (p.end_time) statusStr = '<span class="status-badge status-finished">Fertig</span>';
        else if (p.start_time) statusStr = '<span class="status-badge status-running">Unterwegs</span>';
        else statusStr = '<span class="status-badge status-ready">Bereit</span>';

        let html = `<td data-label="Startnr.">${p.start_number}</td><td data-label="Name">${p.name}</td><td data-label="Kategorie">${p.tags.join(', ')}</td>`;
        if (race.settings.displaytype === 'finished') {
            html += `<td data-label="Dauer">${timeStr}</td>`;
            if (rankingMethod === 'average') {
                const diff = p.duration ? (p.duration - avgDuration).toFixed(3) : '-';
                const color = p.duration ? (p.duration > avgDuration ? 'var(--accent-red)' : 'var(--accent-green)') : 'inherit';
                html += `<td data-label="Abweichung" style="color:${color}; font-family: monospace; font-weight:700;">${p.duration ? (diff > 0 ? '+' : '') + diff + 's' : '-'}</td>`;
            }
            html += `<td data-label="Platz">${p.rank}${p.rank !== '-' ? '.' : ''}</td>`;
        } else {
            html += `<td data-label="Status">${statusStr}</td>`;
        }
        tr.innerHTML = html;
        publicResultsBody.appendChild(tr);
    });

    if (filtered.length === 0) {
        publicResultsBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">${publicParticipants.length === 0 ? 'Noch keine Teilnehmer angemeldet.' : 'Keine Teilnehmer in dieser Kategorie.'}</td></tr>`;
    }
}


async function openRegistration(race, isPreview = false, isKiosk = false) {
    hideAllViews();
    isRegistrationPreview = isPreview;
    isKioskMode = isKiosk;
    currentRace = race.name;

    // Fetch full settings if we only have the lite version (from /public/races)
    if (!race.settings || !race.settings.form_config) {
        try {
            const res = await fetch(`${PUBLIC_BASE}/settings/${race.name}`);
            if (res.ok) {
                currentRaceSettings = await res.json();
            } else {
                currentRaceSettings = race.settings || {};
            }
        } catch (e) {
            console.error("Failed to fetch full settings", e);
            currentRaceSettings = race.settings || {};
        }
    } else {
        currentRaceSettings = race.settings;
    }

    if (backToLandingBtn) {
        backToLandingBtn.style.display = isKiosk ? 'none' : 'block';
    }

    if (isKiosk) {
        // Prevent browser back navigation
        window.history.pushState(null, null, window.location.href);
        window.onpopstate = () => window.history.go(1);
    }

    // Hide header if kiosk
    const regHeader = document.querySelector('.a4-header');
    if (regHeader) regHeader.style.display = isKiosk ? 'none' : 'block';

    if (regA4Title) regA4Title.textContent = race.name.replace(/_/g, ' ');
    if (registrationPage) registrationPage.style.display = 'block';

    // Render the dynamic form from config (HTML string)
    renderDynamicForm(currentRaceSettings.form_config);

    // Handle Preview Mode
    if (submitRegistrationBtn) {
        if (isPreview) {
            submitRegistrationBtn.textContent = "VORSCHAU-MODUS (Kein Absenden)";
            submitRegistrationBtn.disabled = true;
            submitRegistrationBtn.style.opacity = "0.5";
        } else {
            submitRegistrationBtn.textContent = "JETZT REGISTRIEREN";
            submitRegistrationBtn.disabled = false;
            submitRegistrationBtn.style.opacity = "1";
        }
    }

    // Init Signature Pad
    const canvas = document.getElementById('signaturePad');
    if (canvas) {
        signaturePad = new SignaturePad(canvas, {
            backgroundColor: 'rgba(255, 255, 255, 0)',
            penColor: 'rgb(0, 0, 0)'
        });

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
}

function renderDynamicForm(config) {
    if (!config) {
        dynamicFormContainer.innerHTML = '<p style="color: #666; font-style: italic;">Kein Formular konfiguriert.</p>';
        return;
    }

    const content = typeof config === 'string' ? config : (config.content || "");
    const footer = typeof config === 'string' ? "" : (config.footer || "");
    const footerEnabled = typeof config === 'string' ? false : !!config.footerEnabled;

    // Helper for placeholders
    const replaceAllPlaceholders = (text) => {
        const now = new Date();
        let p = text;
        p = p.replace(/\[DATUM\]/g, now.toLocaleDateString());
        p = p.replace(/\[ZEIT\]/g, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        p = p.replace(/\[EVENT\]/g, currentRace.replace(/_/g, ' '));
        return p;
    };

    // Render content with placeholders
    dynamicFormContainer.innerHTML = replaceAllPlaceholders(content);

    // Render footer
    const footerEl = document.getElementById('dynamicFormFooter');
    if (footerEl) {
        if (footerEnabled && footer) {
            footerEl.innerHTML = replaceAllPlaceholders(footer);
            footerEl.style.display = 'block';
        } else {
            footerEl.style.display = 'none';
        }
    }

    // Handle signatures
    const sigPlaceholders = dynamicFormContainer.querySelectorAll('.form-signature-block');
    const sigSection = document.querySelector('.signature-section');

    if (sigPlaceholders.length > 0) {
        sigPlaceholders.forEach((block, idx) => {
            const targetBox = block.querySelector('.form-signature-box');
            if (targetBox && idx === 0) { // Move real pad to first placeholder
                if (sigSection) {
                    targetBox.appendChild(sigSection);
                    sigSection.style.marginTop = "0";
                    sigSection.style.display = "block";
                }
            } else if (targetBox) {
                targetBox.innerHTML = '<div style="height:100%; border:1px solid #ccc; background:#f9f9f9; display:flex; align-items:center; justify-content:center; font-size:10px; color:#999;">Unterschrift Feld</div>';
            }
        });
    } else if (sigSection) {
        // If no signature block in designer, move it BACK to its original spot after dynamicFormContainer
        dynamicFormContainer.after(sigSection);
        sigSection.style.display = "block";
    }
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
    if (raceStatusSelect && currentRaceSettings.displaytype) {
        raceStatusSelect.value = currentRaceSettings.displaytype;
    }

    if (startNumMinInput) startNumMinInput.value = currentRaceSettings.start_num_min || '';
    if (startNumMaxInput) startNumMaxInput.value = currentRaceSettings.start_num_max || '';

    if (rankMethodBest) rankMethodBest.checked = currentRaceSettings.rank_method_best !== false;
    if (rankMethodAverage) rankMethodAverage.checked = !!currentRaceSettings.rank_method_average;

    renderTable();
}



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
        "displaytype": val,
        form_config: currentRaceSettings.form_config || ""
    };


    if (parseInt(startNumMinInput.value)) {
        settingsToSend.start_num_min = parseInt(startNumMinInput.value);
    }

    if (parseInt(startNumMaxInput.value)) {
        settingsToSend.start_num_max = parseInt(startNumMaxInput.value);
    }

    if (rankMethodBest) settingsToSend.rank_method_best = rankMethodBest.checked;
    if (rankMethodAverage) settingsToSend.rank_method_average = rankMethodAverage.checked;

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
        } else if (landingPage.style.display === 'block') {
            await fetchPublicRaces();
        } else if (publicResultsPage.style.display === 'block' && currentRace) {
            // For public results, we poll the results endpoint
            try {
                const res = await fetch(`${PUBLIC_BASE}/results/${currentRace}`);
                if (res.ok) {
                    publicParticipants = await res.json();
                    renderPublicResults();
                }
            } catch (e) { console.error("Poll results failed", e); }
        }
        // If on registrationPage, we don't need to poll anything from backend
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
    displayList.filter(p => (!(p.duration > 0) && p.end_time)).forEach(p => {
        const start = new Date(p.start_time);
        const end = new Date(p.end_time);
        p.duration = (end - start) / 1000;
    });

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
        } else if ((p.end_time) || (!p.start_time && !p.end_time && p.duration > 0)) {
            status = 'Fertig';
            badgeClass = 'status-finished';
            if (p.end_time) {
                const start = new Date(p.start_time);
                const end = new Date(p.end_time);
                durationDisplay = ((end - start) / 1000).toFixed(3) + 's';
            } else { durationDisplay = (p.duration || 0).toFixed(3) + 's'; }

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
    await apiCall(`/${currentRace}/people`, 'PUT', participants);
    editParticipantModal.classList.remove('active');
    await fetchParticipants();
};
window.deleteParticipant = async (index) => {
    if (!confirm(`Teilnehmer ${participants[index].name} wirklich löschen?`)) return;
    participants.splice(index, 1);
    await apiCall(`/${currentRace}/people`, 'PUT', participants);
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

async function apiCall(endpoint, method, body = null, base = API_BASE) {
    try {
        const res = await fetch(`${base}${endpoint}`, {
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
    fetchRaceSettings(); // Also load settings for the new race
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
            await apiCall(`/${raceName}/full`, 'PUT', fullData);
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
                duration = item['Duration'] || item['Dauer'] || item['Zeit'];


                return {
                    id: sn.toString(),
                    name: item['Name'] || item['Full Name'] || `Person ${i + 1}`,
                    start_number: sn,
                    tags: tags,
                    start_time: null,
                    end_time: null,
                    duration: duration
                };
            });
            await apiCall(`/${raceName}/people`, 'PUT', people);
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
            await apiCall(`/${raceName}/people`, 'PUT', people);
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

settingsBtn.onclick = () => {
    fetchRaceSettings(); // Fetch current values when opening
    settingsModal.classList.add('active');
    // Default to first tab
    tabButtons[0].click();
};

closeSettings.onclick = () => {
    settingsModal.classList.remove('active')
    saveRaceSettings();
};

// Tab Switching
tabButtons.forEach(btn => {
    btn.onclick = () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        document.getElementById(tabId).classList.add('active');
        if (tabId === 'tab-users') fetchUsers();
    };
});

// User Management Logic
async function fetchUsers() {
    try {
        const users = await apiCall('/users', 'GET', null, AUTH_BASE);
        renderUserList(users);
    } catch (e) {
        console.error("Failed to fetch users", e);
    }
}

function renderUserList(users) {
    userListBody.innerHTML = '';
    users.forEach(username => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${username}</strong></td>
            <td style="text-align:right">
                <button class="btn btn-outline tiny edit-user" data-user="${username}">Passwort ändern</button>
                <button class="btn btn-outline danger-text tiny delete-user" data-user="${username}">Löschen</button>
            </td>
        `;

        tr.querySelector('.edit-user').onclick = () => {
            userEditArea.style.display = 'block';
            userEditTitle.textContent = `Passwort ändern für ${username}`;
            targetUsernameInput.value = username;
            targetUsernameInput.readOnly = true;
            targetPasswordInput.focus();
        };

        tr.querySelector('.delete-user').onclick = () => deleteUser(username);

        userListBody.appendChild(tr);
    });
}

addUserBtn.onclick = () => {
    userEditArea.style.display = 'block';
    userEditTitle.textContent = 'Neuer Benutzer';
    targetUsernameInput.value = '';
    targetUsernameInput.readOnly = false;
    targetPasswordInput.value = '';
    targetUsernameInput.focus();
};

cancelUserEditBtn.onclick = () => {
    userEditArea.style.display = 'none';
};

saveUserBtn.onclick = async () => {
    const username = targetUsernameInput.value;
    const password = targetPasswordInput.value;
    if (!username || !password) return alert("Benutzername und Passwort erforderlich!");

    try {
        await apiCall('/users', 'POST', { username, password }, AUTH_BASE);
        userEditArea.style.display = 'none';
        fetchUsers();
    } catch (e) {
        alert("Speichern fehlgeschlagen: " + e.message);
    }
};

async function deleteUser(username) {
    if (!confirm(`Benutzer ${username} wirklich löschen?`)) return;
    try {
        await apiCall(`/users/${username}`, 'DELETE', null, AUTH_BASE);
        fetchUsers();
    } catch (e) {
        alert("Löschen fehlgeschlagen: " + e.message);
    }
}

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
if (startNumMin) startNumMin.onchange = saveRaceSettings;
if (startNumMax) startNumMax.onchange = saveRaceSettings;


if (adminLoginBtn) adminLoginBtn.onclick = () => {
    loginModal.style.display = 'flex';
    loginUser.focus();
};

if (cancelLoginBtn) cancelLoginBtn.onclick = () => {
    loginModal.style.display = 'none';
    loginError.style.display = 'none';
};

if (startKioskBnt) {
    startKioskBnt.onclick = async () => {
        if (!currentRace) return;

        try {
            const hash = btoa(currentRace);

            const res = await apiCall(`/${currentRace}/genkey`, 'GET');
            const key = res["key"];

            const url = `${window.location.origin}${window.location.pathname}?k=${hash}&y=${key}`;


            open(url, '_blank');
            //open(url, '_blank', );
        } catch (err) {
            console.error("Kiosk launch failed:", err);
        }

    };
}

if (backToLandingBtn) backToLandingBtn.onclick = () => {
    if (isRegistrationPreview) showAdminApp();
    else showLandingPage();
};

if (clearSignatureBtn) clearSignatureBtn.onclick = () => signaturePad.clear();

/**
 * Generiert das fertige PDF basierend auf dem aktuellen Formular-Inhalt.
 * Gibt ein Objekt mit { pdfBase64, name, tags } zurück oder null bei Fehlern.
 */
async function generateRegistrationPdf() {
    const participantNameInput = document.querySelector('input[data-field-name*="name" i]') ||
        document.querySelector('input[data-field-name*="teilnehmer" i]');
    const participantName = participantNameInput ? participantNameInput.value : "Gast";

    const participantTags = [];
    const allInputs = dynamicFormContainer.querySelectorAll('input, select');
    for (const input of allInputs) {
        const label = (input.dataset.fieldName || "").toLowerCase();
        const value = input.value;
        if (label.includes('tag') || label.includes('kategorie') || label.includes('verein')) {
            participantTags.push(value);
        }
    }

    if (!participantName || participantName.toLowerCase() === "gast") {
        alert("Bitte stellen Sie sicher, dass ein Namensfeld vorhanden und ausgefüllt ist.");
        return null;
    }

    try {
        const pdfDoc = await PDFLib.PDFDocument.create();
        const page = pdfDoc.addPage([595.28, 841.89]);
        const { width, height } = page.getSize();

        const fonts = {
            helvetica: await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica),
            helveticaBold: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold),
            helveticaOblique: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
            helveticaBoldOblique: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
            times: await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman),
            timesBold: await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold),
            timesItalic: await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanItalic),
            timesBoldItalic: await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic),
            courier: await pdfDoc.embedFont(PDFLib.StandardFonts.Courier),
            courierBold: await pdfDoc.embedFont(PDFLib.StandardFonts.CourierBold),
            courierOblique: await pdfDoc.embedFont(PDFLib.StandardFonts.CourierOblique),
            courierBoldOblique: await pdfDoc.embedFont(PDFLib.StandardFonts.CourierBoldOblique),
        };

        const parseColor = (colorStr) => {
            if (!colorStr || colorStr === 'transparent' || colorStr === 'inherit' || colorStr === 'initial') return PDFLib.rgb(0, 0, 0);
            const rgb = colorStr.match(/\d+/g);
            if (rgb && rgb.length >= 3) {
                return PDFLib.rgb(parseInt(rgb[0]) / 255, parseInt(rgb[1]) / 255, parseInt(rgb[2]) / 255);
            }
            if (colorStr.startsWith('#')) {
                const hex = colorStr.replace('#', '');
                if (hex.length === 3) {
                    const r = parseInt(hex[0] + hex[0], 16) / 255;
                    const g = parseInt(hex[1] + hex[1], 16) / 255;
                    const b = parseInt(hex[2] + hex[2], 16) / 255;
                    return PDFLib.rgb(r, g, b);
                }
                const r = parseInt(hex.substring(0, 2), 16) / 255;
                const g = parseInt(hex.substring(2, 4), 16) / 255;
                const b = parseInt(hex.substring(4, 6), 16) / 255;
                return PDFLib.rgb(r || 0, g || 0, b || 0);
            }
            return PDFLib.rgb(0, 0, 0);
        };

        const sanitizePdfText = (text) => {
            if (!text) return "";
            return text.replace(/□/g, '[ ]')
                .replace(/■/g, '[x]')
                .replace(/•/g, '-')
                .replace(/·/g, '-')
                .replace(/\uf0b7/g, '-')
                .replace(/\xa0/g, ' ')
                .replace(/–/g, '-')
                .replace(/—/g, '-')
                .replace(/ẞ/g, 'SS')
                .replace(/[\r\n]+/g, ' ') // Replace newlines with space to avoid WinAnsi error
                .replace(/[^\x00-\xFF]/g, '');
        };

        const replacePlaceholders = (text) => {
            if (!text) return "";
            let t = text;
            t = t.replace(/\[DATUM\]/g, new Date().toLocaleDateString('de-DE'));
            t = t.replace(/\[EVENT\]/g, (currentRace || "Event").replace(/_/g, ' '));
            t = t.replace(/\[ZEIT\]/g, new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
            t = t.replace(/: Teilnehmer/g, participantName);
            return t;
        };

        const getFont = (family, isBold, isItalic) => {
            const fam = (family || "helvetica").toLowerCase();
            let font;
            if (fam.includes("times")) {
                if (isBold && isItalic) font = fonts.timesBoldItalic;
                else if (isBold) font = fonts.timesBold;
                else if (isItalic) font = fonts.timesItalic;
                else font = fonts.times;
            } else if (fam.includes("courier")) {
                if (isBold && isItalic) font = fonts.courierBoldOblique;
                else if (isBold) font = fonts.courierBold;
                else if (isItalic) font = fonts.courierOblique;
                else font = fonts.courier;
            } else {
                if (isBold && isItalic) font = fonts.helveticaBoldOblique;
                else if (isBold) font = fonts.helveticaBold;
                else if (isItalic) font = fonts.helveticaOblique;
                else font = fonts.helvetica;
            }
            return font || fonts.helvetica;
        };

        const embedImage = async (src) => {
            try {
                if (src.startsWith('data:')) {
                    const base64 = src.split(',')[1];
                    const binary = atob(base64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const mime = src.split(';')[0].split(':')[1];
                    return mime.includes('png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
                } else {
                    const resp = await fetch(src);
                    const bytes = await resp.arrayBuffer();
                    const contentType = resp.headers.get('content-type') || "";
                    return contentType.includes('png') || src.toLowerCase().includes('.png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
                }
            } catch (e) {
                console.error("Embedding error", e);
                return null;
            }
        };

        let yOffset = height - 60;
        let xOffset = 50;
        let flowStartX = 50;
        const rootElement = document.getElementById('registrationSheet') || dynamicFormContainer;
        const designerWidth = rootElement.offsetWidth || 794;
        const pxToPt = 595.28 / designerWidth;
        const containerRect = rootElement.getBoundingClientRect();

        const drawInFlow = (text, style, isValue = false) => {
            if (!text) return;
            const processed = replacePlaceholders(text);
            const safeText = sanitizePdfText(processed);
            const { font, size, color } = style;
            const words = safeText.split(/(\s+)/);

            words.forEach(part => {
                if (part === '') return;

                const partWidth = font.widthOfTextAtSize(part, size);
                if (xOffset + partWidth > 545) {
                    xOffset = flowStartX; yOffset -= size * 1.5;
                }

                page.drawText(part, { x: xOffset, y: yOffset, size, font, color });
                if (isValue && part.trim()) {
                    page.drawLine({
                        start: { x: xOffset, y: yOffset - 2 },
                        end: { x: xOffset + partWidth, y: yOffset - 2 },
                        thickness: 0.8, color
                    });
                }
                xOffset += partWidth;
            });




        };

        const processNodes = async (nodes, inheritedStyle) => {
            for (const node of nodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const computed = window.getComputedStyle(node);
                    if (computed.display === 'none' || computed.visibility === 'hidden') continue;
                    if (node.classList.contains('btn') || node.classList.contains('designer-field-helper') || node.id === 'clearSignatureBtn') continue;

                    const fontFamily = computed.fontFamily;
                    const fontSize = parseFloat(computed.fontSize);
                    const color = parseColor(computed.color);
                    const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 700 || node.nodeName === 'B' || node.nodeName === 'STRONG';
                    const isItalic = computed.fontStyle === 'italic' || node.nodeName === 'I' || node.nodeName === 'EM';

                    const display = computed.display || 'inline';
                    const isBlock = display.includes('block') || display.includes('flex') || ['P', 'H1', 'H2', 'H3', 'DIV', 'SECTION', 'HEADER', 'FOOTER'].includes(node.nodeName);

                    let currentStyle = { font: getFont(fontFamily, isBold, isItalic), size: fontSize * pxToPt, color };

                    const position = computed.position;
                    const isFooter = node.classList.contains('a4-designer-footer') || node.id === 'dynamicFormFooter';

                    // Draw border-top if exists (e.g. for signature lines or footer)
                    const borderTop = parseFloat(computed.borderTopWidth);
                    const rect = node.getBoundingClientRect();
                    const leftPt = (rect.left - containerRect.left) * pxToPt;
                    const topPt = (rect.top - containerRect.top) * pxToPt;

                    const isLogo = node.classList.contains('draggable-logo') || node.nodeName === 'IMG';
                    const isSignaturePad = node.nodeName === 'CANVAS' && node.id === 'signaturePad';
                    const isFormLine = node.classList.contains('form-line');

                    // 1. Handle Images / Logos / Signatures FIRST
                    if (isLogo) {
                        const img = node.nodeName === 'IMG' ? node : node.querySelector('img');
                        if (img && img.src) {
                            const embeddedImg = await embedImage(img.src);
                            if (embeddedImg) {
                                const targetWidth = rect.width * pxToPt;
                                const targetHeight = rect.height * pxToPt;
                                const dims = embeddedImg.scaleToFit(targetWidth, targetHeight);
                                page.drawImage(embeddedImg, {
                                    x: leftPt,
                                    y: height - topPt - dims.height,
                                    width: dims.width, height: dims.height
                                });
                                if (position !== 'absolute') {
                                    yOffset = height - topPt - dims.height - 10;
                                }
                            }
                        }
                        continue;
                    }

                    if (isSignaturePad) {
                        if (signaturePad && !signaturePad.isEmpty()) {
                            const signatureData = signaturePad.toDataURL();
                            const sigImg = await embedImage(signatureData);
                            if (sigImg) {
                                const targetWidth = rect.width * pxToPt;
                                const targetHeight = rect.height * pxToPt;
                                const dims = sigImg.scaleToFit(targetWidth, targetHeight);
                                page.drawImage(sigImg, {
                                    x: leftPt,
                                    y: height - topPt - dims.height,
                                    width: dims.width, height: dims.height
                                });
                                yOffset = height - topPt - dims.height - 10;
                                xOffset = flowStartX;
                            }
                        }
                        continue;
                    }

                    if (isFormLine) {
                        const colorLine = parseColor(computed.backgroundColor);
                        const lineY = height - topPt;
                        page.drawLine({
                            start: { x: 50, y: lineY },
                            end: { x: 545, y: lineY },
                            thickness: 1, color: colorLine
                        });
                        yOffset = lineY - 10;
                        continue;
                    }

                    if (borderTop > 0 && computed.borderTopStyle !== 'none' && !node.classList.contains('form-line')) {
                        const lineY = height - topPt;
                        page.drawLine({
                            start: { x: leftPt, y: lineY },
                            end: { x: (rect.right - containerRect.left) * pxToPt, y: lineY },
                            thickness: borderTop * pxToPt,
                            color: parseColor(computed.borderTopColor)
                        });
                    }

                    if (position === 'absolute' || isFooter) {
                        const oldX = xOffset;
                        const oldY = yOffset;
                        const oldStartX = flowStartX;

                        flowStartX = leftPt;
                        xOffset = flowStartX;
                        // Position text baseline below the top of the absolute element
                        yOffset = height - topPt - (currentStyle.size * 0.95);
                        if (borderTop > 0) yOffset -= (borderTop * pxToPt) + 4; // Add gap for line

                        if (node.childNodes.length > 0) {
                            await processNodes(node.childNodes, currentStyle);
                        } else if (node.nodeName === 'INPUT' || node.nodeName === 'SELECT') {
                            drawInFlow((node.value + " ") || " ", currentStyle, true);
                        }

                        xOffset = oldX;
                        yOffset = oldY;
                        flowStartX = oldStartX;
                        continue;
                    }

                    // For regular blocks, synchronize the Y-Offset to match the designer's vertical positioning
                    if (isBlock) {
                        flowStartX = leftPt;
                        xOffset = leftPt;
                        yOffset = height - topPt - (currentStyle.size * 0.95);
                        // Extra gap if a border-top is present (e.g. signature line)
                        if (borderTop > 0) yOffset -= (borderTop * pxToPt) + 6;
                    }



                    if (node.nodeName === 'INPUT' || node.nodeName === 'SELECT') {
                        drawInFlow((node.value + " ") || " ", currentStyle, true);
                    } else if (node.nodeName === 'BR') {
                        xOffset = 50; yOffset -= currentStyle.size * 1.5;
                    } else if (node.nodeName === 'UL' || node.nodeName === 'OL') {
                        const oldX = xOffset; xOffset = 70;
                        const items = node.querySelectorAll('li');
                        for (let i = 0; i < items.length; i++) {
                            const bullet = node.nodeName === 'UL' ? '• ' : `${i + 1}) `;
                            drawInFlow(bullet + items[i].textContent, currentStyle);
                            xOffset = 70; yOffset -= currentStyle.size * 1.2;
                        }
                        xOffset = oldX;
                    } else if (node.childNodes.length > 0) {
                        await processNodes(node.childNodes, currentStyle);
                    }
                } else if (node.nodeType === Node.TEXT_NODE) {
                    if (node.textContent.trim() || node.textContent.includes(' ')) {
                        drawInFlow(node.textContent, inheritedStyle);
                    }
                }
            }
        };

        const defaultStyle = { font: fonts.helvetica, size: 11, color: PDFLib.rgb(0, 0, 0) };
        await processNodes(rootElement.childNodes, defaultStyle);

        const pdfBase64 = await pdfDoc.saveAsBase64({ dataUri: true });
        return { pdfBase64, name: participantName, tags: participantTags };

    } catch (err) {
        console.error("PDF Fehler:", err);
        alert("Fehler beim Erstellen der PDF.");
        return null;
    }
}



// Button-Handler: Registrierung absenden
if (submitRegistrationBtn) {
    submitRegistrationBtn.onclick = async () => {
        // PDF generieren und Daten sammeln
        const result = await generateRegistrationPdf();
        if (!result) return; // Abbruch bei Validierungsfehlern

        const params = new URLSearchParams(window.location.search);
        const key = params.get('y');

        const regData = {
            name: result.name,
            tags: result.tags,
            signed_pdf: result.pdfBase64,
            key: key
        };

        try {
            submitRegistrationBtn.disabled = true;
            submitRegistrationBtn.textContent = "Wird gesendet...";

            const res = await fetch(`${PUBLIC_BASE}/register/${currentRace}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regData)
            });

            if (res.ok) {
                const data = await res.json();

                if (isKioskMode) {
                    alert(`Erfolgreich angemeldet!\nDeine Startnummer: ${data.start_number}`);
                    // Formular zurücksetzen für den nächsten Teilnehmer
                    signaturePad.clear();
                    renderDynamicForm(currentRaceSettings.form_config || {});
                    window.scrollTo(0, 0);
                } else {
                    alert(`Erfolgreich angemeldet!\nStartnummer: ${data.start_number}\n\nDein Beleg wird nun heruntergeladen.`);
                    // Download auslösen
                    const link = document.createElement('a');
                    link.href = result.pdfBase64;
                    link.download = `Anmeldung_${result.name.replace(/\s+/g, '_')}.pdf`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    showLandingPage();
                }
            } else {
                const err = await res.json();
                alert("Fehler: " + (err.message || "Anmeldung fehlgeschlagen."));
            }
        } catch (e) {
            console.error("Submission failed", e);
            alert("Verbindungsfehler bei der Anmeldung.");
        } finally {
            submitRegistrationBtn.disabled = false;
            submitRegistrationBtn.textContent = "JETZT REGISTRIEREN";
        }
    };
}


window.onclick = (e) => {
    if (e.target == settingsModal) settingsModal.classList.remove('active');
    if (e.target == editParticipantModal) editParticipantModal.classList.remove('active');
    if (e.target == exportModal) exportModal.classList.remove('active');
    if (e.target == loginModal && !adminApp.style.display) loginModal.style.display = 'none';
};


// Suche nach: if (importCsvBtn) { ... }
// Und ersetze es hiermit:

if (importCsvBtn) {
    importCsvBtn.onclick = (e) => {
        // Verhindert das Auslösen des Imports, wenn man nur auf den Link im Dropdown klickt
        if (e.target.closest('#createEmptyRaceBtn')) return;
        csvFileInput.click();
    };
}

if (createEmptyRaceBtn) {
    createEmptyRaceBtn.onclick = async (e) => { // async hinzugefügt für await fetch
        e.preventDefault();
        e.stopPropagation();

        const raceNamepr = prompt("Name für die neue Liste:");

        const raceName = raceNamepr.replace(/\.[^/.]+$/, "").replace(/\s+/g, '_');

        if (!raceName || raceName.trim() === "") return;

        const cleanedName = raceName.trim();

        try {
            // 1. Backend-Request: Leeres Rennen erstellen


            const response = await fetch(`${API_BASE}/${encodeURIComponent(cleanedName)}/full`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ people: [] }),
                credentials: 'include'
            });

            if (!response.ok) {
                throw new Error(`Fehler beim Erstellen des Rennens im Backend`);
            }

            // 2. Lokalen State aktualisieren
            participants = [];
            currentRace = cleanedName;
            localStorage.setItem('currentRace', currentRace);

            // 3. Dropdown-Menü (sessionSelect) aktualisieren
            // Wir laden die Sessions neu, damit das Dropdown synchron mit dem Backend ist
            if (typeof fetchSessions === 'function') {
                await fetchSessions();
            } else {
                // Fallback: Manuell hinzufügen, falls fetchSessions nicht verfügbar
                const opt = document.createElement('option');
                opt.value = cleanedName;
                opt.textContent = cleanedName;
                sessionSelect.appendChild(opt);
            }

            // Sofort auf das neue Rennen umschalten
            sessionSelect.value = cleanedName;

            // 4. UI-Elemente aktualisieren
            if (typeof activeName !== 'undefined') activeName.textContent = currentRace;

            // Tabelle leeren und Header für das neue Rennen vorbereiten
            renderTable();

            // 5. Automatisch in den Bearbeitungsmodus wechseln
            editMode = true;
            const editSwitch = document.getElementById('editModeSwitch');
            if (editSwitch) editSwitch.checked = true;

            const editActions = document.getElementById('editActions');
            if (editActions) editActions.style.display = 'flex';

            // Menü schließen
            const content = document.querySelector('.dropdown-content');
            if (content) {
                content.style.display = 'none';
                setTimeout(() => content.style.display = '', 200);
            }

            console.log(`Rennen "${cleanedName}" erfolgreich im Backend erstellt.`);

        } catch (error) {
            console.error(error);
            alert("Fehler beim Erstellen des Rennens: " + error.message);
        }
    };
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
