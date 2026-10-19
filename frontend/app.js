/**
 * app.js – Haupteinstiegspunkt für Race Timer High-Performance
 * Alle Module werden sequenziell in index.html geladen:
 *   js/config.js -> js/state.js -> js/utils.js -> js/api.js -> js/auth.js ->
 *   js/landing.js -> js/table.js -> js/timer.js -> js/designer.js ->
 *   js/export.js -> js/users.js -> app.js
 */

// PDF.js Worker initialisieren
if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// Drucken im Browser abfangen und an MRT-Druckmenü übergeben
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.keyCode === 80)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (typeof openExportMenu === 'function') openExportMenu();
        return false;
    }
}, true);

window.onbeforeprint = (e) => {
    e.preventDefault();
    return false;
};

// Aktive Section Klick-Handler
const activeSectionEl = document.getElementById('activeSection');
if (activeSectionEl) {
    activeSectionEl.addEventListener('click', () => {
        if (typeof handleMainAction === 'function') handleMainAction();
    });
}

// No Permission Overlay Button
const noPermReturnBtn = document.getElementById('noPermReturnBtn');
if (noPermReturnBtn) {
    noPermReturnBtn.addEventListener('click', () => {
        if (typeof showLandingPage === 'function') showLandingPage();
    });
}

// Window Globals für HTML Event-Handler (onclick="...")
window.downloadSignedPdf = typeof downloadSignedPdf !== 'undefined' ? downloadSignedPdf : null;
window.openEditModal     = typeof openEditModal !== 'undefined' ? openEditModal : null;
window.deleteParticipant = typeof deleteParticipant !== 'undefined' ? deleteParticipant : null;
window.showLandingPage   = typeof showLandingPage !== 'undefined' ? showLandingPage : null;

/**
 * Haupt-Initialisierung
 */
async function init() {
    const landingPageEl      = document.getElementById('landingPage');
    const adminAppEl         = document.getElementById('adminApp');
    const registrationPageEl = document.getElementById('registrationPage');

    if (!landingPageEl && !adminAppEl && !registrationPageEl) return;

    // Kiosk-Modus Parameter auswerten (?k=...&y=...)
    const params = new URLSearchParams(window.location.search);
    const kioskParam = params.get('k');
    const key = params.get('y');

    if (kioskParam && key) {
        try {
            const raceName = atob(kioskParam);
            const res = await fetch(`${PUBLIC_BASE}/kiosk/register/${encodeURIComponent(raceName)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 'SECKEY': key }),
                credentials: 'include'
            });

            if (res.ok) {
                const race = await res.json();
                const settings = race?.Race?.settings || {};
                const race_temp = { settings, name: raceName };
                await openRegistration(race_temp, false, true);
                if (typeof startPolling === 'function') startPolling();
                return;
            }
        } catch (e) {
            console.error('Kiosk boot failed', e);
        }
    }

    if (typeof updateSettingsUI === 'function') updateSettingsUI();

    const isLoggedIn = await checkAuthStatus();
    if (isLoggedIn) {
        await showAdminApp();
    } else {
        await showLandingPage();
    }

    if (typeof renderColumnConfig === 'function') renderColumnConfig();

    const publicTagFilterEl = document.getElementById('publicTagFilter');
    if (publicTagFilterEl) {
        publicTagFilterEl.onchange = renderPublicResults;
    }
    document.getElementsByName('rankingMethod').forEach(r => {
        r.onchange = renderPublicResults;
    });

    if (typeof startPolling === 'function') startPolling();
}

// App starten
init();
