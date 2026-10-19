/**
 * js/timer.js – Live-Timer, Start/Stop, Haupt-Anzeige
 */

const startAudio = new Audio('race-start-beeps-125125.mp3');

/* ── Live-Timer Interval ─────────────────────────────────────── */
setInterval(() => {
    const mainTimer = document.getElementById('mainTimer');
    if (activeIndex !== -1 && participants[activeIndex]) {
        const p = participants[activeIndex];
        if (p.start_time && !p.end_time) updateLiveTimerDisplay(p.start_time, mainTimer);
    }
    document.querySelectorAll('.row-live-timer').forEach(span => {
        updateLiveTimerDisplay(span.dataset.start, span);
    });
}, 100);

function updateLiveTimerDisplay(startTimeIso, element) {
    if (!element || !startTimeIso) return;
    const start = new Date(startTimeIso).getTime();
    const diff  = Date.now() - start;
    if (diff < 0) return;

    const hours = Math.floor(diff / 3600000);
    const mins  = Math.floor((diff % 3600000) / 60000);
    const secs  = Math.floor((diff % 60000) / 1000);
    const ms    = String(diff % 1000).padStart(3, '0');

    const mainTimer = document.getElementById('mainTimer');
    if (element === mainTimer) {
        element.textContent = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
    } else {
        element.textContent = `${(diff / 1000).toFixed(3)}s`;
    }
}

/* ── Teilnehmer auswählen ────────────────────────────────────── */
function selectParticipant(index) {
    activeIndex = index;
    updateActiveDisplay();
    renderTable();
}

function updateActiveDisplay() {
    const activeSection     = document.getElementById('activeSection');
    const activeName        = document.getElementById('activeName');
    const activeStartNumber = document.getElementById('activeStartNumber');
    const mainTimer         = document.getElementById('mainTimer');
    const mainActionBtn     = document.getElementById('mainActionBtn');
    const viewActivePdfBtn  = document.getElementById('viewActivePdfBtn');

    if (activeIndex === -1 || !participants[activeIndex]) {
        if (activeSection) activeSection.style.display = 'none';
        return;
    }

    const p = participants[activeIndex];
    if (activeSection) activeSection.style.display = 'block';

    const tagsHtml = renderTagBadges(p.tags, 'center-tags mobile-hideable-tags');
    if (activeName)     activeName.innerHTML        = `${escapeHtml(p.name)}${tagsHtml}`;
    if (activeStartNumber) activeStartNumber.textContent = `#${p.start_number}`;

    if (viewActivePdfBtn) {
        viewActivePdfBtn.onclick = (e) => { e.stopPropagation(); downloadSignedPdf(activeIndex); };
    }

    if (p.start_time && !p.end_time) {
        const canStop = hasPermission('can_stop');
        if (mainActionBtn) {
            mainActionBtn.textContent = canStop ? 'STOP DRÜCKEN' : 'STOPPEN (KEINE BERECHTIGUNG)';
            mainActionBtn.style.background = canStop ? 'var(--accent-red)' : 'grey';
            mainActionBtn.disabled = !canStop;
        }
    } else {
        const canStart = hasPermission('can_start');
        if (mainActionBtn) {
            mainActionBtn.textContent = canStart ? 'START DRÜCKEN' : 'STARTEN (KEINE BERECHTIGUNG)';
            mainActionBtn.style.background = canStart ? 'var(--accent-green)' : 'grey';
            mainActionBtn.disabled = !canStart;
        }
        if (mainTimer) mainTimer.textContent = p.duration ? p.duration.toFixed(1) + 's' : '00:00:00.0';
    }
}

/* ── Start/Stop Hauptaktion ──────────────────────────────────── */
async function handleMainAction() {
    if (!currentRace || activeIndex === -1 || editMode) return;
    const p = participants[activeIndex];

    const isReady = !p.start_time || p.end_time;
    if (isReady && !hasPermission('can_start')) { showToast('Fehlende Berechtigung: Starten', 'warning'); return; }
    if (!isReady && !hasPermission('can_stop'))  { showToast('Fehlende Berechtigung: Stoppen', 'warning'); return; }

    const now = new Date().toISOString();
    const mainActionBtn = document.getElementById('mainActionBtn');

    if (!p.start_time || p.end_time) {
        if (startMode === 'delayed') {
            if (mainActionBtn) { mainActionBtn.disabled = true; mainActionBtn.textContent = 'WARTE AUF START...'; }
            startAudio.play();
            setTimeout(async () => {
                const delayedNow = new Date().toISOString();
                await apiCall(`/${currentRace}/start/${p.start_number}`, 'POST', { timestamp: delayedNow });
                if (mainActionBtn) mainActionBtn.disabled = false;
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

/* ── Polling ─────────────────────────────────────────────────── */
function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        const adminApp = document.getElementById('adminApp');
        if (adminApp && adminApp.style.display === 'block') {
            await fetchSessions();
            if (currentRace && !editMode) await fetchParticipants();
        }
    }, 2000);
}

/* ── Keyboard navigation ─────────────────────────────────────── */
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
        else                       pIndex = Math.max(pIndex - 1, 0);
        selectParticipant(participants.indexOf(displayList[pIndex]));

        const activeRow = document.querySelector('.active-row');
        if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'p') { e.preventDefault(); openExportMenu(); }
};
