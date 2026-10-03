export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") return new Response(null, {headers: cors});

    if (url.pathname === "/api/text-to-image" && request.method === "POST") {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim().slice(0, 500);
        if (!prompt) return new Response(JSON.stringify({error:"Missing prompt"}), {
          status:400, headers:{...cors,"Content-Type":"application/json"}
        });

        const result = await env.AI.run(
          "@cf/black-forest-labs/flux-1-schnell",
          {prompt, steps:4}
        );

        return new Response(JSON.stringify({
          image: `data:image/jpeg;base64,${result.image}`
        }), {
          headers:{...cors,"Content-Type":"application/json"}
        });
      } catch (err) {
        console.error("FLUX generation error:", err);
        return new Response(JSON.stringify({
          error: "Generation failed",
          details: String(err?.message || err)
        }), {
          status:500,
          headers:{...cors,"Content-Type":"application/json"}
        });
      }
    }

    if (url.pathname === "/api/image-enhance" && request.method === "POST") {
      try {
        if (!env.IMAGES) throw new Error("Image enhancement is not configured yet.");
        const body = await request.json();
        const dataUrl = String(body.image || "");
        const mode = Math.max(0, Math.min(7, Number(body.mode ?? 0)));

        if (!dataUrl.startsWith("data:image/")) {
          return new Response(JSON.stringify({error:"Please upload a valid image."}), {
            status:400, headers:{...cors,"Content-Type":"application/json"}
          });
        }

        const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!match) throw new Error("Invalid image data.");
        const inputBinary = atob(match[1]);
        if (inputBinary.length > 20 * 1024 * 1024) throw new Error("Image is too large. Maximum input is 20 MB.");

        const bytes = new Uint8Array(inputBinary.length);
        for (let i = 0; i < inputBinary.length; i++) bytes[i] = inputBinary.charCodeAt(i);

        const info = await env.IMAGES.info(bytes);
        const width = Number(info?.width || 0);
        const height = Number(info?.height || 0);
        if (!width || !height) throw new Error("Could not read image dimensions.");

        // Real AI enhancement: Cloudflare Images uses ESRGAN for
        // upscale=generate. Add mode-specific restoration controls so the
        // result is not just a larger copy of the original.
        let targetWidth;
        let targetHeight;
        let sharpen = 2;
        let brightness = 1;
        let contrast = 1;
        let saturation = 1;
        let gamma = 1;

        if (mode === 4) {
          // 4K mode: fit within 3840x2160 without creating oversized outputs.
          const max4KWidth = 3840;
          const max4KHeight = 2160;
          const scale4K = Math.min(max4KWidth / width, max4KHeight / height);
          const safeScale = Math.max(1, scale4K);
          targetWidth = Math.round(width * safeScale);
          targetHeight = Math.round(height * safeScale);
          sharpen = 2.5;
        } else {
          // Other enhancement modes target a real 2x AI upscale, capped safely.
          const scale = 2;
          const maxPixels = 25_000_000;
          targetWidth = Math.round(width * scale);
          targetHeight = Math.round(height * scale);
          const pixels = targetWidth * targetHeight;

          if (pixels > maxPixels) {
            const factor = Math.sqrt(maxPixels / pixels);
            targetWidth = Math.max(width, Math.floor(targetWidth * factor));
            targetHeight = Math.max(height, Math.floor(targetHeight * factor));
          }

          if (mode === 1) {
            // Portrait: controlled sharpening and gentle contrast.
            sharpen = 2.2;
            contrast = 1.03;
          } else if (mode === 2) {
            // Professional camera: stronger detail and tonal separation.
            sharpen = 3;
            contrast = 1.05;
            saturation = 1.03;
          } else if (mode === 3) {
            // Premium 2x: balanced AI upscale with extra detail.
            sharpen = 2.5;
            contrast = 1.02;
          } else if (mode === 5) {
            // Low-light: lift midtones without aggressively clipping highlights.
            sharpen = 2;
            brightness = 1.08;
            gamma = 0.92;
            contrast = 1.03;
          } else if (mode === 6) {
            // Dynamic range / color: improve separation and color presence.
            sharpen = 2;
            contrast = 1.10;
            saturation = 1.06;
          } else if (mode === 7) {
            // Sharpen: prioritize edge definition.
            sharpen = 4;
          }
        }

        const response = (
          await env.IMAGES.input(bytes)
            .transform({
              width: targetWidth,
              height: targetHeight,
              fit: "contain",
              upscale: "generate",
              sharpen,
              brightness,
              contrast,
              saturation,
              gamma
            })
            .output({format:"image/webp"})
        ).response({
          headers: {
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400"
          }
        });

        const resultBuffer = await response.arrayBuffer();
        const resultBytes = new Uint8Array(resultBuffer);
        let resultBinary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < resultBytes.length; i += chunkSize) {
          resultBinary += String.fromCharCode(...resultBytes.subarray(i, Math.min(i + chunkSize, resultBytes.length)));
        }
        const resultBase64 = btoa(resultBinary);

        return new Response(JSON.stringify({
          image: `data:image/webp;base64,${resultBase64}`,
          width: targetWidth,
          height: targetHeight,
          mode
        }), {
          headers:{...cors,"Content-Type":"application/json"}
        });
      } catch (err) {
        console.error("Image Enhance error:", err);
        return new Response(JSON.stringify({
          error:"Image enhancement failed",
          details:String(err?.message || err)
        }), {
          status:500, headers:{...cors,"Content-Type":"application/json"}
        });
      }
    }

    if (url.pathname === "/api/design-assistant" && request.method === "POST") {
      try {
        const body = await request.json();
        const type = String(body.type || "Brand").trim().slice(0, 80);
        const idea = String(body.idea || "").trim().slice(0, 1000);
        const tone = String(body.tone || "Modern").trim().slice(0, 80);

        if (!idea) return new Response(JSON.stringify({error:"Missing design idea"}), {
          status:400, headers:{...cors,"Content-Type":"application/json"}
        });

        const messages = [
          {
            role: "system",
            content: "You are Graphic Fiction AI, a professional creative director for graphic designers. Give practical, production-ready creative direction. Do not invent brand facts. IMPORTANT: Detect the language used by the user in the idea, type, and tone fields, and write the entire answer in that same language. If the user clearly asks for a different output language, use the requested language instead. Support multilingual output including Arabic, English, French, Spanish, German, Italian, Portuguese, Turkish, Dutch, Russian, Chinese, Japanese, Korean, and other languages the model can handle. Do not mix languages unless the user asks you to. Keep brand names, proper nouns, URLs, and technical names unchanged when appropriate. Structure every answer with equivalent headings translated naturally into the response language: Creative Direction, Visual Style, Color Palette, Typography, Layout & Composition, Imagery, Copy Direction, Production Notes. Keep it concise but useful."
          },
          {
            role: "user",
            content: `Create a design concept for a ${type} project. Idea: ${idea}. Tone: ${tone}. The user is a graphic designer, so focus on actionable visual direction they can execute.`
          }
        ];

        const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
          messages,
          max_tokens: 900,
          temperature: 0.65
        });

        const text = String(result?.response || "").trim();
        if (!text) throw new Error("The AI returned no concept.");

        return new Response(JSON.stringify({text}), {
          headers:{...cors,"Content-Type":"application/json"}
        });
      } catch (err) {
        console.error("Design Assistant error:", err);
        return new Response(JSON.stringify({
          error: "Assistant failed",
          details: String(err?.message || err)
        }), {
          status:500,
          headers:{...cors,"Content-Type":"application/json"}
        });
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Graphic Fiction AI", {headers:{"Content-Type":"text/plain"}});
  }
};