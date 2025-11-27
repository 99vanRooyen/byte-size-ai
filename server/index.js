// server/index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const jwt = require("jsonwebtoken"); // login auth
const db = require("./db"); // sqlite chat-state

const app = express();
app.use(cors());
app.use(express.json());

// ------------- ENV VARIABLES -------------
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JWT_SECRET = process.env.JWT_SECRET;

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️ OPENROUTER_API_KEY is missing from environment.");
}

if (!ADMIN_PASSWORD) {
  console.warn("⚠️ ADMIN_PASSWORD is missing from environment.");
}

if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET is missing from environment.");
}

// ------------- AUTH MIDDLEWARE & LOGIN -------------

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Unauthorized: missing token" });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    console.error("JWT verify error:", err.message);
    return res.status(401).json({ error: "Unauthorized: invalid token" });
  }
}

/**
 * POST /api/login
 * Body: { password }
 * Returns: { token }
 */
app.post("/api/login", (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: "Password is required." });
    }

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Invalid password." });
    }

    const token = jwt.sign(
      { role: "admin", name: "Leonard" },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Login failed." });
  }
});

// ------------- MODELS -------------

/**
 * GET /api/models
 * Fetches models from OpenRouter, sorts:
 *  - free models first
 *  - then by cheapest prompt price
 */
app.get("/api/models", requireAuth, async (req, res) => {
  try {
    const response = await axios.get("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:5173", // dev value
        "X-Title": "Byte-Size AI (local dev)",
      },
    });

    const models = response.data.data || [];

    const mapped = models.map((m) => {
      const pricing = m.pricing || {};
      const promptPrice = Number(pricing.prompt || 0);
      const completionPrice = Number(pricing.completion || 0);

      const arch = m.architecture || {};
      const outputModalities =
        arch.output_modalities || m.output_modalities || [];
      const inputModalities =
        arch.input_modalities || m.input_modalities || [];

      const hasImage =
        Array.isArray(outputModalities) &&
        outputModalities.includes("image");

      const hasVideo =
        (Array.isArray(outputModalities) &&
          outputModalities.includes("video")) ||
        (Array.isArray(inputModalities) &&
          inputModalities.includes("video"));

      return {
        id: m.id,
        name: m.name,
        description: m.description,
        pricing: {
          prompt: promptPrice,
          completion: completionPrice,
        },
        isFree:
          Number(pricing.prompt || 0) === 0 &&
          Number(pricing.completion || 0) === 0,
        outputModalities,
        inputModalities,
        isImageCapable: hasImage,
        isVideoCapable: hasVideo,
      };
    });

    // free first, then by prompt price
    mapped.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      return a.pricing.prompt - b.pricing.prompt;
    });

    res.json({ models: mapped });
  } catch (err) {
    console.error("Error fetching models from OpenRouter:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    } else {
      console.error(err.message);
    }
    res.status(500).json({ error: "Failed to load models from OpenRouter." });
  }
});

/**
 * GET /api/video-models
 * Fetches ONLY video-capable models from OpenRouter
 */
app.get("/api/video-models", requireAuth, async (req, res) => {
  try {
    const response = await axios.get("https://openrouter.ai/api/v1/models", {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:5173",
        "X-Title": "Byte-Size AI (local dev)",
      },
    });

    const models = response.data.data || [];

    const mapped = models.map((m) => {
      const pricing = m.pricing || {};
      const promptPrice = Number(pricing.prompt || 0);
      const completionPrice = Number(pricing.completion || 0);

      const arch = m.architecture || {};
      const outputModalities =
        arch.output_modalities || m.output_modalities || [];
      const inputModalities =
        arch.input_modalities || m.input_modalities || [];

      const hasImage =
        Array.isArray(outputModalities) &&
        outputModalities.includes("image");

      const hasVideo =
        (Array.isArray(outputModalities) &&
          outputModalities.includes("video")) ||
        (Array.isArray(inputModalities) &&
          inputModalities.includes("video"));

      return {
        id: m.id,
        name: m.name,
        description: m.description,
        pricing: {
          prompt: promptPrice,
          completion: completionPrice,
        },
        isFree:
          Number(pricing.prompt || 0) === 0 &&
          Number(pricing.completion || 0) === 0,
        outputModalities,
        inputModalities,
        isImageCapable: hasImage,
        isVideoCapable: hasVideo,
      };
    });

    const videoModels = mapped.filter((m) => m.isVideoCapable);

    videoModels.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1;
      if (!a.isFree && b.isFree) return 1;
      return a.pricing.prompt - b.pricing.prompt;
    });

    res.json({ models: videoModels });
  } catch (err) {
    console.error("Error fetching video models from OpenRouter:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
    } else {
      console.error(err.message);
    }
    res.status(500).json({ error: "Failed to load video models." });
  }
});

// ------------- CHAT STATE (DB) -------------

// GET /api/chat-state
app.get("/api/chat-state", requireAuth, (req, res) => {
  try {
    const row = db
      .prepare("SELECT data FROM chat_state WHERE id = ?")
      .get("default");

    if (!row) {
      return res.json({ projects: [], chats: [] });
    }

    const parsed = JSON.parse(row.data);
    return res.json(parsed);
  } catch (err) {
    console.error("Error reading chat_state from DB:", err);
    return res.status(500).json({ error: "Failed to load chat state." });
  }
});

