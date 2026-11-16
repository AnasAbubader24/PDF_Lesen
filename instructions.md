# Run Lieferklar locally over HTTPS on Windows

This guide serves the app at **https://localhost:10443**. The frontend and API
run together in one container; no separate Nginx container is needed.

This is a local demo with a mock ERP, not a production deployment. It has no
real authentication or SAP connection. Keep it bound to localhost.

## 1. Install the prerequisites

Use **PowerShell** for the commands below.

- Install [Docker Desktop for Windows](https://www.docker.com/products/docker-desktop/).
  Enable the WSL 2 backend if prompted, complete any required restart, and start
  Docker Desktop. Use **Linux containers**.
- Install [Git for Windows](https://git-scm.com/downloads/win) if cloning the source.
- Install `mkcert`, which creates certificates for local development:

```powershell
winget install --id FiloSottile.mkcert --exact
```

Open a new PowerShell window after installation so the updated PATH is loaded.
If Winget is unavailable, use the Windows installation instructions in the
[official mkcert project](https://github.com/FiloSottile/mkcert).

Check the tools:

```powershell
mkcert -version
docker version
docker compose version
```

`docker version` should show both a client and a server. A missing server usually
means Docker Desktop is not running yet.

## 2. Open the project directory

Clone your repository, or open the directory containing `compose.yaml`,
`Dockerfile`, and `.env.example`:

```powershell
cd 'C:\path\to\PDF_Lesen'
```

Replace this example path with your actual checkout. Unless noted otherwise,
run all commands in this guide from this project root.

## 3. Create and trust a local certificate authority

```powershell
mkcert -install
```

Accept the Windows security/UAC prompt if one appears. This creates a local
development certificate authority (CA) and installs its public root certificate
in the applicable trust store. Restart your browser afterward.

**You trust the CA certificate, not the private key.** The private key is used by
the server and must never be imported as a trusted root or shared with others.
Trusting only the server certificate does not replace trusting its issuing CA.

To see where mkcert stores its CA files:

```powershell
mkcert -CAROOT
```

Keep `rootCA-key.pem` secret: someone with that key can create certificates your
machine trusts. Do not copy the CA directory into this project or into Docker.
Each developer should create and trust their own local CA.

Edge and Chrome normally use Windows certificate trust. If Firefox still shows
a warning, check mkcert's Firefox support instructions or import **only**
`rootCA.pem` from the directory above into Firefox's Authorities certificate
store, trusting it to identify websites. Never import `rootCA-key.pem`.

## 4. Generate the localhost certificate and server private key

```powershell
New-Item -ItemType Directory -Force -Path '.\certs' | Out-Null
mkcert -cert-file '.\certs\localhost+2.pem' -key-file '.\certs\localhost+2-key.pem' localhost 127.0.0.1 ::1
```

This creates:

- `certs/localhost+2.pem`: the server certificate.
- `certs/localhost+2-key.pem`: its private key.

The certificate covers `localhost`, `127.0.0.1`, and `::1`. Certificates are not
tied to a port, so it works on port `10443`. Do not overwrite existing keys
unless you intend to replace them; back them up securely first if needed.

These files stay on your machine and are mounted read-only into the container.
They are **not** included in the published Docker image.

## 5. Configure the app

For a new checkout, create a local environment file:

```powershell
Copy-Item '.env.example' '.env'
notepad '.env'
```

If `.env` already exists, edit it instead of overwriting your settings.
Use these values, adding your own Opper API key only if you need AI features:

```dotenv
OPPER_API_KEY=
OPPER_BASE_URL=https://api.opper.ai/v3/compat
OPPER_MODEL=anthropic/claude-sonnet-4-5
HTTPS_PORT=10443
TLS_CERT_PATH=./certs/localhost+2.pem
TLS_KEY_PATH=./certs/localhost+2-key.pem
```

The demo without LLM works with an empty `OPPER_API_KEY`. AI PDF extraction and
free-form AI questions require a valid key and a model available to your Opper
account. AI features send document content or ERP context to the configured
provider; use fictional demo data, not confidential documents.

Absolute certificate paths also work, for example
`C:/path/to/PDF_Lesen/certs/localhost+2.pem`. Use forward slashes in `.env` paths.

Compose passes the selected Opper settings to the app and mounts the certificates
at the image's expected paths. The image already defaults to HTTPS on internal
port `10443`; `HTTPS_PORT` controls the host port only.

## 6. Start with Docker

Choose **one** of these options.

### Option A: Use the published image

```powershell
docker compose pull
docker compose up -d --no-build --remove-orphans --wait
```

This runs `abubader/pdf_lesen:latest` from Docker Hub. No Node.js installation is
required on Windows. The published image currently targets `linux/amd64`.

### Option B: Build this checkout yourself

```powershell
docker compose up --build -d --remove-orphans --wait
```

This builds the frontend and backend from your local source. Use this option to
test code changes that have not been published to Docker Hub.

`--remove-orphans` removes an obsolete Nginx service from earlier versions of this
project. The persistent data volume is not deleted.

## 7. Open and verify the app

Open **https://localhost:10443** in your browser. Use `https`, not `http`.

```powershell
docker compose ps
docker compose logs --tail 100 app
curl.exe --ssl-no-revoke --fail https://localhost:10443/api/health
```

The container should be `healthy`. The health endpoint returns JSON with
`"ok":true` and an `aiConfigured` flag reflecting whether a key is configured.
This flag does not verify that the key or model works with the provider.

`--ssl-no-revoke` addresses Windows curl revocation-check errors for local CA
certificates. It still verifies certificate trust and hostname; do not use `-k`
as a substitute for correctly installing your CA.

In the app, select **Demo ohne LLM** to try the workflow without calling AI.
Review changes before approving them; imports do not automatically update ERP
values.

## 8. Stop, restart, and update

Stop the containers while keeping saved data:

```powershell
docker compose down
```

Start again:

```powershell
docker compose up -d --no-build --wait
```

After changing `.env` or replacing certificate files:

```powershell
docker compose up -d --no-build --force-recreate --wait
```

Update to a newly published image:

```powershell
docker compose pull
docker compose up -d --no-build --wait
```

SQLite data and uploaded PDFs live in the named `erp-data` volume and survive
container replacement. **Do not use `docker compose down -v` unless you intend
to permanently delete that demo data and uploaded files.** Docker's volume is
separate from the data created by running Node.js directly on Windows.

## Alternative: Run HTTPS directly with Node.js (without Docker)

Install **Node.js 24 or newer** (required for built-in `node:sqlite`). Complete
the certificate and `.env` steps above. Stop Docker first if it uses port `10443`.

```powershell
node --version
npm ci
npm test
npm run build
$env:LOCAL_HTTPS = '1'
$env:HOST = '127.0.0.1'
$env:PORT = '10443'
$env:TLS_CERT_PATH = (Resolve-Path '.\certs\localhost+2.pem').Path
$env:TLS_KEY_PATH = (Resolve-Path '.\certs\localhost+2-key.pem').Path
npm start
```

Open **https://localhost:10443**. Keep the terminal open; press **Ctrl+C** to stop.
The absolute certificate paths are important because `npm start` runs inside
the `server` workspace. These PowerShell settings apply only to that terminal.
The backend also reads the root `.env` for the Opper configuration.

Rebuild with `npm run build` after frontend changes. This method serves the built
frontend; it is not the two-process Vite hot-reload development setup.

## Troubleshooting

- **Certificate warning:** Run `mkcert -install`, restart the browser, and confirm
  the certificate was generated by this machine's trusted CA for `localhost`.
  Check Windows time/date and certificate expiry. Do not bypass the warning or
  install someone else's private CA key.
- **Certificate mount/file error:** Check both `.env` paths and verify they point
  to actual files, not directories. Enable Docker Desktop file sharing/access
  for their location if required. Never put certificates under `web/dist` or any
  publicly served frontend directory.
- **Port already in use:** Stop the other local server, or set
  `HTTPS_PORT=10444` in `.env` and recreate the Docker container. Then browse to
  `https://localhost:10444`. For the Node.js alternative, change `$env:PORT`.
- **Docker cannot connect:** Start Docker Desktop, wait for its engine, and
  confirm Linux-container mode and WSL 2 are working.
- **App unhealthy:** Run `docker compose logs --tail 100 app`. Check certificate
  readability, matching certificate/key, and data-volume permissions. Redact
  any sensitive information before sharing diagnostics.
- **AI error:** Verify your Opper key, model access, endpoint, and network
  connection. You can still use the demo without LLM.

## Before pushing this code to a public repository

Publish source and instructions, **not your machine's credentials or data**.

1. Keep `.env` local; publish only `.env.example` with an empty API key and
   portable example paths.
2. Never commit server private keys, mkcert's CA private key, certificate bundles
   containing keys, API tokens, or Docker registry credentials. Do not include
   these in an image or build context either.
3. Do not publish SQLite databases, uploaded PDFs, exports, or logs containing
   real business data. Inspect example documents and screenshots before sharing.
4. The existing `.gitignore` excludes `.env`, `data/`, `certs/*.pem`, dependency
   directories, and build output. `.dockerignore` excludes `.env`, `data`, and
   `certs` from the Docker build. Keep generated PEM files in `certs/`; other
   secret filenames or locations need their own ignore rules.
5. Once the directory is a Git repository, check before committing:

   ```powershell
   git status --short
   git check-ignore .env certs/localhost+2.pem certs/localhost+2-key.pem
   git diff --cached --name-only
   git diff --cached
   ```

   Review staged content privately. Ignore rules do **not** remove files already
   tracked by Git or erase secrets from commit history.
6. If a secret was ever committed or otherwise exposed, rotate/revoke it before
   publishing and remove it from history as appropriate. Deleting the file in a
   later commit is not enough. If a mkcert CA private key was exposed, remove
   trust in that CA and replace it as well.

Do not expose this demo on a public interface without implementing real
authentication, authorization, rate limiting, secret management, and a security
review. Trusted local HTTPS encrypts transport; it does not provide those
application security controls.
