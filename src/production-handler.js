import legacyHandler from "./index.js";

const TRIAL_MODE = true;
const TRIAL_MODE_NOTICE = "Graphic Fiction AI is currently in free beta/trial mode.";
const TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const ENHANCE_MODEL = "@cf/runwayml/stable-diffusion-v1-5-img2img";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-GFA-Client-ID"
};

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{...CORS,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}
function clean(v,max=4000){ return String(v ?? "").replace(/\u0000/g,"").trim().slice(0,max); }
function textOf(r){ return String(r?.response ?? r?.choices?.[0]?.message?.content ?? r?.choices?.[0]?.text ?? "").trim(); }
async function withTimeout(p,ms){
  let timer;
  try { return await Promise.race([p,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error("AI request timed out.")),ms))]); }
  finally { clearTimeout(timer); }
}
async function runText(env,messages,maxTokens=256){
  const result=await withTimeout(env.AI.run(TEXT_MODEL,{messages,max_tokens:maxTokens,temperature:0.35,top_p:0.85}),12000);
  const text=textOf(result);
  if(!text) throw new Error("AI returned an empty response.");
  return text;
}
function chatMessages(incoming){
  const valid=(Array.isArray(incoming)?incoming:[])
    .filter(m=>m&&(m.role==="user"||m.role==="assistant")&&typeof m.content==="string")
    .map(m=>({role:m.role,content:clean(m.content,1400)}))
    .filter(m=>m.content).slice(-6);
  let total=0,out=[];
  for(let i=valid.length-1;i>=0;i--){
    if(total+valid[i].content.length>5000 && out.length>=2) break;
    out.unshift(valid[i]); total+=valid[i].content.length;
  }
  return out;
}
const EGYPTIAN_SYSTEM=[
  "أنت Graphic Fiction AI.",
  "اللغة الافتراضية والأساسية: العربية المصرية الطبيعية، مش الفصحى. اتكلم بالمصري بشكل احترافي وواضح.",
  "لو المستخدم كتب بلغة أخرى، رد بنفس اللغة. ما تخلطش لغات بدون سبب.",
  "خليك مباشر ومختصر، وركز على التصميم والبراندنج والصور والبرومبتات والتسويق.",
  "لو السؤال محتاج خطوات، اكتبها مرقمة وواضحة."
].join(" ");

async function handleChat(request,env){
  try{
    const body=await request.json();
    const messages=chatMessages(body?.messages);
    if(!messages.length) return json({error:"Missing messages",trialMode:TRIAL_MODE},400);
    const result=await runText(env,[{role:"system",content:EGYPTIAN_SYSTEM},...messages],256);
    return json({text:result,trialMode:TRIAL_MODE,trialNotice:TRIAL_MODE_NOTICE});
  }catch(error){
    console.error("chat",error);
    return json({error:"الدردشة حصل فيها عطل مؤقت. جرّب تاني.",details:clean(error?.message||error,220),retryable:true,trialMode:TRIAL_MODE},503);
  }
}

async function handleAssistant(request,env){
  try{
    const body=await request.json();
    const type=clean(body?.type||"Brand",50);
    const idea=clean(body?.idea,900);
    const tone=clean(body?.tone||"Modern",80);
    if(!idea) return json({error:"Missing design idea",trialMode:TRIAL_MODE},400);

    const system=[
      "أنت Creative Director محترف داخل Graphic Fiction AI، ومهمتك إعطاء خطة تصميم عملية يستطيع المصمم تنفيذها فوراً.",
      "اللغة: العربية المصرية الطبيعية. استخدم English فقط لأسماء الخطوط أو المصطلحات التصميمية الضرورية.",
      "ممنوع التكرار والحشو واختراع معلومات عن البراند، وممنوع كلمات غير مفهومة مثل styyl.",
      "لو معلومة غير موجودة، اعمل افتراض تصميمي منطقي واذكره بوضوح كـ(افتراض).",
      "لا تقل إن البراند فاخر أو عالمي أو صحي أو غير ذلك إلا إذا ذكره المستخدم.",
      "الألوان لازم تكون محددة بأسماء واضحة وHEX، من 3 إلى 5 ألوان فقط.",
      "الخطوط: اقترح خطين كحد أقصى مع سبب قصير.",
      "التكوين لازم يوضح مكان العنصر الرئيسي، العنوان، اللوجو، الكوبي، وCTA.",
      "لو المحتوى بوست سوشيال، اذكر المقاس المناسب مثل 1080×1350 عند الحاجة.",
      "اكتب إجابة قصيرة لكن مفيدة، بدون مقدمة عامة أو خاتمة تسويقية.",
      "استخدم هذا الشكل بالضبط: 1) الفكرة 2) الستايل 3) الألوان 4) الخطوط 5) ترتيب العناصر 6) الكوبي المقترح 7) التنفيذ"
    ].join("\n");

    const userPrompt=[
      "نوع المشروع: "+type,
      "الفكرة/طلب العميل: "+idea,
      "التون المطلوب: "+tone,
      "",
      "حوّل الطلب لخطة تصميم محددة وقابلة للتنفيذ. لا تضف معلومات غير مذكورة عن النشاط أو البراند."
    ].join("\n");

    const result=await runText(env,[
      {role:"system",content:system},
      {role:"user",content:userPrompt}
    ],420);

    return json({text:result,trialMode:TRIAL_MODE,trialNotice:TRIAL_MODE_NOTICE});
  }catch(error){
    console.error("assistant",error);
    return json({error:"مساعد التصميم حصل فيه عطل مؤقت. جرّب تاني.",details:clean(error?.message||error,220),retryable:true,trialMode:TRIAL_MODE},503);
  }
}

