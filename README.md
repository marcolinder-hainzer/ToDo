# ToDo – Beruf & Privat

Eine persönliche Todo-App, in der berufliche und private Aufgaben sauber getrennt sind.
Sie läuft im Browser unter **https://marcolinder-hainzer.github.io/ToDo/** und lässt sich auf PC, Tablet
und Handy wie eine App installieren.

- **Oberfläche:** liegt auf **GitHub Pages** (kostenlos, wird bei jeder Änderung automatisch veröffentlicht)
- **Daten & Anmeldung:** liegen bei **Supabase** (kostenloser Tarif, Rechenzentrum Frankfurt).
  Jeder Benutzer sieht ausschließlich seine eigenen Todos – das erzwingt die Datenbank selbst.

## Funktionen

- **Zwei Bereiche: Beruflich & Privat** – überall klar getrennt und farblich unterscheidbar
- **Übersicht:** pro Bereich **Überfällig**, **Anstehend** (Heute, Morgen, Nächste 7 Tage …) und **Allgemein** (ohne Datum);
  umschaltbar zwischen *Beides*, *Beruflich*, *Privat*; Schnelleingabe in jeder Spalte
- **Projekte** pro Bereich mit Farbe, Beschreibung, Fortschritt; archivieren oder löschen
- **Todos** mit Beschreibung, Fälligkeitsdatum (+ Uhrzeit), **Erinnerung**, Priorität und **Bildern**
  (Kamera, Drag & Drop, Strg+V; große Fotos werden automatisch verkleinert)
- **Erinnerungen:** Glocke in der App + **Push-Benachrichtigungen** aufs Handy/den PC, auch wenn die App geschlossen ist
- **Alle Todos:** Suche, Filter nach Bereich, Projekt und Status
- **Farben anpassen:** Hell/Dunkel/System, 8 Farbschemata, eigene Farben, Hintergrund, Schriftgröße (pro Benutzer gespeichert)
- **Benutzer:** keine Selbstregistrierung – nur Administratoren legen Benutzer an, setzen Passwörter zurück oder löschen sie
- Tastenkürzel: **N** = neues Todo, **Strg+Enter** = speichern

## Auf den Geräten installieren

- **Android / Chrome / Edge:** Adresse öffnen → Menü → „App installieren“
- **iPhone / iPad:** in **Safari** öffnen → „Teilen“ → „Zum Home-Bildschirm“, danach die App vom Home-Bildschirm starten
- Danach in der App unter **Einstellungen → Benachrichtigungen** auf jedem Gerät „Auf diesem Gerät aktivieren“ tippen

## Einrichtung

### A) Automatisch (empfohlen)

Mit einem Supabase-Zugangsschlüssel (Access Token) richtet das Skript alles ein:

```bash
npm install
SUPABASE_ACCESS_TOKEN=sbp_... npm run setup:supabase
```

Es legt das Projekt in Frankfurt an, richtet Datenbank, Zugriffsregeln, Bildspeicher, Anmeldung,
Edge Functions und den Erinnerungs-Cronjob ein, erstellt das Admin-Konto `marco` (Start-Passwort wird angezeigt)
und trägt die Verbindungsdaten in `public/config.js` ein. Danach `public/config.js` committen und pushen.
Den Access Token anschließend im Supabase-Dashboard wieder löschen.

### B) Von Hand im Supabase-Dashboard

