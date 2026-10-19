/**
 * js/designer.js – Form-Designer: Toolbar, Insert-Elemente,
 *                  Context-Menu, Logo Drag&Drop, PDF-Template-Vorschau
 */

/* ── DOM refs (werden erst benötigt wenn Modal geöffnet wird) ── */
const formDesignerModal  = document.getElementById('formDesignerModal');
const openFormDesignerBtn = document.getElementById('openFormDesignerBtn');
const closeFormDesigner  = document.getElementById('closeFormDesigner');
const saveFormDesigner   = document.getElementById('saveFormDesigner');
const designerContent    = document.getElementById('designerContent');
const designerFooter     = document.getElementById('designerFooter');
const toggleFooterBtn    = document.getElementById('toggleFooterBtn');
const designerLogoUpload = document.getElementById('designerLogoUpload');
const viewActivePdfBtn   = document.getElementById('viewActivePdfBtn');

/* ── Formular-Designer öffnen ────────────────────────────────── */
function addSelectionListener(el) {
    el.addEventListener('mousedown', () => {
        designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
        el.classList.add('selected-item');
        designerContent.focus();
    });
}

if (openFormDesignerBtn) {
    openFormDesignerBtn.onclick = () => {
        if (window.matchMedia('(max-width: 1024px)').matches && ('ontouchstart' in window)) {
            showToast('Der Formular-Designer ist nur auf dem Desktop verfügbar.', 'warning');
            return;
        }
        try {
            let config = currentRaceSettings.form_config || {};
            if (typeof config === 'string') config = { content: config, footer: '', footerEnabled: false };
            designerContent.innerHTML = config.content || '';
            designerFooter.innerHTML  = config.footer  || '';
            designerFooter.style.display = config.footerEnabled ? 'block' : 'none';
            formDesignerModal.classList.add('active');
            formDesignerModal.style.display = 'flex';

            setTimeout(() => {
                designerContent.querySelectorAll('.draggable-logo').forEach(makeLogoDraggable);
                designerContent.querySelectorAll('.form-signature-block').forEach(addSelectionListener);
            }, 100);
        } catch (err) {
            console.error('Error opening designer:', err);
        }
    };
}

if (closeFormDesigner) closeFormDesigner.onclick = () => {
    formDesignerModal.classList.remove('active');
    formDesignerModal.style.display = 'none';
};

if (saveFormDesigner) saveFormDesigner.onclick = async () => {
    currentRaceSettings.form_config = {
        content:       designerContent.innerHTML,
        footer:        designerFooter.innerHTML,
        footerEnabled: designerFooter.style.display !== 'none',
    };
    await saveRaceSettings();
    formDesignerModal.classList.remove('active');
    formDesignerModal.style.display = 'none';
    showToast('Formular gespeichert!', 'success');
};

if (toggleFooterBtn) toggleFooterBtn.onclick = () => {
    designerFooter.style.display = designerFooter.style.display === 'none' ? 'block' : 'none';
};

if (designerLogoUpload) {
    designerLogoUpload.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => insertDraggableLogo(ev.target.result);
        reader.readAsDataURL(file);
    };
}

/* ── Toolbar-Buttons ─────────────────────────────────────────── */
function smartWordSelection() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0 && selection.isCollapsed) {
        const range = selection.getRangeAt(0);
        const node  = range.startContainer;
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            let start = range.startOffset, end = range.startOffset;
            while (start > 0 && /\w/.test(text[start - 1])) start--;
            while (end < text.length && /\w/.test(text[end])) end++;
            if (start !== end) {
                const newRange = document.createRange();
                newRange.setStart(node, start); newRange.setEnd(node, end);
                selection.removeAllRanges(); selection.addRange(newRange);
            }
        }
    }
}

document.querySelectorAll('.tool-btn[data-command]').forEach(btn => {
    btn.onclick = e => {
        e.preventDefault();
        smartWordSelection();
        document.execCommand(btn.dataset.command, false, null);
        if (designerContent) designerContent.focus();
    };
});

const fontSelect = document.getElementById('fontFamilySelect');
if (fontSelect) fontSelect.onchange = () => { smartWordSelection(); document.execCommand('fontName', false, fontSelect.value); };

