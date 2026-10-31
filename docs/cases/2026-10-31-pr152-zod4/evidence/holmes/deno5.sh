cd /app; T=test/types
cp /exp/mirror.ts $T/mirror.ts
deno check --config $T/deno.json $T/mirror.ts 2>&1 | grep -E 'ERROR|at |Found|Check|const' | sed 's/\x1b\[[0-9;]*m//g' | head -40; echo "exit=${PIPESTATUS[0]}"
