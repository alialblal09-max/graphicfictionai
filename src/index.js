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

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Graphic Fiction AI", {headers:{"Content-Type":"text/plain"}});
  }
};