const sizeSelect = document.getElementById('fontSizeSelect');
if (sizeSelect) sizeSelect.onchange = () => { smartWordSelection(); document.execCommand('fontSize', false, sizeSelect.value); };

const colorPicker = document.getElementById('textColorPicker');
if (colorPicker) colorPicker.oninput = () => { smartWordSelection(); document.execCommand('foreColor', false, colorPicker.value); };

if (designerContent) {
    designerContent.onkeydown = e => {
        if (e.key === 'Tab') {
            e.preventDefault();
            document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && designerContent.querySelector('.selected-item')) {
            e.preventDefault();
            designerContent.querySelector('.selected-item').remove();
        }
    };

    designerContent.onclick = e => {
        if (!e.target.closest('.selected-item')) {
            designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
        }
    };

    designerContent.oncontextmenu = e => {
        const target = e.target.closest('.draggable-logo, .form-line, .form-signature-block');
        if (target) { e.preventDefault(); showDesignerContextMenu(e.pageX, e.pageY, target); }
    };
}

document.querySelectorAll('.placeholder-btn').forEach(btn => {
    btn.onclick = e => {
        e.preventDefault();
        if (designerContent) designerContent.focus();
        document.execCommand('insertText', false, btn.dataset.value);
    };
});

document.querySelectorAll('.insert-btn').forEach(btn => {
    btn.onclick = e => { e.preventDefault(); insertDesignerElement(btn.dataset.type); };
});

document.addEventListener('click', () => {
    const cm = document.getElementById('designerContextMenu');
    if (cm) cm.style.display = 'none';
});

/* ── Insert-Funktionen ───────────────────────────────────────── */
function insertDesignerElement(type) {
    if (!designerContent) return;
    designerContent.focus();
    let html = '';

    if (type === 'text') {
        const label = prompt('Feld-Name (z.B. Verein):', 'Neues Feld');
        if (!label) return;
        html = `<span class="designer-field-helper">[</span><input type="text" class="form-input-inline" data-field-name="${label}" placeholder="${label}"><span class="designer-field-helper">]</span>&nbsp;`;
        document.execCommand('insertHTML', false, html);
    } else if (type === 'select') {
        const label   = prompt('Name der Auswahl:', 'Optionen');
        const options = prompt('Optionen (kommagetrennt):', 'Ja, Nein');
        if (!label || !options) return;
        const optsHtml = options.split(',').map(o => `<option>${o.trim()}</option>`).join('');
        html = `<span class="designer-field-helper">[</span><select class="form-select-inline" data-field-name="${label}">${optsHtml}</select><span class="designer-field-helper">]</span>&nbsp;`;
        document.execCommand('insertHTML', false, html);
    } else if (type === 'line') {
        html = '<div class="form-line" contenteditable="false"></div>';
        document.execCommand('insertHTML', false, html);
        setTimeout(() => {
            const lines = designerContent.querySelectorAll('.form-line');
            addSelectionListener(lines[lines.length - 1]);
        }, 50);
    } else if (type === 'logo') {
        if (designerLogoUpload) designerLogoUpload.click();
    } else if (type === 'signature') {
        html = `<div class="form-signature-block" contenteditable="false" style="margin-top:20px;"><div class="form-signature-box"></div><div class="form-signature-label">Unterschrift Teilnehmer</div></div>`;
        document.execCommand('insertHTML', false, html);
        setTimeout(() => {
            const sigs = designerContent.querySelectorAll('.form-signature-block');
            addSelectionListener(sigs[sigs.length - 1]);
        }, 50);
    }
}

/* ── Context-Menü ────────────────────────────────────────────── */
function showDesignerContextMenu(x, y, target) {
    const cm = document.getElementById('designerContextMenu');
    if (!cm) return;
    cm.innerHTML = '';
    cm.style.display = 'block';
    cm.style.left = x + 'px';
    cm.style.top  = y + 'px';

    const addItem = (text, action, type = '') => {
        const item = document.createElement('div');
        item.className = 'context-item ' + type;
        item.textContent = text;
        item.onclick = () => { action(); cm.style.display = 'none'; };
        cm.appendChild(item);
    };

    if (target.classList.contains('draggable-logo')) {
        addItem('Bild löschen', () => target.remove(), 'danger');
    } else if (target.classList.contains('form-line')) {
        addItem('Linie löschen', () => target.remove(), 'danger');
        addItem('Farbe ändern', () => { const c = prompt('Strichfarbe (Hex oder Name):', '#000'); if (c) target.style.backgroundColor = c; });
        addItem('Stil: Gepunktet', () => { target.style.height = '1px'; target.style.backgroundColor = 'transparent'; target.style.borderBottom = '2px dotted #000'; });
        addItem('Stil: Durchgezogen', () => { target.style.height = '2px'; target.style.borderBottom = 'none'; target.style.backgroundColor = '#000'; });
    } else if (target.classList.contains('form-signature-block')) {
        addItem('Unterschrift löschen', () => target.remove(), 'danger');
    }
}

