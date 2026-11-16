# Lieferklar — Supplier Confirmation Proof of Concept

React + UI5 Web Components, LangChain.js + Opper, zustandsbehaftetes SQLite-Mock-ERP und Docker/HTTPS.
Das Docker-Image enthält Frontend und API und bedient HTTPS direkt, ohne Nginx.
Keine SAP-Verbindung. Lokale Demo, ohne echte Benutzeranmeldung oder Rollenverwaltung.

## Start mit Docker

1. Docker Desktop starten (Linux-Container).
2. `.env.example` nach `.env` kopieren und `OPPER_API_KEY` setzen.
3. Zertifikat und Schlüssel unter `certs/` ablegen oder `TLS_CERT_PATH` / `TLS_KEY_PATH` setzen.
4. `docker compose up --build -d`
5. **https://localhost:10443** öffnen. Bei geändertem `HTTPS_PORT` den Port entsprechend ändern.

Bereits veröffentlichtes Image verwenden: `docker compose pull`, dann `docker compose up -d --no-build`.
Zertifikat und privater Schlüssel werden nur lesbar zur Laufzeit eingebunden; API-Schlüssel kommen
aus `.env`. Keines dieser Geheimnisse ist im Image enthalten. Ohne Opper-Schlüssel funktioniert
die Demo ohne LLM; PDF-KI-Extraktion benötigt einen Schlüssel.

Die bereitgestellten mkcert-Zertifikate benötigen eine im Browser vertrauenswürdige mkcert-CA.
Private Schlüssel nie committen. Ein im Chat geteilter Schlüssel sollte vor weitergehender Nutzung ersetzt werden.
Der HTTPS-Port wird nur an 127.0.0.1 veröffentlicht. Für öffentliche Nutzung sind Authentifizierung, Autorisierung,
Rate-Limits, Secret-Management und eine Sicherheitsprüfung erforderlich.

```dotenv
OPPER_API_KEY=your-key
OPPER_BASE_URL=https://api.opper.ai/v3/compat
OPPER_MODEL=anthropic/claude-sonnet-4-5
TLS_CERT_PATH=./certs/localhost+2.pem
TLS_KEY_PATH=./certs/localhost+2-key.pem
HTTPS_PORT=10443
```

Opper-Modell-ID im öffentlichen Katalog verifiziert. Diese direkte Sonnet-4.5-Route ist laut Katalog
zur Ablösung vorgesehen. Modell bei Bedarf explizit in `.env` ändern; kein automatischer Modellwechsel.
Nach Änderungen: `docker compose up -d --force-recreate app`.

## Demoablauf

1. **Demo ohne LLM** importiert die im Beispiel vorgegebenen Werte, ohne KI aufzurufen.
2. Alternativ **Beispiel-PDF** speichern und mit **PDF auswählen** importieren. Das ist echte
   LangChain/Opper-Extraktion. PDF wird seitenweise als Text und Bild übermittelt; auch Scans werden
   vom Vision-Modell gelesen. Bis zu 15 Seiten / 15 MB.
3. Änderungen und PDF-Belege prüfen, ggf. **Werte korrigieren**. Bestellreferenz und Lieferant
   müssen zusammen eindeutig passen. Mehrfach vorkommende Artikel über Position bzw. manuelle Zuordnung auflösen.
4. Positionen auswählen → **Auswahl verbindlich freigeben** → finale Freigabe bestätigen.
5. **Materialengpässe** zeigt drei verspätete Bedarfe: Lager, Zahnriemen und Hydrauliköl.
   Schrauben sind trotz Lieferverzug durch Bestand gedeckt.
6. **Teillieferung anfragen** erzeugt einen Entwurf. Separate Freigabe speichert die Anfrage,
   versendet aber keine E-Mail und verändert keine Materialverfügbarkeit.
7. **Lieferantenzusage prüfen** simuliert die Antwort. Explizite Freigabe aktualisiert den Lieferplan.
8. **Produktionsverschiebung vorschlagen** berechnet einen materialgedeckten Termin. Freigabe
   verschiebt alle zugehörigen Bedarfe, erhält ursprüngliche Termine und zeigt verbleibende Engpässe.
9. **Aktuellen Datenstand abfragen** oder `/state` liefert immer eine frische Serverabfrage.
   Freie Fragen mit LLM-Schlüssel werden über LangChain anhand eines frischen ERP-Snapshots beantwortet.
10. **ERP-Daten** zeigt gespeicherte Werte und bietet JSON-Export. Die Historie dokumentiert alle Freigaben.

