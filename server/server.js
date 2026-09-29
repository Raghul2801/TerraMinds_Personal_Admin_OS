// Backend: LLM gateway with guardrails + state persistence + report storage/email
const express=require("express"),cors=require("cors"),fs=require("fs"),path=require("path");
const app=express();app.use(cors());app.use(express.json({limit:"10mb"}));
const OLLAMA=process.env.OLLAMA||"http://localhost:11434",MODEL=process.env.MODEL||"qwen2.5:3b",DB=path.join(__dirname,"db.json");
/* ---- LLM safety guardrails ---- */
const BAD=/ignore (all|previous)|system prompt|https?:\/\/|<script|password|otp|cvv/i;
const mask=s=>String(s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g,"[email]").replace(/\b\d{10}\b/g,"[phone]").slice(0,2000);
const hits={};const limited=ip=>{const n=Date.now(),a=(hits[ip]=(hits[ip]||[]).filter(t=>n-t<60000));a.push(n);return a.length>30};
app.get("/api/health",async(q,s)=>{try{const d=await(await fetch(OLLAMA+"/api/tags")).json();s.json({llm:d.models.some(m=>m.name.startsWith(MODEL.split(":")[0])),model:MODEL})}catch(e){s.json({llm:false,model:MODEL})}});
app.post("/api/llm",async(q,s)=>{
 if(limited(q.ip))return s.status(429).json({error:"rate limited"});
 const {sys,user,json=true}=q.body||{};
 if(!sys||!user)return s.status(400).json({error:"bad request"});
 const safe=mask(user);                                   // PII masking + size limit
 if(BAD.test(safe))return s.status(422).json({error:"prompt-injection blocked"});
 try{const r=await fetch(OLLAMA+"/api/chat",{method:"POST",body:JSON.stringify({model:MODEL,stream:false,format:json?"json":undefined,options:{temperature:.2,num_predict:300},messages:[{role:"system",content:sys},{role:"user",content:safe}]})});
  const d=await r.json();let out=String(d.message.content).slice(0,1200);
  if(BAD.test(out))return s.status(422).json({error:"unsafe output blocked"});   // output filter
  if(json)out=JSON.parse(out);                                                   // schema: must be valid JSON
  s.json({out,tokens:(d.prompt_eval_count||0)+(d.eval_count||0)})}catch(e){s.status(502).json({error:"llm unavailable"})}});
/* ---- state + reports ---- */
app.get("/api/state",(q,s)=>{try{s.json(JSON.parse(fs.readFileSync(DB)))}catch(e){s.json({})}});
app.put("/api/state",(q,s)=>{fs.writeFileSync(DB,JSON.stringify(q.body));s.json({ok:true})});
app.post("/api/reports",async(q,s)=>{
 const {file,data,to}=q.body||{};if(!file||!data)return s.status(400).json({error:"bad request"});
 const dir=path.join(__dirname,"reports");fs.mkdirSync(dir,{recursive:true});const f=path.join(dir,path.basename(file));
 fs.writeFileSync(f,Buffer.from(data.split(",").pop(),"base64"));let mailed=false;
 if(process.env.SMTP_HOST){try{const tr=require("nodemailer").createTransport({host:process.env.SMTP_HOST,port:587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});
  await tr.sendMail({from:process.env.SMTP_USER,to:(to||[]).join(","),subject:"Admin OS agent report",text:"Please review and validate the attached report.",attachments:[{filename:path.basename(file),path:f}]});mailed=true}catch(e){}}
 s.json({saved:true,mailed})});
app.listen(8787,()=>console.log("API on http://localhost:8787  model="+MODEL));
