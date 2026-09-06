const express=require("express");
const cors=require("cors");
const multer=require("multer");
const XLSX=require("xlsx");
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");
const bcrypt=require("bcryptjs");

const app=express();
const PORT=process.env.PORT || 3000;
const uploadDir=path.join(__dirname,"uploads");
fs.mkdirSync(uploadDir,{recursive:true});
const upload=multer({dest:uploadDir});

const DATABASE_URL=process.env.DATABASE_URL || "";
const useDb=!!DATABASE_URL;
let pool=null;
if(useDb){
  pool=new Pool({
    connectionString:DATABASE_URL,
    ssl: process.env.NODE_ENV==="production" ? {rejectUnauthorized:false} : false
  });
}

const DATA_DIR=path.join(__dirname,"data");
fs.mkdirSync(DATA_DIR,{recursive:true});
function readLocal(name,fallback=[]){try{return JSON.parse(fs.readFileSync(path.join(DATA_DIR,name),"utf8"))}catch{return fallback}}
function writeLocal(name,data){fs.writeFileSync(path.join(DATA_DIR,name),JSON.stringify(data,null,2),"utf8")}
const norm=s=>String(s||"").trim().replace(/\s+/g," ");
const validPin=p=>/^\d{4}$/.test(String(p||""));
const validMobile=m=>/^\d{10}$/.test(String(m||""));
function validFullName(v){
  const s=norm(v);
  if(!/^[\p{L} ]+$/u.test(s)) return false;
  const parts=s.split(" ");
  return parts.length>=2 && parts.every(x=>[...x].length>=2);
}
function studentPublic(x){return {id:x.id,name:x.name,fatherName:x.father_name??x.fatherName,mobile:x.mobile,pinSet:!!(x.pin_hash??x.pinHash)}}
async function verifyStudent(mobile,pin){
  mobile=norm(mobile);
  if(!validMobile(mobile)||!validPin(pin)) return null;
  if(useDb){
    const q=await pool.query(`SELECT id,name,father_name,mobile,pin_hash FROM students WHERE mobile=$1`,[mobile]);
    if(!q.rowCount||!q.rows[0].pin_hash) return null;
    return await bcrypt.compare(String(pin),q.rows[0].pin_hash)?q.rows[0]:null;
  }
  const x=readLocal("students.json").find(s=>String(s.mobile)===mobile);
  if(!x||!x.pinHash) return null;
  return await bcrypt.compare(String(pin),x.pinHash)?x:null;
}

