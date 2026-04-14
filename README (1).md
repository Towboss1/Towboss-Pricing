# Towco Towing MCP Server

MCP server for GHL Voice AI and Retell AI. Calculates real road distances using Google Routes API and returns accurate towing quotes.

---

## Pricing

- $225 flat rate includes first 10 miles
- Over 10 miles: $6.25 per additional mile

---

## Endpoints

| Endpoint | Transport | Used By |
|---|---|---|
| POST /mcp | HTTP Streamable | GHL Voice AI |
| GET /sse | SSE stream | Retell AI |
| POST /sse | SSE messages | Retell AI |
| GET / | Health check | Browser |

---

## Tool: get_quote

### Input
| Field | Type | Description |
|---|---|---|
| origin | string | Full pickup address including city and state |
| destination | string | Full drop-off address including city and state |
| vehicle | string | Year make and model e.g. 2019 Honda Civic |

### Output
| Field | Example |
|---|---|
| vehicle | 2019 Honda Civic |
| miles | 14.2 |
| duration | 22 mins |
| base_rate | 225 |
| extra_miles | 4.2 |
| extra_cost | 26.25 |
| total | 251 |
| spoken_quote | Alright, so for your 2019 Honda Civic... |

---

## Quote Examples

| Miles | Calculation | Total |
|---|---|---|
| 7 miles | Flat rate | $225 |
| 15 miles | $225 + (5 x $6.25) | $256 |
| 25 miles | $225 + (15 x $6.25) | $319 |

---

## Railway Setup

### Environment Variables
| Key | Value |
|---|---|
| GOOGLE_API_KEY | Your Google Routes API key |
| BASE_URL | https://your-app.up.railway.app |

### Deploy
1. Push this repo to GitHub
2. Go to railway.app → New Project → Deploy from GitHub
3. Add environment variables
4. Railway auto-deploys on every GitHub push

---

## GHL Voice AI Setup
1. Voice AI agent → Model Context Protocol (MCP)
2. MCP URL: https://your-app.up.railway.app/mcp
3. Add Tool → select get_quote
4. When should the tool be used: "Use this tool once you have the pickup address, drop-off address, and vehicle year make and model. Always call this before giving a price. Never estimate the distance yourself."
5. Response Variable: spoken_quote = spoken_quote

---

## Retell AI Setup
1. Agent → MCP node
2. MCP URL: https://your-app.up.railway.app/sse
3. Select get_quote tool
