/**
 * js/table.js – Haupttabelle: renderTable, Spalten-Config,
 *               Edit-Checkboxen, Teilnehmer-CRUD-Modal
 */

/* ── Tabelle rendern ─────────────────────────────────────────── */
function renderTable() {
    const raceBody      = document.getElementById('raceBody');
    const raceTableHead = document.querySelector('#raceTable thead tr');
    if (!raceBody) return;

    /* Sichtbare Spalten ermitteln */
    let visibleCols = columnConfig.filter(c => c.visible);
    if (hasPermission('hide_ranking'))  visibleCols = visibleCols.filter(c => c.id !== 'rank' && c.id !== 'gap');
    if (hasPermission('hide_duration')) visibleCols = visibleCols.filter(c => c.id !== 'duration');

    /* Header */
    raceTableHead.innerHTML = '';
    if (editMode && currentRace) {
        const thCb = document.createElement('th');
        thCb.style.width = '36px';
        thCb.innerHTML = '<input type="checkbox" id="editSelectAll" class="edit-table-check">';
        raceTableHead.appendChild(thCb);
    }
    visibleCols.forEach(col => {
        const th = document.createElement('th');
        th.textContent = col.label;
        if (col.id === 'status' || col.id === 'start' || col.id === 'end') th.classList.add('desktop-only');
        raceTableHead.appendChild(th);
    });
    if (editMode && currentRace) {
        const th = document.createElement('th');
        th.id = 'actionsHeader'; th.textContent = 'Aktionen';
        raceTableHead.appendChild(th);
    }

    raceBody.innerHTML = '';

    /* Anzeigeliste filtern */
    let displayList = participants.filter(p => !currentTag || (p.tags && p.tags.includes(currentTag)));
    if (!hasPermission('can_see_all')) {
        if (hasPermission('can_stop')  && !hasPermission('can_start')) displayList = displayList.filter(p => p.start_time);
        if (hasPermission('can_start') && !hasPermission('can_stop'))  displayList = displayList.filter(p => !p.end_time);
    }

    /* Dauer aus Timestamps ableiten */
    displayList.forEach(p => {
        if (!(p.duration > 0) && p.start_time && p.end_time) {
            const s = new Date(p.start_time).getTime();
            const e = new Date(p.end_time).getTime();
            if (!isNaN(s) && !isNaN(e) && e >= s) p.duration = Math.round(e - s) / 1000;
        }
    });

    /* Rangliste */
    const finishedFiltered = displayList
        .filter(p => typeof p.duration === 'number' && p.duration > 0 && !isNaN(p.duration))
        .sort((a, b) => a.duration - b.duration);
    finishedFiltered.forEach((p, i) => {
        p.rank = (i > 0 && p.duration === finishedFiltered[i - 1].duration) ? finishedFiltered[i - 1].rank : i + 1;
    });
    const winnerDuration = finishedFiltered.length > 0 ? finishedFiltered[0].duration : null;

    displayList.sort((a, b) => a.start_number - b.start_number);

    displayList.forEach(p => {
        const globalIndex = participants.findIndex(o => o.start_number === p.start_number);
        const row = document.createElement('tr');
        if (globalIndex === activeIndex) row.classList.add('active-row');

        let status = 'Bereit', badgeClass = 'status-ready';
        let durationDisplay = '-', rankDisplay = '-', diffDisplay = '-', diffClass = 'diff-col';
        const hasValidDuration = typeof p.duration === 'number' && p.duration > 0 && !isNaN(p.duration);

        if (p.start_time && !p.end_time && !hasValidDuration) {
            status = 'Läuft'; badgeClass = 'status-running';
            durationDisplay = `<span class="row-live-timer" data-start="${p.start_time}">-</span>`;
        } else if (hasValidDuration || (p.start_time && p.end_time)) {
            status = 'Fertig'; badgeClass = 'status-finished';
            const dur = hasValidDuration
                ? p.duration
                : (new Date(p.end_time).getTime() - new Date(p.start_time).getTime()) / 1000;
            durationDisplay = (dur >= 0 ? dur.toFixed(3) : '0.000') + 's';
            if (p.rank && p.rank !== '-') rankDisplay = p.rank + '.';
            if (winnerDuration != null && dur === winnerDuration) { diffDisplay = 'Bestzeit'; diffClass = 'best-time'; }
            else if (winnerDuration != null && dur > winnerDuration) {
                diffDisplay = `+${(dur - winnerDuration).toFixed(3)}s`; diffClass = 'diff-col';
            }
        }

        if (!editMode) row.onclick = () => selectParticipant(globalIndex);

        const tagsHtml = renderTagBadges(p.tags, 'mobile-hideable-tags');
        let rowHtml = '';

        if (editMode && currentRace) {
            rowHtml += `<td style="text-align:center;"><input type="checkbox" class="edit-table-check edit-row-cb" data-index="${globalIndex}"></td>`;
        }

        visibleCols.forEach(col => {
            if      (col.id === 'number')   rowHtml += `<td data-label="Startnr.">#${p.start_number}</td>`;
            else if (col.id === 'name')     rowHtml += `<td data-label="Name">${escapeHtml(p.name)}${tagsHtml}</td>`;
            else if (col.id === 'status')   rowHtml += `<td class="desktop-only"><span class="status-badge ${badgeClass}">${status}</span></td>`;
            else if (col.id === 'start')    rowHtml += `<td data-label="Startzeit" class="desktop-only">${p.start_time ? formatTime(p.start_time) : '-'}</td>`;
            else if (col.id === 'duration') rowHtml += `<td data-label="Dauer">${durationDisplay}</td>`;
            else if (col.id === 'end')      rowHtml += `<td data-label="Endzeit" class="desktop-only">${p.end_time ? formatTime(p.end_time) : '-'}</td>`;
            else if (col.id === 'rank')     rowHtml += `<td data-label="Platz" class="rank-col">${rankDisplay}</td>`;
            else if (col.id === 'gap')      rowHtml += `<td data-label="Rückstand" class="${diffClass}">${diffDisplay}</td>`;
        });

        if (editMode && currentRace) {
            rowHtml += `<td data-label="Aktionen"><div class="edit-row-actions">
                <button class="btn-icon btn-dl-pdf" title="PDF"><iconify-icon icon="mdi:file-eye-outline"></iconify-icon></button>
                <button class="btn-icon btn-edit-part" title="Bearbeiten"><iconify-icon icon="mdi:pencil-outline"></iconify-icon></button>
                <button class="btn-icon danger-icon btn-del-part" title="Löschen"><iconify-icon icon="mdi:trash-can-outline"></iconify-icon></button>
            </div></td>`;
        }

        row.innerHTML = rowHtml;

        if (editMode && currentRace) {
            const dlBtn   = row.querySelector('.btn-dl-pdf');
            const editBtn = row.querySelector('.btn-edit-part');
            const delBtn  = row.querySelector('.btn-del-part');
            if (dlBtn)   dlBtn.addEventListener('click',   e => { e.stopPropagation(); downloadSignedPdf(globalIndex); });
            if (editBtn) editBtn.addEventListener('click', e => { e.stopPropagation(); openEditModal(globalIndex); });
            if (delBtn)  delBtn.addEventListener('click',  e => { e.stopPropagation(); deleteParticipant(globalIndex); });
        }

        raceBody.appendChild(row);
    });

    if (!editMode && activeIndex === -1 && participants.length > 0) {
        const nextIdx = participants.findIndex(p => !p.end_time);
        if (nextIdx !== -1) selectParticipant(nextIdx);
    }

    if (editMode && currentRace) setupEditCheckboxes();
}

