cd /app; T=test/types
run() { echo "=== $1"; deno check --config "$2" "$3" 2>&1 | grep -E 'ERROR|at |Found|Check|const' | sed 's/\x1b\[[0-9;]*m//g' | head -30; echo "exit=${PIPESTATUS[0]}"; }
cp /exp/deno.base.json $T/deno.base.json; cp /exp/canary3.ts $T/canary3.ts
run "canary3 base config" $T/deno.base.json $T/canary3.ts
run "canary3 head config" $T/deno.json $T/canary3.ts
echo "=== DENO env / node_modules layout"; env | grep -i deno; ls node_modules | head -5; ls node_modules/.deno 2>/dev/null | grep zod; readlink -f node_modules/zod; ls -la node_modules/zod | head -2
echo "=== deno check -L debug base (zod mentions)"; deno check -L debug --config $T/deno.base.json $T/canary3.ts 2>&1 | grep -i "zod" | sed 's/\x1b\[[0-9;]*m//g' | head -15
