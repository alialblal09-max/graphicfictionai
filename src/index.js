export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-GFA-Client-ID"
    };

    if (request.method === "OPTIONS") return new Response(null, {headers: cors});

    function recordUsage(tool) {
      try {
        if (!env.ANALYTICS) return;
        const clientId = String(request.headers.get("X-GFA-Client-ID") || "anonymous").slice(0, 128);
        const country = String(request.cf?.country || "unknown").slice(0, 16);
        env.ANALYTICS.writeDataPoint({
          blobs: [tool, clientId, country],
          doubles: [1],
          indexes: [clientId]
        });
      } catch (analyticsError) {
        console.error("Analytics write error:", analyticsError);
      }
    }

    if (url.pathname === "/api/text-to-image" && request.method === "POST") {
      recordUsage("text-to-image");
      try {
        const body = await request.json();
        const prompt = String(body.prompt || "").trim().slice(0, 2048);
        if (!prompt) return new Response(JSON.stringify({error:"Missing prompt"}), {
          status:400, headers:{...cors,"Content-Type":"application/json"}
        });

        const referenceImage = String(body.referenceImage || "");
        let result;

        const hasMainReference = referenceImage.startsWith("data:image/");

        const widthRaw = Number(body.width);
        const heightRaw = Number(body.height);
        const width = Number.isFinite(widthRaw) ? Math.max(256, Math.min(1920, Math.round(widthRaw / 8) * 8)) : 1024;
        const height = Number.isFinite(heightRaw) ? Math.max(256, Math.min(1920, Math.round(heightRaw / 8) * 8)) : 1024;

        if (hasMainReference) {
          const match = referenceImage.match(/^data:image\/([^;]+);base64,(.+)$/);
          if (!match) throw new Error("Invalid reference image.");
          const mime = "image/" + match[1];
          const binary = atob(match[2]);
          if (binary.length > 6 * 1024 * 1024) {
            throw new Error("Reference image is too large.");
          }

          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const identityInstruction = "Image 0 is the user's photo. Use it as the primary reference for the SAME PERSON. Preserve recognizable facial identity, facial structure, eyes, nose, mouth, jawline, skin tone, hairline, hairstyle and body proportions. Do not replace the person with a different face. Change only the scene, pose, clothing or environment requested by the user.";
          const form = new FormData();
          form.append("prompt", identityInstruction + " " + prompt);
          form.append("input_image_0", new Blob([bytes], {type:mime}), "reference.jpg");
          form.append("width", String(width));
          form.append("height", String(height));
          form.append("guidance", "4");

          const formResponse = new Response(form);
          result = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
            multipart: {
              body: formResponse.body,
              contentType: formResponse.headers.get("content-type")
            }
          });
        } else {
          const form = new FormData();
          form.append("prompt", prompt);
          form.append("width", String(width));
          form.append("height", String(height));
          form.append("guidance", "4");

          const formResponse = new Response(form);
          result = await env.AI.run("@cf/black-forest-labs/flux-2-klein-4b", {
            multipart: {
              body: formResponse.body,
              contentType: formResponse.headers.get("content-type")
            }
          });
        }

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
      recordUsage("image-enhance");
      try {
        if (!env.AI) throw new Error("Cloudflare Workers AI is not configured.");

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

        const imageBase64 = match[1];
        const inputBinary = atob(imageBase64);
        if (inputBinary.length > 12 * 1024 * 1024) {
          throw new Error("Image is too large. Maximum input is 12 MB.");
        }

        // Read the original dimensions so the AI result keeps the same aspect ratio.
        function getImageSize(binary) {
          const b = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) b[i] = binary.charCodeAt(i);

          // PNG
          if (b.length >= 24 &&
              b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) {
            return {
              width: (b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19],
              height: (b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]
            };
          }

          // JPEG
          if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
            let i = 2;
            while (i + 9 < b.length) {
              if (b[i] !== 255) { i++; continue; }
              const marker = b[i + 1];
              const len = (b[i + 2] << 8) | b[i + 3];
              if (marker >= 0xC0 && marker <= 0xC3) {
                return {
                  width: (b[i + 7] << 8) | b[i + 8],
                  height: (b[i + 5] << 8) | b[i + 6]
                };
              }
              if (len < 2) break;
              i += 2 + len;
            }
          }

          return {width:1024, height:1024};
        }

        const original = getImageSize(inputBinary);
        const originalWidth = Math.max(256, Number(original.width) || 1024);
        const originalHeight = Math.max(256, Number(original.height) || 1024);

        // Stable Diffusion img2img is currently listed by Cloudflare at $0.00/step.
        // Keep the transformation gentle so the source composition and identity stay close.
        let strength = 0.22;
        let steps = 12;
        let prompt = "enhance this exact image: restore fine details, improve clarity, reduce compression artifacts, improve lighting and texture naturally, preserve the same subject, face, body proportions, composition, colors and objects, photorealistic, do not redesign or add objects";

        if (mode === 1) {
          strength = 0.18;
          steps = 10;
        } else if (mode === 2) {
          strength = 0.25;
          steps = 14;
        } else if (mode === 3) {
          strength = 0.30;
          steps = 16;
          prompt += ", maximum detail recovery and cleaner high-resolution appearance";
        } else if (mode === 4) {
          strength = 0.24;
          steps = 14;
          prompt += ", crisp professional 4K-style detail";
        } else if (mode === 5) {
          strength = 0.16;
          steps = 10;
          prompt += ", preserve natural skin and facial details without changing identity";
        } else if (mode === 6) {
          strength = 0.20;
          steps = 12;
          prompt += ", cleaner product edges and fine material texture";
        } else if (mode === 7) {
          strength = 0.27;
          steps = 15;
          prompt += ", stronger detail recovery while keeping the original image recognizable";
        }

        // The model supports up to 2048px on each side. Preserve aspect ratio.
        const scale = Math.min(1, 2048 / originalWidth, 2048 / originalHeight);
        const width = Math.max(256, Math.round((originalWidth * scale) / 8) * 8);
        const height = Math.max(256, Math.round((originalHeight * scale) / 8) * 8);

        const result = await env.AI.run(
          "@cf/stabilityai/stable-diffusion-xl-base-1.0",
          {
            prompt,
            negative_prompt: "new objects, changed face, changed identity, distorted body, extra fingers, extra limbs, text, watermark, logo changes, cartoon, painting, oversaturated, blurry, low quality",
            image_b64: imageBase64,
            width,
            height,
            num_steps: steps,
            strength,
            guidance: 7.5
          }
        );

        // Workers AI may return the image as a ReadableStream for this model.
        let outputBytes;
        if (result instanceof ReadableStream) {
          const reader = result.getReader();
          const chunks = [];
          let total = 0;
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              total += value.length;
            }
          }
          outputBytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            outputBytes.set(chunk, offset);
            offset += chunk.length;
          }
        } else if (result?.image instanceof ReadableStream) {
          const reader = result.image.getReader();
          const chunks = [];
          let total = 0;
          while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              total += value.length;
            }
          }
          outputBytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            outputBytes.set(chunk, offset);
            offset += chunk.length;
          }
        } else if (result?.image) {
          const raw = result.image;
          if (typeof raw === "string") {
            const clean = raw.replace(/^data:image\/[^;]+;base64,/, "");
            const outBinary = atob(clean);
            outputBytes = new Uint8Array(outBinary.length);
            for (let i = 0; i < outBinary.length; i++) outputBytes[i] = outBinary.charCodeAt(i);
          } else {
            outputBytes = new Uint8Array(raw);
          }
        } else {
          throw new Error("The AI enhancer returned no image.");
        }

        let resultBinary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < outputBytes.length; i += chunkSize) {
          resultBinary += String.fromCharCode(
            ...outputBytes.subarray(i, Math.min(i + chunkSize, outputBytes.length))
          );
        }

        const resultBase64 = btoa(resultBinary);
        return new Response(JSON.stringify({
          image: "data:image/png;base64," + resultBase64,
          width,
          height,
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
      recordUsage("design-assistant");
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

        const text = String(
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          result?.choices?.[0]?.text ??
          result?.result?.response ??
          ""
        ).trim();
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


    if (url.pathname === "/api/remove-background" && request.method === "POST") {
      recordUsage("background-remover");
      try {
        if (!env.IMAGES) throw new Error("Cloudflare Images binding is not configured.");
        const body = await request.json();
        const dataUrl = String(body.image || "");
        if (!dataUrl.startsWith("data:image/")) {
          return new Response(JSON.stringify({error:"Please upload a valid image."}), {
            status:400, headers:{...cors,"Content-Type":"application/json"}
          });
        }

        const match = dataUrl.match(/^data:image\/[^;]+;base64,(.+)$/);
        if (!match) throw new Error("Invalid image data.");
        const binary = atob(match[1]);
        if (binary.length > 20 * 1024 * 1024) {
          throw new Error("Image is too large. Maximum input is 20 MB.");
        }

        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const input = env.IMAGES.input(new Blob([bytes]));
        const result = await input
          .transform({ segment: "foreground" })
          .output({ format: "image/png" });

        const response = await result.response();
        const outputBuffer = await response.arrayBuffer();
        const outputBytes = new Uint8Array(outputBuffer);
        let outBinary = "";
        const chunkSize = 0x8000;
        for (let i = 0; i < outputBytes.length; i += chunkSize) {
          outBinary += String.fromCharCode(
            ...outputBytes.subarray(i, Math.min(i + chunkSize, outputBytes.length))
          );
        }

        return new Response(JSON.stringify({
          image: "data:image/png;base64," + btoa(outBinary)
        }), {
          headers:{...cors,"Content-Type":"application/json"}
        });
      } catch (err) {
        console.error("Background removal error:", err);
        return new Response(JSON.stringify({
          error:"Background removal failed",
          details:String(err?.message || err)
        }), {
          status:500, headers:{...cors,"Content-Type":"application/json"}
        });
      }
    }

    if (url.pathname === "/api/chat" && request.method === "POST") {
      recordUsage("chat");
      try {
        const body = await request.json();
        const incoming = Array.isArray(body.messages) ? body.messages : [];
        const messages = incoming
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-20)
          .map(m => ({
            role: m.role,
            content: String(m.content).trim().slice(0, 6000)
          }))
          .filter(m => m.content);

        if (!messages.length) {
          return new Response(JSON.stringify({error:"Missing messages"}), {
            status:400, headers:{...cors,"Content-Type":"application/json"}
          });
        }

        const system = "You are Graphic Fiction AI, the built-in creative AI assistant for designers. Egyptian Arabic (Masri) is your default conversational dialect and your natural tone should feel friendly, clear, and helpful. If the user writes in another language, answer naturally in that language; if they asks for a specific dialect or language, follow it. You can understand and respond across many languages. Do not mix languages unless useful or requested. You help with graphic design, branding, prompts, image ideas, social media, typography, color, creative direction, marketing copy, and general questions. Give practical answers, examples, and ready-to-use prompts when useful. Never claim to be a human. When the user asks for an image, explain the exact prompt/settings they can use in AI Image Studio rather than pretending the chat itself generated an image. Keep responses concise unless the user asks for detail.";

        const result = await env.AI.run("@cf/zai-org/glm-4.7-flash", {
          messages: [{role:"system", content:system}, ...messages],
          max_tokens: 1200,
          temperature: 0.7
        });

        // Normalize both native Workers AI and OpenAI-compatible response shapes.
        const text = String(
          result?.response ??
          result?.choices?.[0]?.message?.content ??
          result?.choices?.[0]?.text ??
          result?.result?.response ??
          ""
        ).trim();
        if (!text) throw new Error("The AI returned no response.");

        return new Response(JSON.stringify({text}), {
          headers:{...cors,"Content-Type":"application/json"}
        });
      } catch (err) {
        console.error("Chat error:", err);
        return new Response(JSON.stringify({
          error:"Chat failed",
          details:String(err?.message || err)
        }), {
          status:500, headers:{...cors,"Content-Type":"application/json"}
        });
      }
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Graphic Fiction AI", {headers:{"Content-Type":"text/plain"}});
  }
};