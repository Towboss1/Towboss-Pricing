import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  console.log(new Date().toISOString(), req.method, req.url, JSON.stringify(req.body || {}));
  next();
});

const PORT = process.env.PORT || 3000;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

function calculateTotal(miles) {
  if (miles <= 10) {
    return { total: 225, extra_miles: 0, extra_cost: 0 };
  }
  const extraMiles = parseFloat((miles - 10).toFixed(1));
  const extraCost = parseFloat((extraMiles * 6.25).toFixed(2));
  const total = Math.round(225 + extraCost);
  return { total, extra_miles: extraMiles, extra_cost: extraCost };
}

function buildSpokenQuote(vehicle, miles, pricing) {
  if (miles <= 10) {
    return "Alright, so for your " + vehicle + " the flat rate is $225 and that includes up to 10 miles. You're at " + miles + " miles so your total comes out to $225.";
  }
  return "Alright, so for your " + vehicle + " the flat rate is $225 which includes the first 10 miles. You have " + pricing.extra_miles + " additional miles at $6.25 a mile, that's $" + pricing.extra_cost.toFixed(2) + ". So your total comes out to $" + pricing.total + ".";
}

const TOOLS = [
  {
    name: "get_quote",
    description: "Calculates real road driving distance and returns an accurate towing quote. Only call this with exact addresses confirmed by the caller.",
    inputSchema: {
      type: "object",
      required: ["origin", "destination", "vehicle"],
      properties: {
        origin: { type: "string", description: "Exact pickup address with street number, street name, city and state as confirmed by the caller" },
        destination: { type: "string", description: "Exact drop-off address with street number, street name, city and state as confirmed by the caller" },
        vehicle: { type: "string", description: "Year make and model e.g. 2019 Honda Civic" },
      },
    },
  },
];

// ─── Geocode and validate address ─────────────────────────────────────────
async function validateAndGeocode(address) {
  console.log("Validating address:", address);
  const res = await axios.post(
    "https://addressvalidation.googleapis.com/v1:validateAddress",
    {
      address: { addressLines: [address] },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
      },
    }
  );

  const result = res.data && res.data.result;
  const verdict = result && result.verdict;
  const geocode = result && result.geocode;

  console.log("Address verdict:", JSON.stringify(verdict));

  if (!verdict || !geocode) {
    throw new Error("ADDRESS_NOT_FOUND:" + address);
  }

  // Reject if address is not complete or not confirmed at street level
  const hasUnconfirmed = verdict.hasUnconfirmedComponents;
  const addressComplete = verdict.addressComplete;
  const granularity = verdict.geocodeGranularity;

  console.log("Complete:", addressComplete, "Granularity:", granularity, "Unconfirmed:", hasUnconfirmed);

  // Must be at least PREMISE or ROUTE level and complete
  const validGranularity = ["PREMISE", "SUB_PREMISE", "ROUTE"].includes(granularity);

  if (!addressComplete || !validGranularity || hasUnconfirmed) {
    throw new Error("ADDRESS_NOT_FOUND:" + address);
  }

  const location = geocode.location;
  return { lat: location.latitude, lng: location.longitude, formatted: result.address && result.address.formattedAddress };
}

// ─── Get distance between validated coordinates ───────────────────────────
async function getDistanceFromCoords(origin, destination) {
  const res = await axios.post(
    "https://routes.googleapis.com/directions/v2:computeRoutes",
    {
      origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
      destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      units: "IMPERIAL",
    },
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_API_KEY,
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration",
      },
    }
  );

  const route = res.data && res.data.routes && res.data.routes[0];
  if (!route || !route.distanceMeters) throw new Error("NO_ROUTE");

  const miles = Math.ceil((route.distanceMeters / 1609.344) * 10) / 10;
  const durationMin = Math.round(parseInt(route.duration) / 60);
  console.log("Distance:", miles, "miles,", durationMin, "mins");
  return { miles, duration: durationMin + " mins" };
}

