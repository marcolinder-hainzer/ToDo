# ToDo – Beruf & Privat

Eine persönliche, selbst gehostete Todo-App, in der berufliche und private Aufgaben sauber getrennt sind.
Läuft im Browser auf PC, Tablet und Handy und lässt sich wie eine App auf dem Home-Bildschirm installieren.

## Funktionen

- **Zwei Bereiche: Beruflich & Privat** – überall klar getrennt und farblich unterscheidbar
- **Übersicht (Startseite)** – pro Bereich drei Abschnitte:
  - **Überfällig** – Fälligkeitsdatum ist überschritten
  - **Anstehend** – mit Fälligkeitsdatum, gruppiert nach *Heute*, *Morgen*, *Nächste 7 Tage*, *Diesen Monat*, *Später*
  - **Allgemein** – Todos ohne Datum
  - Umschaltbar: *Beides*, nur *Beruflich* oder nur *Privat*
  - Schnelleingabe direkt in jeder Spalte
- **Projekte** – pro Bereich, mit Farbe, Beschreibung, Fortschrittsbalken; archivieren oder löschen
- **Todos** mit
  - Titel und kurzer Beschreibung
  - Fälligkeitsdatum (optional mit Uhrzeit) und Schnellauswahl (Heute, Morgen, Nächste Woche)
  - **Erinnerung** zu einem frei wählbaren Zeitpunkt (Schnellauswahl z. B. „1 Tag vorher“)
  - Priorität (Niedrig / Normal / Hoch)
  - **Bildern** – hochladen, per Drag & Drop oder Strg+V einfügen, auf dem Handy direkt mit der Kamera;
    große Fotos werden vor dem Upload automatisch verkleinert
- **Erinnerungen**
  - Glocke mit Zähler in der App; Aktionen *Erledigt*, *+10 Min.*, *+1 Std.*, *Morgen 9:00*, *Ausblenden*
  - **Push-Benachrichtigungen** aufs Handy/den PC, auch wenn die App geschlossen ist (benötigt HTTPS)
- **Alle Todos** – Suche (auch mit Umlauten), Filter nach Bereich, Projekt und Status (offen/erledigt)
- **Farben anpassen** – Hell/Dunkel/System, 8 Farbschemata, eigene Farben für Akzent, Beruflich und Privat,
  Hintergrundfarbe, Schriftgröße. Wird pro Benutzer gespeichert und gilt auf allen Geräten.
- **Sicherheit & Benutzer**
  - Anmeldung mit Benutzername und Passwort – es gibt **keine** Selbstregistrierung
  - Nur Administratoren (du, Marco) können Benutzer anlegen, Passwörter zurücksetzen oder löschen
  - Jeder Benutzer sieht ausschließlich seine eigenen Todos, Projekte und Bilder
- Tastenkürzel: **N** = neues Todo, **Strg+Enter** = speichern

## Schnellstart

Voraussetzung: **Node.js 22.13 oder neuer** (die Datenbank SQLite ist in Node eingebaut – keine weitere Software nötig).

```bash
npm install
npm start
```

Beim **ersten Start** wird das Administrator-Konto `marco` angelegt und das Start-Passwort in der Konsole angezeigt:

```
==========================================
  Administrator-Konto wurde angelegt:
    Benutzername: marco
    Passwort:     xYz…
  Bitte nach der ersten Anmeldung ändern (wird erzwungen).
==========================================
```

Öffne <http://localhost:3000>, melde dich an und vergib ein eigenes Passwort.
Alternativ kannst du das Start-Passwort vorgeben: `ADMIN_PASSWORD=... npm start` (oder in der `.env`).

### Mit Docker

```bash
docker compose up -d --build
docker compose logs todo     # zeigt das Start-Passwort
```

Die Daten liegen im Docker-Volume `todo-data`.

## Im Internet bzw. auf dem Handy nutzen (HTTPS)

