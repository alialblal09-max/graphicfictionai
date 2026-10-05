import legacyHandler from "./index.js";

const TRIAL_MODE = true;
const TRIAL_MODE_NOTICE = "Graphic Fiction AI is currently in free beta/trial mode.";
const TEXT_MODEL = "@cf/meta/llama-3.2-3b-instruct";
const DESIGN_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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
async function runText(env,messages,maxTokens=256,options={}){
  const model=options.model||TEXT_MODEL;
  const timeout=options.timeout??12000;
  const result=await withTimeout(env.AI.run(model,{
    messages,
    max_tokens:maxTokens,
    temperature:options.temperature??0.35,
    top_p:options.top_p??0.85,
    ...(options.response_format?{response_format:options.response_format}: {})
  }),timeout);
  const text=textOf(result);
  if(!text) throw new Error("AI returned an empty response.");
  return text;
}
const DESIGN_SCHEMA={
  type:"object",
  properties:{
    idea:{type:"string"},
    style:{type:"string"},
    colors:{type:"array",minItems:3,maxItems:5,items:{type:"string"}},
    fonts:{type:"array",minItems:1,maxItems:2,items:{type:"string"}},
    layout:{type:"array",minItems:3,maxItems:5,items:{type:"string"}},
    copy:{type:"string"},
    execution:{type:"array",minItems:3,maxItems:5,items:{type:"string"}}
  },
  required:["idea","style","colors","fonts","layout","copy","execution"],
  additionalProperties:false
};

function parseJsonObject(text){
  const raw=String(text||"").trim().replace(/^```json\s*/i,"").replace(/^```\s*/,"").replace(/\s*```$/,"").trim();
  try{return JSON.parse(raw);}catch{}
  const first=raw.indexOf("{"), last=raw.lastIndexOf("}");
  if(first>=0&&last>first)return JSON.parse(raw.slice(first,last+1));
  throw new Error("AI returned invalid JSON.");
}
function normalizeList(value){
  return (Array.isArray(value)?value:[value]).map(v=>String(v??"").trim()).filter(Boolean);
}
function normalizeDesignJson(data){
  const colors=normalizeList(data?.colors).slice(0,5).map(v=>{
    const m=v.match(/#(?:[0-9A-Fa-f]{6})\b/);
    const hex=m?m[0]:"";
    const name=v.replace(/[-—:]?\s*#(?:[0-9A-Fa-f]{6})\b/g,"").replace(/^[-*]\s*/,"").trim();
    return hex&&name?"- "+name+" — "+hex:v;
  });
  const fonts=normalizeList(data?.fonts).slice(0,2).map(v=>"- "+v.replace(/^[-*]\s*/,"").trim());
  const layout=normalizeList(data?.layout).slice(0,5).map(v=>"- "+v.replace(/^[-*]\s*/,"").trim());
  const execution=normalizeList(data?.execution).slice(0,5).map(v=>"- "+v.replace(/^[-*]\s*/,"").trim());
  return [
    "1) الفكرة:\n"+String(data?.idea||"").trim(),
    "2) الستايل:\n"+String(data?.style||"").trim(),
    "3) الألوان:\n"+colors.join("\n"),
    "4) الخطوط:\n"+fonts.join("\n"),
    "5) ترتيب العناصر:\n"+layout.join("\n"),
    "6) الكوبي المقترح:\n"+String(data?.copy||"").trim(),
    "7) التنفيذ:\n"+execution.join("\n")
  ].join("\n\n").trim();
}

function designAssistantNeedsRepair(text){
  const t=String(text||"");
  const required=["1) الفكرة:","2) الستايل:","3) الألوان:","4) الخطوط:","5) ترتيب العناصر:","6) الكوبي المقترح:","7) التنفيذ:"];
  if(!required.every(h=>t.includes(h)))return true;
  const colors=(t.match(/3\) الألوان:[\s\S]*?(?=\n\n4\) الخطوط:|$)/)||[""])[0];
  const fonts=(t.match(/4\) الخطوط:[\s\S]*?(?=\n\n5\) ترتيب العناصر:|$)/)||[""])[0];
  const layout=(t.match(/5\) ترتيب العناصر:[\s\S]*?(?=\n\n6\) الكوبي المقترح:|$)/)||[""])[0];
  const copy=(t.match(/6\) الكوبي المقترح:[\s\S]*?(?=\n\n7\) التنفيذ:|$)/)||[""])[0];
  const execution=(t.match(/7\) التنفيذ:[\s\S]*$/)||[""])[0];
  if(!/#(?:[0-9A-Fa-f]{6})\b/.test(colors))return true;
  if((fonts.match(/(^|\n)-/g)||[]).length<1)return true;
  if((layout.match(/(^|\n)-/g)||[]).length<3)return true;
  if(copy.replace(/6\) الكوبي المقترح:/,"").trim().length<8)return true;
  if((execution.match(/(^|\n)-/g)||[]).length<3)return true;
  return false;
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

    const schemaResponse={type:"json_schema",json_schema:{name:"graphic_fiction_design_plan",strict:true,schema:DESIGN_SCHEMA}};
    const structuredSystem=[
      "أنت Creative Director محترف داخل Graphic Fiction AI.",
      "اكتب المحتوى بالعربية المصرية الطبيعية. استخدم English فقط لأسماء الخطوط أو المصطلحات التصميمية الضرورية.",
      "لا تخترع معلومات غير موجودة في طلب المستخدم.",
      "أرجع JSON فقط مطابقاً للـschema. ممنوع Markdown وممنوع عناوين مرقمة.",
      "idea: فكرة بصرية محددة.",
      "style: معالجة بصرية تشمل الإضاءة والخلفية والجو العام.",
      "colors: من 3 إلى 5 عناصر، وكل عنصر يجب أن يحتوي اسم اللون وكود HEX سداسي.",
      "fonts: من 1 إلى 2 عنصر، وكل عنصر: اسم الخط — الحجم — الاستخدام.",
      "layout: من 3 إلى 5 عناصر، وكل عنصر: العنصر — المكان — الحجم أو النسبة.",
      "copy: من 1 إلى 3 جمل إعلانية طبيعية وقصيرة.",
      "execution: من 3 إلى 5 خطوات عملية تبدأ بأفعال واضحة.",
      "لو المشروع Instagram post استخدم 1080×1350 ما لم يطلب المستخدم مقاساً آخر."
    ].join("\n");
    const userPrompt=["نوع المشروع: "+type,"الفكرة/طلب العميل: "+idea,"التون المطلوب: "+tone].join("\n");
    let structured;
    try{
      const raw=await runText(env,[{role:"system",content:structuredSystem},{role:"user",content:userPrompt}],650,{model:DESIGN_MODEL,temperature:0.05,top_p:0.70,timeout:20000,response_format:schemaResponse});
      structured=normalizeDesignJson(parseJsonObject(raw));
    }catch(firstError){
      const raw=await runText(env,[{role:"system",content:structuredSystem+"\nأخرج JSON صحيحاً فقط بدون أي شرح."},{role:"user",content:userPrompt+"\nأعد المحاولة من البداية مع الالتزام الكامل بالـJSON schema."}],650,{model:DESIGN_MODEL,temperature:0.02,top_p:0.60,timeout:20000,response_format:{type:"json_object"}});
      structured=normalizeDesignJson(parseJsonObject(raw));
    }
    if(designAssistantNeedsRepair(structured))throw new Error("Design assistant produced an invalid structured plan.");
    return json({text:structured,trialMode:TRIAL_MODE,trialNotice:TRIAL_MODE_NOTICE});

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