**Parallele Änderung simulieren** demonstriert Versionskonflikte. Vor erneuter Freigabe muss der
Vorschlag neu abgeglichen werden. **Demo zurücksetzen** setzt die Daten nach Bestätigung zurück.
SQLite und PDFs liegen im Docker-Volume `erp-data` und überleben Neustarts. Reset leert die fachlichen
Daten/Chat-Historie; bereits gespeicherte PDF-Dateien bleiben im lokalen Volume.

## Sprachen

Deutsch und Englisch vollständig; Französisch, Spanisch, Italienisch, Portugiesisch, Arabisch (RTL)
und Chinesisch für Kernoberfläche. Detaillierte technische Hinweise fallen dort auf Englisch zurück.
Datums-, Zahlen- und Preisformatierung ist sprachabhängig; der KI-Chat antwortet in der gewählten Sprache.
Dokumentbelege, Artikelstammdaten und deutsche Lieferantenentwürfe werden als Originaldaten nicht übersetzt.

## Lokale Entwicklung

Node.js **24+** (integriertes `node:sqlite`), npm:

```powershell
npm ci
npm test
npm run build
```

Browser-Tests: `npx playwright install chromium`, dann `npm run test:ui`.
Diese Tests nutzen eine isolierte temporäre Datenbank und verändern nicht den Demo-Datenstand.

Zwei Terminals: `npm run dev:api` und `npm run dev:web`.
Für HTTPS im Vite-Frontend vor dem Start `TLS_CERT_PATH` und `TLS_KEY_PATH` als Umgebungsvariablen
mit absoluten Pfaden setzen. Vite proxyt `/api` an das lokale Backend.
Alternativ gebautes Frontend über den Backend-HTTPS-Server ausliefern:

```powershell
$env:LOCAL_HTTPS='1'
$env:PORT='3443'
$env:TLS_CERT_PATH='C:/path/to/localhost+2.pem'
$env:TLS_KEY_PATH='C:/path/to/localhost+2-key.pem'
npm start
```

## Architektur und Grenzen

- Ein Backend enthält eine klar getrennte Mock-ERP-Domänenschicht; kein zusätzlicher SAP-Dienst nötig.
- LangChain extrahiert strukturierte Bestätigungen und beantwortet Fragen. Es erhält keine Schreibwerkzeuge.
- Lieferdatum, Nettoeinheitspreis und Bestätigungsfelder werden pro Position gemeinsam freigegeben.
- Preise sind **Netto nach Rabatt**, nur EUR in den Seeds, keine erneute Rabattberechnung.
- Lieferpläne unterstützen Teillieferungen; `shipDate` zeigt den letzten Termin der Restmenge.
- Materialrechnung: chronologische Zuordnung, jeder Bestand/Zugang nur einmal, ein Kalendertag Wareneingang.
  Unbestätigte erwartete Bestellzugänge sind geplante Versorgung, Lieferantenanfragen sind keine Versorgung.
- Materialfeasible Termine, **keine** Arbeitszentrum-/Feiertags-/Kapazitätsplanung, Stücklistenauflösung oder
  Terminpropagierung über mehrstufige Produktionsabhängigkeiten.
- Globale ERP-Revision plus Vorschlagsversion verhindern veraltete Freigaben. SQLite-Transaktionen
  speichern Änderungen und Audit gemeinsam. PDF-Hash und Bestätigung/Bestellreferenz verhindern Doppelimporte.
  Revidierte Dokumente mit identischer Bestätigungsnummer müssen in dieser Demo manuell behandelt werden.
- Benutzername ist ein Demo-Label, kein authentifizierter Identitätsnachweis.
- Original-PDF kann geöffnet werden; Extraktion liefert textuelle Belege und Seitenzahlen, keine
  automatisch geometrisch markierten Bounding-Boxes. Ergebnisse müssen menschlich geprüft werden.
- Ein LLM-Aufruf kann zwischenzeitlich durch eine ERP-Änderung überholt werden; Chat zeigt daher
  die gelesene Revision explizit neben dem aktuellen Datenstand.

## Read API

`GET /api/state` — vollständiger letzter Datenstand samt Engpässen und Historie (Cache deaktiviert).
`GET /api/orders/po-4711` oder `/api/orders/B-2026-04711` — aktuelle Bestellung plus Revision.
`POST /api/chat` mit `{"message":"/state","language":"de"}` — aktueller Zustand ohne LLM.

Mutation-Endpunkte sind nur für diese lokale Demo bestimmt und verlangen explizite Freigabepayloads.
Tests unter `server/test/` prüfen unter anderem Freigabeschranke, Versionierung, Teilmengen,
Engpässe, Einzelallokation, Produktionsverschiebung, Persistenz, Rollback und CSRF-Abwehr.
