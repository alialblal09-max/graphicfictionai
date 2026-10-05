const IDENTITY_PRESERVATION_PROMPT = `
IDENTITY PRESERVATION — HIGHEST PRIORITY

When a reference image is provided, treat it as the primary source of truth for the person's identity.

Preserve the exact recognizable identity of the person. Maintain facial structure, face shape, eyes, eyebrows, nose, lips, jawline, cheek structure, skin tone, natural skin texture, hairline, hairstyle, facial hair, freckles, moles, scars, distinctive marks, age, natural facial characteristics, natural body proportions, head-to-body ratio, shoulder width, neck length, hands, and overall anatomy.

Never unintentionally change the person's identity. Do not reshape or beautify the face, enlarge the eyes, change the nose or lips, alter the jaw, change skin tone or age, change body proportions, make the person taller or shorter, make the neck unnaturally long, remove distinctive characteristics, apply excessive beauty filters, create plastic-looking skin, or replace the person's face with another person.

Only change elements explicitly requested by the user. If the user requests a new outfit, change only the outfit. If the user requests a new environment, change only the environment. If the user requests a different pose, modify the pose while preserving identity and realistic anatomy. If the user requests different lighting, modify lighting without changing identity.

Maintain realistic human anatomy and natural proportions. Generate a photorealistic result with high detail, realistic skin texture, accurate facial features, natural lighting, realistic shadows, and professional photographic quality.

The final result must remain clearly recognizable as the same individual shown in the reference image.
`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Serve the Graphic Fiction AI frontend from the same Worker.
    if (request.method === "GET") {
      const assetResponse = await env.ASSETS.fetch(request);
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers: assetResponse.headers,
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    try {
      const body = await request.json();
      const userPrompt = (body.prompt || "").toString().trim().slice(0, 1200);
      const identityPreservation = body.identityPreservation !== false;

      if (!userPrompt) {
        return new Response(JSON.stringify({ error: "Missing prompt" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Automatically protect identity for every image request unless explicitly disabled.
      const prompt = identityPreservation
        ? `${IDENTITY_PRESERVATION_PROMPT}\nUSER REQUEST:\n${userPrompt}`
        : userPrompt;

      const result = await env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
        prompt,
        steps: 4,
      });

      return new Response(
        JSON.stringify({
          image: `data:image/jpeg;base64,${result.image}`,
          identityPreservation,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err) {
      return new Response(JSON.stringify({
        error: "Generation failed",
        message: err?.message || "Unknown error"
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};
