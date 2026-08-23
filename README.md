# grAIn Mobile Backend

Production-ready REST API for the **grAIn** farmer-facing IoT grain dryer mobile app.
ESP32 + **DHT22 only** — temperature & humidity. No moisture / weight / voltage / energy fields exist anywhere in this codebase.

- Node.js 20+ / Express 5-free (Express 4) / TypeScript
- MongoDB Atlas via Mongoose (`MONGODB_URI` env var)
- JWT access tokens (~30 day expiry) via `Authorization: Bearer <token>`
- CORS enabled for all origins
- Deployable to Render free tier (cold-start friendly: `/api/health|/warmup|/ping` respond instantly)

## Project layout

```
src/
  config/     env.ts (env + fail-fast placeholder check), db.ts, firebase.ts (optional RTDB mirror)
  models/     User, Device, SensorDatum, Command, DryingSession, AlertItem, NotificationItem
  controllers/
  routes/
  middleware/ auth.ts (JWT guard)
  services/   commandParser, commandService, sessionStats, analytics, assistant(+knowledge)
  utils/
scripts/smoke.ts   end-to-end API test against in-memory MongoDB
```

## Local setup

```bash
npm install
cp .env.example .env      # fill MONGODB_URI + JWT_SECRET
npm run dev               # tsx watch
npm run build && npm start
npm run smoke             # full end-to-end test (in-memory Mongo)
npm run export-training-data   # export completed real sessions → ml/data/exported_sessions.csv
```

`.env` keys:

| Key | Required | Notes |
|---|---|---|
| `PORT` | no | default 8080 |
| `MONGODB_URI` | yes | Atlas SRV string. Values containing `<db_password>` fail fast at boot. `MONGO_URI` accepted as alias. |
| `JWT_SECRET` | yes | any long random string |
| `OPENAI_API_KEY` | no | enables LLM replies for `/api/v1/assistant/chat`; without it a built-in EN/FIL agronomy fallback answers |
| `ML_SERVICE_URL` | no | Python prediction microservice (`ml/`); unset = physics-fallback estimator only |
| `TARGET_MOISTURE_PCT` | no | target grain moisture for the completion criterion (default 14) |
| `COMPLETION_SUSTAIN_MINUTES` | no | minutes exhaust RH must stay at equilibrium before "complete" (default 30) |
| `FIREBASE_*` | no | optional RTDB mirroring only; never the primary store |

## API surface (all under `/api`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/login`, `POST /auth/register`, `GET /auth/me`, `POST /auth/logout` |
| Devices | `GET /devices`, `GET /devices/:id`, `POST /devices` |
| Sensors (DHT22) | `GET /sensors/:deviceId?page&limit&hours`, `GET /sensors/data`, `POST /sensors/data` *(public ESP ingress; extra fields silently dropped)* |
| Commands | `POST /commands`, `GET /commands/:deviceId` *(public ESP poll; latest pending → `polled`)* |
| Dryer direct | `POST /dryer/:deviceId/start|stop|fan|stepper|relay|heater` |
| Sessions | `GET /sessions?status&deviceId&page&limit`, `GET /sessions/:id`, `POST /sessions`, `PATCH /sessions/:id {action:'complete'|'abort'}` |
| Analytics | `GET /analytics/overview?period=daily|weekly|monthly` |
| Predictions (AI) | `GET /predictions/:sessionId?history=true&limit=20` *(remaining drying time + ETA; auto-refreshed on sensor ingress)* |
| Alerts | `GET /alerts`, `PATCH /alerts/:id/read`, `DELETE /alerts` |
| Notifications | `GET /notifications?page&limit&unread`, `PATCH /notifications {ids}|{markAll:true}`, `POST /notifications/fcm-token`, `DELETE /notifications/fcm-token` |
| Push (legacy) | `POST /push/token {pushToken}` |
| Assistant | `POST /v1/assistant/chat {messages,language:'EN'|'FIL',deviceId?}` |
| Health | `GET /health`, `GET /warmup`, `GET /ping` |

Command string forms supported by `POST /api/commands`:
`START:MANUAL|AUTO[:temp[:fanSpeed]]` · `STOP` · `FAN:FAN1|FAN2|ALL:ON|OFF` · `STEP:START|STOP|CW|CCW` · `R1:1|0` · `H1:1|0`

Reads return the `{ success: true, data: <entity|array>, pagination? }` envelope the app expects.

---

## Deploy to Render

1. Push this folder to GitHub.
2. Render Dashboard → **New → Web Service** → connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance type:** Free (cold starts are fine — health endpoints respond instantly and Mongo reconnects in background)
4. **Environment variables:**
   - `MONGODB_URI` = your Atlas SRV connection string (real password — no `<db_password>` placeholder!)
   - `JWT_SECRET` = long random string (e.g. from `openssl rand -hex 32`)
   - Optionally `OPENAI_API_KEY`
5. Deploy. Verify: `curl https://<your-service>.onrender.com/api/health` → `{"success":true,...}`.

> Atlas side: allow connections from anywhere (`0.0.0.0/0`) in Network Access, since Render egress IPs are dynamic.

## Point the Expo app at this backend

In the mobile repo `.env`:

```
EXPO_PUBLIC_API_URL=https://<your-service>.onrender.com/api
```

Rebuild/restart the Expo app after changing it (env vars are inlined at bundle time).

## ESP32 firmware expectations

- POST readings every ~10–30 s to `POST /api/sensors/data` with `{ deviceId, temperature, humidity, status }`.
- Poll `GET /api/commands/<DEVICE_ID>` every few seconds; execute the newest `pending` command; the server marks it `polled` automatically on fetch. Polling also refreshes the device heartbeat (`lastSeen`/`isOnline`).
