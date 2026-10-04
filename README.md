# 🏁 Multi-Race-Timer

Ein modernes, webbasiertes Zeitnehmungs-System für Sportveranstaltungen. Verwalte mehrere Rennen gleichzeitig, erfasse Zeiten in Echtzeit, ermögliche Online-Anmeldungen und veröffentliche Ergebnislisten – alles in einer eleganten, mobilfreundlichen Oberfläche.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub](https://img.shields.io/badge/GitHub-EatingJan1%2FMulti--Race--Timer-blue?logo=github)](https://github.com/EatingJan1/Multi-Race-Timer)

---

## ✨ Features

- **Mehrere Rennen** gleichzeitig verwalten
- **Echtzeit-Zeiterfassung** mit Start/Stop-Funktion (inkl. verzögertem Start mit Beep-Countdown)
- **Online-Anmeldung** mit konfigurierbarem Formular (Drag & Drop Designer)
- **Kiosk-Modus** für Selbst-Anmeldung vor Ort (Tablet-optimiert) mit sicherem Token-Zugriff
- **Öffentliche Ergebnislisten** nach Rennabschluss
- **Kategorien/Tags** für Teilnehmer (z.B. U18, PRO, Verein)
- **Export** als PDF, Excel (.xlsx) und CSV
- **Signierte PDFs** für Anmeldeformulare mit Inhaltsvalidierung
- **Responsive Design & PWA-fähig** – optimiert für Desktop, Tablet und Smartphone
- **Rollen- & Rechtesystem** mit Manager- und Admin-Ebenen

---

## 🚀 Schnellstart (Lokal)

### Voraussetzungen
- Python 3.10+
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

> Wenn `ADMIN_PASS` nicht gesetzt ist, erzeugt das Backend beim ersten Start ein temporäres Initialpasswort und gibt dieses beim Start aus.

---

## 🐳 Docker (Empfohlen für Produktion)

```bash
cp .env.example .env
# Passe .env an (mindestens SECRET_KEY und ADMIN_PASS setzen!)
docker compose up -d
```

Das System ist nun über das Nginx-Frontend auf Port `80` erreichbar. Die API wird intern über `/api/` an das Backend weitergeleitet.

### Wichtige Produktions-Variablen

Vor dem produktiven Einsatz sollten mindestens diese Werte in `.env` gesetzt werden:

```bash
SECRET_KEY=$(openssl rand -hex 32)
ADMIN_USER=admin
ADMIN_PASS=DeinSicheresAdminPasswort
SESSION_COOKIE_SECURE=true
CORS_ALLOWED_ORIGINS=https://deine-domain.example
```

Sicherheitsrelevante Hinweise:
- In Produktion startet das Backend nicht ohne gesetzten `SECRET_KEY`.
- Passwörter werden mit `scrypt`/`pbkdf2` sicher gehasht.
- Nginx liefert Sicherheits-Header (CSP, HSTS, X-Frame-Options, X-Content-Type-Options) und fungiert als Reverse Proxy.
- Anfragen und Logins sind durch integriertes Rate-Limiting gegen Brute-Force-Angriffe geschützt.

---

## 📁 Projektstruktur

```
Multi-Race-Timer/
├── backend/
│   ├── app.py              # Flask REST API & Security Layer
│   ├── requirements.txt    # Gependelte Python-Abhängigkeiten
│   └── Dockerfile          # Non-Root Image mit Gunicorn
├── frontend/
│   ├── index.html          # Haupt-App & Landing Page
│   ├── impressum.html      # Impressum (Österreich, ECG)
│   ├── datenschutz.html    # Datenschutzerklärung (DSGVO)
│   ├── app.js              # Frontend-Logik
│   ├── footer-info.js      # Versionslader
│   ├── style.css           # Design-System
│   ├── nginx.conf          # Nginx Reverse Proxy & Security Headers
│   ├── icons/              # App-Icons (PWA)
│   └── manifest.json       # PWA-Manifest
├── data/                   # Renndaten (JSON) & Signaturen (PDF)
├── var/                    # SQLite-Datenbank (users.db)
├── docker-compose.yml      # Multi-Container Setup
├── start.sh                # Lokaler Startskript
├── .env.example            # Konfigurations-Vorlage
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