/* ── Bulk-Selektion ──────────────────────────────────────────── */
function setupEditCheckboxes() {
    const raceBody    = document.getElementById('raceBody');
    const selectAll   = document.getElementById('editSelectAll');
    const bulkActions = document.getElementById('bulkActions');
    const bulkCount   = document.getElementById('bulkSelectionCount');

    const updateBulkUI = () => {
        const checked = raceBody.querySelectorAll('.edit-row-cb:checked');
        const total   = raceBody.querySelectorAll('.edit-row-cb');
        const count   = checked.length;
        if (bulkActions) bulkActions.style.display = count > 0 ? 'flex' : 'none';
        if (bulkCount)   bulkCount.textContent      = `${count} ausgewählt`;
        if (selectAll) {
            selectAll.checked       = count === total.length && total.length > 0;
            selectAll.indeterminate = count > 0 && count < total.length;
        }
    };

    raceBody.querySelectorAll('.edit-row-cb').forEach(cb => {
        cb.onchange = () => {
            cb.closest('tr').style.background = cb.checked ? 'rgba(99,102,241,0.1)' : '';
            updateBulkUI();
        };
    });

    if (selectAll) {
        selectAll.onchange = () => {
            raceBody.querySelectorAll('.edit-row-cb').forEach(cb => {
                cb.checked = selectAll.checked;
                cb.closest('tr').style.background = cb.checked ? 'rgba(99,102,241,0.1)' : '';
            });
            updateBulkUI();
        };
    }
    updateBulkUI();
}

