/**
 * js/landing.js – Landing-Page, Public-Ergebnisse, Registrierung, Kiosk, PDF-Generierung
 */

/* ── DOM refs ────────────────────────────────────────────────── */
const landingPage       = document.getElementById('landingPage');
const registrationPage  = document.getElementById('registrationPage');
const adminApp          = document.getElementById('adminApp');
const publicResultsPage = document.getElementById('publicResultsPage');

const upcomingRacesList = document.getElementById('upcomingRacesList');
const finishedRacesList = document.getElementById('finishedRacesList');
const publicResultsHeader = document.getElementById('publicResultsHeader');
const publicResultsBody   = document.getElementById('publicResultsBody');
const publicTagFilter     = document.getElementById('publicTagFilter');
const rankingMethodContainer = document.getElementById('rankingMethodContainer');
const rankMethodBest     = document.getElementById('rankMethodBest');
const rankMethodAverage  = document.getElementById('rankMethodAverage');
const resultsTitle       = document.getElementById('resultsTitle');
const resultsSubtitle    = document.getElementById('resultsSubtitle');
const backToLandingResultsBtn = document.getElementById('backToLandingResultsBtn');
const backToLandingBtn   = document.getElementById('backToLandingBtn');
const regA4Title         = document.getElementById('regA4Title');
const dynamicFormContainer = document.getElementById('dynamicFormContainer');
const submitRegistrationBtn = document.getElementById('submitRegistrationBtn');
const clearSignatureBtn  = document.getElementById('clearSignatureBtn');
const startKioskBnt      = document.getElementById('startKioskBnt');
const showKioskQrBtn     = document.getElementById('showKioskQrBtn');
const kioskQrModal       = document.getElementById('kioskQrModal');
const kioskQrImage       = document.getElementById('kioskQrImage');
const kioskQrUrl         = document.getElementById('kioskQrUrl');
const copyKioskQrUrlBtn  = document.getElementById('copyKioskQrUrlBtn');
const closeKioskQrBtn    = document.getElementById('closeKioskQrBtn');

/* ── Landing ─────────────────────────────────────────────────── */
async function showLandingPage() {
    hideAllViews();
    if (landingPage) landingPage.style.display = 'block';
    currentRace = '';
    localStorage.removeItem('currentRace');
    fetchPublicRaces();
}

async function fetchPublicRaces() {
    try {
        const res = await fetch(`${PUBLIC_BASE}/races`);
        if (res.ok) renderRaceGrid(await res.json());
    } catch (e) { console.error('Public fetch failed', e); }
}

function renderRaceGrid(races) {
    if (upcomingRacesList) upcomingRacesList.innerHTML = '';
    if (finishedRacesList) finishedRacesList.innerHTML = '';

    const upcoming = races.filter(r => r.settings.displaytype !== 'finished' && r.settings.displaytype !== 'hidden');
    const finished = races.filter(r => r.settings.displaytype === 'finished');

    if (upcoming.length === 0 && upcomingRacesList) {
        upcomingRacesList.innerHTML = '<div class="race-card-skeleton">Keine aktiven Rennen</div>';
    }
    upcoming.forEach(race => upcomingRacesList && upcomingRacesList.appendChild(createRaceCard(race)));
    finished.forEach(race => finishedRacesList && finishedRacesList.appendChild(createRaceCard(race)));
}

