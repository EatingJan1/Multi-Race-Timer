/**
 * js/export.js – CSV, Excel, PDF-Print, Race-Export, Import
 */

/* ── Hilfsfunktion: Export-Liste aufbauen ────────────────────── */
function buildExportList(filter, sortBy) {
    let list = participants.filter(p => !filter || (p.tags && p.tags.includes(filter)));
    list = list.filter(p => p.duration);
    list.sort((a, b) => a.duration - b.duration);
    list.forEach((p, i) => {
        p.rank = (i > 0 && p.duration === list[i - 1].duration) ? list[i - 1].rank : i + 1;
    });

    if (sortBy === 'number')    list.sort((a, b) => a.start_number - b.start_number);
    else if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === 'startTime') list.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    else if (sortBy === 'mean') {
        const avg = list.reduce((s, p) => s + p.duration, 0) / (list.length || 1);
        list.sort((a, b) => Math.abs(a.duration - avg) - Math.abs(b.duration - avg));
        list.forEach((p, i) => {
            const d = Math.abs(p.duration - avg);
            p.rank = (i > 0 && d === Math.abs(list[i - 1].duration - avg)) ? list[i - 1].rank : i + 1;
        });
    }

    return list;
}

function getSelectedCols() {
    return [
        { id: 'col-rank',     label: 'Platz',      key: 'rank'     },
        { id: 'col-number',   label: 'Startnr.',   key: 'number'   },
        { id: 'col-name',     label: 'Name',        key: 'name'     },
        { id: 'col-tags',     label: 'Kategorie',   key: 'tags'     },
        { id: 'col-start',    label: 'Startzeit',   key: 'start'    },
        { id: 'col-end',      label: 'Endzeit',     key: 'end'      },
        { id: 'col-duration', label: 'Dauer',       key: 'duration' },
        { id: 'col-gap',      label: 'Rückstand',   key: 'gap'      },
    ].filter(c => {
        const el = document.getElementById(c.id);
        return el && el.checked;
    });
}

/* ── Export-Modal öffnen ─────────────────────────────────────── */
function openExportMenu() {
    updateTagFilter();
    const exportTagFilter = document.getElementById('exportTagFilter');
    const exportModal     = document.getElementById('exportModal');
    if (exportTagFilter) exportTagFilter.value = currentTag;

    const checkMapping = [
        { id: 'col-tags',     key: 'tags',     type: 'array' },
        { id: 'col-start',    key: 'start_time', type: 'value' },
        { id: 'col-end',      key: 'end_time',   type: 'value' },
        { id: 'col-duration', key: 'duration',   type: 'value' },
        { id: 'col-gap',      key: 'duration',   type: 'value' },
    ];

    checkMapping.forEach(mapping => {
        const checkbox = document.getElementById(mapping.id);
        if (!checkbox) return;
        const label   = checkbox.closest('.check-container');
        const hasData = participants.some(p =>
            mapping.type === 'array'
                ? p[mapping.key] && p[mapping.key].length > 0
                : p[mapping.key] !== null && p[mapping.key] !== undefined && p[mapping.key] !== ''
        );
        checkbox.checked  = hasData;
        checkbox.disabled = !hasData;
        if (label) {
            label.style.opacity = hasData ? '1' : '0.4';
            label.style.cursor  = hasData ? 'pointer' : 'not-allowed';
            label.title         = hasData ? '' : 'Keine Daten in dieser Spalte vorhanden';
        }
    });

    if (exportModal) exportModal.classList.add('active');
}

const exportBtn   = document.getElementById('exportBtn');
const closeExport = document.getElementById('closeExport');
const exportModal = document.getElementById('exportModal');
if (exportBtn)   exportBtn.onclick   = openExportMenu;
if (closeExport) closeExport.onclick = () => { if (exportModal) exportModal.classList.remove('active'); };

/* ── Logo ────────────────────────────────────────────────────── */
const exportLogoInput     = document.getElementById('exportLogoInput');
const exportLogoPreview   = document.getElementById('exportLogoPreview');
const logoPreviewContainer = document.getElementById('logoPreviewContainer');
const printLogo           = document.getElementById('printLogo');