function getSelectedIndices() {
    const raceBody = document.getElementById('raceBody');
    return Array.from(raceBody.querySelectorAll('.edit-row-cb:checked'))
        .map(cb => parseInt(cb.dataset.index));
}

/* ── Settings UI ─────────────────────────────────────────────── */
function updateSettingsUI() {
    updateUIPermissions();
    const modeSwitch       = document.getElementById('modeSwitch');
    const editSwitch       = document.getElementById('editSwitch');
    const editActionsView  = document.getElementById('editActions');
    const actionsHeader    = document.getElementById('actionsHeader');
    const raceStatusSelect = document.getElementById('raceStatusSelect');
    const startNumMin      = document.getElementById('startNumMin');
    const startNumMax      = document.getElementById('startNumMax');
    const rankMethodBest   = document.getElementById('rankMethodBest');
    const rankMethodAvg    = document.getElementById('rankMethodAverage');

    if (modeSwitch) modeSwitch.checked = (startMode === 'delayed');
    if (editSwitch) editSwitch.checked = editMode;
    if (editActionsView) editActionsView.style.display = (editMode && currentRace) ? 'block' : 'none';
    if (actionsHeader)   actionsHeader.style.display   = (editMode && currentRace) ? 'table-cell' : 'none';

    if (raceStatusSelect && currentRaceSettings.displaytype)
        raceStatusSelect.value = currentRaceSettings.displaytype;
    if (startNumMin) startNumMin.value = currentRaceSettings.start_num_min || '';
    if (startNumMax) startNumMax.value = currentRaceSettings.start_num_max || '';
    if (rankMethodBest) rankMethodBest.checked = currentRaceSettings.rank_method_best !== false;
    if (rankMethodAvg)  rankMethodAvg.checked  = !!currentRaceSettings.rank_method_average;

    renderTable();
}

/* ── Spalten-Konfiguration ───────────────────────────────────── */
function renderColumnConfig() {
    const container = document.getElementById('columnConfigList');
    if (!container) return;
    container.innerHTML = '';

    columnConfig.forEach((col, index) => {
        const item = document.createElement('div');
        item.className = `column-config-item ${col.required ? 'required' : ''} ${!col.visible ? 'disabled-item' : ''}`;
        item.draggable = true;
        item.dataset.index = index;
        item.innerHTML = `
            <div class="drag-icon"><span></span><span></span><span></span><span></span></div>
            <span class="col-label">${col.label}</span>
            ${!col.required ? '<div class="visibility-indicator"></div>' : ''}
        `;

        item.addEventListener('dblclick', e => {
            e.preventDefault(); e.stopPropagation();
            if (!col.required) toggleColumn(col.id);
        });
        item.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', index); item.classList.add('dragging'); });
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            document.querySelectorAll('.column-config-item').forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom'));
        });
        item.addEventListener('dragover', e => {
            e.preventDefault();
            const draggingItem = document.querySelector('.dragging');
            if (draggingItem === item) return;
            const offset = e.clientY - item.getBoundingClientRect().top;
            item.classList.remove('drag-over-top', 'drag-over-bottom');
            item.classList.add(offset < item.getBoundingClientRect().height / 2 ? 'drag-over-top' : 'drag-over-bottom');
        });
        item.addEventListener('drop', e => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (fromIndex !== index) {
                const moved = columnConfig.splice(fromIndex, 1)[0];
                columnConfig.splice(index, 0, moved);
                saveAndRefreshConfig();
            }
        });

        container.appendChild(item);
    });
}