async function runGetQuote(args) {
  const origin = (args.origin || "").trim();
  const destination = (args.destination || "").trim();
  const vehicle = (args.vehicle || "").trim();

  if (origin.length < 5 || destination.length < 5) {
    return {
      error: true,
      spoken_quote: "I need the full street address including the street number and city. Can you give me that?",
    };
  }

  try {
    // Validate both addresses first
    let originGeo, destGeo;

    try {
      originGeo = await validateAndGeocode(origin);
    } catch (e) {
      console.log("Origin validation failed:", e.message);
      return {
        error: true,
        spoken_quote: "I wasn't able to verify the pickup address. Can you double-check the street number, street name, and city for me?",
      };
    }

    try {
      destGeo = await validateAndGeocode(destination);
    } catch (e) {
      console.log("Destination validation failed:", e.message);
      return {
        error: true,
        spoken_quote: "I wasn't able to verify the drop-off address. Can you double-check that address for me?",
      };
    }

    console.log("Origin validated:", originGeo.formatted);
    console.log("Destination validated:", destGeo.formatted);

    // Get real road distance between validated coordinates
    const { miles, duration } = await getDistanceFromCoords(originGeo, destGeo);
    const pricing = calculateTotal(miles);
    const spoken_quote = buildSpokenQuote(vehicle, miles, pricing);

    return {
      vehicle,
      miles,
      duration,
      base_rate: 225,
      extra_miles: pricing.extra_miles,
      extra_cost: pricing.extra_cost,
      total: pricing.total,
      origin_verified: originGeo.formatted,
      destination_verified: destGeo.formatted,
      spoken_quote,
    };

  } catch (err) {
    console.error("Quote error:", err.message);
    return {
      error: true,
      spoken_quote: "I'm having trouble pulling the distance right now. Let me have a dispatcher call you back with the quote.",
    };
  }
}

// ─── Core MCP handler ─────────────────────────────────────────────────────
async function handleMCP(body, sendResponse) {
  const { jsonrpc, id, method, params } = body;
  console.log("MCP method:", method);
  if (method === "initialize") {
    return sendResponse({ jsonrpc, id, result: { protocolVersion: params && params.protocolVersion ? params.protocolVersion : "2024-11-05", serverInfo: { name: "towco-mcp", version: "1.0.0" }, capabilities: { tools: {} } } });
  }
  if (method === "notifications/initialized") return sendResponse({ jsonrpc, id, result: {} });
  if (method === "tools/list") return sendResponse({ jsonrpc, id, result: { tools: TOOLS } });
  if (method === "tools/call") {
    const name = params && params.name;
    const args = params && params.arguments;
    try {
      const result = name === "get_quote" ? await runGetQuote(args) : (() => { throw new Error("Unknown tool: " + name); })();
      return sendResponse({ jsonrpc, id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
    } catch (err) {
      console.error("Tool error:", err.message);
      return sendResponse({ jsonrpc, id, result: { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true } });
    }
  }
  return sendResponse({ jsonrpc, id, result: {} });
}

// ─── HTTP Streamable — POST /mcp (GHL) ───────────────────────────────────
app.post("/mcp", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  await handleMCP(req.body, (payload) => res.json(payload));
});

// ─── POST / — Retell posts to root ───────────────────────────────────────
app.post("/", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  await handleMCP(req.body, (payload) => res.json(payload));
});

// ─── SSE — GET + POST /sse (Retell) ──────────────────────────────────────
const clients = new Map();
let clientId = 0;

app.get("/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  const id = ++clientId;
  clients.set(id, res);
  const BASE_URL = process.env.BASE_URL || "";
  res.write("event: endpoint\ndata: " + JSON.stringify({ uri: BASE_URL + "/sse?clientId=" + id }) + "\n\n");
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => { clients.delete(id); clearInterval(ping); });
});

app.post("/sse", async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  const id = req.query.clientId ? parseInt(req.query.clientId) : null;
  const client = id ? clients.get(id) : null;
  await handleMCP(req.body, (payload) => {
    if (client) client.write("event: message\ndata: " + JSON.stringify(payload) + "\n\n");
    res.json(payload);
  });
});

app.options("*", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.sendStatus(200);
});

app.post("/message", async (req, res) => {
  const id = parseInt(req.query.clientId);
  const client = clients.get(id);
  await handleMCP(req.body, (payload) => {
    if (client) client.write("event: message\ndata: " + JSON.stringify(payload) + "\n\n");
    res.json({ status: "ok" });
  });
});

app.get("/", (req, res) => res.json({ status: "Towco MCP server running", key_present: !!GOOGLE_API_KEY }));

app.listen(PORT, () => console.log("Towco MCP server running on port " + PORT));
