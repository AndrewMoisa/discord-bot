# Discord HR Manager Bot

Bot Discord pentru management semi-automat de angajari si pontaj:

- Flux angajare: managerul ruleaza comanda de angajare, botul posteaza cererea in canalul de hiring, manager/admin aproba sau respinge, iar la aprobare botul atribuie rolul de angajat.
- Flux pontaj: botul publica un panel cu un buton Clock (toggle). La Clock Out se calculeaza durata si se posteaza log in canalul de arhiva pontaj.

## Functionalitati

- Slash command `cv` cu formular UI pentru depunere CV.
- Slash command `setup-timesheet` pentru panelul de pontaj.
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

- `DISCORD_TOKEN` token bot Discord
- `CLIENT_ID` application client id Discord
- `GUILD_ID` server id unde inregistrezi comenzile
- `DATABASE_URL` conexiune PostgreSQL
- `ROLE_EMPLOYEE_ID` rolul atribuit la aprobare
- `CHANNEL_HIRING_ID` canal pentru cereri de angajare
- `CHANNEL_APPROVED_CV_ID` canal pentru CV-uri aprobate (embed complet)
- `CHANNEL_TIMESHEET_ID` canal unde se posteaza panelul de pontaj
- `CHANNEL_TIMESHEET_ARCHIVE_ID` canal unde se posteaza logurile de pontaj
- `CHANNEL_LOGS_ID` canal de audit/loguri
- `MANAGER_ROLE_IDS` lista role id separate prin virgula pentru acces la hire/review
- `TIMEZONE` implicit `Europe/Bucharest`

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

Posteaza panelul de pontaj in canalul configurat (`CHANNEL_TIMESHEET_ID`).

## Flux angajare

1. Manager ruleaza `/cv`.
2. Bot creeaza cererea si o posteaza in canalul de hiring.
3. Manager/admin apasa `Approve` sau `Reject`.
4. La `Approve`:

- status cerere devine `APPROVED`
- utilizatorul este creat/actualizat in tabela `Employee`
- botul atribuie `ROLE_EMPLOYEE_ID`
- se publica log in canalul de loguri

5. La `Reject`:

- status cerere devine `REJECTED`
- se publica log in canalul de loguri

## Flux pontaj

1. Angajatul apasa `Clock`.
2. Bot valideaza ca userul are rolul de angajat si nu are sesiune deschisa.
3. Bot creeaza un `TimeEntry` cu status `OPEN`.
4. La urmatorul `Clock`, botul inchide sesiunea, calculeaza durata si logheaza intervalul in canalul de arhiva pontaj.

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