if (exportLogoInput) {
    exportLogoInput.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            uploadedLogoData = ev.target.result;
            if (exportLogoPreview)    exportLogoPreview.src = uploadedLogoData;
            if (logoPreviewContainer) logoPreviewContainer.style.display = 'block';
            if (printLogo) { printLogo.src = uploadedLogoData; printLogo.style.display = 'block'; }
        };
        reader.readAsDataURL(file);
    };
}

/* ── CSV ─────────────────────────────────────────────────────── */
const btnPrepareCSV = document.getElementById('btnPrepareCSV');
if (btnPrepareCSV) {
    btnPrepareCSV.onclick = () => {
        const filter  = document.getElementById('exportTagFilter')?.value || '';
        const sortBy  = document.getElementById('exportSortBy')?.value || 'rank';
        const cols    = getSelectedCols();
        const list    = buildExportList(filter, sortBy);
        const winner  = list.length > 0 ? list[0].duration : null;
        const avg     = list.length > 0 ? list.reduce((s, p) => s + p.duration, 0) / list.length : 0;

        let csv = cols.map(c => c.label).join(',') + '\n';
        list.forEach(p => {
            const row = cols.map(c => {
                if (c.key === 'rank')     return `${p.rank}.`;
                if (c.key === 'number')   return `#${p.start_number}`;
                if (c.key === 'name')     return p.name;
                if (c.key === 'tags')     return p.tags ? p.tags.join(' ') : '-';
                if (c.key === 'start')    return formatTime(p.start_time);
                if (c.key === 'end')      return formatTime(p.end_time);
                if (c.key === 'duration') return `${p.duration.toFixed(3)}s`;
                if (c.key === 'gap')      return sortBy === 'mean'
                    ? `${(p.duration > avg ? '+' : '')}${(p.duration - avg).toFixed(3)}s`
                    : p.rank === 1 ? 'Bestzeit' : `+${(p.duration - winner).toFixed(3)}s`;
                return '';
            });
            csv += row.join(',') + '\n';
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `Ergebnisse_${currentRace || 'Race'}_${filter || 'Alle'}.csv` });
        a.click();
    };
}

/* ── Excel ───────────────────────────────────────────────────── */
const btnExportExcel = document.getElementById('btnExportExcel');
if (btnExportExcel) {
    btnExportExcel.onclick = () => {
        const filter = document.getElementById('exportTagFilter')?.value || '';
        const sortBy = document.getElementById('exportSortBy')?.value || 'rank';
        const cols   = getSelectedCols();
        const list   = buildExportList(filter, sortBy);
        const winner = list.length > 0 ? list[0].duration : null;

        const data = list.map(p => {
            const row = {};
            cols.forEach(c => {
                if (c.key === 'rank')     row[c.label] = p.rank;
                if (c.key === 'number')   row[c.label] = p.start_number;
                if (c.key === 'name')     row[c.label] = p.name;
                if (c.key === 'tags')     row[c.label] = p.tags ? p.tags.join(', ') : '';
                if (c.key === 'start')    row[c.label] = p.start_time ? formatTime(p.start_time) : '';
                if (c.key === 'end')      row[c.label] = p.end_time ? formatTime(p.end_time) : '';
                if (c.key === 'duration') row[c.label] = p.duration;
                if (c.key === 'gap')      row[c.label] = p.rank === 1 ? 'Bestzeit' : (winner ? `+${(p.duration - winner).toFixed(3)}s` : '');
            });
            return row;
        });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Ergebnisse');
        XLSX.writeFile(wb, `${currentRace || 'Export'}_Ergebnisse.xlsx`);
    };
}

