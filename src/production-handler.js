import legacyHandler from "./index.js";

const TRIAL_MODE = true;
const TRIAL_MODE_NOTICE = "Graphic Fiction AI is currently in free beta/trial mode. No subscription or payment check is required.";
const TEXT_MODEL = "@cf/zai-org/glm-4.7-flash";
const ENHANCE_MODEL = "@cf/bytedance/stable-diffusion-xl-lightning";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-GFA-Client-ID"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

function clean(value, max = 4000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
}

function modelText(result) {
  return String(result?.response ?? result?.choices?.[0]?.message?.content ?? result?.choices?.[0]?.text ?? result?.result?.response ?? "").trim();
}

function transientError(error) {
  return /timeout|timed out|aborted|capacity|busy|429|408|temporar|unavailable|overloaded/i.test(String(error?.message || error || ""));
}

async function runText(env, messages, maxCompletionTokens = 480, temperature = 0.45) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await env.AI.run(TEXT_MODEL, {
        messages,
        max_completion_tokens: maxCompletionTokens,
        temperature
      });
      const text = modelText(result);
      if (!text) throw new Error("The AI returned an empty response.");
      return text;
    } catch (error) {
      lastError = error;
      if (!transientError(error) || attempt === 1) break;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  }
  throw lastError || new Error("AI request failed.");
}

function chatMessages(incoming) {
  const valid = (Array.isArray(incoming) ? incoming : [])
    .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: clean(m.content, 2200) }))
    .filter(m => m.content)
    .slice(-6);

  let total = 0;
  const kept = [];
  for (let i = valid.length - 1; i >= 0; i--) {
    if (total + valid[i].content.length > 8000 && kept.length >= 2) break;
    kept.unshift(valid[i]);
    total += valid[i].content.length;
  }
  return kept;
}

async function handleChat(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400); }

  const messages = chatMessages(body?.messages);
  if (!messages.length) return json({ error: "Missing messages", trialMode: TRIAL_MODE }, 400);

  const system = [
    "أنت Graphic Fiction AI، المساعد الذكي الأساسي للمصممين وصنّاع المحتوى.",
    "اللغة الافتراضية هي العربية المصرية الطبيعية، بأسلوب مصري واضح واحترافي وودود. لا تستخدم الفصحى إلا لو كانت مطلوبة.",
    "لو المستخدم كتب بلغة أخرى، رد بنفس اللغة. لا تخلط لغات بدون طلب.",
    "ساعد في التصميم الجرافيكي، البراندنج، اللوجوهات، البرومبتات، توليد وتعديل الصور، الألوان، الخطوط، التكوين، التسويق والكتابة الإبداعية.",
    "قدّم إجابة مباشرة وقصيرة أولاً، ثم التفاصيل الضرورية فقط. استخدم نقاطاً عند الحاجة.",
    "لو الطلب خاص بتوليد صورة، وجّه المستخدم لاستخدام Image Studio بدل الادعاء أن المحادثة ولّدت صورة.",
    "حافظ على سياق آخر رسائل ولا تعيد بداية الموضوع من الصفر."
  ].join(" ");

  try {
    const text = await runText(env, [{ role: "system", content: system }, ...messages], 480, 0.45);
    return json({ text, trialMode: TRIAL_MODE, trialNotice: TRIAL_MODE_NOTICE });
  } catch (error) {
    console.error("Chat error:", error);
    return json({ error: "الدردشة مش متاحة مؤقتاً. جرّب تاني.", details: clean(error?.message || error, 240), trialMode: TRIAL_MODE, retryable: true }, 503);
  }
}

async function handleDesignAssistant(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400); }

  const type = clean(body?.type || "Brand", 60);
  const idea = clean(body?.idea, 700);
  const tone = clean(body?.tone || "Modern", 60);
  if (!idea) return json({ error: "Missing design idea", trialMode: TRIAL_MODE }, 400);

  const system = [
    "أنت Graphic Fiction AI، Creative Director محترف للمصممين.",
    "العربية المصرية هي اللغة الافتراضية. اكتب بالمصري الطبيعي والواضح إلا إذا طلب المستخدم لغة أخرى صراحة.",
    "حوّل الفكرة إلى توجيه تصميم قابل للتنفيذ فوراً.",
    "استخدم عناوين قصيرة: الاتجاه الإبداعي، الستايل البصري، الألوان، الخطوط، التكوين، الصور، الكوبي، ملاحظات التنفيذ.",
    "لا تخترع معلومات عن البراند غير موجودة في الطلب."
  ].join(" ");

  try {
    const text = await runText(env, [
      { role: "system", content: system },
      { role: "user", content: `نوع المشروع: ${type}\nالفكرة: ${idea}\nالتون: ${tone}\nاعمل Concept احترافي ومختصر يقدر المصمم ينفذه.` }
    ], 520, 0.45);
    return json({ text, trialMode: TRIAL_MODE, trialNotice: TRIAL_MODE_NOTICE });
  } catch (error) {
    console.error("Design assistant error:", error);
    return json({ error: "مساعد التصميم مش متاح مؤقتاً. جرّب تاني.", details: clean(error?.message || error, 240), trialMode: TRIAL_MODE, retryable: true }, 503);
  }
}