function createRaceCard(race) {
    const card = document.createElement('div');
    card.className = 'race-card';

    let statusBadge = '';
    let statusIcon  = 'line-md:calendar';
    const dt = race.settings.displaytype;

    if (dt === 'finished') {
        statusBadge = '<span class="badge badge-closed"><iconify-icon icon="line-md:check-all"></iconify-icon>Beendet</span>';
        statusIcon  = 'line-md:check-all';
    } else if (dt === 'open') {
        statusBadge = '<span class="badge badge-live"><iconify-icon icon="line-md:circle-to-confirm-circle-transition"></iconify-icon>Anmeldung Offen</span>';
        statusIcon  = 'line-md:calendar-clock';
    } else if (dt === 'registration_stop') {
        statusBadge = '<span class="badge badge-closed"><iconify-icon icon="line-md:close-circle"></iconify-icon>Anmeldung geschlossen</span>';
        statusIcon  = 'line-md:close-circle';
    } else {
        statusBadge = '<span class="badge badge-future"><iconify-icon icon="line-md:loading-loop"></iconify-icon>Vorbereitung</span>';
    }

    card.innerHTML = `
        <div>
            <h3 class="race-card-title">${escapeHtml(race.name.replace(/_/g, ' '))}</h3>
            <div class="race-card-info">
                <iconify-icon icon="${statusIcon}" width="18" height="18"></iconify-icon>
                ${statusBadge}
            </div>
        </div>
        <button class="btn btn-primary small race-card-cta">
            ${(dt === 'finished' || dt === 'registration_stop') ? 'Ergebnisse / Liste' : 'Details / Anmeldung'}
        </button>
    `;
    card.onclick = () => dt === 'open' ? openRegistration(race) : showPublicResults(race);
    return card;
}

if (backToLandingResultsBtn) backToLandingResultsBtn.onclick = showLandingPage;

/* ── Public Results ──────────────────────────────────────────── */
async function showPublicResults(race) {
    hideAllViews();
    publicRaceData = race;
    currentRace    = race.name;

    if (resultsTitle)    resultsTitle.textContent    = race.name.replace(/_/g, ' ');
    if (resultsSubtitle) resultsSubtitle.textContent = race.settings.displaytype === 'finished' ? 'Offizielle Endergebnisse' : 'Aktuelle Teilnehmerliste';
    if (publicResultsPage) publicResultsPage.style.display = 'block';
    if (publicTagFilter) publicTagFilter.value = '';

    if (rankingMethodContainer) {
        const canBest = race.settings.rank_method_best !== false;
        const canAvg  = race.settings.rank_method_average === true;
        rankingMethodContainer.style.display = (canBest && canAvg) ? 'flex' : 'none';
        if (canAvg && !canBest) {
            const avgRadio = document.querySelector('input[name="rankingMethod"][value="average"]');
            if (avgRadio) avgRadio.checked = true;
        } else {
            const bestRadio = document.querySelector('input[name="rankingMethod"][value="best"]');
            if (bestRadio) bestRadio.checked = true;
        }
    }

    if (publicResultsBody) publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Lade Daten...</td></tr>';

    try {
        const res = await fetch(`${PUBLIC_BASE}/results/${race.name}`);
        if (!res.ok) throw new Error('Fehler beim Laden');
        publicParticipants = await res.json();

        const tags = new Set();
        publicParticipants.forEach(p => p.tags.forEach(t => tags.add(t)));
        if (publicTagFilter) {
            const currentVal = publicTagFilter.value;
            publicTagFilter.innerHTML = '<option value="">Alle Kategorien</option>';
            Array.from(tags).sort().forEach(t => {
                const opt = document.createElement('option');
                opt.value = t; opt.textContent = t;
                publicTagFilter.appendChild(opt);
            });
            publicTagFilter.value = currentVal;
        }

        renderPublicResults();
    } catch (e) {
        console.error(e);
        if (publicResultsBody) publicResultsBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:red;">Daten konnten nicht geladen werden.</td></tr>';
    }
}

