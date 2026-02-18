require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const twilio = require("twilio");
const OpenAI = require("openai");
const { getBusDataForAgent } = require("./services/busDataService");

const app = express();

// Allow React dev server (localhost:3000) to call this API when proxy fails
app.use(cors({ origin: ["http://localhost:3000", "http://127.0.0.1:3000"] }));

// Middleware to parse Twilio's application/x-www-form-urlencoded webhooks
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Health check: confirms you're hitting this server (e.g. GET http://localhost:5000/api/health)
app.get("/api/health", (req, res) => res.json({ ok: true, service: "daewoo-voice-agent" }));

// Register /api/call-out first so it is never shadowed
app.post("/api/call-out", async (req, res) => {
  if (!twilioClient) {
    return res.status(503).json({ error: "Twilio credentials not configured" });
  }
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!fromNumber) {
    return res.status(503).json({ error: "TWILIO_PHONE_NUMBER not set in environment" });
  }
  // Accept "to" from JSON body or query (Thunder Client: set Body to JSON and Headers to Content-Type: application/json)
  const to = (req.body?.to ?? req.query?.to)?.trim();
  if (!to) {
    return res.status(400).json({
      error: "Missing 'to' phone number",
      hint: "Send JSON body with header Content-Type: application/json. Example: {\"to\": \"+923001234567\"}",
    });
  }
  const voiceUrl = `${BASE_URL.replace(/\/$/, "")}/voice`;
  try {
    const call = await twilioClient.calls.create({
      to,
      from: fromNumber,
      url: voiceUrl,
      method: "POST",
    });
    return res.json({ sid: call.sid, status: call.status, message: "Outbound call initiated" });
  } catch (err) {
    console.error("Error creating outbound call:", err);
    return res.status(500).json({ error: err.message || "Failed to place call" });
  }
});

// Twilio REST client (for listing calls and placing outbound calls)
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

// Base URL where this server is reachable (e.g. ngrok HTTPS URL). Used for outbound call TwiML.
const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 5000}`;

// Pending incoming calls: callSid -> { from, createdAt }. UI can accept or decline.
const pendingIncomingCalls = new Map();
const PENDING_CALL_MAX_AGE_MS = 90 * 1000;

function cleanOldPendingCalls() {
  const now = Date.now();
  for (const [sid, data] of pendingIncomingCalls.entries()) {
    if (now - data.createdAt > PENDING_CALL_MAX_AGE_MS) pendingIncomingCalls.delete(sid);
  }
}

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Core system prompt including strict rules and embedded structured data
const buildSystemPrompt = (busData) => {
  return `
You are a professional voice assistant for Daewoo Express Pakistan, speaking to callers over the phone.
You only answer about:
- Bus schedules
- Ticket prices
- Route durations
- Booking process
- Ticket confirmation
- Terminal information

Rules:
- Keep responses under 4 sentences.
- Be clear, warm, and voice-friendly.
- Never answer unrelated questions.
- If a route is not found in the provided data, politely say that the schedule is currently unavailable.
- Do not mention that you are an AI model or language model.
- Do not read the data structure verbatim; convert it into natural speech.
- Do not use bullet points, lists, or any formatting — just natural spoken sentences.

