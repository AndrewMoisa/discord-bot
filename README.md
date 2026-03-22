# Discord HR Manager Bot

Bot Discord pentru management semi-automat de angajari si pontaj, cu suport multi-guild:

- Flux angajare: managerul ruleaza comanda de angajare, botul posteaza cererea in canalul de hiring, manager/admin aproba sau respinge, iar la aprobare botul atribuie rolul de angajat.
- Flux pontaj: botul publica un panel cu un buton Clock (toggle). La Clock Out se calculeaza durata si se posteaza log in canalul de arhiva pontaj.
- Izolare date: fiecare guild are schema PostgreSQL dedicata (`g_<guildId>`), iar setarile de guild se tin in tabele publice.

## Functionalitati

- Slash command `cv` cu formular UI pentru depunere CV.
- Slash command `setup-timesheet` pentru panelul de pontaj.
- Slash command `tenant-setup` pentru setup schema + config pe guild.
- Slash command `tenant-status` pentru verificarea statusului de setup pe guild.
- Butoane `Approve/Reject` pentru cereri de angajare.
- Atribuire automata a rolului de angajat la aprobare.
- Clock in/out cu regula: un singur clock-in activ per angajat.
- Loguri centralizate in canal dedicat.
- Persistenta in PostgreSQL prin Prisma.

## Tehnologii

- Node.js + TypeScript
- discord.js v14
- PostgreSQL + Prisma ORM
- Railway pentru hosting

## Setup local

1. Instalare dependinte:

```bash
npm install
```

2. Copiaza variabilele de mediu:

```bash
cp .env.example .env
```

3. Completeaza `.env` cu valorile reale din Discord si DB.

4. Ruleaza migrarile Prisma pe baza ta de date:

```bash
npx prisma migrate dev --name init
```

5. Pornire in dezvoltare:

```bash
npm run dev
```

## Variabile de mediu

- `BOT_TOKEN` token bot Discord
- `APP_ID` application client id Discord
- `DATABASE_URL` conexiune PostgreSQL
- `BOT_OWNER_IDS` user ids separate prin virgula (doar owner poate rula setup)
- `CONTROL_PANEL_PORT` port pentru API panel (default `8787`)
- `PANEL_API_TOKEN` token pentru autentificarea request-urilor catre API panel
- `PANEL_PROXY_SHARED_SECRET` secret optional suplimentar pentru request-urile venite prin proxy-ul Cloudflare
- `PANEL_PROXY_ONLY` daca este `true`, API-ul panel accepta doar request-uri cu metadata de proxy (`X-Panel-Actor-Id` + `X-Request-Id`)
- `PANEL_ALLOWED_ORIGINS` lista de origini permise pentru panel (separate prin virgula)
- `DEFAULT_*` fallback optional pentru bootstrap config (vezi `.env.example`)

## Control Panel API (owner-only)

Backend-ul include acum un API simplu pentru panel web. Toate endpoint-urile (in afara de health) necesita header:

- `X-Panel-Token: <PANEL_API_TOKEN>`

UI panel este disponibil la:

- `/panel/` pe acelasi host/port cu API-ul

Endpoint-uri:

- `GET /api/health`
- `GET /api/guilds`
- `GET /api/guilds/:guildId`
- `PUT /api/guilds/:guildId/config`
- `POST /api/guilds/:guildId/provision`

## Comenzi bot

### `/cv`

Doar manager/admin.

Parametri:

- `user` membrul pentru care se completeaza CV-ul

Formular UI (modal) cu campuri:

- Nume & Prenume
- CNP
- Numar de telefon
- Poza cu buletinul (URL)
- De cine ai fost adus?

Rezultat:

- creeaza cerere in DB cu status `PENDING`
- posteaza embed in canalul de hiring cu butoane `Approve/Reject`

### `/setup-timesheet`

Doar manager/admin.

Posteaza panelul de pontaj in canalul configurat pentru guild in `GuildConfig.timesheetChannelId`.

### `/tenant-setup`

Doar owner bot.

Provisioneaza tenantul guild-ului curent:

- creeaza/actualizeaza `GuildTenant` si `GuildConfig`
- creeaza schema dedicata `g_<guildId>`
- creeaza tabelele tenant (`Employee`, `HireRequest`, `TimeEntry`) in schema dedicata

Parametri:

- `employee_role_id`
- `cv_channel_id`
- `cv_approved_channel_id`
- `timesheet_channel_id`
- `timesheet_archive_channel_id`
- `timesheet_summary_channel_id`
- `log_channel_id`
- `manager_role_ids` (lista separata prin virgula)
- `timezone` (optional)

### `/tenant-status`

Doar owner bot.

Afiseaza statusul tenantului pentru guild-ul curent.

## Flux angajare

1. Manager ruleaza `/cv`.
2. Bot creeaza cererea si o posteaza in canalul de hiring.
3. Manager/admin apasa `Approve` sau `Reject`.
4. La `Approve`:

- status cerere devine `APPROVED`
- utilizatorul este creat/actualizat in tabela `Employee`
- botul atribuie `EMPLOYEE_ROLE_ID`
- se publica log in canalul de loguri

5. La `Reject`:

- status cerere devine `REJECTED`
- se publica log in canalul de loguri

## Flux pontaj

1. Angajatul apasa `Clock`.
2. Bot valideaza ca userul are rolul de angajat si nu are sesiune deschisa.
3. Bot creeaza un `TimeEntry` cu status `OPEN`.
4. La urmatorul `Clock`, botul inchide sesiunea, calculeaza durata si logheaza intervalul in canalul de arhiva pontaj.
5. La ora 00:00, botul face auto clock-out pentru orice sesiune deschisa si trimite rezumatul zilnic in canalul de summary.
6. Duminica la 19:00, botul trimite rezumatul saptamanal (Nume -> ore state) in acelasi canal de summary.

## Deploy Railway (free)

1. Creeaza proiect nou pe Railway si conecteaza repository-ul.
2. Adauga toate variabilele de mediu din `.env.example` in Railway.
3. Seteaza comenzi:

- Build command: `npm run build`
- Start command: `npm run prisma:deploy && npm run start`

4. Asigura-te ca serviciul PostgreSQL este atasat si `DATABASE_URL` este setat.
5. Dupa deploy, verifica in Discord ca slash commands apar in guild si ruleaza corect.

## Comenzi utile

```bash
npm run dev
npm run build
npm run check
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
```