function renderPublicResults() {
    if (!publicRaceData || !publicParticipants) return;

    const race         = publicRaceData;
    const selectedTag  = publicTagFilter ? publicTagFilter.value : '';
    const methodRadio  = document.querySelector('input[name="rankingMethod"]:checked');
    const rankingMethod = methodRadio ? methodRadio.value : 'best';

    let filtered = publicParticipants.filter(p => !selectedTag || p.tags.includes(selectedTag));
    const finishedFiltered = filtered.filter(p => p.duration);
    const avgDuration = finishedFiltered.length > 0
        ? finishedFiltered.reduce((acc, p) => acc + p.duration, 0) / finishedFiltered.length : 0;

    if (race.settings.displaytype === 'finished') {
        if (rankingMethod === 'average' && finishedFiltered.length > 0) {
            filtered.sort((a, b) => {
                if (a.duration && b.duration) return Math.abs(a.duration - avgDuration) - Math.abs(b.duration - avgDuration);
                return a.duration ? -1 : 1;
            });
        } else {
            filtered.sort((a, b) => {
                if (a.duration && b.duration) return a.duration - b.duration;
                return a.duration ? -1 : 1;
            });
        }
    } else {
        filtered.sort((a, b) => a.start_number - b.start_number);
    }

    let headerHtml = '<th>#</th><th>Name</th><th>Kategorie</th>';
    if (race.settings.displaytype === 'finished') {
        headerHtml += '<th>Zeit</th>';
        if (rankingMethod === 'average') headerHtml += '<th>Abw.</th>';
        headerHtml += '<th>Platz</th>';
    } else {
        headerHtml += '<th>Status</th>';
    }
    if (publicResultsHeader) publicResultsHeader.innerHTML = headerHtml;

    if (race.settings.displaytype === 'finished') {
        filtered.forEach((p, i) => {
            if (p.duration) {
                let currentVal = p.duration;
                let prevVal    = i > 0 ? filtered[i - 1].duration : null;
                if (rankingMethod === 'average') {
                    currentVal = Math.abs(p.duration - avgDuration);
                    prevVal    = i > 0 ? Math.abs(filtered[i - 1].duration - avgDuration) : null;
                }
                p.rank = (i > 0 && currentVal === prevVal) ? filtered[i - 1].rank : i + 1;
            } else {
                p.rank = '-';
            }
        });
    }

    if (publicResultsBody) publicResultsBody.innerHTML = '';

    filtered.forEach(p => {
        const tr = document.createElement('tr');
        if (race.settings.displaytype === 'finished' && p.rank === 1) tr.classList.add('rank-1');

        const timeStr = p.duration ? p.duration.toFixed(3) + 's' : '-';
        let statusStr = '';
        if (p.end_time)        statusStr = '<span class="status-badge status-finished">Fertig</span>';
        else if (p.start_time) statusStr = '<span class="status-badge status-running">Unterwegs</span>';
        else                   statusStr = '<span class="status-badge status-ready">Bereit</span>';

        let html = `<td data-label="Startnr.">${p.start_number}</td><td data-label="Name">${escapeHtml(p.name)}</td><td data-label="Kategorie">${escapeHtml((p.tags || []).join(', '))}</td>`;
        if (race.settings.displaytype === 'finished') {
            html += `<td data-label="Dauer">${timeStr}</td>`;
            if (rankingMethod === 'average') {
                const diff  = p.duration ? (p.duration - avgDuration).toFixed(3) : '-';
                const color = p.duration ? (p.duration > avgDuration ? 'var(--accent-red)' : 'var(--accent-green)') : 'inherit';
                html += `<td data-label="Abweichung" style="color:${color};font-family:monospace;font-weight:700;">${p.duration ? (diff > 0 ? '+' : '') + diff + 's' : '-'}</td>`;
            }
            html += `<td data-label="Platz">${p.rank}${p.rank !== '-' ? '.' : ''}</td>`;
        } else {
            html += `<td data-label="Status">${statusStr}</td>`;
        }
        tr.innerHTML = html;
        if (publicResultsBody) publicResultsBody.appendChild(tr);
    });

    if (filtered.length === 0 && publicResultsBody) {
        publicResultsBody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;">${publicParticipants.length === 0 ? 'Noch keine Teilnehmer angemeldet.' : 'Keine Teilnehmer in dieser Kategorie.'}</td></tr>`;
    }
}