window.toggleColumn = (id) => {
    const col = columnConfig.find(c => c.id === id);
    if (col && !col.required) { col.visible = !col.visible; saveAndRefreshConfig(); }
};

function saveAndRefreshConfig() {
    localStorage.setItem('columnConfig', JSON.stringify(columnConfig));
    renderColumnConfig();
    renderTable();
}

const resetColumnsBtn = document.getElementById('resetColumnsBtn');
if (resetColumnsBtn) resetColumnsBtn.onclick = () => {
    if (confirm('Spalten-Einstellungen auf Standard zurücksetzen?')) {
        columnConfig = DEFAULT_COLUMNS.map(c => ({ ...c }));
        saveAndRefreshConfig();
    }
};

/* ── Race sessions / participants fetch ──────────────────────── */
async function fetchSessions() {
    const sessionSelect = document.getElementById('sessionSelect');
    if (!sessionSelect) return [];
    try {
        const sessions = await apiCall('/list', 'GET');
        const prevValue = sessionSelect.value;
        sessionSelect.innerHTML = '<option value="">-- Lauf wählen --</option>';
        sessions.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s.replace(/_/g, ' ');
            sessionSelect.appendChild(opt);
        });
        sessionSelect.value = prevValue;
        return sessions;
    } catch (err) {
        console.error('Failed to fetch sessions', err);
        return [];
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
    const tagFilter         = document.getElementById('tagFilter');
    const exportTagFilter   = document.getElementById('exportTagFilter');
    const availableTagsDl   = document.getElementById('availableTags');
    if (!tagFilter) return;

    const allTags = new Set();
    participants.forEach(p => { if (p.tags) p.tags.forEach(t => allTags.add(t)); });

    const prevTag       = tagFilter.value;
    const prevExportTag = exportTagFilter ? exportTagFilter.value : '';
    const filterHtml    = '<option value="">Alle Kategorien</option>';
    tagFilter.innerHTML = filterHtml;
    if (exportTagFilter) exportTagFilter.innerHTML = filterHtml;
    if (availableTagsDl) availableTagsDl.innerHTML = '';

    Array.from(allTags).sort().forEach(tag => {
        const opt = document.createElement('option');
        opt.value = tag; opt.textContent = tag;
        tagFilter.appendChild(opt.cloneNode(true));
        if (exportTagFilter) exportTagFilter.appendChild(opt.cloneNode(true));
        if (availableTagsDl) {
            const dlOpt = document.createElement('option');
            dlOpt.value = tag;
            availableTagsDl.appendChild(dlOpt);
        }
    });

    tagFilter.value = prevTag;
    if (exportTagFilter) exportTagFilter.value = prevExportTag;
}

/* ── Settings fetch/save ─────────────────────────────────────── */
async function fetchRaceSettings() {
    if (!currentRace) return;
    try {
        currentRaceSettings = await apiCall(`/${currentRace}/settings`, 'GET');
        updateSettingsUI();
    } catch (e) {
        console.error('Failed to fetch settings', e);
    }
}

async function saveRaceSettings() {
    const raceStatusSelect = document.getElementById('raceStatusSelect');
    const startNumMin      = document.getElementById('startNumMin');
    const startNumMax      = document.getElementById('startNumMax');
    const rankMethodBest   = document.getElementById('rankMethodBest');
    const rankMethodAvg    = document.getElementById('rankMethodAverage');

    if (!currentRace || !raceStatusSelect) return;

    const settingsToSend = {
        displaytype: raceStatusSelect.value,
        form_config: currentRaceSettings.form_config || '',
    };
    if (parseInt(startNumMin?.value)) settingsToSend.start_num_min = parseInt(startNumMin.value);
    if (parseInt(startNumMax?.value)) settingsToSend.start_num_max = parseInt(startNumMax.value);
    if (rankMethodBest) settingsToSend.rank_method_best    = rankMethodBest.checked;
    if (rankMethodAvg)  settingsToSend.rank_method_average = rankMethodAvg.checked;

    await apiCall(`/${currentRace}/settings`, 'POST', settingsToSend);
}

