import legacyHandler from "./index.js";

const TRIAL_MODE = true;
const TRIAL_MODE_NOTICE = "Graphic Fiction AI is currently in free beta/trial mode. No subscription or payment check is required.";
const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-GFA-Client-ID"
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", ...extra }
  });
}

function cleanText(value, max) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function getText(result) {
  return String(
    result?.response ??
    result?.choices?.[0]?.message?.content ??
    result?.choices?.[0]?.text ??
    result?.result?.response ??
    ""
  ).trim();
}

async function runText(env, messages, options = {}) {
  const maxTokens = Math.max(256, Math.min(options.maxTokens ?? 760, 1200));
  const temperature = options.temperature ?? 0.55;
  let lastError;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await env.AI.run(TEXT_MODEL, {
        messages,
        max_tokens: maxTokens,
        max_completion_tokens: maxTokens,
        temperature
      });
      const text = getText(result);
      if (!text) throw new Error("The AI returned an empty response.");
      return text;
    } catch (err) {
      lastError = err;
      const message = String(err?.message || err || "");
      const transient = /timeout|aborted|capacity|busy|429|408|temporar|unavailable/i.test(message);
      if (!transient || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }

  throw lastError || new Error("AI request failed.");
}

function buildChatMessages(incoming) {
  const cleaned = incoming
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: cleanText(m.content, 3500) }))
    .filter(m => m.content);

  // Keep enough recent context for continuity without sending a huge transcript on every turn.
  const recent = cleaned.slice(-10);
  let total = 0;
  const kept = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const size = recent[i].content.length;
    if (total + size > 14000 && kept.length >= 2) break;
    kept.unshift(recent[i]);
    total += size;
  }
  return kept;
}

async function handleChat(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400);
  }

  const messages = buildChatMessages(Array.isArray(body?.messages) ? body.messages : []);
  if (!messages.length) return json({ error: "Missing messages", trialMode: TRIAL_MODE }, 400);

  const system = [
    "You are Graphic Fiction AI, the built-in creative AI assistant for designers.",
    "Egyptian Arabic (Masri) is the default conversational dialect and should sound natural, friendly, and professional.",
    "If the user writes in another language, answer in that language. Do not mix languages unless requested.",
    "You help with graphic design, branding, prompts, image generation ideas, image editing, typography, color, creative direction, marketing copy, and general questions.",
    "Give practical answers and ready-to-use prompts when useful.",
    "Never claim to be human. Never pretend that chat itself generated an image; direct image requests to the Image Studio workflow.",
    "Keep normal answers concise. Use short sections or bullets when they improve clarity.",
    "If the user asks a follow-up, use the recent conversation context rather than restarting the topic."
  ].join(" ");

  try {
    const text = await runText(env, [{ role: "system", content: system }, ...messages], {
      maxTokens: 760,
      temperature: 0.55
    });
    return json({
      text,
      trialMode: TRIAL_MODE,
      trialNotice: TRIAL_MODE_NOTICE
    }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Production chat error:", err);
    return json({
      error: "Chat is temporarily unavailable. Please try again.",
      details: cleanText(err?.message || err, 300),
      trialMode: TRIAL_MODE,
      retryable: true
    }, 503);
  }
}

async function handleDesignAssistant(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400); }

  const type = cleanText(body?.type || "Brand", 80);
  const idea = cleanText(body?.idea, 900);
  const tone = cleanText(body?.tone || "Modern", 80);
  if (!idea) return json({ error: "Missing design idea", trialMode: TRIAL_MODE }, 400);

  const system = [
    "You are Graphic Fiction AI, a senior creative director for graphic designers.",
    "Detect the user's language and answer completely in that language unless a different output language is explicitly requested.",
    "Return practical, production-ready direction without inventing brand facts.",
    "Use these concise sections: Creative Direction, Visual Style, Color Palette, Typography, Layout & Composition, Imagery, Copy Direction, Production Notes.",
    "Translate section headings naturally into the response language."
  ].join(" ");

  const user = `Create a design concept for a ${type} project. Idea: ${idea}. Tone: ${tone}. Focus on actionable visual direction a graphic designer can execute.`;
  try {
    const text = await runText(env, [
      { role: "system", content: system },
      { role: "user", content: user }
    ], { maxTokens: 700, temperature: 0.55 });
    return json({ text, trialMode: TRIAL_MODE, trialNotice: TRIAL_MODE_NOTICE }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Production design assistant error:", err);
    return json({ error: "Design assistant is temporarily unavailable. Please try again.", details: cleanText(err?.message || err, 300), trialMode: TRIAL_MODE, retryable: true }, 503);
  }
}

function binaryToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

