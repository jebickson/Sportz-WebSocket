# Sportz

A real-time live sports commentary backend. Sportz exposes a **REST API** for managing matches and play-by-play commentary, and a **WebSocket channel** that pushes new commentary and score updates to subscribed clients the moment they happen.

The project's focus is production-minded WebSocket engineering: per-match subscriptions, heartbeats, rate limiting, backpressure protection, and strict message validation.

**Live demo:** https://sportz-websocket-9l26.onrender.com/
*(Hosted on a free tier, so the first request after a period of inactivity can take a moment while the server wakes up.)*

![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![WebSockets](https://img.shields.io/badge/WebSockets-010101?logo=socketdotio&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black)
![Arcjet](https://img.shields.io/badge/Arcjet-5C2D91)

---

## Features

- **Match management:** list and create matches; status (`scheduled`, `live`, `finished`) is computed from each match's start and end time
- **Commentary management:** read and add play-by-play entries tied to a specific match
- **Real-time broadcasts:** clients subscribe per match and receive new commentary instantly over WebSockets
- **Structured WebSocket protocol:** subscribe, unsubscribe, replace the whole subscription set, and ping, with typed server responses and error codes
- **Resilient connections:** heartbeats, rate limiting, subscription caps, and backpressure protection
- **Strict validation:** every REST body and WebSocket message is validated with Zod schemas
- **Security:** request protection with Arcjet (rate limiting and bot defense)
- **Seed tooling:** a script that populates matches and simulates live commentary and score changes

## Architecture

```
                 REST (HTTP)                       ┌────────────────────┐
  Client  ───────────────────────────────────────▶ │   Express server   │
    │                                              │  (validation: Zod) │
    │          WebSocket  /ws                      │                    │
    └────────────────────────────────────────────▶ │   ws server        │
         subscribe / unsubscribe / ping            │  (subscriptions,   │
    ◀──────────────────────────────────────────────│   heartbeats, ...) │
         commentary broadcasts per match           └─────────┬──────────┘
                                                             │ Drizzle ORM
                                                             ▼
                                                     ┌──────────────┐
                                                     │  PostgreSQL  │
                                                     └──────────────┘
```

New commentary posted through the REST API is saved to PostgreSQL and then broadcast only to the sockets subscribed to that match.

## Tech Stack

| Area | Technology |
|------|-----------|
| Runtime and server | Node.js, Express |
| Real-time | WebSockets with the `ws` library |
| Database | PostgreSQL |
| ORM and migrations | Drizzle ORM, Drizzle Kit |
| Validation | Zod |
| Security | Arcjet |
| Frontend | React |
| Config | dotenv, CORS middleware |
| Hosting | Render |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) and npm
- A PostgreSQL database (local, or a hosted instance such as Neon or Supabase)
- An [Arcjet](https://arcjet.com/) API key

### 1. Clone and install

```bash
git clone https://github.com/jebickson/Sportz-WebSocket.git
cd Sportz-WebSocket
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=

# Server
PORT=8000
HOST=0.0.0.0

# Arcjet
ARCJET_KEY=
ARCJET_ENV=development

# Seed script
API_URL=http://localhost:8000
BROADCAST=1
DELAY_MS=250
MATCH_COUNT=0
```

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `PORT` / `HOST` | Port and interface the server listens on |
| `ARCJET_KEY` / `ARCJET_ENV` | Arcjet credentials and environment |
| `API_URL` | Base URL the seed script sends requests to |
| `BROADCAST` | Turns live-commentary simulation on (`1`) or off |
| `DELAY_MS` | Delay between simulated events, in milliseconds |
| `MATCH_COUNT` | Number of matches the seed script generates |

### 3. Set up the database

Apply the schema in `drizzle/` to your database:

```bash
npx drizzle-kit migrate
```

### 4. Run the server

```bash
npm run dev
```

The server starts in watch mode. Use the port from your `.env` file:

- HTTP: `http://localhost:<PORT>`
- WebSocket: `ws://localhost:<PORT>/ws`

### Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the server in watch mode |
| `npm run seed` | Seed the database with a match and commentary entries |

## REST API

### Matches

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/matches?limit=50` | List matches |
| `POST` | `/matches` | Create a match |

**Create a match**

```json
{
  "sport": "football",
  "homeTeam": "FC Neon",
  "awayTeam": "Drizzle United",
  "startTime": "2025-02-01T12:00:00.000Z",
  "endTime": "2025-02-01T13:45:00.000Z"
}
```

Status values are `scheduled`, `live`, and `finished`, computed from `startTime` and `endTime`.

### Commentary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/matches/:id/commentary?limit=100` | List commentary for a match |
| `POST` | `/matches/:id/commentary` | Add a commentary entry |

**Create a commentary entry**

```json
{
  "minute": 42,
  "sequence": 120,
  "period": "2nd half",
  "eventType": "goal",
  "actor": "Alex Morgan",
  "team": "FC Neon",
  "message": "GOAL! Powerful finish from the edge of the box.",
  "metadata": { "assist": "Sam Kerr" },
  "tags": ["goal", "shot"]
}
```

## WebSocket Protocol

Connect to `ws://localhost:<PORT>/ws`. To subscribe to a match as soon as you connect, add a query parameter: `ws://localhost:<PORT>/ws?matchId=123`.

### Client to server

| Message | Purpose |
|---------|---------|
| `{ "type": "subscribe", "matchId": 123 }` | Subscribe to a match |
| `{ "type": "unsubscribe", "matchId": 123 }` | Unsubscribe from a match |
| `{ "type": "setSubscriptions", "matchIds": [1, 2, 3] }` | Replace all subscriptions at once |
| `{ "type": "ping" }` | Application-level ping |

### Server to client

| Message | Meaning |
|---------|---------|
| `{ "type": "welcome" }` | Connection accepted |
| `{ "type": "subscribed", "matchId": 123 }` | Subscription confirmed |
| `{ "type": "unsubscribed", "matchId": 123 }` | Unsubscription confirmed |
| `{ "type": "subscriptions", "matchIds": [1, 2, 3] }` | Current subscription set |
| `{ "type": "commentary", "data": { ... } }` | New commentary for a subscribed match |
| `{ "type": "pong" }` | Reply to `ping` |
| `{ "type": "error", "code": "match_not_found", ... }` | Validation or lookup error |

**Error example**

```json
{
  "type": "error",
  "code": "match_not_found",
  "message": "Match 999 not found",
  "matchIds": [999]
}
```

### Connection limits

| Limit | Value |
|-------|-------|
| Subscriptions per socket | 50 |
| Message rate | 10 messages per second, with a burst of 20 |
| Maximum message size | 1 MB |
| Backpressure | Connection is closed if more than 1 MB is buffered for a client |

## Design Notes

- **Heartbeats** detect and clean up dead connections so stale sockets do not accumulate.
- **Backpressure protection** stops a slow client from exhausting server memory.
- **Per-match subscriptions** mean each client only receives the updates it asked for.
- **Schema validation** rejects malformed input at the edge, for both HTTP and WebSocket traffic.
- **Scaling:** broadcasts currently reach only sockets connected to the same server instance. To run multiple instances, add a pub/sub layer such as Redis, NATS, or Kafka.
- **Authentication** is intentionally omitted so the project stays focused on WebSocket mechanics.

## Roadmap

- [ ] Redis pub/sub for multi-instance broadcasting
- [ ] Authentication and per-user permissions for posting commentary
- [ ] Automated tests for the REST and WebSocket layers
- [ ] CI pipeline with GitHub Actions

## Author

**Jebickson Samuel**
GitHub: [@jebickson](https://github.com/jebickson)

## Acknowledgments

Built while following a WebSockets course by JavaScript Mastery.