/* ── Teilnehmer bearbeiten / löschen ────────────────────────── */
const addParticipantBtn = document.getElementById('addParticipantBtn');
if (addParticipantBtn) {
    addParticipantBtn.onclick = () => {
        const editParticipantModal = document.getElementById('editParticipantModal');
        const editModalTitle = document.getElementById('editModalTitle');
        const editName   = document.getElementById('editName');
        const editNumber = document.getElementById('editNumber');
        const editTags   = document.getElementById('editTags');
        editingIndex = -1;
        if (editModalTitle) editModalTitle.textContent = 'Neuer Teilnehmer';
        if (editName)   editName.value   = '';
        if (editNumber) editNumber.value = participants.length > 0 ? Math.max(...participants.map(p => p.start_number)) + 1 : 1;
        if (editTags)   editTags.value   = '';
        if (editParticipantModal) editParticipantModal.classList.add('active');
    };
}

window.openEditModal = (index) => {
    editingIndex = index;
    const p = participants[index];
    const editParticipantModal = document.getElementById('editParticipantModal');
    const editModalTitle  = document.getElementById('editModalTitle');
    const editName        = document.getElementById('editName');
    const editNumber      = document.getElementById('editNumber');
    const editTags        = document.getElementById('editTags');
    const editDuration    = document.getElementById('editDuration');
    const editDurationHint = document.getElementById('editDurationHint');
    const resetDurationBtn = document.getElementById('resetDurationBtn');

    if (editModalTitle) editModalTitle.textContent = 'Teilnehmer bearbeiten';
    if (editName)   editName.value   = p.name;
    if (editNumber) editNumber.value = p.start_number;
    if (editTags)   editTags.value   = p.tags ? p.tags.join(', ') : '';

    if (editDuration) {
        let calcDuration = null;
        if (p.start_time && p.end_time) calcDuration = (new Date(p.end_time) - new Date(p.start_time)) / 1000;

        if (p.duration > 0) {
            editDuration.value = p.duration;
            editDurationHint.textContent = (calcDuration && Math.abs(calcDuration - p.duration) > 0.001)
                ? `Manuell gesetzt. Berechnet wäre: ${calcDuration.toFixed(3)}s`
                : calcDuration ? 'Aus Zeitstempeln berechnet (Start → Ende)' : 'Manuell gesetzt (keine Zeitstempel vorhanden)';
        } else {
            editDuration.value = '';
            if (editDurationHint) editDurationHint.textContent = 'Leer = wird aus Start-/Endzeit berechnet';
        }
    }

    if (resetDurationBtn) {
        resetDurationBtn.onclick = () => {
            if (editDuration) editDuration.value = '';
            if (editDurationHint) { editDurationHint.textContent = 'Duration wird zurückgesetzt. Zeitstempel werden verwendet.'; editDurationHint.style.color = 'var(--accent-green, #22c55e)'; }
        };
    }

    if (editParticipantModal) editParticipantModal.classList.add('active');
};

const cancelEditBtn = document.getElementById('cancelEdit');
if (cancelEditBtn) cancelEditBtn.onclick = () => document.getElementById('editParticipantModal').classList.remove('active');

const saveParticipantBtn = document.getElementById('saveParticipant');
if (saveParticipantBtn) {
    saveParticipantBtn.onclick = async () => {
        const editName     = document.getElementById('editName');
        const editNumber   = document.getElementById('editNumber');
        const editTags     = document.getElementById('editTags');
        const editDuration = document.getElementById('editDuration');

        const name = editName.value.trim();
        const sn   = parseInt(editNumber.value);
        const tags = editTags.value.split(',').map(t => t.trim()).filter(t => t !== '');

        if (!name || isNaN(sn)) { showToast('Bitte Name und Startnummer korrekt ausfüllen.', 'warning'); return; }
        const dup = participants.find((p, i) => p.start_number === sn && i !== editingIndex);
        if (dup) { showToast(`Startnummer ${sn} wird bereits von ${dup.name} verwendet.`, 'warning'); return; }

        const durationVal = editDuration?.value ? parseFloat(editDuration.value) : null;

        if (editingIndex === -1) {
            participants.push({ id: sn.toString(), name, start_number: sn, tags, start_time: null, end_time: null, duration: durationVal });
        } else {
            const p = participants[editingIndex];
            p.name = name; p.start_number = sn; p.id = sn.toString(); p.tags = tags;
            p.duration = (durationVal !== null && durationVal > 0) ? durationVal : null;
        }
        participants.sort((a, b) => a.start_number - b.start_number);
        await apiCall(`/${currentRace}/people`, 'PUT', participants);
        document.getElementById('editParticipantModal').classList.remove('active');
        await fetchParticipants();
    };
}