function readJpegSize(bytes) {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc3 && i + 8 < bytes.length) {
      return { width: (bytes[i + 7] << 8) | bytes[i + 8], height: (bytes[i + 5] << 8) | bytes[i + 6] };
    }
    if (!len || len < 2) break;
    i += 2 + len;
  }
  return { width: 1024, height: 1024 };
}

function getImageSize(binary) {
  const b = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i);
  if (b.length >= 24 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) {
    return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) return readJpegSize(b);
  return { width: 1024, height: 1024 };
}

async function streamToBytes(stream) {
  if (stream instanceof ReadableStream) return new Uint8Array(await new Response(stream).arrayBuffer());
  if (stream?.image instanceof ReadableStream) return new Uint8Array(await new Response(stream.image).arrayBuffer());
  if (stream?.image) {
    if (typeof stream.image === "string") {
      const clean = stream.image.replace(/^data:image\/[^;]+;base64,/, "");
      const binary = atob(clean);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
    }
    return new Uint8Array(stream.image);
  }
  throw new Error("The AI enhancer returned no image.");
}

async function handleImageEnhance(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400); }

  const dataUrl = cleanText(body?.image, 18 * 1024 * 1024);
  const mode = Math.max(0, Math.min(7, Number(body?.mode ?? 0)));
  if (!dataUrl.startsWith("data:image/")) return json({ error: "Please upload a valid image.", trialMode: TRIAL_MODE }, 400);

  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return json({ error: "Invalid image data.", trialMode: TRIAL_MODE }, 400);
  const imageBase64 = match[1];
  let binary;
  try { binary = atob(imageBase64); } catch { return json({ error: "Invalid base64 image.", trialMode: TRIAL_MODE }, 400); }
  if (binary.length > 10 * 1024 * 1024) return json({ error: "Image is too large. Maximum input is 10 MB.", trialMode: TRIAL_MODE }, 413);

  const original = getImageSize(binary);
  const ow = Math.max(256, Number(original.width) || 1024);
  const oh = Math.max(256, Number(original.height) || 1024);
  const scale = Math.min(1, 1536 / ow, 1536 / oh);
  const width = Math.max(256, Math.round((ow * scale) / 8) * 8);
  const height = Math.max(256, Math.round((oh * scale) / 8) * 8);

  let strength = 0.16;
  let steps = 8;
  let prompt = "enhance this exact image, restore fine detail, improve clarity and lighting naturally, preserve the exact subject, face, identity, body proportions, composition, colors and objects, photorealistic, do not redesign or add objects";
  if (mode === 1) { strength = 0.12; steps = 6; }
  else if (mode === 2) { strength = 0.16; steps = 8; }
  else if (mode === 3) { strength = 0.20; steps = 10; prompt += ", stronger detail recovery"; }
  else if (mode === 4) { strength = 0.17; steps = 8; prompt += ", crisp professional detail"; }
  else if (mode === 5) { strength = 0.10; steps = 6; prompt += ", preserve natural skin and facial identity with minimal change"; }
  else if (mode === 6) { strength = 0.14; steps = 7; prompt += ", cleaner product edges and material texture"; }
  else if (mode === 7) { strength = 0.18; steps = 9; prompt += ", stronger recovery while keeping the original recognizable"; }

  try {
    const result = await env.AI.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", {
      prompt,
      negative_prompt: "changed face, changed identity, different person, distorted body, extra fingers, extra limbs, new objects, text, watermark, logo changes, cartoon, painting, oversaturated, blurry, low quality",
      image_b64: imageBase64,
      width,
      height,
      num_steps: steps,
      strength,
      guidance: 6.5
    });
    const outputBytes = await streamToBytes(result);
    return json({
      image: "data:image/png;base64," + binaryToBase64(outputBytes),
      width,
      height,
      mode,
      trialMode: TRIAL_MODE,
      trialNotice: TRIAL_MODE_NOTICE
    }, 200, { "Cache-Control": "no-store" });
  } catch (err) {
    console.error("Production image enhance error:", err);
    return json({ error: "Image enhancement is temporarily unavailable. Please try again.", details: cleanText(err?.message || err, 300), trialMode: TRIAL_MODE, retryable: true }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Graphic Fiction AI", trialMode: TRIAL_MODE, timestamp: new Date().toISOString() }, 200, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname === "/api/design-assistant" && request.method === "POST") return handleDesignAssistant(request, env);
    if (url.pathname === "/api/image-enhance" && request.method === "POST") return handleImageEnhance(request, env);

    // Preserve every existing route and UI exactly as built; only the reliability-sensitive
    // endpoints above are replaced by the production layer.
    return legacyHandler.fetch(request, env, ctx);
  }
};