if (publicTagFilter) publicTagFilter.onchange = renderPublicResults;
document.getElementsByName('rankingMethod').forEach(r => { r.onchange = renderPublicResults; });

/* ── Registrierung ───────────────────────────────────────────── */
async function openRegistration(race, isPreview = false, isKiosk = false) {
    hideAllViews();
    isRegistrationPreview = isPreview;
    isKioskMode           = isKiosk;
    currentRace           = race.name;

    if (!race.settings || !race.settings.form_config) {
        try {
            const res = await fetch(`${PUBLIC_BASE}/settings/${race.name}`);
            currentRaceSettings = res.ok ? await res.json() : race.settings || {};
        } catch (e) { currentRaceSettings = race.settings || {}; }
    } else {
        currentRaceSettings = race.settings;
    }

    if (backToLandingBtn) backToLandingBtn.style.display = isKiosk ? 'none' : 'block';

    if (isKiosk) {
        window.history.pushState(null, null, window.location.href);
        window.onpopstate = () => window.history.go(1);
    }

    const regHeader = document.querySelector('.a4-header');
    if (regHeader) regHeader.style.display = isKiosk ? 'none' : 'block';
    if (regA4Title) regA4Title.textContent = race.name.replace(/_/g, ' ');
    if (registrationPage) registrationPage.style.display = 'block';

    renderDynamicForm(currentRaceSettings.form_config);

    if (submitRegistrationBtn) {
        if (isPreview) {
            submitRegistrationBtn.textContent = 'VORSCHAU-MODUS (Kein Absenden)';
            submitRegistrationBtn.disabled    = true;
            submitRegistrationBtn.style.opacity = '0.5';
        } else {
            submitRegistrationBtn.textContent   = 'JETZT REGISTRIEREN';
            submitRegistrationBtn.disabled      = false;
            submitRegistrationBtn.style.opacity = '1';
        }
    }

    const canvas = document.getElementById('signaturePad');
    if (canvas) {
        signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgba(255,255,255,0)', penColor: 'rgb(0,0,0)' });
        const resize = () => {
            const ratio = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width  = canvas.offsetWidth  * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            if (signaturePad) signaturePad.clear();
        };
        window.addEventListener('resize', resize);
        resize();
    }
}

