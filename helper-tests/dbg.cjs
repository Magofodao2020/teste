require('./fakewin.cjs');
const W = globalThis.__fakeWin;
const PORT = 7996; process.argv[2] = String(PORT);
const realLog = console.log; const logs=[]; console.log=(...a)=>logs.push(a.join(' '));
require(process.env.HELPER_DIR + '/626.js');
const V = W.VERSION; const at=(rva)=>W.BASE+rva;
const names=['FFlagX','FIntY'], addresses=['0x101100','0x100100'];
W.poke(at(0x101100), Buffer.from([0]));
{const b=Buffer.alloc(4);b.writeInt32LE(777);W.poke(at(0x100100),b);}
const post=async(p,b)=>(await fetch(`http://127.0.0.1:${PORT}${p}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)})).json();
(async()=>{
  for(let i=0;i<50;i++){try{await fetch(`http://127.0.0.1:${PORT}/status`);break;}catch{await new Promise(r=>setTimeout(r,50));}}
  const so=await post('/set-offsets',{version:V,names,addresses});
  realLog('set-offsets:', JSON.stringify(so));
  const st=await (await fetch(`http://127.0.0.1:${PORT}/status`)).json();
  realLog('status running/offsets/match:', st.runningBuild, st.offsetsBuild, st.buildMatch, 'canApply', st.canApply);
  const on=await post('/toggle',{name:'FFlagX',flags:{FFlagX:'true'},dumpVersion:V});
  realLog('toggle:', JSON.stringify(on));
  const ap=await post('/apply',{flags:{FFlagX:'true'},dumpVersion:V});
  realLog('apply:', JSON.stringify(ap));
  realLog('--- helper logs ---'); logs.forEach(l=>realLog(l));
  process.exit(0);
})();
