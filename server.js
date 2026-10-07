// Pickle Time court booking server. No dependencies. Node 22.5+
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {DatabaseSync}=require('node:sqlite');
const PORT=process.env.PORT||3000,PASS=process.env.ADMIN_PASSWORD||'changeme',SECRET=process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex');
const DB=process.env.DB_PATH||path.join(__dirname,'bookings.db');
if(PASS==='changeme')console.warn('WARNING: set ADMIN_PASSWORD before going live!');
const db=new DatabaseSync(DB);
db.exec(`CREATE TABLE IF NOT EXISTS bookings(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,hour INTEGER NOT NULL,name TEXT NOT NULL,phone TEXT NOT NULL,price INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%SZ','now')),UNIQUE(date,hour))`);
const OPEN=6,CLOSE=22,MAXD=30,price=h=>h>=16?230:180;
const manila=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit'}).formatToParts(new Date()).reduce((o,x)=>(o[x.type]=x.value,o),{});return{today:`${p.year}-${p.month}-${p.day}`,h:+p.hour}};
const addDays=(d,n)=>{const t=new Date(d+'T00:00:00Z');t.setUTCDate(t.getUTCDate()+n);return t.toISOString().slice(0,10)};
const sign=v=>crypto.createHmac('sha256',SECRET).update(v).digest('hex');
const mkToken=()=>{const e=Date.now()+12*3600e3;return e+'.'+sign(''+e)};
const okToken=t=>{const[e,s]=(t||'').split('.');return e&&s&&+e>Date.now()&&s.length===64&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(sign(e)))};
const isAdmin=req=>okToken(((req.headers.cookie||'').match(/(?:^|; )pt_admin=([^;]+)/)||[])[1]);
const tries=new Map();
const json=(res,code,o,h={})=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store',...h});res.end(JSON.stringify(o))};
const body=req=>new Promise((ok,no)=>{let b='';req.on('data',c=>{b+=c;if(b.length>1e5){no();req.destroy()}});req.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch{no()}})});
const csv=r=>['Date,Time,Name,Phone,Price,Booked at(UTC)'].concat(r.map(x=>[x.date,x.hour+':00-'+(x.hour+1)+':00',x.name,x.phone,x.price,x.created_at].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','))).join('\n');
http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://x'),p=u.pathname;
 try{
  if(req.method==='GET'&&p==='/api/slots'){const f=/^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('from')||'')?u.searchParams.get('from'):manila().today;
   return json(res,200,db.prepare('SELECT date,hour FROM bookings WHERE date>=?').all(f))}
  if(req.method==='POST'&&p==='/api/bookings'){
   const b=await body(req),name=String(b.name||'').trim().slice(0,80),phone=String(b.phone||'').trim(),date=String(b.date||''),hours=[...new Set(b.hours)];
   const n=manila();
   if(!name||!/^[\d+\-\s()]{7,20}$/.test(phone)||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Array.isArray(b.hours)||!hours.length||hours.length>16)return json(res,400,{error:'Invalid details'});
   if(date<n.today||date>addDays(n.today,MAXD))return json(res,400,{error:'Date out of range'});
   const ins=db.prepare('INSERT INTO bookings(date,hour,name,phone,price) VALUES(?,?,?,?,?)'),booked=[],failed=[];
   db.exec('BEGIN');
   for(const h of hours){if(!Number.isInteger(h)||h<OPEN||h>=CLOSE||(date===n.today&&h<n.h)){failed.push(h);continue}
    try{ins.run(date,h,name,phone,price(h));booked.push(h)}catch{failed.push(h)}}
   db.exec('COMMIT');
   return json(res,200,{booked,failed,total:booked.reduce((s,h)=>s+price(h),0)})}
  if(req.method==='POST'&&p==='/api/admin/login'){
   const ip=req.socket.remoteAddress,t=tries.get(ip)||{n:0,at:Date.now()};if(Date.now()-t.at>9e5){t.n=0;t.at=Date.now()}
   if(t.n>=8)return json(res,429,{error:'Too many attempts. Try again later.'});
   const b=await body(req),a=Buffer.from(sign(String(b.password||''))),c=Buffer.from(sign(PASS));
   if(!crypto.timingSafeEqual(a,c)){t.n++;tries.set(ip,t);return json(res,401,{error:'Wrong password'})}
   return json(res,200,{ok:true},{'Set-Cookie':`pt_admin=${mkToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.headers['x-forwarded-proto']==='https'?'; Secure':''}`})}
  if(p.startsWith('/api/admin/')){
   if(!isAdmin(req))return json(res,401,{error:'Not logged in'});
   if(req.method==='GET'&&p==='/api/admin/bookings')return json(res,200,db.prepare('SELECT * FROM bookings ORDER BY date,hour').all());
   if(req.method==='GET'&&p==='/api/admin/export.csv'){res.writeHead(200,{'Content-Type':'text/csv','Content-Disposition':'attachment; filename="pickle-time-bookings.csv"'});return res.end(csv(db.prepare('SELECT * FROM bookings ORDER BY date,hour').all()))}
   const m=p.match(/^\/api\/admin\/bookings\/(\d+)$/);
   if(req.method==='DELETE'&&m){db.prepare('DELETE FROM bookings WHERE id=?').run(+m[1]);return json(res,200,{ok:true})}
   if(req.method==='POST'&&p==='/api/admin/logout')return json(res,200,{ok:true},{'Set-Cookie':'pt_admin=; Max-Age=0; Path=/'})}
  if(req.method==='GET'&&(p==='/'||p==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end(fs.readFileSync(path.join(__dirname,'public','index.html')))}
  json(res,404,{error:'Not found'})
 }catch(e){try{db.exec('ROLLBACK')}catch{}json(res,500,{error:'Server error'})}
}).listen(PORT,()=>console.log('Pickle Time running on http://localhost:'+PORT));