/* ── Race-JSON Export ────────────────────────────────────────── */
const btnExportRace = document.getElementById('btnExportRace');
if (btnExportRace) {
    btnExportRace.onclick = async () => {
        if (!currentRace) return;
        try {
            const fullData = await apiCall(`/${currentRace}/full`, 'GET');
            const blob = new Blob([JSON.stringify(fullData, null, 4)], { type: 'application/json' });
            const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${currentRace}.race` });
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (err) { showToast('Fehler beim Export: ' + err.message, 'error'); }
    };
}

/* ── PDF Drucken ─────────────────────────────────────────────── */
const btnPreparePDF = document.getElementById('btnPreparePDF');
if (btnPreparePDF) btnPreparePDF.onclick = () => prepareAndPrint();

function prepareAndPrint() {
    const filter    = document.getElementById('exportTagFilter')?.value || '';
    const sortBy    = document.getElementById('exportSortBy')?.value || 'rank';
    const cols      = getSelectedCols();
    const raceTitle = currentRace ? currentRace.replace(/_/g, ' ') : 'Wettbewerb';
    let   tagTitle  = filter ? `Kategorie: ${filter}` : 'Gesamtwertung';

    let list = buildExportList(filter, sortBy);
    const averageDuration = list.length > 0 ? list.reduce((s, p) => s + p.duration, 0) / list.length : 0;
    if (sortBy === 'mean') tagTitle += ` (Ø: ${averageDuration.toFixed(3)}s)`;

    const printTitle    = document.getElementById('printTitle');
    const printSubtitle = document.getElementById('printSubtitle');
    const printTable    = document.getElementById('printTable');
    if (printTitle)    printTitle.textContent    = raceTitle;
    if (printSubtitle) printSubtitle.textContent = tagTitle;

    if (uploadedLogoData && printLogo) {
        printLogo.src = uploadedLogoData;
        printLogo.style.setProperty('display', 'block', 'important');
    } else if (printLogo) {
        printLogo.style.setProperty('display', 'none', 'important');
        printLogo.removeAttribute('src');
    }

    if (printTable) {
        printTable.innerHTML = `<thead><tr>${cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody id="printBody"></tbody>`;
        const pBody = document.getElementById('printBody');
        const winner = (sortBy !== 'mean' && list.length > 0) ? list[0].duration : null;
        list.forEach(p => {
            const row = document.createElement('tr');
            row.innerHTML = cols.map(c => {
                if (c.key === 'rank')     return `<td>${p.rank}.</td>`;
                if (c.key === 'number')   return `<td>#${p.start_number}</td>`;
                if (c.key === 'name')     return `<td>${escapeHtml(p.name)}</td>`;
                if (c.key === 'tags')     return `<td>${p.tags ? escapeHtml(p.tags.join(', ')) : '-'}</td>`;
                if (c.key === 'start')    return `<td>${p.start_time ? escapeHtml(formatTime(p.start_time)) : '-'}</td>`;
                if (c.key === 'end')      return `<td>${p.end_time ? escapeHtml(formatTime(p.end_time)) : '-'}</td>`;
                if (c.key === 'duration') return `<td>${p.duration != null ? p.duration.toFixed(3) + 's' : '-'}</td>`;
                if (c.key === 'gap') {
                    if (sortBy === 'mean') {
                        const diff = p.duration - averageDuration;
                        return `<td>${(diff > 0 ? '+' : '') + diff.toFixed(3)}s</td>`;
                    }
                    return `<td>${p.rank === 1 ? 'Bestzeit' : `+${(p.duration - winner).toFixed(3)}s`}</td>`;
                }
                return '<td></td>';
            }).join('');
            pBody.appendChild(row);
        });
    }

    if (exportModal) exportModal.classList.remove('active');
    setTimeout(() => window.print(), 250);
}

/* ── Import (CSV / XLSX / .race) ─────────────────────────────── */
const csvFileInput     = document.getElementById('csvFile');
const importCsvBtn     = document.getElementById('importCsvBtn');
const createEmptyRaceBtn = document.getElementById('createEmptyRaceBtn');
const appendParticipantsBtn = document.getElementById('appendParticipantsBtn');
const appendReviewModal = document.getElementById('appendReviewModal');
const appendReviewList  = document.getElementById('appendReviewList');
const confirmAppendBtn  = document.getElementById('confirmAppendBtn');
const cancelAppendBtn   = document.getElementById('cancelAppendBtn');
const appendStats       = document.getElementById('appendStats');