window.deleteParticipant = async (index) => {
    if (!confirm(`Teilnehmer ${participants[index].name} wirklich löschen?`)) return;
    participants.splice(index, 1);
    await apiCall(`/${currentRace}/people`, 'PUT', participants);
    await fetchParticipants();
};

/* ── Bulk-Aktionen ───────────────────────────────────────────── */
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = async () => {
        const indices = getSelectedIndices();
        if (indices.length === 0) return;
        if (!confirm(`${indices.length} Teilnehmer wirklich löschen?`)) return;
        indices.sort((a, b) => b - a).forEach(i => participants.splice(i, 1));
        try { await apiCall(`/${currentRace}/people`, 'PUT', participants); }
        catch (e) { showToast('Fehler beim Löschen: ' + e.message, 'error'); }
        await fetchParticipants();
    };
}

const bulkTagBtn       = document.getElementById('bulkTagBtn');
const bulkTagPopover   = document.getElementById('bulkTagPopover');
const bulkTagInput     = document.getElementById('bulkTagInput');
const bulkTagApplyBtn  = document.getElementById('bulkTagApplyBtn');
const bulkTagCancelBtn = document.getElementById('bulkTagCancelBtn');
const bulkTagSuggestions = document.getElementById('bulkTagSuggestions');

if (bulkTagBtn && bulkTagPopover) {
    bulkTagBtn.onclick = () => {
        bulkTagPopover.style.display = 'block';
        if (bulkTagInput) bulkTagInput.focus();
        if (bulkTagSuggestions) {
            bulkTagSuggestions.innerHTML = '';
            const allTags = new Set();
            participants.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));
            allTags.forEach(tag => {
                const opt = document.createElement('option'); opt.value = tag;
                bulkTagSuggestions.appendChild(opt);
            });
        }
    };
}
if (bulkTagCancelBtn && bulkTagPopover) {
    bulkTagCancelBtn.onclick = () => { bulkTagPopover.style.display = 'none'; if (bulkTagInput) bulkTagInput.value = ''; };
}
if (bulkTagApplyBtn) {
    bulkTagApplyBtn.onclick = async () => {
        const raw = bulkTagInput?.value || '';
        const newTags = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
        if (newTags.length === 0) return;
        const indices = getSelectedIndices();
        if (indices.length === 0) return;
        indices.forEach(i => {
            if (!participants[i].tags) participants[i].tags = [];
            newTags.forEach(tag => { if (!participants[i].tags.includes(tag)) participants[i].tags.push(tag); });
        });
        try { await apiCall(`/${currentRace}/people`, 'PUT', participants); }
        catch (e) { showToast('Fehler beim Speichern: ' + e.message, 'error'); }
        if (bulkTagPopover) bulkTagPopover.style.display = 'none';
        if (bulkTagInput) bulkTagInput.value = '';
        await fetchParticipants();
    };
}

/* ── Session-Wechsel / Tag-Filter ────────────────────────────── */
const sessionSelect = document.getElementById('sessionSelect');
if (sessionSelect) {
    sessionSelect.addEventListener('change', e => {
        currentRace = e.target.value;
        localStorage.setItem('currentRace', currentRace);
        activeIndex = -1;
        fetchParticipants();
        fetchRaceSettings();
    });
}

const tagFilter = document.getElementById('tagFilter');
if (tagFilter) {
    tagFilter.addEventListener('change', e => { currentTag = e.target.value; renderTable(); });
}

/* ── Settings-Modal ──────────────────────────────────────────── */
const settingsBtn  = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettings = document.getElementById('closeSettings');
const tabButtons    = document.querySelectorAll('.tab-btn');
const tabPanes      = document.querySelectorAll('.tab-pane');

if (settingsBtn) settingsBtn.onclick = () => {
    fetchRaceSettings();
    settingsModal.classList.add('active');
    if (tabButtons[0]) tabButtons[0].click();
};
if (closeSettings) closeSettings.onclick = () => {
    settingsModal.classList.remove('active');
    saveRaceSettings();
};

