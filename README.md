# 🏁 Multi-Race-Timer

Ein modernes, webbasiertes Zeitnehmungs-System für Sportveranstaltungen. Verwalte mehrere Rennen gleichzeitig, erfasse Zeiten in Echtzeit, ermögliche Online-Anmeldungen und veröffentliche Ergebnislisten – alles in einer eleganten, mobilfreundlichen Oberfläche.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-EatingJan1%2FMulti--Race--Timer-blue?logo=github)](https://github.com/EatingJan1/Multi-Race-Timer)

---

## ✨ Features

- **Mehrere Rennen** gleichzeitig verwalten
- **Echtzeit-Zeiterfassung** mit Start/Stop-Funktion (inkl. verzögertem Start mit Beep-Countdown)
- **Online-Anmeldung** mit konfigurierbarem Formular (Drag & Drop Designer)
- **Kiosk-Modus** für Selbst-Anmeldung vor Ort (Tablet-optimiert)
- **Öffentliche Ergebnislisten** nach Rennabschluss
- **Kategorien/Tags** für Teilnehmer (z.B. U18, PRO, Verein)
- **Export** als PDF, Excel (.xlsx) und CSV
- **Signierte PDFs** für Anmeldeformulare
- **Responsive Design** – funktioniert auf Desktop, Tablet und Smartphone
- **PWA-fähig** – kann als App auf dem Homescreen installiert werden
- **Versionierung** über Git-Tags

---

## 🚀 Schnellstart (Lokal)

### Voraussetzungen
- Python 3.8+
- Git

### Installation

```bash
git clone https://github.com/EatingJan1/Multi-Race-Timer.git
cd Multi-Race-Timer
./start.sh
```

Die App ist dann erreichbar unter:
- **Frontend:** http://localhost:8000
- **Backend API:** http://localhost:5002

### Standard-Login
- **Benutzer:** `admin` oder Wert aus `ADMIN_USER`
- **Passwort:** Wert aus `ADMIN_PASS`

> Wenn `ADMIN_PASS` nicht gesetzt ist, erzeugt das Backend beim ersten Start ein zufälliges Initialpasswort und schreibt es ins Log.

---

## 🐳 Docker (Empfohlen für Produktion)

```bash
docker-compose up -d
```

Das Frontend ist dann auf Port `80`, das Backend auf Port `5002` erreichbar.

### Wichtige Produktions-Variablen

Vor dem produktiven Einsatz sollten mindestens diese Werte gesetzt werden:

```bash
export SECRET_KEY='bitte-einen-langen-zufallswert-setzen'
export ADMIN_USER='admin'
export ADMIN_PASS='bitte-ein-starkes-passwort-setzen'
export CORS_ALLOWED_ORIGINS='https://deine-domain.example'
export SESSION_COOKIE_SECURE='true'
docker-compose up -d
```

Sicherheitsrelevante Hinweise:
- Passwörter werden ab V1.0 gehasht gespeichert; alte Klartext-Passwörter werden beim Laden automatisch migriert.
- Benutzerdaten liegen in `./var/users.db` (SQLite) und werden per Docker-Volume persistent gehalten.
- Offene CORS-Freigaben wurden entfernt. Bei zusätzlicher Domain oder LAN-Nutzung `CORS_ALLOWED_ORIGINS` explizit ergänzen.

---

## 📁 Projektstruktur

```
Multi-Race-Timer/
├── backend/
│   ├── app.py              # Flask REST API
│   ├── requirements.txt    # Python-Abhängigkeiten
│   └── Dockerfile
├── frontend/
│   ├── index.html          # Haupt-App
│   ├── impressum.html      # Impressum (Österreich, ECG)
│   ├── datenschutz.html    # Datenschutzerklärung (DSGVO)
│   ├── app.js              # Frontend-Logik
│   ├── footer-info.js      # Versionslader für alle Seiten
│   ├── style.css           # Design-System
│   ├── logo.png            # App-Logo (austauschbar)
│   └── manifest.json       # PWA-Manifest
├── data/                   # Renndaten (JSON) & Signaturen (PDF)
├── docker-compose.yml
├── start.sh                # Lokaler Startskript
├── var/users.db            # Benutzer & Berechtigungen (SQLite)
└── LICENSE                 # MIT License
```

---

## 📖 Dokumentation

Ausführliche Dokumentation im **[GitHub Wiki](../../wiki)**:

- [🏠 Startseite & Übersicht](../../wiki/Home)
- [⚙️ Installation & Hosting](../../wiki/Installation)
- [🔧 Konfiguration](../../wiki/Konfiguration)
- [👤 Benutzerhandbuch](../../wiki/Benutzerhandbuch)
- [🔒 Sicherheit](../../wiki/Sicherheit)
- [🎨 Anpassung & Branding](../../wiki/Anpassung)

---

## 📄 Lizenz

MIT License – © 2026 Jan Reiner. Siehe [LICENSE](LICENSE).
