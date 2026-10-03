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
            content: "You are Graphic Fiction AI, a professional creative director for graphic designers. Give practical, production-ready creative direction. Do not invent brand facts. Structure every answer with these headings: Creative Direction, Visual Style, Color Palette, Typography, Layout & Composition, Imagery, Copy Direction, Production Notes. Keep it concise but useful."
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