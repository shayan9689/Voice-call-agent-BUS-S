/**
 * Bus data for the voice agent: hardcoded base + optional external API (e.g. bookme.pk).
 * bookme.pk API: POST https://api.bookme.pk/REST/API/bus_times (headers: app-version, authorization, content-type).
 */

const busDataStatic = require("../data");

const BUS_API_URL = process.env.BUS_DATA_API_URL || process.env.BOOKME_BUS_API_URL;
const BUS_API_METHOD = (process.env.BUS_DATA_API_METHOD || "GET").toUpperCase();
const CACHE_MS = Math.min(parseInt(process.env.BUS_DATA_CACHE_MS, 10) || 5 * 60 * 1000, 30 * 60 * 1000);
let cached = null;
let cachedAt = 0;

/** Build headers for bookme.pk (app-version, authorization, content-type) or generic. */
function getApiHeaders() {
  const headers = { Accept: "application/json" };
  if (process.env.BOOKME_APP_VERSION) headers["app-version"] = process.env.BOOKME_APP_VERSION;
  if (process.env.BOOKME_AUTH) headers["authorization"] = process.env.BOOKME_AUTH;
  if (BUS_API_METHOD === "POST") headers["Content-Type"] = "application/json";
  return headers;
}

/** Parse optional JSON body from env (for POST). */
function getApiBody() {
  const raw = process.env.BUS_DATA_API_BODY;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Normalize external API response into our route shape.
 * Handles: { routes: {} }, { data: { buses: [] } }, or bookme-style { buses: [ { departure_time, price, origin, destination } ] }.
 */
function normalizeExternalRoutes(apiBody) {
  if (!apiBody || typeof apiBody !== "object") return null;
  const routes = apiBody.routes || apiBody.data?.routes || apiBody.data?.buses || apiBody.buses;
  if (!routes) return null;

  const out = {};
  if (Array.isArray(routes)) {
    routes.forEach((r) => {
      const from = r.from || r.origin || r.origin_name || r.from_city;
      const to = r.to || r.destination || r.destination_name || r.to_city;
      const key = [from, to].filter(Boolean).join("-");
      if (!key) return;
      const times = r.departureTimes || r.times || (r.departure_time ? [r.departure_time] : []);
      const price = r.ticketPrice || r.price || r.fare || "—";
      const duration = r.duration || r.duration_minutes ? `${r.duration_minutes} minutes` : "—";
      if (!out[key]) out[key] = { departureTimes: [], ticketPrice: price, duration };
      if (Array.isArray(times)) out[key].departureTimes.push(...times);
      else if (times) out[key].departureTimes.push(String(times));
    });
  } else if (typeof routes === "object") {
    Object.assign(out, routes);
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Fetch from optional external bus API (GET or POST) and merge with static data.
 */
async function fetchAndMergeBusData() {
  const base = { ...busDataStatic, routes: { ...busDataStatic.routes } };

  if (!BUS_API_URL || !BUS_API_URL.startsWith("http")) {
    return base;
  }

  if (cached && Date.now() - cachedAt < CACHE_MS) {
    return cached;
  }

  try {
    const options = {
      method: BUS_API_METHOD,
      headers: getApiHeaders(),
      signal: AbortSignal.timeout(10000),
    };
    if (BUS_API_METHOD === "POST") {
      const body = getApiBody();
      if (body !== undefined) options.body = JSON.stringify(body);
    }
    const res = await fetch(BUS_API_URL, options);
    if (!res.ok) return base;
    const body = await res.json();
    const external = normalizeExternalRoutes(body);
    if (external) {
      Object.assign(base.routes, external);
    }
    cached = base;
    cachedAt = Date.now();
    return base;
  } catch (err) {
    console.warn("Bus data API fetch failed, using static data only:", err.message);
    return base;
  }
}

/**
 * Returns the bus data object to inject into the voice agent system prompt.
 * Use this in the /voice handler before calling OpenAI.
 */
async function getBusDataForAgent() {
  return fetchAndMergeBusData();
}

module.exports = { getBusDataForAgent, normalizeExternalRoutes };
