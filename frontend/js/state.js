/**
 * js/state.js – Globaler Anwendungszustand
 * Alle Module lesen und schreiben diese Variablen direkt.
 */

/* ── Teilnehmer & Rennen ───────────────────────────────────────── */
let participants        = [];
let activeIndex         = -1;
let currentRace         = localStorage.getItem('currentRace') || '';
let currentTag          = '';
let currentRaceSettings = {};
let pollInterval        = null;

/* ── Start/Edit-Modus ─────────────────────────────────────────── */
let startMode  = localStorage.getItem('startMode') || 'direct';
let editMode   = localStorage.getItem('editMode') === 'true';
let editingIndex = -1;

/* ── Import/Append ───────────────────────────────────────────── */
let isAppendMode  = false;
let pendingAppend = [];

/* ── Benutzer & Permissions ──────────────────────────────────── */
let userPermissions = {};
let releaseInfoCache = null;
let allUsersLocal    = [];
let currentEditingUserRaces      = {};
let currentEditingUserGlobalPerms = {};
let currentEditingRaceName       = '';

/* ── Spalten-Konfiguration ───────────────────────────────────── */
let columnConfig = (() => {
    const saved = JSON.parse(localStorage.getItem('columnConfig')) || [];
    return DEFAULT_COLUMNS.map(def => {
        const existing = saved.find(c => c.id === def.id);
        if (!existing) return { ...def };
        const synced = { ...def, ...existing };
        if (def.required) synced.visible = true;
        return synced;
    });
})();
const savedOrderKeys = columnConfig.map(c => c.id);
columnConfig = [...columnConfig].sort(
    (a, b) => savedOrderKeys.indexOf(a.id) - savedOrderKeys.indexOf(b.id)
);

/* ── PDF / Registrierung ─────────────────────────────────────── */
let signaturePad           = null;
let pdfTextFields          = [];
let isRegistrationPreview  = false;
let isKioskMode            = false;
let uploadedLogoData       = null;

/* ── Public Landing ──────────────────────────────────────────── */
let publicParticipants = [];
let publicRaceData     = null;
