# daewoo-voice-agent

Production-ready AI Voice Call Agent for **Daewoo Express Pakistan**, built with **Node.js**, **Express**, **Twilio Voice**, and the **OpenAI API**.  
The assistant answers incoming calls, understands caller speech, and responds with natural voice about:

- Bus schedules
- Ticket prices
- Route durations
- Booking process
- Ticket confirmation
- Terminal information

All data is **hardcoded and structured** inside the backend (no RAG or external knowledge base).

---

### 1. Prerequisites

- **Node.js** (LTS recommended)
- A **Twilio account** with:
  - A Twilio phone number capable of **Voice**
- An **OpenAI API key**
- **ngrok** (or any HTTPS tunneling tool) for local development

---

### 2. Installation

From the project root:

```bash
npm install
```

This will install:

- `express`
- `twilio`
- `openai`
- `dotenv`

---

### 3. Environment Configuration

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Open `.env` and fill in your values:

```bash
PORT=5000
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890
BASE_URL=https://your-ngrok-subdomain.ngrok-free.dev
BUS_DATA_API_URL=https://api.bookme.pk/REST/API/bus_times
BUS_DATA_API_METHOD=POST
BUS_DATA_API_BODY=
BOOKME_APP_VERSION=
BOOKME_AUTH=
BUS_DATA_CACHE_MS=300000
```

- **TWILIO_PHONE_NUMBER**: Your Twilio voice number (E.164, e.g. `+1234567890`). Required for the **outbound call (dial)** feature in the frontend.
- **BASE_URL**: Public URL of this server (e.g. your ngrok HTTPS URL). Required so outbound calls use the correct TwiML URL. Do not add a trailing slash.
- **Optional (bookme.pk live data)**: `BUS_DATA_API_URL`, `BUS_DATA_API_METHOD=POST`, `BUS_DATA_API_BODY` (JSON string), `BOOKME_APP_VERSION`, `BOOKME_AUTH`. See “Optional: live data from bookme.pk” under §4.

> **Note**: The Twilio SID and Auth Token are required for the calls dashboard and click-to-dial. For incoming webhooks only, TwiML can work without them once the webhook URL is set.

---

### 4. Structured Bus Data

The file `data.js` contains all hardcoded data used by the assistant:

- **Routes**:
  - Lahore → Islamabad
  - Lahore → Multan
  - Karachi → Lahore
  - Islamabad → Peshawar
- For each route:
  - `departureTimes` (array of times)
  - `ticketPrice`
  - `duration`
- Global text fields:
  - `bookingInstructions`
  - `confirmationInstructions`
  - `terminalInfo`

The server injects this data into the system prompt so the AI can answer only from these values and not invent new information.

**Optional: live data from bookme.pk**  
bookme.pk’s bus API is **POST** `https://api.bookme.pk/REST/API/bus_times` with headers `app-version`, `authorization`, and `content-type`.