function parsePeopleFromFile(fileName, fileData, json = null) {
    if (fileName.endsWith('.race')) {
        return json ? (json.people || []) : [];
    }
    if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const workbook = XLSX.read(fileData);
        const sheet    = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_json(sheet).map((item, i) => {
            const sn     = parseInt(item['Startnummer'] || item['Startnr.'] || item['Number'] || item['#']) || (i + 1);
            const tagsRaw = item['Kategorie'] || item['Tags'] || item['Kategorien'] || '';
            return { id: sn.toString(), name: item['Name'] || item['Full Name'] || `Person ${i + 1}`, start_number: sn, tags: tagsRaw.toString().split(/[,\s]+/).filter(t => t.length > 0), start_time: null, end_time: null, duration: item['Duration'] || item['Dauer'] || item['Zeit'] || null };
        });
    }
    // CSV
    const text    = typeof fileData === 'string' ? fileData : new TextDecoder().decode(fileData);
    const lines   = text.split(/\r?\n/).filter(l => l.trim());
    const headers = lines[0].split(/[;,]/).map(h => h.trim());
    return lines.slice(1).map((line, i) => {
        const parts = line.split(/[;,]/).map(p => p.trim());
        const obj   = {};
        headers.forEach((h, idx) => obj[h] = parts[idx]);
        const sn     = parseInt(obj['Startnummer'] || obj['Startnr.'] || obj['Number'] || obj['#']) || (i + 1);
        const tagsRaw = obj['Kategorie'] || obj['Tags'] || obj['Kategorien'] || '';
        return { id: sn.toString(), name: obj['Name'] || obj['Full Name'] || `Person ${i + 1}`, start_number: sn, tags: tagsRaw.toString().split(/[,\s]+/).filter(t => t.length > 0), start_time: null, end_time: null, duration: obj['Duration'] || obj['Dauer'] || obj['Zeit'] || null };
    });
}

if (csvFileInput) {
    csvFileInput.addEventListener('change', async e => {
        const file = e.target.files[0];
        if (!file) return;

        const fileName  = file.name.toLowerCase();
        const raceName  = isAppendMode ? currentRace : file.name.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_');

        try {
            let peopleToImport = [];
            let fullData = null;

            if (fileName.endsWith('.race')) {
                const text = await file.text();
                fullData   = JSON.parse(text);
                if (!isAppendMode) {
                    await apiCall(`/${raceName}/full`, 'PUT', fullData);
                } else {
                    peopleToImport = fullData.people || [];
                }
            } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
                const data = await file.arrayBuffer();
                peopleToImport = parsePeopleFromFile(fileName, data);
            } else {
                const text = await file.text();
                peopleToImport = parsePeopleFromFile(fileName, text);
            }

            if (isAppendMode) {
                pendingAppend = peopleToImport;
                openAppendReviewModal();
            } else if (fileName.endsWith('.race')) {
                currentRace = raceName;
                localStorage.setItem('currentRace', currentRace);
                await fetchSessions();
                if (sessionSelect) sessionSelect.value = currentRace;
                await fetchParticipants(); updateSettingsUI();
            } else {
                await apiCall(`/${raceName}/people`, 'PUT', peopleToImport);
                currentRace = raceName;
                localStorage.setItem('currentRace', currentRace);
                await fetchSessions();
                if (sessionSelect) sessionSelect.value = currentRace;
                await fetchParticipants(); updateSettingsUI();
            }
        } catch (err) {
            showToast('Fehler beim Import: ' + err.message, 'error');
        } finally {
            csvFileInput.value = '';
        }
    });
}

if (importCsvBtn) {
    importCsvBtn.onclick = e => {
        if (e.target.closest('#createEmptyRaceBtn')) return;
        isAppendMode = false;
        if (csvFileInput) csvFileInput.click();
    };
}

if (appendParticipantsBtn) {
    appendParticipantsBtn.onclick = () => {
        if (!currentRace) { showToast('Bitte wählen Sie zuerst ein Rennen aus.', 'warning'); return; }
        isAppendMode = true;
        if (csvFileInput) csvFileInput.click();
    };
}