// POST /api/chat-state
app.post("/api/chat-state", requireAuth, (req, res) => {
  try {
    const { projects, chats } = req.body;

    if (!projects || !chats) {
      return res
        .status(400)
        .json({ error: "Missing 'projects' or 'chats' in body." });
    }

    const data = JSON.stringify({ projects, chats });

    db.prepare(
      `
      INSERT INTO chat_state (id, data)
      VALUES (?, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `
    ).run("default", data);

    return res.json({ success: true });
  } catch (err) {
    console.error("Error saving chat_state to DB:", err);
    return res.status(500).json({ error: "Failed to save chat state." });
  }
});

// ------------- AI CHAT -------------

/**
 * POST /api/ai
 * Body: { prompt, brand, mode, modelId, clientDate? }
 */
app.post("/api/ai", requireAuth, async (req, res) => {
  try {
    const { prompt, brand, mode, modelId, clientDate } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "Missing prompt." });
    }

    const now = clientDate ? new Date(clientDate) : new Date();
    const isoNow = now.toISOString();
    const humanDate = now.toLocaleString("en-ZA", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const lower = (prompt || "").toLowerCase();

    if (lower.includes("how many days") && lower.includes("christmas")) {
      const yearMatch = lower.match(/20\d{2}/);
      let targetYear;

      if (yearMatch) {
        targetYear = parseInt(yearMatch[0], 10);
      } else {
        targetYear = now.getFullYear();
        const christmasThisYear = new Date(targetYear, 11, 25);
        if (christmasThisYear < now) {
          targetYear += 1;
        }
      }

      const target = new Date(targetYear, 11, 25);
      const diffMs = target - now;
      const days = Math.max(
        0,
        Math.ceil(diffMs / (1000 * 60 * 60 * 24))
      );

      console.log(
        `🎄 Christmas override used. Today=${isoNow.slice(
          0,
          10
        )}, targetYear=${targetYear}, days=${days}`
      );

      return res.json({
        reply: `There are ${days} days until Christmas ${targetYear}. (Based on current date ${isoNow.slice(
          0,
          10
        )})`,
      });
    }

    const model = modelId || "openai/gpt-4o-mini";

    const systemPrompt = `
You are Byte-Size AI, the personal AI assistant for Leonard van Rooyen.
Brand: ${brand}
Mode: ${mode}

Current real-world date & time (user's context) is: ${humanDate} (ISO: ${isoNow}).
Always use THIS runtime date/time for:
- "today", "now", "current year", "this month", "this week"
- counting days until/from a date
- anything involving deadlines, days remaining, or time differences.

Do NOT rely on your training cutoff date for time-related questions. If there is any conflict,
the runtime date above is the source of truth.

Stay consistent with Leonard's brand voice: professional, sharp, direct, but still human.
Speak clearly, be practical, and avoid fluff.
    `.trim();

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "Byte-Size AI Studio",
          "Content-Type": "application/json",
        },
        timeout: 60000,
      }
    );

    const aiReply =
      response.data.choices?.[0]?.message?.content ||
      "No response received from OpenRouter.";

    res.json({ reply: aiReply });
  } catch (err) {
    console.error("Error talking to OpenRouter from /api/ai:");

    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
      return res.status(500).json({
        error: "AI request failed.",
        details: err.response.data,
      });
    } else {
      console.error(err.message);
      return res.status(500).json({
        error: "AI request failed.",
        details: err.message,
      });
    }
  }
});

// ------------- IMAGE GENERATION -------------

/**
 * POST /api/image
 * Image Generation Endpoint
 */
app.post("/api/image", requireAuth, async (req, res) => {
  try {
    const { prompt, model } = req.body;

    if (!prompt || !prompt.trim()) {
      return res
        .status(400)
        .json({ error: "Missing prompt for image generation." });
    }

    const imageModel =
      model ||
      process.env.DEFAULT_IMAGE_MODEL ||
      "google/gemini-2.5-flash-image-preview";

    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: imageModel,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        modalities: ["image", "text"],
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "http://localhost:5173",
          "X-Title": "Byte-Size AI Image Generator",
          "Content-Type": "application/json",
        },
        timeout: 120000,
      }
    );

    const message = response.data.choices?.[0]?.message || {};
    const img = message.images?.[0];

    const imageUrl =
      img?.image_url?.url || img?.imageUrl?.url || null;

    if (!imageUrl) {
      console.error("OpenRouter did NOT return an image:", response.data);
      return res.status(500).json({
        error: "OpenRouter returned no image for this prompt.",
      });
    }

    res.json({
      reply: message.content || "Here is your generated image.",
      imageUrl,
    });
  } catch (err) {
    console.error("🔥 ERROR in /api/image:");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Data:", err.response.data);
      return res.status(500).json({
        error: "Image request failed.",
        details: err.response.data,
      });
    } else {
      console.error(err.message);
      return res.status(500).json({
        error: "Image request failed.",
        details: err.message,
      });
    }
  }
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Byte-Size AI backend running on http://localhost:${PORT}`);
});
