
import {useState,useRef,useEffect} from "react";
import {jsPDF} from "jspdf";
/* ===== LOCAL LLM (Ollama) ===== */
const OLLAMA="http://localhost:11434", MODEL="qwen2.5:3b";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ping(){try{const d=await(await fetch("/api/health")).json();window.__api=true;return !!d.llm}catch(e){return pingDirect()}}
async function pingDirect(){try{const r=await fetch(OLLAMA+"/api/tags");const d=await r.json();return d.models.some(m=>m.name.startsWith(MODEL.split(":")[0]))}catch(e){return false}}
async function llm(sys,user,json=true){
 if(window.__api){try{const r=await fetch("/api/llm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sys,user,json})});return r.ok?await r.json():null}catch(e){}}
 return llmDirect(sys,user,json)}
async function llmDirect(sys,user,json=true){
 try{const c=new AbortController();const to=setTimeout(()=>c.abort(),45000);
  const r=await fetch(OLLAMA+"/api/chat",{method:"POST",signal:c.signal,body:JSON.stringify({model:MODEL,stream:false,format:json?"json":undefined,options:{temperature:.2},messages:[{role:"system",content:sys},{role:"user",content:user}]})});
  clearTimeout(to);const d=await r.json();const t=d.message.content;
  return {out:json?JSON.parse(t):t,tokens:(d.prompt_eval_count||0)+(d.eval_count||0)};
 }catch(e){return null}
}
/* ===== DATA ===== */
const TODAY=new Date("2026-09-29"),expired=d=>new Date(d)<TODAY;
const ICON={fee:"💳",exam:"📝",warranty:"🛡️"},LBL={fee:"Fee portal",exam:"Exam forms",warranty:"Warranties"};
const mk=()=>[
 {id:1,type:"fee",title:"Semester fee — ₹42,500",due:"2026-10-01",hard:true,status:"pending",keys:["Student ID","Amount","Payment method"]},
 {id:2,type:"exam",title:"End-sem exam form",due:"2026-10-05",status:"pending",keys:["Full name","Roll no.","Subjects"]},
 {id:3,type:"exam",title:"Hostel no-dues form",due:"2026-10-06",status:"pending",keys:["Room","Dues cleared"]},
 {id:4,type:"warranty",title:"Laptop warranty — Dell XPS",due:"2026-08-12",status:"pending",keys:["Serial","Expiry"]},
 {id:5,type:"warranty",title:"Phone warranty — Galaxy S24",due:"2027-03-01",status:"pending",keys:["IMEI","Expiry"]}];
const fallback=(t,u)=>Object.fromEntries(t.keys.map(k=>[k,{"Student ID":u.roll,"Amount":"₹42,500","Payment method":"UPI","Full name":u.name,"Roll no.":u.roll,"Subjects":"6 core subjects","Room":"B-214","Dues cleared":"Yes (₹0)","Serial":"DL-"+u.roll.slice(-4)+"88","IMEI":"3562 0981","Expiry":t.due}[k]||"—"]));
const SEED=[
 {name:"Aarav Kumar",email:"demo@student.com",pw:"demo123",roll:"CS23B014",course:"B.Tech CSE",tasks:mk(),used:0,tokens:0,bonus:0,notes:[]},
 {name:"Meera Iyer",email:"meera@student.com",pw:"meera123",roll:"EC23B102",course:"B.Tech ECE",tasks:mk().map(t=>({...t,status:t.id===4?"reminded":"done"})),used:0,tokens:1900,bonus:0,notes:[]},
 {name:"Rohan Das",email:"rohan@student.com",pw:"rohan123",roll:"ME23B057",course:"B.Tech ME",tasks:mk(),used:0,tokens:1900,bonus:0,notes:[]}];
const INITDB={users:SEED,cap:2000,portals:{fee:true,exam:true,warranty:true},log:[],reports:[],mails:[]};
const TAGS={pending:["t-mu","Queued"],done:["t-ok","Completed"],deferred:["t-wa","Deferred"],reminded:["t-er","Renew needed"]};
const hi=()=>{const h=new Date().getHours();return h<12?"Good morning":h<17?"Good afternoon":"Good evening"};

/* ===== GUARDRAILS: code-enforced policies around the LLM ===== */
const G={last:0,busy:0,events:[],
 note(m,log){this.events.push(m);log&&log("GUARDRAIL "+m)},
 allow(t){return ["fee","exam","warranty"].includes(t.type)&&!/^https?:/i.test(t.portal||"")},
 clean(v,max=60){return String(v==null?"":v).replace(/[<>{}`]/g,"").replace(/\s+/g," ").trim().slice(0,max)},
 bad(v){return /ignore (all|previous)|system prompt|https?:\/\/|<script|password|otp|cvv/i.test(v)},
 msg(m){if(!m)return "";m=this.clean(m,220);if(this.bad(m)){this.note("Unsafe reminder text rejected");return ""}return m},
 plan(o,pending,log){
  let ord=null;
  if(o&&Array.isArray(o.order)){const ids=o.order.map(Number);if(ids.length===pending.length&&new Set(ids).size===ids.length&&ids.every(i=>pending.some(t=>t.id===i)))ord=ids.map(i=>pending.find(t=>t.id===i))}
  if(!ord){if(o)this.note("LLM plan invalid — deterministic plan used",log);ord=[...pending].sort((a,b)=>a.due.localeCompare(b.due))}
  const s=[...ord].sort((a,b)=>(b.hard?1:0)-(a.hard?1:0));
  if(s.some((t,i)=>t!==ord[i]))this.note("Hard deadline moved to front (policy)",log);
  return s},
 form(t,u,o,log){
  const fb=fallback(t,u),pin={"Student ID":u.roll,"Roll no.":u.roll,"Full name":u.name,"Amount":"₹42,500","Payment method":"UPI","Expiry":t.due},out={};
  t.keys.forEach(k=>{let v=o?this.clean(o[k]):"";
   if(k in pin){if(v&&v!==pin[k])this.note(k+" pinned to verified value (LLM said \""+v+"\")",log);v=pin[k]}
   else if(!v||this.bad(v)){if(o)this.note(k+" invalid — fallback used",log);v=fb[k]}
   out[k]=v});return out},
 signup(f){
  if(!/^[A-Za-z][A-Za-z .'-]{1,39}$/.test(f.name))return "Enter a valid name (letters only)";
  if(!/^[A-Z]{2}\d{2}[A-Z]\d{3}$/i.test(f.roll))return "Roll no. format: CS23B014";
  if(!/^\S+@\S+\.\S+$/.test(f.email))return "Enter a valid email";
  if(f.pw.length<6)return "Password needs 6+ characters";
  if(/https?:|<|>/.test(f.course)||f.course.length>40)return "Invalid course";return ""}
};
function makeReport(u,d){
 const doc=new jsPDF();let y=42;
 const P=(s,sz=11,b=false,c=[30,30,50])=>{doc.setFontSize(sz);doc.setFont("helvetica",b?"bold":"normal");doc.setTextColor(...c);doc.splitTextToSize(String(s).replace(/₹/g,"Rs.").replace(/→/g,"->"),175).forEach(l=>{if(y>280){doc.addPage();y=20}doc.text(l,17,y);y+=sz*0.45+2.5})};
 doc.setFillColor(109,76,245);doc.rect(0,0,210,30,"F");doc.setTextColor(255,255,255);doc.setFontSize(20);doc.text("Admin OS - Agent Report",17,19);
 P("Student: "+u.name+" ("+u.roll+", "+u.course+")",12,true);
 P("Generated: "+new Date().toLocaleString()+"   Model: "+MODEL);
 P("Tokens used: "+u.tokens+" / "+(d.cap+(u.bonus||0))+" (daily cap)");y+=4;
 P("Workflow",14,true,[109,76,245]);(u.wf||[]).forEach(s=>P((s.st==="done"?"[OK] ":"[WAITING] ")+s.l+": "+String(s.note).replace(/₹/g,"Rs."),10));y+=4;
 P("Task summary",14,true,[109,76,245]);
 u.tasks.forEach(t=>{P("["+({done:"DONE",reminded:"RENEWAL REQUESTED",deferred:"DEFERRED",pending:"QUEUED"})[t.status]+"] "+t.title+" (due "+t.due+")",11,true);
  if(t.values)P("   "+Object.entries(t.values).map(([k,v])=>k+": "+v).join(" | "),10);
  if(t.why)P("   Reason: "+t.why,10,false,[224,64,90])});
 y+=4;P("Reminders sent",14,true,[109,76,245]);
 (u.notes.length?u.notes:[{m:"None"}]).forEach(n=>P("- "+n.m,10));y+=4;
 P("Agent activity (latest)",14,true,[109,76,245]);
 d.log.slice(0,12).reverse().forEach(l=>P("["+l.t+"] "+l.m,9));y+=6;
 P("Guardrail audit",14,true,[109,76,245]);(G.events.length?G.events:["No violations - all LLM outputs passed validation."]).forEach(e=>P("- "+e,10));P("Deferred items listed: "+u.tasks.filter(t=>t.status==="deferred").length+" (none hidden). Real university portals: NOT accessed (mock only). Cap enforced in code.",10);y+=4;
 P("HUMAN VALIDATION REQUIRED: review this report and approve or flag it.",10,true,[232,137,26]);
 return {doc,file:"AdminOS_Report_"+u.roll+"_"+Date.now()+".pdf",data:doc.output("datauristring")};
}
function App(){
 const [db,setDb]=useState(()=>{try{return JSON.parse(localStorage.getItem("aos4"))||INITDB}catch(e){return INITDB}});
 const [me,setMe]=useState(null);const [live,setLive]=useState(null);const [ok,setOk]=useState(null);const [toast,setToast]=useState("");
 const ref=useRef(db);ref.current=db;
 const [portal,setPortal]=useState(location.hash.slice(1)||null);
 const go=k=>{location.hash=k;setPortal(k)};
 useEffect(()=>{try{localStorage.setItem("aos4",JSON.stringify(db))}catch(e){}},[db]);
 useEffect(()=>{ping().then(setOk);fetch("/api/state").then(r=>r.json()).then(d=>{if(d&&d.users&&d.users.length)setDb(d);window.__sync=true}).catch(()=>{})},[]);
 useEffect(()=>{if(!window.__sync||!window.__api)return;const t=setTimeout(()=>fetch("/api/state",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(db)}).catch(()=>{}),600);return()=>clearTimeout(t)},[db]);
 const say=m=>{setToast(m);setTimeout(()=>setToast(""),3000)};
 const patch=(email,fn)=>setDb(d=>({...d,users:d.users.map(u=>u.email===email?fn(u):u)}));
 const addLog=m=>setDb(d=>({...d,log:[{t:new Date().toLocaleTimeString(),m},...d.log].slice(0,80)}));
 const getU=e=>ref.current.users.find(u=>u.email===e);
 const upd=(e,id,p)=>patch(e,u=>({...u,tasks:u.tasks.map(t=>t.id===id?{...t,...p}:t)}));

 /* ===== THE AGENT: runs automatically after sign-up / sign-in ===== */
 async function agent(email){
  const u0=getU(email);if(!u0)return;
  if(Date.now()-G.busy<180000||Date.now()-G.last<8000){addLog("GUARDRAIL run throttled (no constant pinging)");return}
  G.last=Date.now();G.busy=Date.now();G.events=[];
  const EST={fee:700,exam:500,warranty:400},cap=()=>ref.current.cap+(getU(email).bonus||0),tm=()=>new Date().toLocaleTimeString();
  const W={stages:[["fee","Fee portal"],["exam","Exam forms"],["warranty","Warranty"],["remind","Reminders"]].map(([k,l])=>({k,l,st:"wait",note:""})),cur:-1,title:"",fields:[],n:0,submit:false,done:false};
  const show=()=>setLive({...W,stages:W.stages.map(s=>({...s}))});
  const note=m=>patch(email,u=>({...u,notes:[{m,t:tm()},...u.notes]}));
  addLog(u0.name+" signed in — agent woke up");
  const fee0=u0.tasks.find(t=>t.type==="fee"),d0=fee0?Math.ceil((new Date(fee0.due)-TODAY)/864e5):99;
  if(fee0&&fee0.status!=="done"&&d0<=3){note("⏰ Exam fee due in "+d0+" day(s) — complete payment before "+fee0.due+". Your agent is processing it now.");addLog("DEADLINE ALERT fee due in "+d0+" day(s)")}
  const waited=[];show();await sleep(900);
  for(let i=0;i<4;i++){
   const st=W.stages[i],k=st.k;W.cur=i;st.st="active";W.title="";W.fields=[];W.n=0;show();await sleep(700);
   let ok_=0,def=0,ren=[],msgs=0;
   if(k!=="remind"){
    for(const t of getU(email).tasks.filter(t=>t.type===k&&(t.status==="pending"||t.status==="deferred"))){
     const d=ref.current,cur=getU(email);
     if(!G.allow(t)){G.note("Blocked non-allowlisted portal: "+t.title,addLog);continue}
     if(!d.portals[k]){upd(email,t.id,{status:"deferred",why:"Portal closed by admin"});def++;addLog("DEFERRED "+t.title+" — portal closed");continue}
     if(cur.tokens+EST[k]>cap()){upd(email,t.id,{status:"deferred",why:"Daily token cap reached"});def++;waited.push(t.title);addLog("DEFERRED "+t.title+" — token cap");continue}
     W.title=t.title;W.fields=t.keys.map(x=>[x,""]);W.n=0;show();
     const r=await llm('You fill web forms for a student. Reply JSON with exactly these keys: '+t.keys.join(", "),"Student: "+JSON.stringify({name:cur.name,roll:cur.roll,course:cur.course})+". Form: "+t.title);
     setOk(!!r);const vals=G.form(t,cur,r&&r.out,addLog),f=t.keys.map(x=>[x,vals[x]]);W.fields=f;
     for(let j=1;j<=f.length;j++){W.n=j;show();await sleep(550)}
     W.submit=true;show();await sleep(700);W.submit=false;
     const tk=Math.max(EST[k],r?r.tokens:0);patch(email,u=>({...u,tokens:u.tokens+tk}));
     if(k==="warranty"&&expired(t.due)){upd(email,t.id,{status:"reminded",values:vals});ren.push(t.title.split("— ")[1]);addLog("RENEWAL FILED "+t.title)}
     else{upd(email,t.id,{status:"done",values:vals,why:null});ok_++;addLog((k==="warranty"?"STORED ":"SUBMITTED ")+t.title)}
     await sleep(80);
    }
    st.note=k==="fee"&&ok_?"Fee paid ₹42,500 · receipt #FR"+String(Date.now()).slice(-6):[ok_&&ok_+" submitted",ren.length&&"renewal filed: "+ren.join(", "),def&&def+" waiting (listed)"].filter(Boolean).join(" · ")||"Already completed";
    st.st=def&&!ok_&&!ren.length?"skip":"done";
   }else{
    const u=getU(email),fee=u.tasks.find(t=>t.type==="fee"),out=[];
    if(fee&&fee.status!=="done")out.push("⏰ Exam fee is due "+fee.due+" — please complete the payment.");
    for(const t of u.tasks.filter(t=>t.status==="reminded")){
     let m="";if(getU(email).tokens+250<=cap()){const r=await llm('Write a short friendly reminder. Reply JSON {"message":"..."}',t.title+" expired on "+t.due+". Ask the student to renew; a renewal request is already filed.");m=G.msg(r&&r.out&&r.out.message);if(r)patch(email,x=>({...x,tokens:x.tokens+Math.max(250,r.tokens)}))}
     out.push("🛡️ "+(m||t.title+" expired on "+t.due+" — renewal request filed. Please renew your warranty."))}
    if(waited.length){out.push("🔋 Daily token cap reached. Renew tokens to process: "+waited.join(", ")+".");patch(email,x=>({...x,tokenOut:true}));say("🔋 Token cap reached — renew tokens")}
    out.forEach(m=>{note(m);addLog("REMINDER "+m.slice(0,60))});msgs=out.length;
    st.note=msgs?msgs+" notification(s) sent":"No reminders needed";st.st="done";await sleep(80);
   }
   W.title="";W.fields=[];show();await sleep(800);
  }
  patch(email,u=>({...u,wf:W.stages.map(s=>({k:s.k,l:s.l,st:s.st,note:s.note}))}));
  W.cur=-1;W.done=true;show();await finish(email);await sleep(900);
  setLive(null);G.busy=0;say("Workflow complete · report downloaded & emailed");
 }
 const renew=e=>{patch(e,u=>({...u,bonus:(u.bonus||0)+1500,tokenOut:false,notes:[{m:"🔋 Tokens renewed (+1,500). Resuming waiting tasks…",t:new Date().toLocaleTimeString()},...u.notes]}));addLog("TOKENS RENEWED for "+e);G.last=0;G.busy=0;setTimeout(()=>agent(e),500)};
 const finish=async e=>{
  await sleep(400);const d=ref.current,u=getU(e),rp=makeReport(u,d);
  try{rp.doc.save(rp.file)}catch(x){}
  const id=Date.now(),t=new Date().toLocaleString();
  setDb(x=>({...x,reports:[{id,email:e,name:u.name,file:rp.file,data:rp.data,t,status:"pending"},...(x.reports||[])],
   mails:[{id:id+1,to:e,subject:"Your agent report — "+t,body:"Hi "+u.name+", your agent finished all work automatically. Please review the attached report and validate the data.",rid:id,t},{id:id+2,to:"admin@finexa.com",subject:"Agent report: "+u.name+" ("+u.roll+")",body:"Automated copy of the student's report. Validation pending.",rid:id,t},...(x.mails||[])]}));
  addLog("REPORT generated, downloaded & emailed → "+u.name+" + admin");
  fetch("/api/reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:rp.file,data:rp.data,to:[e,"admin@finexa.com"]})}).catch(()=>{});
 };
 const reset=e=>{patch(e,u=>({...u,used:0,tokens:0,bonus:0,tokenOut:false,tasks:u.tasks.map(t=>t.status==="deferred"?{...t,status:"pending",why:null}:t)}));addLog("New day — cap reset for "+e)};

 if(!me){if(portal!=="user"&&portal!=="admin")return <Landing go={go}/>;
  return <Auth db={db} setDb={setDb} ok={ok} portal={portal} back={()=>{location.hash="";setPortal(null)}} onIn={m=>{setMe(m);if(m.role==="user")setTimeout(()=>agent(m.email),300)}}/>}
 const S={db,setDb,me,ok,say,agent,reset,renew,addLog,patch,upd,getU,live};
 return <div className="frame"><div className="inner">
  {me.role==="user"?<Student S={S}/>:<Admin S={S}/>}
  <div style={{textAlign:"center",marginTop:20}}><button className="btn" onClick={()=>setMe(null)}>Sign out</button></div>
 </div>
 {live&&<Live L={live}/>}{toast&&<div className="toast">{toast}</div>}</div>;
}

function Live({L}){
 return <div className="ov"><div className="modal">
  <h2 style={{margin:0}}>🤖 Agent workflow</h2><div className="mu">{MODEL} · 🛡️ Guardrails active · one task at a time — the rest wait in the queue</div>
  <div style={{margin:"14px 0"}}>{L.stages.map((s,i)=><div key={s.k} className={"wf "+s.st}><span className="wfi">{s.st==="done"?"✓":s.st==="skip"?"!":s.st==="active"?<i className="spin"/>:i+1}</span><div><b>{s.l}</b><div className="mu">{s.st==="wait"?"Waiting in queue":s.st==="active"?(L.title||"Processing…"):s.note}</div></div></div>)}</div>
  {L.title&&L.fields.length>0&&<div><b>{L.title}</b>{L.fields.map(([k,v],i)=><div key={k} className={"fld "+(i<L.n?"f":"")}><span className="mu">{k}</span><b>{i<L.n?v:"…"}</b></div>)}<div className="mu" style={{marginTop:8}}>{L.submit?"✅ Submitting form…":"Auto-filling…"}</div></div>}
  {L.done&&<div className="up">All steps complete — generating & emailing report…</div>}
 </div></div>;
}
function WfCard({u}){
 const fee=u.tasks.find(t=>t.type==="fee"),days=Math.ceil((new Date(fee.due)-TODAY)/864e5),paid=fee.status==="done";
 const wf=u.wf||[["fee","Fee portal"],["exam","Exam forms"],["warranty","Warranty"],["remind","Reminders"]].map(([k,l])=>({k,l,st:"wait",note:"Runs automatically after sign-in"}));
 return <div className="card" style={{marginTop:16}}><div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10}}><div><h2>Workflow status</h2><div className="mu">Tasks run one after another; each gets a ✓ when complete</div></div>
  <div className="sub" style={{margin:0}}><span className="mu">Exam fee · ₹42,500</span><div><b>{paid?"Paid ✓":"Due "+fee.due+" · "+days+" day(s) left"}</b> <span className={"tag "+(paid?"t-ok":days<=3?"t-er":"t-wa")}>{paid?"Paid":days<=3?"Deadline close":"Pending"}</span></div></div></div>
  <div style={{marginTop:12}}>{wf.map((s,i)=><div key={s.k} className={"wf "+s.st}><span className="wfi">{s.st==="done"?"✓":s.st==="skip"?"!":i+1}</span><div><b>{s.l}</b><div className="mu">{s.st==="wait"?s.note||"Waiting":s.note}</div></div></div>)}</div></div>;
}
function Shell({S,tabs,tab,setTab,title,sub}){
 return <>
  <div className="nav"><div className="logo"><i>⚡</i>Admin OS</div>
   <div className="pills">{tabs.map(([k,l])=><button key={k} className={"pill "+(tab===k?"on":"")} onClick={()=>setTab(k)}>{l}</button>)}</div>
   <div className="ic" title="LLM status">{S.ok?"🟢":"🟡"}</div><div className="ic">🔔{S.me.role==="user"&&S.getU(S.me.email).notes.length>0&&<b>{S.getU(S.me.email).notes.length}</b>}</div><div className="ic" style={{fontWeight:700,color:"var(--pr)"}}>{S.me.name[0]}</div></div>
  <div className="head"><div><h1>{title}</h1><div className="mu">{sub}</div></div></div></>;
}

function AskBtn({S}){
 const [o,setO]=useState(false),[q,setQ]=useState(""),[a,setA]=useState(""),[b,setB]=useState(false);
 const u=S.getU(S.me.email);
 const go=async()=>{setB(true);setA("");const r=await llm("You are a concise student admin assistant. Answer in 2 sentences.","Tasks: "+JSON.stringify(u.tasks.map(t=>[t.title,t.status,t.due]))+"\nQuestion: "+q,false);setA(r?r.out:"Ollama offline — start it to chat.");setB(false)};
 return <><button className="btn p" onClick={()=>setO(true)}>✨ Ask Agent</button>
  {o&&<div className="ov" onClick={()=>setO(false)}><div className="modal chat" onClick={e=>e.stopPropagation()}><h2>Ask your agent</h2><div className="mu">Runs locally on {MODEL}</div>
   <input placeholder="e.g. What is still pending?" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&go()}/>
   <button className="btn p" style={{marginTop:10}} disabled={b} onClick={go}>{b?"Thinking…":"Ask"}</button>{a&&<p>{a}</p>}</div></div>}</>;
}

function Chart({vals}){
 const W=560,H=190,mx=Math.max(...vals,1),pts=vals.map((v,i)=>[20+i*(W-40)/(vals.length-1),H-25-(v/mx)*(H-50)]);
 const line=pts.map(p=>p.join(",")).join(" ");
 return <svg viewBox={"0 0 "+W+" "+H} style={{width:"100%"}}><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d4cf5" stopOpacity=".6"/><stop offset="1" stopColor="#6d4cf5" stopOpacity=".05"/></linearGradient></defs>
  <polygon points={line+" "+pts[pts.length-1][0]+","+(H-25)+" 20,"+(H-25)} fill="url(#g)"/><polyline points={line} fill="none" stroke="#6d4cf5" strokeWidth="3"/>
  {pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="4" fill="#fff" stroke="#6d4cf5" strokeWidth="2"/>)}
  {["Mon","Tue","Wed","Thu","Fri","Sat","Today"].map((d,i)=><text key={d} x={pts[i][0]} y={H-6} fontSize="11" fill="#6f7190" textAnchor="middle">{d}</text>)}</svg>;
}

const dl=r=>{const a=document.createElement("a");a.href=r.data;a.download=r.file;a.click()};
function Landing({go}){
 return <div className="frame"><div className="auth" style={{maxWidth:560}}>
  <div className="logo" style={{justifyContent:"center"}}><i>⚡</i>Admin OS</div>
  <p className="mu">Fully automated agent for fees, exam forms & warranties. Choose your portal.</p>
  <div className="grid g3">{[["user","🎓","Student portal","Sign in — the agent does the rest"],["admin","🛠️","Admin portal","Reports, inbox & policies"]].map(([k,i,t,s])=><div key={k} className="card" style={{cursor:"pointer"}} onClick={()=>go(k)}><div style={{fontSize:34}}>{i}</div><h2>{t}</h2><div className="mu">{s}</div></div>)}</div>
 </div></div>;
}
function AdminAuth({db,setDb,onIn,ok,portal,back}){
 const adm=portal==="admin";
 const [mode,setMode]=useState("in"),[f,setF]=useState({name:"",email:"",pw:"",roll:"",course:"B.Tech CSE"}),[err,setErr]=useState("");
 const set=k=>e=>setF({...f,[k]:e.target.value});
 const submit=()=>{setErr("");
  if(adm){if(f.email==="admin@finexa.com"&&f.pw==="admin123")return onIn({name:"Admin",email:f.email,role:"admin"});return setErr("Invalid admin credentials")}
  if(mode==="up"){
   if(!f.name||!f.email||!f.pw||!f.roll)return setErr("Fill all fields");
   const ve=G.signup(f);if(ve)return setErr(ve);
   if(db.users.some(u=>u.email===f.email))return setErr("Account exists — sign in");
   const u={...f,tasks:mk(),used:0,tokens:0,notes:[]};
   setDb({...db,users:[...db.users,u],log:[{t:new Date().toLocaleTimeString(),m:"New sign-up: "+f.name},...db.log]});onIn({...u,role:"user"});
  }else{const u=db.users.find(u=>u.email===f.email&&u.pw===f.pw);if(!u)return setErr("Wrong email or password");onIn({...u,role:"user"})}};
 return <div className="frame"><div className="auth">
  <div className="logo" style={{justifyContent:"center"}}><i>⚡</i>{adm?"Admin portal":"Student portal"}</div>
  <p className="mu">{adm?"Review agent reports and manage policies.":"Sign in — your agent starts automatically, no clicks needed."}</p>
  {!adm&&<div className="seg"><button className={mode==="in"?"on":""} onClick={()=>setMode("in")}>Sign in</button><button className={mode==="up"?"on":""} onClick={()=>setMode("up")}>Sign up</button></div>}
  {!adm&&mode==="up"&&<><input placeholder="Full name" value={f.name} onChange={set("name")}/><input placeholder="Roll number (e.g. CS23B014)" value={f.roll} onChange={set("roll")}/><input placeholder="Course" value={f.course} onChange={set("course")}/></>}
  <input placeholder="Email" value={f.email} onChange={set("email")}/><input type="password" placeholder="Password" value={f.pw} onChange={set("pw")}/>
  {err&&<div style={{color:"var(--er)",marginTop:10,fontSize:13}}>{err}</div>}
  <button className="btn p" style={{width:"100%",marginTop:16}} onClick={submit}>{adm?"Sign in":mode==="up"?"Create account & start agent":"Sign in & start agent"}</button>
  <p className="mu" style={{marginTop:14}}><span className="ok-dot" style={{background:ok?"var(--ok)":"var(--wa)"}}/>{ok?"Local LLM "+MODEL+" connected":"Ollama not detected — rule-based fallback"}{adm&&<><br/>Demo: admin@finexa.com / admin123</>}</p>
  <button className="btn" onClick={back}>← Switch portal</button>
 </div></div>;
}
function Auth(p){return p.portal==="user"?<StudentAuth {...p}/>:<AdminAuth {...p}/>}
const TAGS3=["Deadlines handled, automatically.","Fees, forms & warranties on autopilot.","You validate. The agent does the rest."];
function StudentAuth({db,setDb,onIn,ok,back}){
 const [mode,setMode]=useState("up"),[f,setF]=useState({first:"",last:"",email:"",pw:"",roll:"",course:"B.Tech CSE"}),[show,setShow]=useState(false),[agree,setAgree]=useState(true),[err,setErr]=useState(""),[sl,setSl]=useState(0);
 useEffect(()=>{const i=setInterval(()=>setSl(s=>(s+1)%3),3200);return()=>clearInterval(i)},[]);
 const set=k=>e=>setF({...f,[k]:e.target.value});
 const submit=()=>{setErr("");
  if(mode==="up"){
   const name=(f.first+" "+f.last).trim();
   if(!f.first||!f.last||!f.email||!f.pw||!f.roll)return setErr("Please fill all fields");
   const ve=G.signup({...f,name});if(ve)return setErr(ve);
   if(!agree)return setErr("Please accept the Terms & Conditions");
   if(db.users.some(u=>u.email===f.email))return setErr("Account already exists — log in instead");
   const u={name,email:f.email,pw:f.pw,roll:f.roll.toUpperCase(),course:f.course,tasks:mk(),used:0,tokens:0,notes:[]};
   setDb({...db,users:[...db.users,u],log:[{t:new Date().toLocaleTimeString(),m:"New sign-up: "+name},...db.log]});onIn({...u,role:"user"});
  }else{const u=db.users.find(u=>u.email===f.email&&u.pw===f.pw);if(!u)return setErr("Wrong email or password");onIn({...u,role:"user"})}};
 const up=mode==="up";
 return <div className="sa-page"><div className="sa-card">
  <div className="sa-hero">
   <svg viewBox="0 0 400 500" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7462e0"/><stop offset=".55" stopColor="#4a3d9c"/><stop offset="1" stopColor="#241a48"/></linearGradient></defs>
    <rect width="400" height="500" fill="url(#sky)"/><ellipse cx="90" cy="120" rx="70" ry="7" fill="#3a2f80" opacity=".6"/><ellipse cx="300" cy="90" rx="50" ry="5" fill="#8f80ee" opacity=".4"/>
    <path d="M0 300C80 235 170 195 255 228C330 255 372 300 400 335L400 500L0 500Z" fill="#5e4f78"/><path d="M0 300C80 235 170 195 255 228C330 255 372 300 400 335" fill="none" stroke="#a294bd" strokeWidth="1.5" opacity=".6"/>
    <path d="M0 390C100 335 210 355 295 322C345 304 380 322 400 345L400 500L0 500Z" fill="#2f2447"/><path d="M0 455C120 412 250 435 400 402L400 500L0 500Z" fill="#1c1531"/></svg>
   <div className="sa-top"><div className="sa-logo">⚡ Admin OS</div><button className="sa-back" onClick={back}>Switch portal →</button></div>
   <div className="sa-cap"><div key={sl} className="sa-tag">{TAGS3[sl]}</div><div className="sa-dash">{[0,1,2].map(i=><i key={i} className={i===sl?"on":""}/>)}</div></div>
  </div>
  <div className="sa-form" onKeyDown={e=>e.key==="Enter"&&submit()}>
   <h1>{up?"Create an account":"Welcome back"}</h1>
   <p className="sa-sub">{up?"Already have an account? ":"New to Admin OS? "}<a onClick={()=>{setMode(up?"in":"up");setErr("")}}>{up?"Log in":"Sign up"}</a></p>
   {up&&<div className="sa-row"><input placeholder="First name" value={f.first} onChange={set("first")}/><input placeholder="Last name" value={f.last} onChange={set("last")}/></div>}
   <input placeholder="Email" value={f.email} onChange={set("email")}/>
   {up&&<div className="sa-row"><input placeholder="Roll no. (CS23B014)" value={f.roll} onChange={set("roll")}/><select value={f.course} onChange={set("course")}>{["B.Tech CSE","B.Tech ECE","B.Tech ME","B.Sc","MBA"].map(c=><option key={c}>{c}</option>)}</select></div>}
   <div className="sa-pw"><input type={show?"text":"password"} placeholder="Enter your password" value={f.pw} onChange={set("pw")}/><span onClick={()=>setShow(!show)}>{show?"🙈":"👁"}</span></div>
   {up&&<label className="sa-chk"><input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)}/>I agree to the <a>Terms & Conditions</a></label>}
   {err&&<div className="sa-err">{err}</div>}
   <button className="sa-go" onClick={submit}>{up?"Create account":"Log in"}</button>
   <div className="sa-or"><i/>Or {up?"register":"sign in"} with<i/></div>
   <div className="sa-row"><button className="sa-soc" onClick={()=>setErr("Social sign-in is disabled in this demo (mock portal).")}><b style={{color:"#ea4335"}}>G</b> Google</button><button className="sa-soc" onClick={()=>setErr("Social sign-in is disabled in this demo (mock portal).")}>🍎 Apple</button></div>
   <div className="sa-llm"><span className="ok-dot" style={{background:ok?"#3ddc97":"#e8a13a"}}/>{ok?"Local LLM "+MODEL+" connected":"Ollama not detected — fallback mode"} · 🛡️ Guardrails on<br/>Demo login: demo@student.com / demo123</div>
  </div></div></div>;
}
function MailList({S,to}){
 const {db,setDb}=S;const rs=Object.fromEntries((db.reports||[]).map(r=>[r.id,r]));
 const set=(id,st)=>{setDb(d=>({...d,reports:d.reports.map(r=>r.id===id?{...r,status:st,by:S.me.name}:r)}));S.addLog("Report "+st+" by "+S.me.name)};
 const list=(db.mails||[]).filter(m=>m.to===to);
 return <div className="card" style={{marginTop:16}}><h2>📧 Mailbox — {to}</h2><div className="mu">The only human step: open the report and validate the data.</div>
  {list.length?list.map(m=>{const r=rs[m.rid];return <div className="sub" key={m.id}><b>{m.subject}</b><div className="mu">{m.t}</div><p style={{fontSize:14}}>{m.body}</p>
   {r&&<div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}><button className="btn" onClick={()=>dl(r)}>📎 {r.file.slice(0,26)}…</button><span className={"tag "+(r.status==="validated"?"t-ok":r.status==="flagged"?"t-er":"t-wa")}>{r.status}{r.by?" · "+r.by:""}</span>
   {r.status==="pending"&&<><button className="btn p" onClick={()=>set(r.id,"validated")}>✔ Validate data</button><button className="btn" onClick={()=>set(r.id,"flagged")}>⚑ Flag issue</button></>}</div>}</div>}):<p className="mu">No emails yet.</p>}</div>;
}
function Student({S}){
 const [tab,setTab]=useState("home");const u=S.getU(S.me.email),cap=S.db.cap;
 const exp=u.tasks.filter(t=>t.type==="warranty"&&expired(t.due));
 const cnt=t=>u.tasks.filter(x=>x.type===t);
 const shown=tab==="home"?u.tasks:u.tasks.filter(t=>t.type===tab);
 const trend=[900,1400,700,1800,1200,1500,u.tokens];
 const mine=(S.db.mails||[]).filter(m=>m.to===u.email).length;
 const fee=u.tasks.find(t=>t.type==="fee"),days=fee?Math.ceil((new Date(fee.due)-TODAY)/864e5):99;
 return <>
  <Shell S={S} tab={tab} setTab={setTab} title={hi()+", "+u.name.split(" ")[0]+"!"} sub="Everything runs automatically — you only validate the report emailed to you." tabs={[["home","Overview"],["fee","Fee portal"],["exam","Exam forms"],["warranty","Warranties"],["mail","Mailbox ("+mine+")"]]}/>
  {u.tokenOut&&<div className="alert"><span>🔋 Daily token cap reached — remaining tasks are waiting. Renew your tokens to continue.</span><button className="btn p" onClick={()=>S.renew(u.email)}>Renew tokens</button></div>}{fee&&fee.status!=="done"&&days<=3&&<div className="alert"><span>⏰ Exam fee due in {days} day(s) — complete payment before {fee.due}.</span></div>}{exp.map(t=><div className="alert" key={t.id}><span>⚠️ <b>{t.title}</b> expired on {t.due} — {t.status==="reminded"?"the agent sent a reminder and filed a renewal request.":"the agent will send a reminder."}</span></div>)}
  {tab==="mail"?<MailList S={S} to={u.email}/>:<>
  {tab==="home"&&<><WfCard u={u}/><div className="grid g3">
   <div className="card"><div className="mu">Daily agent cap</div><div className="big">{u.tokens}<span className="mu" style={{fontSize:20}}> / {cap+(u.bonus||0)} tokens</span></div>
    <div className="up">{u.tokens>=cap+(u.bonus||0)?"Token cap reached — rest waiting":"Within daily token budget"}</div>
    <div className="trio"><div><span className="mu">Tokens</span><b>{u.tokens.toLocaleString()}</b></div><div><span className="mu">Done</span><b>{u.tasks.filter(t=>t.status==="done").length}</b></div><div><span className="mu">Deferred</span><b>{u.tasks.filter(t=>t.status==="deferred").length}</b></div></div></div>
   <div className="card"><h2>Task Overview</h2><div className="mu">Progress per portal</div>
    {Object.keys(LBL).map(k=>{const a=cnt(k),d=a.filter(t=>t.status==="done"||t.status==="reminded").length;return <div className="sub" key={k}><div style={{display:"flex",justifyContent:"space-between"}}><span className="mu">{ICON[k]} {LBL[k]}</span><span className={"tag "+(d===a.length?"t-ok":"t-wa")}>{d===a.length?"On track":"In progress"}</span></div><b style={{fontSize:18}}>{d} / {a.length}</b><div className="bar"><i style={{width:d/a.length*100+"%",background:d===a.length?"var(--ok)":"var(--pr)"}}/></div></div>})}</div>
   <div className="card"><h2>Tasks by Status</h2><div className="mu">Where your work stands</div>
    {["done","pending","deferred","reminded"].map(s=>{const n=u.tasks.filter(t=>t.status===s).length;return <div className="cat" key={s}><i style={{width:Math.max(n/u.tasks.length*100,12)+"%"}}/><span>{TAGS[s][1]}</span><em>{n}</em></div>})}</div>
  </div>
  <div className="grid g2"><div className="card"><h2>Token Usage Trend</h2><div className="mu">Local model tokens per day</div><Chart vals={trend}/></div>
   <div className="card"><h2>Reminders</h2><div className="mu">Sent by your agent</div>{u.notes.length?u.notes.slice(0,4).map((n,i)=><div className="sub" key={i}><div style={{fontSize:14}}>{n.m}</div><div className="mu">{n.t}</div></div>):<p className="mu">No reminders yet.</p>}</div></div></>}
  <div className="card" style={{marginTop:16}}><h2>{tab==="home"?"Recent Activity":LBL[tab]}</h2><div className="mu">Every task, including deferred ones — nothing is hidden</div>
   <table style={{marginTop:12}}><thead><tr><th>Task</th><th>Category</th><th>Due</th><th>Status</th></tr></thead><tbody>
   {shown.map(t=><tr key={t.id}><td>{t.title}{t.hard&&<span className="tag t-er" style={{marginLeft:6}}>HARD</span>}<div className="mu">{t.why||(t.values?Object.values(t.values).join(" · "):"")}</div></td><td><span className="tag t-pr">{ICON[t.type]} {LBL[t.type]}</span></td><td>{t.due}</td><td><span className={"tag "+TAGS[t.status][0]}>{t.type==="fee"&&t.status==="done"?"Fee paid":TAGS[t.status][1]}</span></td></tr>)}</tbody></table></div></>}
 </>;
}
function Admin({S}){
 const [tab,setTab]=useState("home"),{db,setDb}=S,U=db.users,R=db.reports||[];
 const all=U.flatMap(u=>u.tasks),hard=all.filter(t=>t.hard);
 const st=(l,v,c)=><div className="card"><div className="mu">{l}</div><div className="big" style={{fontSize:34,color:c}}>{v}</div></div>;
 const newDay=()=>{setDb(d=>({...d,users:d.users.map(u=>({...u,used:0,tokens:0,bonus:0,tokenOut:false,tasks:u.tasks.map(t=>t.status==="deferred"?{...t,status:"pending",why:null}:t)}))}));S.say("Caps reset — deferred work re-queued for next agent run")};
 return <><Shell S={S} tab={tab} setTab={setTab} title="Admin console" sub="Agents run automatically. You receive each student's report and validate it." tabs={[["home","Overview"],["mail","Reports & Inbox ("+R.length+")"]]}/>
  {tab==="mail"?<><MailList S={S} to="admin@finexa.com"/>
   <div className="card" style={{marginTop:16,overflowX:"auto"}}><h2>All reports</h2><table style={{marginTop:10}}><thead><tr><th>Student</th><th>Generated</th><th>Status</th><th></th></tr></thead><tbody>
   {R.length?R.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.t}</td><td><span className={"tag "+(r.status==="validated"?"t-ok":r.status==="flagged"?"t-er":"t-wa")}>{r.status}</span></td><td><button className="btn" onClick={()=>dl(r)}>⬇ PDF</button></td></tr>):<tr><td colSpan="4" className="mu">No reports yet.</td></tr>}</tbody></table></div></>:<>
  <div className="grid g3">{st("Deadlines caught",hard.filter(t=>t.status==="done").length+" / "+hard.length,"var(--ok)")}{st("Tokens spent",U.reduce((a,u)=>a+u.tokens,0).toLocaleString())}{st("Deferred",all.filter(t=>t.status==="deferred").length,"var(--wa)")}{st("Reports awaiting validation",R.filter(r=>r.status==="pending").length,"var(--pr)")}</div>
  <div className="grid g3">
   <div className="card"><h2>Policy: daily cap</h2><div className="big">{db.cap} <span className="mu" style={{fontSize:18}}>tokens / student / day</span></div><input type="range" min="1000" max="5000" step="250" value={db.cap} style={{width:"100%",accentColor:"#6d4cf5"}} onChange={e=>setDb({...db,cap:+e.target.value})}/><button className="btn" style={{marginTop:12}} onClick={newDay}>Start new day</button></div>
   <div className="card"><h2>Mock portals</h2>{Object.keys(LBL).map(k=><div className="sub" key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}><span>{ICON[k]} {LBL[k]}</span><button className={"btn "+(db.portals[k]?"p":"")} onClick={()=>setDb({...db,portals:{...db.portals,[k]:!db.portals[k]}})}>{db.portals[k]?"Open":"Closed"}</button></div>)}</div>
   <div className="card"><h2>🛡️ Guardrails</h2><div className="mu">{db.log.filter(l=>l.m.startsWith("GUARDRAIL")).length} interventions logged</div>{["Daily cap enforced in code, not by the LLM","Hard deadlines always processed first","Mock portals only — no real university login","LLM output validated; identity & fee fields pinned","Deferred work always listed in reports","Run throttling, injection filter, input validation"].map(x=><div className="sub" key={x} style={{fontSize:13,padding:"8px 12px"}}>✅ {x}</div>)}</div>
   <div className="card"><h2>Agent log</h2><div className="log">{db.log.length?db.log.map((l,i)=><div key={i}>[{l.t}] {l.m}</div>):<span className="mu">No activity yet.</span>}</div></div>
  </div>
  <div className="card" style={{marginTop:16,overflowX:"auto"}}><h2>Students</h2>
   <table style={{marginTop:10}}><thead><tr><th>Name</th><th>Roll</th><th>Tokens</th><th>Fee</th><th>Forms</th><th>Warranty</th></tr></thead><tbody>
   {U.length?U.map(u=><tr key={u.email}><td>{u.name}</td><td>{u.roll}</td><td>{u.tokens}/{db.cap+(u.bonus||0)}</td><td><span className={"tag "+TAGS[u.tasks[0].status][0]}>{u.tasks[0].status==="done"?"Fee paid":TAGS[u.tasks[0].status][1]}</span></td><td>{u.tasks.filter(t=>t.type==="exam"&&t.status==="done").length}/2</td><td>{u.tasks.filter(t=>t.type==="warranty"&&t.status==="reminded").length?"Renewal requested":"OK"}</td></tr>):<tr><td colSpan="6" className="mu">No students yet.</td></tr>}</tbody></table></div></>}</>;
}
export default App;
