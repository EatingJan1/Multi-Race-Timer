// Lightweight script to load version and copyright info into the footer.
// Used on sub-pages (impressum.html, datenschutz.html) without loading the full app.js.
(async function () {
    const PUBLIC_BASE = `http://${window.location.hostname}:5002/public`;
    try {
        const res = await fetch(`${PUBLIC_BASE}/info`);
        if (res.ok) {
            const data = await res.json();
            const versionEl = document.getElementById('appVersion');
            const copyrightEl = document.getElementById('appCopyright');
            if (versionEl) versionEl.textContent = `Version: ${data.version}`;
            if (copyrightEl) copyrightEl.textContent = `\u00a9 ${new Date().getFullYear()} ${data.copyright}`;
        }
    } catch (e) {
        console.warn('Could not load app info:', e);
    }
})();