/* ── Append-Review-Modal ─────────────────────────────────────── */
function openAppendReviewModal() {
    if (!appendReviewList) return;
    appendReviewList.innerHTML = '';

    const usedNumbers = new Set(participants.map(p => p.start_number));
    const minNum      = parseInt(currentRaceSettings.start_num_min) || 1;
    const maxNum      = parseInt(currentRaceSettings.start_num_max) || 9999;
    let   nextCandidate = minNum;

    const findNext = () => {
        while (usedNumbers.has(nextCandidate) && nextCandidate <= maxNum) nextCandidate++;
        if (nextCandidate > maxNum) return null;
        const num = nextCandidate; usedNumbers.add(num); nextCandidate++;
        return num;
    };

    let overflowCount = 0;
    pendingAppend.forEach((p, idx) => {
        const originalNum = p.start_number;
        const newNum      = findNext();
        if (newNum === null) { overflowCount++; return; }
        p.start_number = newNum; p.id = newNum.toString();

        const tr = document.createElement('tr');
        const changedHint = originalNum !== newNum ? `<span style="opacity:0.45;font-size:0.8em;margin-left:6px;">(war #${originalNum})</span>` : '';
        tr.innerHTML = `<td><input type="checkbox" class="append-row-check" data-index="${idx}"></td><td>#${newNum}${changedHint}</td><td>${p.name}</td><td class="append-tag-cell">${(p.tags || []).join(', ')}</td>`;
        appendReviewList.appendChild(tr);
    });

    if (overflowCount > 0) {
        pendingAppend = pendingAppend.filter(p => p.start_number !== undefined);
        if (appendStats) appendStats.innerHTML = `Insgesamt ${pendingAppend.length} Teilnehmer zugewiesen. <span style="color:var(--accent-red);">${overflowCount} konnten nicht zugewiesen werden.</span>`;
    } else {
        if (appendStats) appendStats.textContent = `Insgesamt ${pendingAppend.length} Teilnehmer mit neuen Startnummern zugewiesen.`;
    }

    // Selection logic
    const selectionHint = document.getElementById('appendSelectionHint');
    const selectAllCb   = document.getElementById('appendSelectAll');
    const updateCount   = () => {
        const checked = appendReviewList.querySelectorAll('.append-row-check:checked').length;
        if (selectionHint) selectionHint.textContent = `${checked} von ${pendingAppend.length} Teilnehmer ausgewählt`;
    };

    appendReviewList.querySelectorAll('.append-row-check').forEach(cb => {
        cb.onchange = () => {
            cb.closest('tr').style.background = cb.checked ? 'rgba(99,102,241,0.12)' : '';
            updateCount();
            if (selectAllCb) {
                const total   = appendReviewList.querySelectorAll('.append-row-check').length;
                const checked = appendReviewList.querySelectorAll('.append-row-check:checked').length;
                selectAllCb.checked       = checked === total;
                selectAllCb.indeterminate = checked > 0 && checked < total;
            }
        };
    });

    if (selectAllCb) {
        selectAllCb.checked = false; selectAllCb.indeterminate = false;
        selectAllCb.onchange = () => {
            appendReviewList.querySelectorAll('.append-row-check').forEach(cb => {
                cb.checked = selectAllCb.checked;
                cb.closest('tr').style.background = cb.checked ? 'rgba(99,102,241,0.12)' : '';
            });
            updateCount();
        };
    }

    // Tag-Zuweisungen
    const tagSuggestions  = document.getElementById('appendTagSuggestions');
    const appendTagsInput = document.getElementById('appendTagsInput');
    if (tagSuggestions) {
        tagSuggestions.innerHTML = '';
        const allTags = new Set();
        participants.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));
        pendingAppend.forEach(p => (p.tags || []).forEach(t => allTags.add(t)));
        allTags.forEach(tag => { const opt = document.createElement('option'); opt.value = tag; tagSuggestions.appendChild(opt); });
    }
    if (appendTagsInput) appendTagsInput.value = '';

    const applyBtn = document.getElementById('applyAppendTagsBtn');
    if (applyBtn) {
        applyBtn.onclick = () => {
            const raw     = appendTagsInput?.value || '';
            const newTags = raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
            if (newTags.length === 0) return;
            const checkedBoxes = appendReviewList.querySelectorAll('.append-row-check:checked');
            if (checkedBoxes.length === 0) { applyBtn.textContent = 'Niemand markiert!'; setTimeout(() => { applyBtn.textContent = 'Zuweisen'; }, 1200); return; }
            checkedBoxes.forEach(cb => {
                const idx = parseInt(cb.dataset.index);
                const person = pendingAppend[idx];
                if (!person) return;
                if (!person.tags) person.tags = [];
                newTags.forEach(tag => { if (!person.tags.includes(tag)) person.tags.push(tag); });
                const tagCell = cb.closest('tr').querySelector('.append-tag-cell');
                if (tagCell) tagCell.textContent = person.tags.join(', ');
            });
            applyBtn.textContent = `✓ ${checkedBoxes.length} aktualisiert`;
            applyBtn.style.background = 'var(--accent-green, #22c55e)';
            setTimeout(() => { applyBtn.textContent = 'Zuweisen'; applyBtn.style.background = ''; }, 1500);
        };
    }

    updateCount();
    if (appendReviewModal) appendReviewModal.style.display = 'flex';
}