Für die Nutzung außerhalb deines Heimnetzes und für Push-Benachrichtigungen braucht die App **HTTPS**.
Am einfachsten mit [Caddy](https://caddyserver.com) als Reverse-Proxy (holt das Zertifikat automatisch):

```caddyfile
todo.deine-domain.de {
    reverse_proxy localhost:3000
}
```

Und in der `.env` der App:

```ini
TRUST_PROXY=true
COOKIE_SECURE=true
VAPID_SUBJECT=mailto:du@deine-domain.de
```

### Als App installieren & Benachrichtigungen

- **Android / Chrome / Edge:** Menü → „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.
- **iPhone / iPad (ab iOS 16.4):** In Safari öffnen → „Teilen“ → „Zum Home-Bildschirm“. Die App von dort starten.
- Danach unter **Einstellungen → Benachrichtigungen → „Auf diesem Gerät aktivieren“**.
  Mit „Test senden“ prüfst du, ob alles ankommt. Das geht für jedes Gerät einzeln.

Ohne HTTPS funktionieren Erinnerungen trotzdem – sie erscheinen dann in der App (Glocke oben rechts),
solange die App geöffnet ist.

## Benutzer verwalten

Als Administrator findest du in der Seitenleiste **Benutzer**:

- **Neuer Benutzer** – Benutzername, Anzeigename, Start-Passwort (mit Generator).
  Standardmäßig muss der Benutzer das Passwort bei der ersten Anmeldung ändern.
- **Passwort** zurücksetzen (meldet den Benutzer auf allen Geräten ab)
- **Zum Admin** machen bzw. Rechte entziehen (mindestens ein Admin bleibt immer erhalten)
- **Löschen** – entfernt den Benutzer mit allen Todos, Projekten und Bildern

### Passwort vergessen?

Auf dem Server (im Projektordner):

```bash
npm run reset-password -- marco                    # erzeugt ein neues Zufallspasswort
npm run reset-password -- marco MeinNeuesPasswort  # setzt ein bestimmtes Passwort
```

Mit Docker: `docker compose exec todo node --disable-warning=ExperimentalWarning scripts/reset-password.js marco`

## Datensicherung

Alles liegt im Ordner `data/` (bzw. im Docker-Volume):

- `todo.db` – Datenbank (Benutzer, Projekte, Todos, Einstellungen)
- `uploads/` – hochgeladene Bilder

Für ein Backup die App kurz stoppen und den gesamten Ordner kopieren.

## Konfiguration

Alle Einstellungen per Umgebungsvariable oder in einer `.env`-Datei (Vorlage: `.env.example`).

| Variable             | Standard                     | Bedeutung                                                         |
| -------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `PORT`               | `3000`                       | Port der App                                                      |
| `HOST`               | `0.0.0.0`                    | Netzwerk-Adresse                                                  |
| `DATA_DIR`           | `./data`                     | Ordner für Datenbank und Bilder                                   |
| `ADMIN_USERNAME`     | `marco`                      | Benutzername des ersten Admins (nur beim ersten Start)            |
| `ADMIN_DISPLAY_NAME` | aus Benutzername             | Anzeigename des ersten Admins                                     |
| `ADMIN_PASSWORD`     | zufällig                     | Start-Passwort des ersten Admins                                  |
| `TRUST_PROXY`        | `false`                      | `true` hinter Reverse-Proxy (HTTPS & echte IP erkennen)           |
| `COOKIE_SECURE`      | `auto`                       | `true` = Cookie nur über HTTPS + HSTS                             |
| `VAPID_SUBJECT`      | `mailto:admin@example.com`   | Kontaktadresse für Push-Dienste                                   |
| `SESSION_DAYS`       | `30`                         | Gültigkeit einer Anmeldung (verlängert sich bei Nutzung)          |
| `MAX_UPLOAD_MB`      | `15`                         | Maximale Bildgröße                                                |
| `ALLOWED_ORIGINS`    | –                            | Zusätzliche erlaubte Origins (kommagetrennt), selten nötig        |

## Sicherheit im Überblick

- Passwörter mit **scrypt** gehasht (eigenes Salt pro Benutzer), Vergleich in konstanter Zeit
- Sitzungen über zufälliges Token in einem **HttpOnly-/SameSite-Cookie**; in der Datenbank liegt nur dessen Hash
- **CSRF-Schutz**: Sitzungs-Token im Header + Prüfung der Herkunft (Origin) jeder ändernden Anfrage
- **Login-Sperre** nach wiederholten Fehlversuchen (pro Benutzername und IP, 15 Minuten)
- Passwortwechsel bzw. -reset meldet alle anderen Geräte ab; „Andere Geräte abmelden“ in den Einstellungen
- Strikte **Content-Security-Policy** und weitere Sicherheits-Header (helmet); Inhalte werden nie als HTML eingefügt
- **Uploads**: Bildtyp wird anhand des Dateiinhalts geprüft (kein SVG), zufällige Dateinamen,
  Bilder nur für den Besitzer abrufbar
- Strikte Trennung der Daten: jede Abfrage ist auf den angemeldeten Benutzer beschränkt

## Entwicklung

```bash
npm run dev    # Neustart bei Code-Änderungen
npm test       # API- und Sicherheitstests (starten einen Server mit Test-Datenbank)
```

Aufbau:

```
server/            Express-Backend
  index.js         Start, erstes Admin-Konto
  app.js           Middleware, Sicherheits-Header, Routen
  auth.js          Passwörter, Sitzungen, CSRF, Login-Sperre
  db.js            SQLite-Schema & Migrationen
  push.js          Web-Push (VAPID-Schlüssel werden automatisch erzeugt)
  reminders.js     Prüft alle 30 s fällige Erinnerungen
  routes/          API-Endpunkte
public/            Frontend (ohne Build-Schritt)
  js/views/        Seiten: Übersicht, Todos, Projekte, Einstellungen, Benutzer, Login
  js/components/   Todo-Editor, Erinnerungen, Bildbetrachter …
  css/app.css      Design (Farben über CSS-Variablen anpassbar)
  sw.js            Service Worker für Push-Benachrichtigungen
scripts/           reset-password.js
test/              Automatisierte Tests
```