Here is the structured Daewoo Express data you must rely on. Do not invent new routes or prices beyond this data:
${JSON.stringify(busData, null, 2)}
`.trim();
};

/**
 * Helper to generate an AI reply for a caller utterance using OpenAI Chat Completions.
 * Uses busData (static + optional bookme/external API) for context.
 */
async function getAiReply(callerText, busData) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const messages = [
    {
      role: "system",
      content: buildSystemPrompt(busData),
    },
    {
      role: "user",
      content: [
        "Caller question or request:",
        `"${callerText}"`,
        "",
        "Respond as if you are speaking directly to the caller on the phone.",
        "Use a friendly, concise tone and keep the reply under 4 sentences.",
      ].join(" "),
    },
  ];

  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages,
    temperature: 0.3,
    max_tokens: 220,
  });

  const aiReply =
    completion.choices?.[0]?.message?.content?.trim() ||
    "I am sorry, I could not understand that clearly. Please ask again about bus schedules, ticket prices, or your booking.";

  return aiReply;
}

/**
 * Incoming call webhook. Put caller on hold and show Accept/Decline in UI.
 * Configure Twilio "A call comes in" to this URL: BASE_URL/voice/incoming
 */
app.post("/voice/incoming", (req, res) => {
  const callSid = req.body.CallSid;
  const from = req.body.From || req.body.Caller;
  if (callSid) {
    pendingIncomingCalls.set(callSid, { from, createdAt: Date.now() });
  }
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({ voice: "Polly.Joanna" }, "Please hold. Your call is important to us.");
  twiml.redirect({ method: "POST" }, `${BASE_URL.replace(/\/$/, "")}/voice/hold`);
  res.type("text/xml");
  return res.send(twiml.toString());
});

/**
 * Hold loop: keeps caller waiting until UI accepts or declines.
 */
app.post("/voice/hold", (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  twiml.pause({ length: 5 });
  twiml.redirect({ method: "POST" }, `${BASE_URL.replace(/\/$/, "")}/voice/hold`);
  res.type("text/xml");
  return res.send(twiml.toString());
});

/**
 * Main Twilio Voice webhook (AI answers). Used after user clicks Accept in UI.
 * Handles both the initial greeting and subsequent speech turns via <Gather input="speech">.
 */
app.post("/voice", async (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const speechResult = req.body.SpeechResult;

  // No user speech yet: greet and start speech gather
  if (!speechResult) {
    const gather = twiml.gather({
      input: "speech",
      action: "/voice",
      method: "POST",
      timeout: 5,
      speechTimeout: "auto",
    });

    gather.say(
      { voice: "Polly.Joanna" },
      "Thank you for calling Daewoo Express Pakistan. I can help you with bus schedules, ticket prices, route durations, bookings, and terminal information. Please tell me how I can assist you."
    );

    // If no speech comes through, loop back to the same endpoint
    twiml.redirect("/voice");

    res.type("text/xml");
    return res.send(twiml.toString());
  }

  // We received caller speech: get bus data (static + optional API) and send to OpenAI
  let aiReply;
  try {
    const busData = await getBusDataForAgent();
    aiReply = await getAiReply(speechResult, busData);
  } catch (error) {
    console.error("Error while generating AI reply:", error);

    // Voice-friendly, short fallback in case of an internal error
    aiReply =
      "I am currently unable to access the bus information system. Please try again in a few minutes or visit your nearest Daewoo Express terminal for assistance.";
  }

  // Say the AI-generated reply to the caller
  twiml.say({ voice: "Polly.Joanna" }, aiReply);

  // Redirect back to /voice to keep the conversation going with a new Gather
  twiml.redirect("/voice");

  res.type("text/xml");
  return res.send(twiml.toString());
});

// ——— Frontend API: list recent calls (incoming + outgoing) ———
app.get("/api/calls", async (req, res) => {
  if (!twilioClient) {
    return res
      .status(503)
      .json({ error: "Twilio credentials not configured" });
  }
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const calls = await twilioClient.calls.list({ limit });
    const list = calls.map((c) => ({
      sid: c.sid,
      direction: c.direction,
      from: c.from,
      to: c.to,
      status: c.status,
      duration: c.duration ? parseInt(c.duration, 10) : null,
      startTime: c.startTime,
      endTime: c.endTime,
    }));
    return res.json({ calls: list });
  } catch (err) {
    console.error("Error listing calls:", err);
    return res.status(500).json({ error: "Failed to list calls" });
  }
});

// ——— Incoming call: show in UI, accept (connect to AI) or decline ———
app.get("/api/incoming-call", (req, res) => {
  cleanOldPendingCalls();
  const entries = [...pendingIncomingCalls.entries()];
  if (entries.length === 0) {
    return res.json({ pending: false });
  }
  const [callSid, data] = entries[0];
  return res.json({ pending: true, callSid, from: data.from });
});

app.post("/api/call-accept", async (req, res) => {
  if (!twilioClient) {
    return res.status(503).json({ error: "Twilio not configured" });
  }
  const callSid = (req.body?.callSid ?? req.query?.callSid)?.trim();
  if (!callSid) {
    return res.status(400).json({ error: "Missing callSid" });
  }
  if (!pendingIncomingCalls.has(callSid)) {
    return res.status(404).json({ error: "Call no longer pending" });
  }
  try {
    const voiceUrl = `${BASE_URL.replace(/\/$/, "")}/voice`;
    await twilioClient.calls(callSid).update({ url: voiceUrl, method: "POST" });
    pendingIncomingCalls.delete(callSid);
    return res.json({ ok: true, message: "Call connected to AI" });
  } catch (err) {
    console.error("Error accepting call:", err);
    return res.status(500).json({ error: err.message || "Failed to accept call" });
  }
});

app.post("/api/call-decline", async (req, res) => {
  if (!twilioClient) {
    return res.status(503).json({ error: "Twilio not configured" });
  }
  const callSid = (req.body?.callSid ?? req.query?.callSid)?.trim();
  if (!callSid) {
    return res.status(400).json({ error: "Missing callSid" });
  }
  if (!pendingIncomingCalls.has(callSid)) {
    return res.status(404).json({ error: "Call no longer pending" });
  }
  try {
    await twilioClient.calls(callSid).update({ status: "completed" });
    pendingIncomingCalls.delete(callSid);
    return res.json({ ok: true, message: "Call declined" });
  } catch (err) {
    console.error("Error declining call:", err);
    return res.status(500).json({ error: err.message || "Failed to decline call" });
  }
});

// Frontend: serve React build or static HTML (after API routes so /api/* is always handled)
// On Vercel, React build is copied to public/ during build; express.static is ignored there so we serve from public
const clientDist = path.join(__dirname, "client", "dist");
const publicDir = path.join(__dirname, "public");
const useReactBuild = fs.existsSync(clientDist) && !process.env.VERCEL;
const usePublic = process.env.VERCEL || !useReactBuild;
if (usePublic) {
  app.get("/", (req, res) => {
    res.sendFile(path.join(publicDir, "index.html"), (err) => {
      if (err) res.status(500).send("Frontend not found. Run npm run client:build or add public/index.html.");
    });
  });
  app.use(express.static(publicDir));
} else {
  app.use(express.static(clientDist));
  app.get("/", (req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

const PORT = process.env.PORT || 5000;

// On Vercel, the app is run as a serverless function — do not call listen()
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Daewoo voice agent server is running on port ${PORT}`);
  });
}

module.exports = app;