async function initDb(){
  if(!useDb) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS students(
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      father_name TEXT NOT NULL,
      mobile TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE students ADD COLUMN IF NOT EXISTS pin_hash TEXT;

    CREATE TABLE IF NOT EXISTS questions(
      id BIGSERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      answer CHAR(1) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS results(
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT,
      name TEXT NOT NULL,
      father_name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      percentage NUMERIC(6,2) NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    ALTER TABLE results ADD COLUMN IF NOT EXISTS review_json JSONB;
    ALTER TABLE results DROP CONSTRAINT IF EXISTS results_mobile_key;
    CREATE INDEX IF NOT EXISTS idx_results_mobile_created ON results(mobile,created_at DESC);

    CREATE TABLE IF NOT EXISTS pin_reset_requests(
      id BIGSERIAL PRIMARY KEY,
      student_id BIGINT,
      mobile TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_pin_reset_status ON pin_reset_requests(status,requested_at DESC);
  `);
}

app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));
app.get("/api/health",(req,res)=>res.json({ok:true,mode:useDb?"postgres":"local-json",version:"3.1"}));

app.post("/api/register",async(req,res)=>{
  try{
    const b=req.body||{}, name=norm(b.name), fatherName=norm(b.fatherName), mobile=norm(b.mobile), pin=String(b.pin||"");
    if(!validFullName(name)) return res.status(400).json({error:"Enter full Student Name using letters only (at least 2 words)."});
    if(!validFullName(fatherName)) return res.status(400).json({error:"Enter full Father Name using letters only (at least 2 words)."});
    if(!validMobile(mobile)) return res.status(400).json({error:"Mobile Number must be exactly 10 digits."});
    if(!validPin(pin)) return res.status(400).json({error:"PIN must be exactly 4 digits."});
    const pinHash=await bcrypt.hash(pin,10);
    if(useDb){
      const q=await pool.query(`INSERT INTO students(name,father_name,mobile,pin_hash) VALUES($1,$2,$3,$4) ON CONFLICT(mobile) DO NOTHING RETURNING id,name,father_name,mobile,pin_hash`,[name,fatherName,mobile,pinHash]);
      if(!q.rowCount) return res.status(409).json({error:"Mobile already registered. Please Login."});
      return res.json({ok:true,student:studentPublic(q.rows[0])});
    }
    const s=readLocal("students.json");
    if(s.some(x=>String(x.mobile)===mobile)) return res.status(409).json({error:"Mobile already registered. Please Login."});
    const x={id:Date.now(),name,fatherName,mobile,pinHash,createdAt:new Date().toISOString()};
    s.push(x);writeLocal("students.json",s);return res.json({ok:true,student:studentPublic(x)});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/login",async(req,res)=>{
  try{
    const mobile=norm(req.body?.mobile), pin=String(req.body?.pin||"");
    if(!validMobile(mobile)||!validPin(pin)) return res.status(400).json({error:"Enter 10-digit Mobile Number and 4-digit PIN."});
    if(useDb){
      const q=await pool.query(`SELECT id,name,father_name,mobile,pin_hash FROM students WHERE mobile=$1`,[mobile]);
      if(!q.rowCount) return res.status(404).json({error:"Mobile Number is not registered."});
      if(!q.rows[0].pin_hash) return res.status(409).json({error:"PIN is not set for this old account. Use Forgot PIN and ask Admin to set a PIN."});
      if(!(await bcrypt.compare(pin,q.rows[0].pin_hash))) return res.status(401).json({error:"Incorrect PIN."});
      return res.json({ok:true,student:studentPublic(q.rows[0])});
    }
    const x=readLocal("students.json").find(s=>String(s.mobile)===mobile);
    if(!x) return res.status(404).json({error:"Mobile Number is not registered."});
    if(!x.pinHash) return res.status(409).json({error:"PIN is not set for this old account. Use Forgot PIN."});
    if(!(await bcrypt.compare(pin,x.pinHash))) return res.status(401).json({error:"Incorrect PIN."});
    res.json({ok:true,student:studentPublic(x)});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/forgot-pin",async(req,res)=>{
  try{
    const mobile=norm(req.body?.mobile);
    if(!validMobile(mobile)) return res.status(400).json({error:"Enter a valid 10-digit Mobile Number."});
    if(useDb){
      const s=await pool.query(`SELECT id,name,father_name,mobile FROM students WHERE mobile=$1`,[mobile]);
      if(!s.rowCount) return res.status(404).json({error:"Mobile Number is not registered."});
      const pending=await pool.query(`SELECT id FROM pin_reset_requests WHERE mobile=$1 AND status='PENDING' LIMIT 1`,[mobile]);
      if(!pending.rowCount) await pool.query(`INSERT INTO pin_reset_requests(student_id,mobile) VALUES($1,$2)`,[s.rows[0].id,mobile]);
      return res.json({ok:true,message:"PIN reset request sent to Admin."});
    }
    const students=readLocal("students.json"), s=students.find(x=>String(x.mobile)===mobile);
    if(!s) return res.status(404).json({error:"Mobile Number is not registered."});
    const rr=readLocal("pin_reset_requests.json");
    if(!rr.some(x=>x.mobile===mobile&&x.status==="PENDING")) rr.push({id:Date.now(),studentId:s.id,mobile,status:"PENDING",requestedAt:new Date().toISOString()});
    writeLocal("pin_reset_requests.json",rr);res.json({ok:true,message:"PIN reset request sent to Admin."});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/questions",async(req,res)=>{
  try{
    if(useDb){const q=await pool.query(`SELECT id,question,option_a AS a,option_b AS b,option_c AS c,option_d AS d,answer FROM questions ORDER BY id`);return res.json(q.rows)}
    res.json(readLocal("questions.json"));
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/result",async(req,res)=>{
  try{
    const b=req.body||{}, mobile=norm(b.mobile), pin=String(b.pin||"");
    let student=null;
    if(pin) student=await verifyStudent(mobile,pin);
    else {
      // Compatibility only for old accounts that do not yet have a PIN.
      if(useDb){const q=await pool.query(`SELECT id,name,father_name,mobile,pin_hash FROM students WHERE mobile=$1`,[mobile]);if(q.rowCount&&!q.rows[0].pin_hash)student=q.rows[0]}
      else {const x=readLocal("students.json").find(s=>String(s.mobile)===mobile);if(x&&!x.pinHash)student=x}
    }
    if(!student) return res.status(401).json({error:"Student login verification failed."});

    let score=0,total=0,review=null;
    if(Array.isArray(b.answers)){
      const submitted=b.answers.map(v=>Number.isInteger(Number(v))?Number(v):-1);
      let questions;
      if(useDb){questions=(await pool.query(`SELECT id,question,option_a AS a,option_b AS b,option_c AS c,option_d AS d,answer FROM questions ORDER BY id`)).rows}
      else questions=readLocal("questions.json");
      total=questions.length;
      review=questions.map((q,i)=>{
        const selectedIndex=(submitted[i]>=0&&submitted[i]<=3)?submitted[i]:-1;
        const correctIndex="ABCD".indexOf(String(q.answer||"").toUpperCase());
        if(selectedIndex===correctIndex && correctIndex>=0)score++;
        return {question:q.question,a:q.a,b:q.b,c:q.c,d:q.d,selected:selectedIndex>=0?"ABCD"[selectedIndex]:"",correct:correctIndex>=0?"ABCD"[correctIndex]:"",isCorrect:selectedIndex===correctIndex&&correctIndex>=0};
      });
    }else{
      // Backward compatibility with older APK versions.
      total=Math.max(0,Number(b.total)||0);score=Math.max(0,Number(b.score)||0);
      if(score>total) return res.status(400).json({error:"Invalid score."});
    }
    const percentage=total?+(score*100/total).toFixed(2):0, status=total&&score/total>=0.4?"PASS":"FAIL";
    const studentId=student.id, name=student.name, fatherName=student.father_name??student.fatherName;
    if(useDb){
      const q=await pool.query(`INSERT INTO results(student_id,name,father_name,mobile,score,total,percentage,status,review_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) RETURNING id,student_id AS "studentId",name,father_name AS "fatherName",mobile,score,total,percentage,status,review_json AS review,created_at AS "createdAt"`,[studentId,name,fatherName,mobile,score,total,percentage,status,review?JSON.stringify(review):null]);
      return res.json(q.rows[0]);
    }
    const rows=readLocal("results.json"),x={id:Date.now(),studentId,name,fatherName,mobile,score,total,percentage,status,review,createdAt:new Date().toISOString()};rows.push(x);writeLocal("results.json",rows);res.json(x);
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/my-results",async(req,res)=>{
  try{
    const mobile=norm(req.body?.mobile),pin=String(req.body?.pin||"");
    const student=await verifyStudent(mobile,pin);
    if(!student) return res.status(401).json({error:"Invalid Mobile Number or PIN."});
    if(useDb){const q=await pool.query(`SELECT id,score,total,percentage,status,review_json AS review,created_at AS "createdAt" FROM results WHERE mobile=$1 ORDER BY created_at DESC,id DESC`,[mobile]);return res.json({student:studentPublic(student),results:q.rows})}
    const rows=readLocal("results.json").filter(x=>String(x.mobile)===mobile).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));res.json({student:studentPublic(student),results:rows});
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/results",async(req,res)=>{
  try{
    const from=norm(req.query.from),to=norm(req.query.to),validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(x);
    if((from&&!validDate(from))||(to&&!validDate(to))) return res.status(400).json({error:"Date must be YYYY-MM-DD"});
    if(useDb){
      let sql=`SELECT id,student_id AS "studentId",name,father_name AS "fatherName",mobile,score,total,percentage,status,created_at AS "createdAt" FROM results`;const params=[],where=[];
      if(from){params.push(from);where.push(`created_at >= ($${params.length}::date AT TIME ZONE 'Asia/Kolkata')`)}
      if(to){params.push(to);where.push(`created_at < (($${params.length}::date + 1) AT TIME ZONE 'Asia/Kolkata')`)}
      if(where.length)sql+=' WHERE '+where.join(' AND ');sql+=' ORDER BY created_at DESC,id DESC';return res.json((await pool.query(sql,params)).rows);
    }
    let rows=readLocal("results.json");if(from||to){const start=from?new Date(from+'T00:00:00+05:30'):null,end=to?new Date(to+'T23:59:59.999+05:30'):null;rows=rows.filter(x=>{const d=new Date(x.createdAt||0);return(!start||d>=start)&&(!end||d<=end)})}res.json(rows.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)));
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/admin/students",async(req,res)=>{
  try{
    if(useDb){const q=await pool.query(`SELECT id,name,father_name AS "fatherName",mobile,(pin_hash IS NOT NULL) AS "pinSet",created_at AS "createdAt" FROM students ORDER BY created_at DESC,id DESC`);return res.json(q.rows)}
    res.json(readLocal("students.json").map(x=>({id:x.id,name:x.name,fatherName:x.fatherName,mobile:x.mobile,pinSet:!!x.pinHash,createdAt:x.createdAt})));
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/admin/pin-reset-requests",async(req,res)=>{
  try{
    if(useDb){const q=await pool.query(`SELECT r.id,r.student_id AS "studentId",r.mobile,r.status,r.requested_at AS "requestedAt",r.resolved_at AS "resolvedAt",s.name,s.father_name AS "fatherName" FROM pin_reset_requests r LEFT JOIN students s ON s.id=r.student_id ORDER BY CASE WHEN r.status='PENDING' THEN 0 ELSE 1 END,r.requested_at DESC`);return res.json(q.rows)}
    const students=readLocal("students.json");res.json(readLocal("pin_reset_requests.json").map(r=>{const s=students.find(x=>String(x.id)===String(r.studentId))||{};return {...r,name:s.name||'',fatherName:s.fatherName||''}}));
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/admin/reset-pin",async(req,res)=>{
  try{
    const requestId=req.body?.requestId, studentId=req.body?.studentId, mobile=norm(req.body?.mobile),newPin=String(req.body?.newPin||"");
    if(!validPin(newPin)) return res.status(400).json({error:"New PIN must be exactly 4 digits."});
    const hash=await bcrypt.hash(newPin,10);
    if(useDb){
      let q;if(studentId)q=await pool.query(`UPDATE students SET pin_hash=$1 WHERE id=$2 RETURNING id,mobile`,[hash,studentId]);else q=await pool.query(`UPDATE students SET pin_hash=$1 WHERE mobile=$2 RETURNING id,mobile`,[hash,mobile]);
      if(!q.rowCount)return res.status(404).json({error:"Student not found."});
      if(requestId)await pool.query(`UPDATE pin_reset_requests SET status='RESOLVED',resolved_at=NOW() WHERE id=$1`,[requestId]);
      else await pool.query(`UPDATE pin_reset_requests SET status='RESOLVED',resolved_at=NOW() WHERE mobile=$1 AND status='PENDING'`,[q.rows[0].mobile]);
      return res.json({ok:true,message:"PIN has been set/reset successfully."});
    }
    const students=readLocal("students.json");const s=students.find(x=>studentId?String(x.id)===String(studentId):String(x.mobile)===mobile);if(!s)return res.status(404).json({error:"Student not found."});s.pinHash=hash;writeLocal("students.json",students);const rr=readLocal("pin_reset_requests.json");rr.forEach(r=>{if((requestId&&String(r.id)===String(requestId))||(!requestId&&r.mobile===s.mobile&&r.status==='PENDING')){r.status='RESOLVED';r.resolvedAt=new Date().toISOString()}});writeLocal("pin_reset_requests.json",rr);res.json({ok:true,message:"PIN has been set/reset successfully."});
  }catch(e){res.status(500).json({error:e.message})}
});

app.delete("/api/admin/results/:id",async(req,res)=>{
  try{
    const id=String(req.params.id||"");
    if(!/^\d+$/.test(id))return res.status(400).json({error:"Invalid result id."});
    if(useDb){const q=await pool.query(`DELETE FROM results WHERE id=$1 RETURNING id`,[id]);if(!q.rowCount)return res.status(404).json({error:"Result not found."});return res.json({ok:true,message:"Result deleted."})}
    const rows=readLocal("results.json"),next=rows.filter(x=>String(x.id)!==id);if(next.length===rows.length)return res.status(404).json({error:"Result not found."});writeLocal("results.json",next);res.json({ok:true,message:"Result deleted."});
  }catch(e){res.status(500).json({error:e.message})}
});

app.delete("/api/admin/students/:id",async(req,res)=>{
  try{
    const id=String(req.params.id||"");
    if(!/^\d+$/.test(id))return res.status(400).json({error:"Invalid student id."});
    if(useDb){
      const c=await pool.connect();try{await c.query('BEGIN');const st=await c.query(`SELECT mobile FROM students WHERE id=$1`,[id]);if(!st.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:"Student not found."})}const mobile=st.rows[0].mobile;await c.query(`DELETE FROM pin_reset_requests WHERE student_id=$1 OR mobile=$2`,[id,mobile]);await c.query(`DELETE FROM results WHERE student_id=$1 OR mobile=$2`,[id,mobile]);await c.query(`DELETE FROM students WHERE id=$1`,[id]);await c.query('COMMIT');return res.json({ok:true,message:"Student and all linked results/reset requests deleted."});}catch(e){await c.query('ROLLBACK');throw e}finally{c.release()}
    }
    const students=readLocal("students.json"),st=students.find(x=>String(x.id)===id);if(!st)return res.status(404).json({error:"Student not found."});writeLocal("students.json",students.filter(x=>String(x.id)!==id));writeLocal("results.json",readLocal("results.json").filter(x=>String(x.studentId)!==id&&String(x.mobile)!==String(st.mobile)));writeLocal("pin_reset_requests.json",readLocal("pin_reset_requests.json").filter(x=>String(x.studentId)!==id&&String(x.mobile)!==String(st.mobile)));res.json({ok:true,message:"Student and linked data deleted."});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/admin/upload-excel",upload.single("file"),async(req,res)=>{
  if(!req.file)return res.status(400).json({error:"Select Excel"});
  try{
    const wb=XLSX.readFile(req.file.path),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:""}),errors=[],valid=[];
    rows.forEach((z,i)=>{const n=i+2,question=norm(z.Question),a=norm(z["Option A"]),b=norm(z["Option B"]),c=norm(z["Option C"]),d=norm(z["Option D"]),raw=norm(z.Answer).toUpperCase(),answer=({"1":"A","2":"B","3":"C","4":"D"}[raw]||raw);if(!question)errors.push(`Row ${n}: Question missing`);if(!a)errors.push(`Row ${n}: Option A missing`);if(!b)errors.push(`Row ${n}: Option B missing`);if(!c)errors.push(`Row ${n}: Option C missing`);if(!d)errors.push(`Row ${n}: Option D missing`);if(!["A","B","C","D"].includes(answer))errors.push(`Row ${n}: Answer must be A/B/C/D or 1/2/3/4`);if(question&&a&&b&&c&&d&&["A","B","C","D"].includes(answer))valid.push({question,a,b,c,d,answer})});
    if(useDb){for(const x of valid)await pool.query(`INSERT INTO questions(question,option_a,option_b,option_c,option_d,answer) VALUES($1,$2,$3,$4,$5,$6)`,[x.question,x.a,x.b,x.c,x.d,x.answer])}else{const qs=readLocal("questions.json");valid.forEach((x,i)=>qs.push({id:Date.now()+i,...x}));writeLocal("questions.json",qs)}
    fs.unlinkSync(req.file.path);res.json({found:rows.length,imported:valid.length,errors});
  }catch(e){try{fs.unlinkSync(req.file.path)}catch{}res.status(400).json({error:e.message})}
});
app.post("/api/admin/clear-questions",async(req,res)=>{try{if(useDb)await pool.query(`DELETE FROM questions`);else writeLocal("questions.json",[]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
// Kept only so older admin pages do not error. Multiple attempts are now intentional.
app.post("/api/admin/remove-duplicate-results",async(req,res)=>res.json({before:0,after:0,removed:0,message:"V3.0 allows multiple exam attempts. No results were removed."}));

initDb().then(()=>app.listen(PORT,()=>console.log(`CIE Exam Admin running on port ${PORT} (${useDb?"Postgres":"local JSON"}) - V3.1`))).catch(err=>{console.error("Database startup error:",err);process.exit(1)});