function renderDynamicForm(config) {
    if (!config || !dynamicFormContainer) {
        if (dynamicFormContainer) dynamicFormContainer.innerHTML = '<p style="color:#666;font-style:italic;">Kein Formular konfiguriert.</p>';
        return;
    }

    const content        = typeof config === 'string' ? config : (config.content || '');
    const footer         = typeof config === 'string' ? '' : (config.footer || '');
    const footerEnabled  = typeof config === 'string' ? false : !!config.footerEnabled;

    const replacePlaceholders = text => {
        const now = new Date();
        return text
            .replace(/\[DATUM\]/g, now.toLocaleDateString())
            .replace(/\[ZEIT\]/g,  now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
            .replace(/\[EVENT\]/g, currentRace.replace(/_/g, ' '));
    };

    dynamicFormContainer.innerHTML = replacePlaceholders(content);

    const footerEl = document.getElementById('dynamicFormFooter');
    if (footerEl) {
        if (footerEnabled && footer) { footerEl.innerHTML = replacePlaceholders(footer); footerEl.style.display = 'block'; }
        else footerEl.style.display = 'none';
    }

    const sigPlaceholders = dynamicFormContainer.querySelectorAll('.form-signature-block');
    const sigSection      = document.querySelector('.signature-section');
    if (sigPlaceholders.length > 0) {
        sigPlaceholders.forEach((block, idx) => {
            const targetBox = block.querySelector('.form-signature-box');
            if (targetBox && idx === 0) {
                if (sigSection) { targetBox.appendChild(sigSection); sigSection.style.marginTop = '0'; sigSection.style.display = 'block'; }
            } else if (targetBox) {
                targetBox.innerHTML = '<div style="height:100%;border:1px solid #ccc;background:#f9f9f9;display:flex;align-items:center;justify-content:center;font-size:10px;color:#999;">Unterschrift Feld</div>';
            }
        });
    } else if (sigSection) {
        dynamicFormContainer.after(sigSection);
        sigSection.style.display = 'block';
    }
}

if (backToLandingBtn) backToLandingBtn.onclick = () => { isRegistrationPreview ? showAdminApp() : showLandingPage(); };
if (clearSignatureBtn) clearSignatureBtn.onclick = () => { if (signaturePad) signaturePad.clear(); };

/* ── Kiosk ───────────────────────────────────────────────────── */
async function createKioskLaunchUrl() {
    if (!currentRace) throw new Error('no-race');
    const hash = btoa(currentRace);
    const res  = await apiCall(`/${currentRace}/genkey`, 'GET');
    return `${window.location.origin}${window.location.pathname}?k=${hash}&y=${res.key}`;
}

if (startKioskBnt) {
    startKioskBnt.onclick = async () => {
        if (!currentRace) return;
        try { window.open(await createKioskLaunchUrl(), '_blank'); }
        catch (err) { showToast('Kiosk-Link konnte nicht erstellt werden.', 'error'); }
    };
}

if (showKioskQrBtn) {
    showKioskQrBtn.onclick = async () => {
        if (!currentRace) { showToast('Bitte zuerst ein Rennen auswählen.', 'warning'); return; }
        try {
            const url = await createKioskLaunchUrl();
            if (kioskQrImage) kioskQrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(url)}`;
            if (kioskQrUrl)   kioskQrUrl.value  = url;
            if (kioskQrModal) { kioskQrModal.classList.add('active'); kioskQrModal.style.display = 'flex'; }
        } catch (err) { showToast('QR-Code konnte nicht erstellt werden.', 'error'); }
    };
}

if (copyKioskQrUrlBtn) {
    copyKioskQrUrlBtn.onclick = async () => {
        try {
            const text = kioskQrUrl ? kioskQrUrl.value : '';
            if (!text) return;
            await navigator.clipboard.writeText(text);
            showToast('Kiosk-Link kopiert.', 'success');
        } catch (e) { showToast('Kopieren nicht möglich. Bitte Link manuell markieren.', 'warning'); }
    };
}

if (closeKioskQrBtn) {
    closeKioskQrBtn.onclick = () => {
        if (kioskQrModal) { kioskQrModal.classList.remove('active'); kioskQrModal.style.display = 'none'; }
    };
}

/* ── PDF-Generierung ─────────────────────────────────────────── */
async function generateRegistrationPdf() {
    const participantNameInput = document.querySelector('input[data-field-name*="name" i]') ||
        document.querySelector('input[data-field-name*="teilnehmer" i]');
    const participantName = participantNameInput ? participantNameInput.value : 'Gast';

    const participantTags = [];
    if (dynamicFormContainer) {
        for (const input of dynamicFormContainer.querySelectorAll('input, select')) {
            const label = (input.dataset.fieldName || '').toLowerCase();
            if (label.includes('tag') || label.includes('kategorie') || label.includes('verein')) {
                participantTags.push(input.value);
            }
        }
    }

    if (!participantName || participantName.toLowerCase() === 'gast') {
        showToast('Bitte stellen Sie sicher, dass ein Namensfeld vorhanden und ausgefüllt ist.', 'warning');
        return null;
    }

    try {
        const pdfDoc = await PDFLib.PDFDocument.create();
        const page   = pdfDoc.addPage([595.28, 841.89]);
        const { width, height } = page.getSize();

        const fonts = {
            helvetica:            await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica),
            helveticaBold:        await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBold),
            helveticaOblique:     await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
            helveticaBoldOblique: await pdfDoc.embedFont(PDFLib.StandardFonts.HelveticaBoldOblique),
            times:                await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRoman),
            timesBold:            await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBold),
            timesItalic:          await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanItalic),
            timesBoldItalic:      await pdfDoc.embedFont(PDFLib.StandardFonts.TimesRomanBoldItalic),
            courier:              await pdfDoc.embedFont(PDFLib.StandardFonts.Courier),
            courierBold:          await pdfDoc.embedFont(PDFLib.StandardFonts.CourierBold),
            courierOblique:       await pdfDoc.embedFont(PDFLib.StandardFonts.CourierOblique),
            courierBoldOblique:   await pdfDoc.embedFont(PDFLib.StandardFonts.CourierBoldOblique),
        };

        const parseColor = colorStr => {
            if (!colorStr || ['transparent','inherit','initial'].includes(colorStr)) return PDFLib.rgb(0,0,0);
            const rgb = colorStr.match(/\d+/g);
            if (rgb && rgb.length >= 3) return PDFLib.rgb(parseInt(rgb[0])/255, parseInt(rgb[1])/255, parseInt(rgb[2])/255);
            if (colorStr.startsWith('#')) {
                const hex = colorStr.replace('#', '');
                if (hex.length === 3) return PDFLib.rgb(parseInt(hex[0]+hex[0],16)/255, parseInt(hex[1]+hex[1],16)/255, parseInt(hex[2]+hex[2],16)/255);
                return PDFLib.rgb(parseInt(hex.substring(0,2),16)/255, parseInt(hex.substring(2,4),16)/255, parseInt(hex.substring(4,6),16)/255);
            }
            return PDFLib.rgb(0,0,0);
        };

        const sanitizePdfText = text => !text ? '' : text
            .replace(/□/g,'[ ]').replace(/■/g,'[x]').replace(/•/g,'-').replace(/·/g,'-')
            .replace(/\uf0b7/g,'-').replace(/\xa0/g,' ').replace(/–/g,'-').replace(/—/g,'-')
            .replace(/ẞ/g,'SS').replace(/[\r\n]+/g,' ').replace(/[^\x00-\xFF]/g,'');

        const replacePlaceholders = text => {
            if (!text) return '';
            return text
                .replace(/\[DATUM\]/g, new Date().toLocaleDateString('de-DE'))
                .replace(/\[EVENT\]/g,  (currentRace || 'Event').replace(/_/g,' '))
                .replace(/\[ZEIT\]/g,   new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}))
                .replace(/·Teilnehmer/g, participantName);
        };

        const getFont = (family, isBold, isItalic) => {
            const fam = (family || 'helvetica').toLowerCase();
            if (fam.includes('times')) {
                if (isBold && isItalic) return fonts.timesBoldItalic;
                if (isBold)   return fonts.timesBold;
                if (isItalic) return fonts.timesItalic;
                return fonts.times;
            }
            if (fam.includes('courier')) {
                if (isBold && isItalic) return fonts.courierBoldOblique;
                if (isBold)   return fonts.courierBold;
                if (isItalic) return fonts.courierOblique;
                return fonts.courier;
            }
            if (isBold && isItalic) return fonts.helveticaBoldOblique;
            if (isBold)   return fonts.helveticaBold;
            if (isItalic) return fonts.helveticaOblique;
            return fonts.helvetica;
        };

        const embedImage = async src => {
            try {
                if (src.startsWith('data:')) {
                    const base64 = src.split(',')[1];
                    const binary = atob(base64);
                    const bytes  = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const mime = src.split(';')[0].split(':')[1];
                    return mime.includes('png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
                } else {
                    const resp  = await fetch(src);
                    const bytes = await resp.arrayBuffer();
                    const ct    = resp.headers.get('content-type') || '';
                    return (ct.includes('png') || src.toLowerCase().includes('.png')) ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
                }
            } catch (e) { console.error('Embedding error', e); return null; }
        };

        const rootElement  = document.getElementById('registrationSheet') || dynamicFormContainer;
        const designerWidth = rootElement.offsetWidth || 794;
        const pxToPt        = 595.28 / designerWidth;
        const containerRect = rootElement.getBoundingClientRect();

        let yOffset = height - 60, xOffset = 50, flowStartX = 50;

        const drawInFlow = (text, style, isValue = false) => {
            if (!text) return;
            const safeText = sanitizePdfText(replacePlaceholders(text));
            const { font, size, color } = style;
            safeText.split(/(\s+)/).forEach(part => {
                if (part === '') return;
                const partWidth = font.widthOfTextAtSize(part, size);
                if (xOffset + partWidth > 545) { xOffset = flowStartX; yOffset -= size * 1.5; }
                page.drawText(part, { x: xOffset, y: yOffset, size, font, color });
                if (isValue && part.trim()) {
                    page.drawLine({ start: { x: xOffset, y: yOffset - 2 }, end: { x: xOffset + partWidth, y: yOffset - 2 }, thickness: 0.8, color });
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

                    const isBold   = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 700 || ['B','STRONG'].includes(node.nodeName);
                    const isItalic = computed.fontStyle === 'italic' || ['I','EM'].includes(node.nodeName);
                    const currentStyle = { font: getFont(computed.fontFamily, isBold, isItalic), size: parseFloat(computed.fontSize) * pxToPt, color: parseColor(computed.color) };

                    const rect      = node.getBoundingClientRect();
                    const leftPt    = (rect.left - containerRect.left) * pxToPt;
                    const topPt     = (rect.top  - containerRect.top)  * pxToPt;
                    const display   = computed.display || 'inline';
                    const isBlock   = display.includes('block') || display.includes('flex') || ['P','H1','H2','H3','DIV','SECTION','HEADER','FOOTER'].includes(node.nodeName);
                    const isFooter  = node.classList.contains('a4-designer-footer') || node.id === 'dynamicFormFooter';
                    const isLogo    = node.classList.contains('draggable-logo') || node.nodeName === 'IMG';
                    const isSigPad  = node.nodeName === 'CANVAS' && node.id === 'signaturePad';
                    const isFormLine = node.classList.contains('form-line');
                    const borderTop = parseFloat(computed.borderTopWidth);
                    const position  = computed.position;

                    if (isLogo) {
                        const img = node.nodeName === 'IMG' ? node : node.querySelector('img');
                        if (img && img.src) {
                            const embeddedImg = await embedImage(img.src);
                            if (embeddedImg) {
                                const dims = embeddedImg.scaleToFit(rect.width * pxToPt, rect.height * pxToPt);
                                page.drawImage(embeddedImg, { x: leftPt, y: height - topPt - dims.height, width: dims.width, height: dims.height });
                                if (position !== 'absolute') yOffset = height - topPt - dims.height - 10;
                            }
                        }
                        continue;
                    }
                    if (isSigPad) {
                        if (signaturePad && !signaturePad.isEmpty()) {
                            const sigImg = await embedImage(signaturePad.toDataURL());
                            if (sigImg) {
                                const dims = sigImg.scaleToFit(rect.width * pxToPt, rect.height * pxToPt);
                                page.drawImage(sigImg, { x: leftPt, y: height - topPt - dims.height, width: dims.width, height: dims.height });
                                yOffset = height - topPt - dims.height - 10; xOffset = flowStartX;
                            }
                        }
                        continue;
                    }
                    if (isFormLine) {
                        page.drawLine({ start: { x: 50, y: height - topPt }, end: { x: 545, y: height - topPt }, thickness: 1, color: parseColor(computed.backgroundColor) });
                        yOffset = height - topPt - 10; continue;
                    }

                    if (borderTop > 0 && computed.borderTopStyle !== 'none' && !node.classList.contains('form-line')) {
                        page.drawLine({ start: { x: leftPt, y: height - topPt }, end: { x: (rect.right - containerRect.left) * pxToPt, y: height - topPt }, thickness: borderTop * pxToPt, color: parseColor(computed.borderTopColor) });
                    }

                    if (position === 'absolute' || isFooter) {
                        const oldX = xOffset, oldY = yOffset, oldSX = flowStartX;
                        flowStartX = leftPt; xOffset = leftPt;
                        yOffset = height - topPt - (currentStyle.size * 0.95);
                        if (borderTop > 0) yOffset -= (borderTop * pxToPt) + 4;
                        if (node.childNodes.length > 0) await processNodes(node.childNodes, currentStyle);
                        else if (['INPUT','SELECT'].includes(node.nodeName)) drawInFlow((node.value + ' ') || ' ', currentStyle, true);
                        xOffset = oldX; yOffset = oldY; flowStartX = oldSX; continue;
                    }

                    if (isBlock) {
                        flowStartX = leftPt; xOffset = leftPt;
                        yOffset = height - topPt - (currentStyle.size * 0.95);
                        if (borderTop > 0) yOffset -= (borderTop * pxToPt) + 6;
                    }

                    if (['INPUT','SELECT'].includes(node.nodeName)) {
                        drawInFlow((node.value + ' ') || ' ', currentStyle, true);
                    } else if (node.nodeName === 'BR') {
                        xOffset = 50; yOffset -= currentStyle.size * 1.5;
                    } else if (['UL','OL'].includes(node.nodeName)) {
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

        await processNodes(rootElement.childNodes, { font: fonts.helvetica, size: 11, color: PDFLib.rgb(0,0,0) });
        const pdfBase64 = await pdfDoc.saveAsBase64({ dataUri: true });
        return { pdfBase64, name: participantName, tags: participantTags };
    } catch (err) {
        console.error('PDF Fehler:', err);
        showToast('Fehler beim Erstellen der PDF.', 'error');
        return null;
    }
}

/* ── Submit Registrierung ────────────────────────────────────── */
if (submitRegistrationBtn) {
    submitRegistrationBtn.onclick = async () => {
        const result = await generateRegistrationPdf();
        if (!result) return;

        const params = new URLSearchParams(window.location.search);
        const key    = params.get('y');
        const regData = { name: result.name, tags: result.tags, signed_pdf: result.pdfBase64, key };

        try {
            submitRegistrationBtn.disabled    = true;
            submitRegistrationBtn.textContent = 'Wird gesendet...';

            const res = await fetch(`${PUBLIC_BASE}/register/${currentRace}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(regData),
            });

            if (res.ok) {
                const data = await res.json();
                if (isKioskMode) {
                    showToast(`Erfolgreich angemeldet!\nDeine Startnummer: ${data.start_number}`, 'success', 5200);
                    if (signaturePad) signaturePad.clear();
                    renderDynamicForm(currentRaceSettings.form_config || {});
                    window.scrollTo(0, 0);
                } else {
                    showToast(`Erfolgreich angemeldet!\nStartnummer: ${data.start_number}\n\nDein Beleg wird nun heruntergeladen.`, 'success', 5200);
                    const link = Object.assign(document.createElement('a'), { href: result.pdfBase64, download: `Anmeldung_${result.name.replace(/\s+/g, '_')}.pdf` });
                    document.body.appendChild(link); link.click(); document.body.removeChild(link);
                    showLandingPage();
                }
            } else {
                const err = await res.json();
                showToast('Fehler: ' + (err.message || 'Anmeldung fehlgeschlagen.'), 'error');
            }
        } catch (e) {
            console.error('Submission failed', e);
            showToast('Verbindungsfehler bei der Anmeldung.', 'error');
        } finally {
            submitRegistrationBtn.disabled    = false;
            submitRegistrationBtn.textContent = 'JETZT REGISTRIEREN';
        }
    };
}

/* ── No-Perm Return ──────────────────────────────────────────── */
const noPermReturnBtn = document.getElementById('noPermReturnBtn');
if (noPermReturnBtn) noPermReturnBtn.addEventListener('click', () => showLandingPage());

window.showLandingPage = showLandingPage;