1. Auf [supabase.com](https://supabase.com) ein **neues Projekt** anlegen (Region *Frankfurt*, Free-Tarif).
2. **SQL Editor** → Inhalt von [`supabase/schema.sql`](supabase/schema.sql) einfügen → *Run*.
3. **Authentication → Sign In / Providers:** „Allow new users to sign up“ **aus**, bei *Email* „Confirm email“ **aus**.
4. **Authentication → Users → Add user:** E-Mail `marco@todo.local`, ein Passwort, „Auto Confirm User“ an.
   Der erste Benutzer wird automatisch Administrator. (Der Benutzername ist der Teil vor dem @.)
5. **Edge Functions → Deploy a new function → Via Editor:** je eine Funktion `admin-users` und `send-reminders`
   mit dem Code aus `supabase/functions/<name>/index.ts` anlegen und bei beiden **„Verify JWT“ ausschalten**.
6. **Edge Functions → Secrets:** `CRON_SECRET` (beliebige lange Zufallszeichenfolge), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
   (erzeugen mit `npx web-push generate-vapid-keys`) und `VAPID_SUBJECT` (z. B. `mailto:du@example.com`).
7. **SQL Editor** → [`supabase/cron.sql`](supabase/cron.sql) mit eingesetzter Projekt-URL und `CRON_SECRET` ausführen.
8. **Project Settings → API Keys:** Projekt-URL und *Publishable key* sowie den VAPID-Public-Key in
   [`public/config.js`](public/config.js) eintragen, committen und pushen.

### GitHub Pages einschalten (einmalig)

Repository → **Settings → Pages → Build and deployment → Source: „GitHub Actions“**.
Ab dann veröffentlicht der Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) den Ordner `public/`
bei jeder Änderung automatisch.

## Benutzer verwalten

Als Administrator in der Seitenleiste **Benutzer**: neue Benutzer anlegen (mit Start-Passwort, das bei der ersten
Anmeldung geändert werden muss), Passwörter zurücksetzen, Admin-Rechte vergeben/entziehen, Benutzer löschen
(inkl. aller Todos, Projekte und Bilder). Ein Administrator kann die Todos anderer Benutzer **nicht** sehen.

**Passwort vergessen?** Ein anderer Admin setzt es unter *Benutzer* zurück. Als einziger Admin:
im Supabase-Dashboard unter *Authentication → Users* beim Benutzer „Reset password“ bzw. ein neues Passwort setzen.

## Hinweise zum kostenlosen Supabase-Tarif

- 500 MB Datenbank und 1 GB Dateispeicher – für eine persönliche Todo-App mehr als genug.
- Wird das Projekt **eine Woche lang nicht benutzt**, pausiert Supabase es (mit E-Mail-Warnung vorher).
  Im Dashboard mit einem Klick wieder starten; bei regelmäßiger Nutzung passiert das nicht.

## Sicherheit

- Anmeldung über Supabase Auth (Passwörter werden mit bcrypt gespeichert), keine Selbstregistrierung
- **Row Level Security** auf allen Tabellen: Jede Abfrage liefert nur Zeilen des angemeldeten Benutzers –
  auch wer die öffentlichen Schlüssel aus `config.js` kennt, kommt ohne Anmeldung an keine Daten
- Bilder in einem **privaten** Speicher-Bucket, jeder Benutzer nur in seinem eigenen Ordner; Anzeige über zeitlich
  begrenzte Links; Bildtyp wird anhand des Dateiinhalts geprüft (kein SVG)
- Benutzerverwaltung nur über die Edge Function `admin-users`, die Admin-Rechte serverseitig prüft
- Passwortänderung erfordert das aktuelle Passwort und meldet alle anderen Geräte ab
- Strikte Content-Security-Policy; Inhalte werden nie als HTML eingefügt

## Entwicklung

```bash
npm install
npm run dev        # http://localhost:5173/ToDo/ (bildet GitHub Pages nach)
npm run vendor     # aktualisiert public/vendor/supabase.js nach einem Update von @supabase/supabase-js
```

```
public/                 die komplette App (wird auf GitHub Pages veröffentlicht)
  config.js             Verbindung zu Supabase (öffentliche Werte)
  js/data.js            Datenzugriff (Auth, Datenbank, Bilder, Edge Functions)
  js/views/             Seiten: Übersicht, Todos, Projekte, Einstellungen, Benutzer, Login
  js/components/        Todo-Editor, Erinnerungen, Bildbetrachter …
  sw.js                 Service Worker für Push-Benachrichtigungen
supabase/
  schema.sql            Tabellen, Zugriffsregeln (RLS), Bildspeicher
  cron.sql              Erinnerungs-Cronjob
  functions/            Edge Functions: admin-users, send-reminders
scripts/
  setup-supabase.mjs    automatische Einrichtung über die Supabase Management API
  serve.mjs             lokaler Testserver
.github/workflows/      automatische Veröffentlichung auf GitHub Pages
```