1. **Capture one real request**: On [bookme.pk](https://bookme.pk) → bus search → DevTools (F12) → **Network** → search for a bus. Find the request to `api.bookme.pk/.../bus_times`. Copy:
   - **Request URL**
   - **Request method** (POST)
   - **Request headers**: `app-version`, `authorization`
   - **Request payload** (JSON body, e.g. origin/destination/date)
2. **Configure `.env`**:
   - `BUS_DATA_API_URL=https://api.bookme.pk/REST/API/bus_times`
   - `BUS_DATA_API_METHOD=POST`
   - `BOOKME_APP_VERSION=<value from headers>`
   - `BOOKME_AUTH=<value from authorization header>`
   - `BUS_DATA_API_BODY={"..."}` — JSON string for the request body (e.g. from, to, date)
   - Optional: `BUS_DATA_CACHE_MS=300000` (cache 5 min)
3. The server will POST to that URL (with cache), merge the response with `data.js`, and use it in the voice agent. If the request fails, only `data.js` is used. You can adapt `services/busDataService.js` → `normalizeExternalRoutes()` to match bookme’s response shape.

---

### 5. Frontend (React Calls UI)

The frontend is a **React** app (Vite + React) in `client/`:

- **Incoming calls**: When someone calls your Twilio number, the UI shows an **Incoming call** modal with the caller number and **Accept** / **Decline** buttons. The caller hears "Please hold" until you choose. **Accept** connects the call to the AI assistant; **Decline** hangs up. Incoming and completed calls appear in **Recent calls**.
- **Outgoing calls**: Use **Place outbound call** to enter a phone number (E.164) and click **Call**. The server uses the Twilio API to dial that number; when they answer, they hear the same Daewoo AI flow.

**Development (React dev server with hot reload):**

```bash
npm run client:install   # once: install client deps
npm start               # terminal 1: backend on port 5000
npm run client:dev      # terminal 2: React on port 3000 (proxies /api to 5000)
```

Then open **http://localhost:3000** for the React UI.

**Production (single server):**

```bash
npm run client:build    # build React to client/dist
npm start              # serves backend + React from port 5000
```

Then open **http://localhost:5000** (or your `BASE_URL`). Ensure `TWILIO_PHONE_NUMBER` and `BASE_URL` are set in `.env` for dial and for correct TwiML on outbound calls.

---

### 6. Running the Server

Start the server:

```bash
npm start
```

Or with auto-reload during development:

```bash
npm run dev
```

By default, the server listens on `http://localhost:5000` (or the value of `PORT` in your `.env`).

---

### 7. Exposing the Server with ngrok

Twilio must reach your machine over the public internet using **HTTPS**. Using ngrok:

```bash
ngrok http 5000
```

ngrok will print a forwarding URL similar to:

```text
https://abcd-1234.ngrok.io -> http://localhost:5000
```

You will use this HTTPS URL in your Twilio Voice webhook configuration.

---

### 8. Configure Twilio Voice Webhook

1. Log in to the **Twilio Console**.
2. Go to **Phone Numbers** → **Manage** → **Active numbers**.
3. Click your **Twilio voice-enabled number**.
4. Under **Voice Configuration** (or similar):
   - For “**A CALL COMES IN**”, select **Webhook**.
   - Set the URL to:

     ```text
     https://YOUR-NGROK-SUBDOMAIN.ngrok.io/voice/incoming
     ```

   - Ensure the method is **HTTP POST**.
5. Save your changes.

Now, when someone calls your Twilio number, Twilio will send a POST request to `/voice/incoming`. The caller is put on hold and your UI shows **Accept** or **Decline**. If you click **Accept**, the call is connected to the AI at `/voice`.

---

### 9. Call Flow & Logic

- **Incoming call**: Twilio calls `/voice/incoming`, which plays "Please hold" and redirects to a hold loop. The UI polls `/api/incoming-call` and shows an **Incoming call** modal. **Accept** → call is redirected to `/voice` (AI). **Decline** → call is hung up.
- **When the call is connected to the AI** (after Accept or for outbound):
  - `/voice` responds with Twilio `<Gather input="speech">` using:
    - `timeout="5"`
    - `speechTimeout="auto"`
  - The assistant greets the caller and asks how it can help.
- **When `SpeechResult` is present**:
  - The server sends:
    - The caller’s recognized speech.
    - The full structured bus data from `data.js`.
    - A strict system prompt that:
      - Restricts topics to Daewoo bus information.
      - Enforces answers under **4 sentences**.
      - Requires clear, voice-friendly language.
      - Forbids unrelated answers or mentioning it is an AI model.
  - OpenAI returns a response, which is spoken back with:

    ```js
    twiml.say({ voice: "Polly.Joanna" }, aiReply);
    ```

  - After speaking, the call is redirected back to `/voice` to continue the conversation.

---

### 10. Error Handling

- If OpenAI API fails or is not correctly configured:
  - The server logs the error to the console.
  - The caller hears a short, voice-friendly fallback message explaining that the system is temporarily unavailable and suggesting they try again or visit a terminal.
- HTTP responses are always valid TwiML, so Twilio can complete the call gracefully.

---

### 11. Example Testing Steps

- **Local test with ngrok**:
  - Ensure the server is running: `npm start`.
  - Run: `ngrok http 5000`.
  - Configure your Twilio number **Voice** webhook to `https://YOUR-NGROK-SUBDOMAIN.ngrok.io/voice/incoming`.
  - Call your Twilio number from your mobile phone.
- **Try example questions** (speak naturally):
  - “What are the departure times from Lahore to Islamabad today?”
  - “How much is a ticket from Karachi to Lahore?”
  - “How long does it take from Islamabad to Peshawar?”
  - “How do I confirm my Daewoo ticket?”
  - “Where is the Daewoo terminal in Lahore?”

The assistant should respond in clear, natural voice, under 4 sentences, using only the structured data.
