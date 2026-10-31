set -u
cd /app
echo "== zod copies"; ls -d node_modules/.pnpm/zod@*
Z=node_modules/.pnpm/zod@4.6.7/node_modules/zod
echo "== realpaths"; readlink -f node_modules/zod; readlink -f node_modules/.pnpm/@git-stunts+vault@1.0.1/node_modules/zod; readlink -f node_modules/.pnpm/@git-stunts+plumbing@3.3.2/node_modules/zod
echo "== globalConfig / globalThis in zod core"; grep -n "globalConfig\|globalThis" $Z/v4/core/core.js | head
grep -n "__zod_globalRegistry\|globalThis" $Z/v4/core/registries.js | head
echo "== eval usage"; grep -n "new F(\|allowsEval\|new Function" $Z/v4/core/util.js $Z/v4/core/schemas.js $Z/v4/core/doc.js | head
grep -n "jitless" $Z/v4/core/schemas.js | head
echo "== handleUnionResults"; grep -n "function handleUnionResults" -A22 $Z/v4/core/schemas.js
echo "== int check"; grep -n "Number.isSafeInteger\|MAX_SAFE_INTEGER" $Z/v4/core/*.js | head
echo "== vault z.config / locale / registry"; V=$(readlink -f node_modules/.pnpm/@git-stunts+vault@1.0.1/node_modules/@git-stunts/vault); grep -rn "z.config\|\.config(\|globalRegistry\|zod" $V --include=*.js -l | head; grep -rn "z.config\|config(" $V/src 2>/dev/null | head
echo "== plumbing zod usage"; P=$(readlink -f node_modules/.pnpm/@git-stunts+plumbing@3.3.2/node_modules/@git-stunts/plumbing); grep -rln "from 'zod'\|from \"zod\"" $P | head; grep -rn "ManifestSchema\|git-cas" $P --include=*.js | head -3
echo "== who imports plumbing in src"; grep -rln "@git-stunts/plumbing" src bin index.js | head
echo "== getter read count"
node --input-type=module -e "
import * as S3 from '/exp/schema-v3.mjs'; import * as S4 from '/exp/schema-v4.mjs';
for (const [n,S] of [['z3',S3],['z4',S4]]) {
  let reads=0; const o={index:0,digest:'a'.repeat(64),blob:'b'.repeat(40)};
  Object.defineProperty(o,'size',{enumerable:true,get(){reads++; return reads===1?7:9;}});
  const r=S.ChunkSchema.safeParse(o); console.log(n,'reads',reads,'success',r.success,'out size',r.success&&r.data.size);
}
const b64=(n,f)=>Buffer.alloc(n,f).toString('base64');
for (const it of [1.5,-1,0,'1',null]) {
 const enc={scheme:'whole',algorithm:'aes-256-gcm',nonce:b64(12,1),tag:b64(16,2),kdf:{algorithm:'pbkdf2',salt:b64(8,3),iterations:it}};
 for (const [n,S] of [['z3',S3],['z4',S4]]) { const r=S.EncryptionSchema.safeParse(enc); console.log('iterations',JSON.stringify(it),n,r.success?'ok':JSON.stringify(r.error.issues.map(i=>i.message+'@'+i.path.join('.')))); }
}
"
echo "== import cost (ms, fresh process x5)"
for i in 1 2 3 4 5; do node --input-type=module -e "const t=performance.now(); await import('/app/node_modules/.pnpm/zod@3.25.76/node_modules/zod/index.js'); const t1=performance.now(); console.log('z3 import',(t1-t).toFixed(1))"; node --input-type=module -e "const t=performance.now(); await import('/app/node_modules/zod/index.js'); const t1=performance.now(); console.log('z4 import',(t1-t).toFixed(1))"; done
echo "== schema module load (incl first parse)"
for i in 1 2 3; do node --input-type=module -e "const t=performance.now(); const S=await import('/exp/schema-v3.mjs'); const t1=performance.now(); S.ManifestSchema.parse({slug:'s',filename:'f',size:1,chunks:[]}); console.log('v3 load',(t1-t).toFixed(1),'first parse',(performance.now()-t1).toFixed(2))"; node --input-type=module -e "const t=performance.now(); const S=await import('/exp/schema-v4.mjs'); const t1=performance.now(); S.ManifestSchema.parse({slug:'s',filename:'f',size:1,chunks:[]}); console.log('v4 load',(t1-t).toFixed(1),'first parse',(performance.now()-t1).toFixed(2))"; done
echo "== package sizes"; du -sh node_modules/.pnpm/zod@3.25.76/node_modules/zod $Z
echo "== deno nodeModulesDir: is node_modules part of image? test/types"; ls test/types; cat test/types/deno.json