tabButtons.forEach(btn => {
    btn.onclick = () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const tabId = btn.getAttribute('data-tab');
        const pane = document.getElementById(tabId);
        if (pane) pane.classList.add('active');
        if (tabId === 'tab-users') fetchUsers();
    };
});

/* ── Renn-Steuerung ──────────────────────────────────────────── */
const deleteSessionBtn = document.getElementById('deleteSessionBtn');
if (deleteSessionBtn) {
    deleteSessionBtn.onclick = async () => {
        if (!currentRace || !confirm(`Soll der Lauf "${currentRace}" wirklich gelöscht werden?`)) return;
        await apiCall(`/${currentRace}/delete`, 'DELETE');
        currentRace = ''; localStorage.removeItem('currentRace');
        await fetchSessions(); await fetchParticipants(); updateSettingsUI();
        if (settingsModal) settingsModal.classList.remove('active');
    };
}

const modeSwitch = document.getElementById('modeSwitch');
const editSwitch = document.getElementById('editSwitch');
const raceStatusSelect = document.getElementById('raceStatusSelect');

if (modeSwitch) modeSwitch.onchange = () => {
    startMode = modeSwitch.checked ? 'delayed' : 'direct';
    localStorage.setItem('startMode', startMode);
    updateSettingsUI();
};
if (editSwitch) editSwitch.onchange = () => {
    editMode = editSwitch.checked;
    localStorage.setItem('editMode', editMode);
    updateSettingsUI();
};
if (raceStatusSelect) raceStatusSelect.onchange = saveRaceSettings;

/* ── Views ───────────────────────────────────────────────────── */
function hideAllViews() {
    const landingPage      = document.getElementById('landingPage');
    const registrationPage = document.getElementById('registrationPage');
    const adminApp         = document.getElementById('adminApp');
    const publicResultsPage = document.getElementById('publicResultsPage');
    const overlay          = document.getElementById('noPermissionOverlay');

    if (landingPage)       landingPage.style.display       = 'none';
    if (registrationPage)  registrationPage.style.display  = 'none';
    if (adminApp)          adminApp.style.display          = 'none';
    if (publicResultsPage) publicResultsPage.style.display = 'none';
    if (overlay)           overlay.style.display           = 'none';
}

async function showAdminApp() {
    hideAllViews();
    const adminApp = document.getElementById('adminApp');
    if (adminApp) adminApp.style.display = 'block';

    const sessions = await fetchSessions();
    const overlay  = document.getElementById('noPermissionOverlay');
    if (overlay) overlay.style.display = 'none';

    const lastRace = localStorage.getItem('currentRace');
    if (lastRace) {
        const isAdmin   = userPermissions.permissions && userPermissions.permissions.is_admin;
        const canAccess = sessions.includes(lastRace) || isAdmin;
        if (canAccess) {
            currentRace = lastRace;
            if (sessionSelect) sessionSelect.value = lastRace;
            await fetchParticipants();
            updateSettingsUI();
        } else {
            currentRace = ''; localStorage.removeItem('currentRace');
            if (sessionSelect) sessionSelect.value = '';
            updateSettingsUI();
        }
    } else {
        currentRace = '';
        updateSettingsUI();
    }

    await updateAdminReleaseNotice();
}

/* ── Click-Outside close modals ──────────────────────────────── */
window.onclick = (e) => {
    const editParticipantModal = document.getElementById('editParticipantModal');
    const exportModal          = document.getElementById('exportModal');
    const kioskQrModal         = document.getElementById('kioskQrModal');
    const loginModal           = document.getElementById('loginModal');
    const adminApp             = document.getElementById('adminApp');

    if (e.target === settingsModal) settingsModal.classList.remove('active');
    if (e.target === editParticipantModal && editParticipantModal) editParticipantModal.classList.remove('active');
    if (e.target === exportModal && exportModal) exportModal.classList.remove('active');
    if (e.target === kioskQrModal && kioskQrModal) {
        kioskQrModal.classList.remove('active');
        kioskQrModal.style.display = 'none';
    }
    if (e.target === loginModal && loginModal && !adminApp?.style.display) loginModal.style.display = 'none';
};