if (confirmAppendBtn) {
    confirmAppendBtn.onclick = async () => {
        confirmAppendBtn.disabled = true; confirmAppendBtn.textContent = 'Speichern...';
        try {
            await apiCall(`/${currentRace}/people/append`, 'POST', pendingAppend);
            if (appendReviewModal) appendReviewModal.style.display = 'none';
            await fetchParticipants();
        } catch (e) {
            showToast('Fehler beim Hinzufügen: ' + e.message, 'error');
        } finally {
            confirmAppendBtn.disabled = false; confirmAppendBtn.textContent = 'Jetzt Hinzufügen';
        }
    };
}
if (cancelAppendBtn) {
    cancelAppendBtn.onclick = () => { if (appendReviewModal) appendReviewModal.style.display = 'none'; pendingAppend = []; };
}

/* ── Neues leeres Rennen ─────────────────────────────────────── */
if (createEmptyRaceBtn) {
    createEmptyRaceBtn.onclick = async e => {
        e.preventDefault(); e.stopPropagation();
        const raceNamepr = prompt('Name für die neue Liste:');
        if (!raceNamepr || raceNamepr.trim() === '') return;
        const cleanedName = raceNamepr.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_').trim();
        try {
            const response = await fetch(`${API_BASE}/${encodeURIComponent(cleanedName)}/full`, {
                method: 'PUT', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ people: [] }), credentials: 'include',
            });
            if (!response.ok) throw new Error('Fehler beim Erstellen des Rennens im Backend');

            participants = []; currentRace = cleanedName;
            localStorage.setItem('currentRace', currentRace);
            await fetchSessions();
            if (sessionSelect) sessionSelect.value = cleanedName;
            renderTable();

            editMode = true;
            const editSwitchEl = document.getElementById('editModeSwitch');
            if (editSwitchEl) editSwitchEl.checked = true;

            const content = document.querySelector('.dropdown-content');
            if (content) { content.style.display = 'none'; setTimeout(() => content.style.display = '', 200); }
        } catch (error) {
            console.error(error);
            showToast('Fehler beim Erstellen des Rennens: ' + error.message, 'error');
        }
    };
}

/* ── Trigger CSV Import Btn (alternative) ────────────────────── */
const triggerCsvImportBtn = document.getElementById('triggerCsvImportBtn');
if (triggerCsvImportBtn) {
    triggerCsvImportBtn.addEventListener('click', e => {
        e.preventDefault(); isAppendMode = false;
        if (csvFileInput) csvFileInput.click();
    });
}

/* ── Signed PDF Download ─────────────────────────────────────── */
async function downloadSignedPdf(index) {
    const p = participants[index];
    if (!p || !currentRace) return;

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
            showToast(`PDF nicht gefunden.\nDatei: ${filename}\nGrund: ${errBody.message || response.statusText}`, 'error');
            return;
        }
        const blob = await response.blob();
        window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
        showToast(`Konnte PDF nicht laden: ${e.message}`, 'error');
    }
}

window.downloadSignedPdf = downloadSignedPdf;
