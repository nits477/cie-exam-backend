const express=require("express");
const cors=require("cors");
const multer=require("multer");
const XLSX=require("xlsx");
const fs=require("fs");
const path=require("path");
const {Pool}=require("pg");

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

function readLocal(name,fallback=[]){
  try{return JSON.parse(fs.readFileSync(path.join(DATA_DIR,name),"utf8"))}
  catch{return fallback}
}
function writeLocal(name,data){
  fs.writeFileSync(path.join(DATA_DIR,name),JSON.stringify(data,null,2),"utf8");
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
      mobile TEXT UNIQUE NOT NULL,
      score INTEGER NOT NULL,
      total INTEGER NOT NULL,
      percentage NUMERIC(6,2) NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

app.use(cors());
app.use(express.json({limit:"2mb"}));
app.use(express.static(path.join(__dirname,"public")));

app.get("/api/health",(req,res)=>res.json({ok:true,mode:useDb?"online-db":"local-json"}));

app.post("/api/register",async(req,res)=>{
  try{
    const b=req.body||{};
    const name=String(b.name||"").trim();
    const fatherName=String(b.fatherName||"").trim();
    const mobile=String(b.mobile||"").trim();
    if(!name||!fatherName||!mobile)
      return res.status(400).json({error:"Name, Father Name and Mobile required"});

    if(useDb){
      const q=await pool.query(
        `INSERT INTO students(name,father_name,mobile)
         VALUES($1,$2,$3)
         ON CONFLICT(mobile) DO NOTHING
         RETURNING id,name,father_name,mobile`,
         [name,fatherName,mobile]
      );
      if(!q.rowCount) return res.status(409).json({error:"Duplicate mobile"});
      const x=q.rows[0];
      return res.json({id:x.id,name:x.name,fatherName:x.father_name,mobile:x.mobile});
    }

    const s=readLocal("students.json");
    if(s.some(x=>String(x.mobile)===mobile))
      return res.status(409).json({error:"Duplicate mobile"});
    const x={id:Date.now(),name,fatherName,mobile,createdAt:new Date().toISOString()};
    s.push(x);writeLocal("students.json",s);res.json(x);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/questions",async(req,res)=>{
  try{
    if(useDb){
      const q=await pool.query(`SELECT id,question,option_a AS a,option_b AS b,option_c AS c,option_d AS d,answer FROM questions ORDER BY id`);
      return res.json(q.rows);
    }
    res.json(readLocal("questions.json"));
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/result",async(req,res)=>{
  try{
    const b=req.body||{};
    const mobile=String(b.mobile||"").trim();
    const total=Number(b.total)||0, score=Number(b.score)||0;
    const percentage=total?+(score*100/total).toFixed(2):0;
    const status=total && score/total>=0.4 ? "PASS":"FAIL";

    if(useDb){
      const q=await pool.query(
        `INSERT INTO results(student_id,name,father_name,mobile,score,total,percentage,status)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT(mobile) DO NOTHING
         RETURNING *`,
        [b.studentId||null,String(b.name||""),String(b.fatherName||""),mobile,score,total,percentage,status]
      );
      if(!q.rowCount) return res.status(409).json({error:"Result already submitted for this student."});
      return res.json(q.rows[0]);
    }

    const rows=readLocal("results.json");
    if(rows.some(x=>String(x.mobile||"").trim()===mobile))
      return res.status(409).json({error:"Result already submitted for this student."});
    const x={id:Date.now(),studentId:b.studentId,name:b.name,fatherName:b.fatherName,mobile,score,total,percentage,status,createdAt:new Date().toISOString()};
    rows.push(x);writeLocal("results.json",rows);res.json(x);
  }catch(e){res.status(500).json({error:e.message})}
});

app.get("/api/results",async(req,res)=>{
  try{
    if(useDb){
      const q=await pool.query(`SELECT id,student_id AS "studentId",name,father_name AS "fatherName",mobile,score,total,percentage,status,created_at AS "createdAt" FROM results ORDER BY id DESC`);
      return res.json(q.rows);
    }
    res.json(readLocal("results.json"));
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/admin/upload-excel",upload.single("file"),async(req,res)=>{
  if(!req.file) return res.status(400).json({error:"Select Excel"});
  try{
    const wb=XLSX.readFile(req.file.path);
    const ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
    const errors=[],valid=[];
    rows.forEach((z,i)=>{
      const n=i+2;
      const question=String(z.Question||"").trim();
      const a=String(z["Option A"]||"").trim();
      const b=String(z["Option B"]||"").trim();
      const c=String(z["Option C"]||"").trim();
      const d=String(z["Option D"]||"").trim();
      const raw=String(z.Answer||"").trim().toUpperCase();
      const answer=({"1":"A","2":"B","3":"C","4":"D"}[raw]||raw);

      if(!question)errors.push(`Row ${n}: Question missing`);
      if(!a)errors.push(`Row ${n}: Option A missing`);
      if(!b)errors.push(`Row ${n}: Option B missing`);
      if(!c)errors.push(`Row ${n}: Option C missing`);
      if(!d)errors.push(`Row ${n}: Option D missing`);
      if(!["A","B","C","D"].includes(answer))errors.push(`Row ${n}: Answer must be A/B/C/D or 1/2/3/4`);
      if(question&&a&&b&&c&&d&&["A","B","C","D"].includes(answer))
        valid.push({question,a,b,c,d,answer});
    });

    if(useDb){
      for(const x of valid){
        await pool.query(
          `INSERT INTO questions(question,option_a,option_b,option_c,option_d,answer)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [x.question,x.a,x.b,x.c,x.d,x.answer]
        );
      }
    }else{
      const qs=readLocal("questions.json");
      valid.forEach((x,i)=>qs.push({id:Date.now()+i,...x}));
      writeLocal("questions.json",qs);
    }

    fs.unlinkSync(req.file.path);
    res.json({found:rows.length,imported:valid.length,errors});
  }catch(e){
    try{fs.unlinkSync(req.file.path)}catch{}
    res.status(400).json({error:e.message})
  }
});

app.post("/api/admin/clear-questions",async(req,res)=>{
  try{
    if(useDb) await pool.query(`DELETE FROM questions`);
    else writeLocal("questions.json",[]);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message})}
});

app.post("/api/admin/remove-duplicate-results",async(req,res)=>{
  try{
    if(useDb) return res.json({before:0,after:0,removed:0,message:"Online DB prevents duplicates automatically."});
    const rows=readLocal("results.json"),seen=new Set(),clean=[];
    for(const row of rows){
      const key=String(row.mobile||row.studentId||"").trim();
      if(!key || !seen.has(key)){clean.push(row);if(key)seen.add(key)}
    }
    writeLocal("results.json",clean);
    res.json({before:rows.length,after:clean.length,removed:rows.length-clean.length});
  }catch(e){res.status(500).json({error:e.message})}
});

initDb()
  .then(()=>app.listen(PORT,()=>console.log(`CIE Exam Admin running on port ${PORT} (${useDb?"Postgres":"local JSON"})`)))
  .catch(err=>{console.error("Database startup error:",err);process.exit(1)});