/* ── Logo Drag&Resize ────────────────────────────────────────── */
function insertDraggableLogo(src) {
    if (!designerContent) return;
    const div = document.createElement('div');
    div.className = 'draggable-logo';
    div.id = 'logo_' + Date.now();
    div.style.cssText = 'left:50px;top:100px;width:100px;';
    div.setAttribute('contenteditable', 'false');
    div.innerHTML = `<img src="${src}"><div class="resize-handle"></div>`;
    designerContent.appendChild(div);
    makeLogoDraggable(div);
}

function makeLogoDraggable(el) {
    let isDragging = false, isResizing = false;
    let startX, startY, startWidth, startLeft, startTop;

    el.onmousedown = e => {
        if (e.target.classList.contains('resize-handle') || e.target === el) e.preventDefault();
        designerContent.querySelectorAll('.selected-item').forEach(s => s.classList.remove('selected-item'));
        el.classList.add('selected-item');
        if (designerContent) designerContent.focus();

        isResizing = e.target.classList.contains('resize-handle');
        isDragging = !isResizing;
        startX = e.clientX; startY = e.clientY;
        startWidth = el.offsetWidth; startLeft = el.offsetLeft; startTop = el.offsetTop;

        document.onmousemove = me => {
            if (isDragging) {
                el.style.left = (startLeft + me.clientX - startX) + 'px';
                el.style.top  = (startTop  + me.clientY - startY) + 'px';
            } else if (isResizing) {
                el.style.width = (startWidth + me.clientX - startX) + 'px';
            }
        };
        document.onmouseup = () => { isDragging = false; isResizing = false; document.onmousemove = null; document.onmouseup = null; };
    };
}

/* ── PDF-Template Vorschau (Legacy) ──────────────────────────── */
async function loadPdfTemplate(raceName) {
    try {
        const res = await fetch(`${PUBLIC_BASE}/template/${raceName}`);
        if (!res.ok) throw new Error(`PDF nicht gefunden (${res.status})`);

        const arrayBuffer = await (await res.blob()).arrayBuffer();
        const pdf  = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1);

        const scale    = 1.5;
        const viewport = page.getViewport({ scale });
        const canvas   = document.getElementById('regPdfCanvas');
        if (!canvas) throw new Error("Canvas 'regPdfCanvas' nicht gefunden");

        const context = canvas.getContext('2d');
        canvas.height = viewport.height; canvas.width = viewport.width;
        await page.render({ canvasContext: context, viewport }).promise;

        const textContent = await page.getTextContent();
        extractTextFields(textContent, viewport);
    } catch (e) {
        console.error('PDF load error:', e);
        showToast('Fehler beim Laden der PDF-Vorlage: ' + e.message, 'error');
    }
}

function extractTextFields(textContent, viewport) {
    const overlay = document.getElementById('pdfOverlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    pdfTextFields     = [];

    textContent.items.forEach(item => {
        if (item.str.includes('/@')) {
            const matches = item.str.match(/\/@(.*?)\@\//g);
            if (matches) {
                matches.forEach(match => {
                    const fieldName = match.replace(/\/@|\@\//g, '');
                    const tx        = pdfjsLib.Util.transform(viewport.transform, item.transform);
                    const input     = document.createElement('input');
                    input.className = 'pdf-input';
                    input.placeholder = fieldName;
                    input.style.left  = `${tx[4]}px`;
                    input.style.top   = `${viewport.height - tx[5] - 20}px`;
                    input.style.width = `${item.width * viewport.scale}px`;
                    overlay.appendChild(input);
                    pdfTextFields.push({ name: fieldName, element: input, x: tx[4], y: tx[5], width: item.width });
                });
            }
        }
    });
}