function decodeBase64(s){
  const b=atob(s), bytes=new Uint8Array(b.length);
  for(let i=0;i<b.length;i++) bytes[i]=b.charCodeAt(i);
  return bytes;
}
function encodeBase64(bytes){
  let s="",chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk) s+=String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)));
  return btoa(s);
}
async function handleEnhance(request,env){
  try{
    const body=await request.json();
    const data=String(body?.image||"");
    const mode=Math.max(0,Math.min(7,Number(body?.mode||0)));
    const m=data.match(/^data:image\/[^;]+;base64,(.+)$/);
    if(!m) return json({error:"Please upload a valid image.",trialMode:TRIAL_MODE},400);
    const b64=m[1];
    if(b64.length>10*1024*1024) return json({error:"الصورة كبيرة. الحد الأقصى 7MB تقريباً.",trialMode:TRIAL_MODE},413);
    const prompts=[
      "restore clarity and fine detail naturally",
      "remove compression artifacts and improve clarity",
      "recover fine detail and sharpness",
      "strong detail recovery while preserving the original",
      "clean professional product detail",
      "improve portrait clarity and natural skin detail",
      "clean product edges and material texture",
      "stronger clarity and detail recovery"
    ];
    const result=await withTimeout(env.AI.run(ENHANCE_MODEL,{
      prompt:"Enhance this exact image: "+prompts[mode]+". Preserve the same person, face, identity, body proportions, pose, composition, colors, clothing, objects and background. Do not redesign or invent content.",
      negative_prompt:"different person, changed identity, changed face, altered facial features, changed body proportions, long neck, oversized head, distorted hands, extra fingers, extra limbs, new objects, text, watermark, cartoon, painting, oversaturated",
      image_b64:b64,
      num_steps:8,
      strength:0.10+mode*0.015,
      guidance:6.0
    }),30000);
    const bytes=result instanceof ReadableStream
      ? new Uint8Array(await new Response(result).arrayBuffer())
      : new Uint8Array(result);
    if(!bytes.length) throw new Error("Enhancer returned no image.");
    return json({image:"data:image/png;base64,"+encodeBase64(bytes),mode,trialMode:TRIAL_MODE,trialNotice:TRIAL_MODE_NOTICE});
  }catch(error){
    console.error("enhancer",error);
    return json({error:"تحسين الصورة فشل. جرّب صورة أصغر أو جرّب تاني.",details:clean(error?.message||error,260),retryable:true,trialMode:TRIAL_MODE},503);
  }
}

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==="OPTIONS") return new Response(null,{headers:CORS});
    if(url.pathname==="/api/health"&&request.method==="GET") return json({ok:true,service:"Graphic Fiction AI",ai:!!env.AI,trialMode:TRIAL_MODE});
    if(url.pathname==="/api/chat"&&request.method==="POST") return handleChat(request,env);
    if(url.pathname==="/api/design-assistant"&&request.method==="POST") return handleAssistant(request,env);
    if(url.pathname==="/api/image-enhance"&&request.method==="POST") return handleEnhance(request,env);
    return legacyHandler.fetch(request,env,ctx);
  }
};