function base64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesBase64(bytes) {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) out += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  return btoa(out);
}

function imageSize(binary) {
  const b = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i);
  if (b.length >= 24 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) {
    return { width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19], height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23] };
  }
  if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 255) { i++; continue; }
      const marker = b[i + 1];
      const len = (b[i + 2] << 8) | b[i + 3];
      if (marker >= 0xc0 && marker <= 0xc3 && i + 8 < b.length) return { width: (b[i + 7] << 8) | b[i + 8], height: (b[i + 5] << 8) | b[i + 6] };
      if (len < 2) break;
      i += 2 + len;
    }
  }
  return { width: 1024, height: 1024 };
}

async function outputBytes(result) {
  if (result instanceof ReadableStream) return new Uint8Array(await new Response(result).arrayBuffer());
  if (result?.image instanceof ReadableStream) return new Uint8Array(await new Response(result.image).arrayBuffer());
  if (result?.image) return typeof result.image === "string" ? base64Bytes(result.image.replace(/^data:image\/[^;]+;base64,/, "")) : new Uint8Array(result.image);
  throw new Error("The image model returned no image.");
}

async function handleImageEnhance(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON request.", trialMode: TRIAL_MODE }, 400); }

  const dataUrl = clean(body?.image, 14 * 1024 * 1024);
  const mode = Math.max(0, Math.min(7, Number(body?.mode ?? 0)));
  if (!dataUrl.startsWith("data:image/")) return json({ error: "Please upload a valid image.", trialMode: TRIAL_MODE }, 400);

  const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (!match) return json({ error: "Invalid image data.", trialMode: TRIAL_MODE }, 400);
  const imageBase64 = match[1];
  let binary;
  try { binary = atob(imageBase64); } catch { return json({ error: "Invalid base64 image.", trialMode: TRIAL_MODE }, 400); }
  if (binary.length > 8 * 1024 * 1024) return json({ error: "الصورة كبيرة جداً. الحد الأقصى 8MB.", trialMode: TRIAL_MODE }, 413);

  const original = imageSize(binary);
  const ow = Math.max(256, Number(original.width) || 1024);
  const oh = Math.max(256, Number(original.height) || 1024);
  const scale = Math.min(1, 1024 / ow, 1024 / oh);
  const width = Math.max(256, Math.round((ow * scale) / 8) * 8);
  const height = Math.max(256, Math.round((oh * scale) / 8) * 8);

  const profiles = [
    { strength: 0.12, prompt: "restore clarity and fine detail naturally" },
    { strength: 0.10, prompt: "lightly clean compression and improve clarity" },
    { strength: 0.14, prompt: "recover detail and improve sharpness naturally" },
    { strength: 0.18, prompt: "strong detail recovery while preserving the original" },
    { strength: 0.14, prompt: "create crisp professional detail" },
    { strength: 0.08, prompt: "gently improve portrait clarity and natural skin detail" },
    { strength: 0.11, prompt: "clean product edges and material texture" },
    { strength: 0.16, prompt: "stronger clarity and detail recovery" }
  ];
  const profile = profiles[mode];

  try {
    const result = await env.AI.run(ENHANCE_MODEL, {
      prompt: `Enhance this exact image. ${profile.prompt}. Preserve the exact person, face, identity, body proportions, pose, composition, colors, objects, clothing and background. Do not redesign the image. Photorealistic natural result.`,
      negative_prompt: "changed identity, different person, changed face, altered facial features, changed body proportions, long neck, oversized head, distorted hands, extra fingers, extra limbs, new objects, text, watermark, cartoon, painting, oversaturated, blurry",
      image_b64: imageBase64,
      width,
      height,
      num_steps: 4,
      strength: profile.strength,
      guidance: 5.5
    });

    const output = await outputBytes(result);
    return json({ image: "data:image/png;base64," + bytesBase64(output), width, height, mode, trialMode: TRIAL_MODE, trialNotice: TRIAL_MODE_NOTICE });
  } catch (error) {
    console.error("Image enhancement error:", error);
    return json({ error: "تحسين الصورة فشل مؤقتاً. جرّب صورة أصغر أو جرّب تاني.", details: clean(error?.message || error, 300), trialMode: TRIAL_MODE, retryable: true }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Graphic Fiction AI", trialMode: TRIAL_MODE, timestamp: new Date().toISOString() });
    }

    if (url.pathname === "/api/chat" && request.method === "POST") return handleChat(request, env);
    if (url.pathname === "/api/design-assistant" && request.method === "POST") return handleDesignAssistant(request, env);
    if (url.pathname === "/api/image-enhance" && request.method === "POST") return handleImageEnhance(request, env);

    return legacyHandler.fetch(request, env, ctx);
  }
};
