cd /app; T=test/types
run() { echo "=== $1"; deno check --config "$2" "$3" 2>&1 | grep -E 'ERROR|at |Found|Check|const' | sed 's/\x1b\[[0-9;]*m//g' | head -30; echo "exit=${PIPESTATUS[0]}"; }
cp /exp/deno.base.json $T/deno.base.json; cp /exp/canary2.ts $T/canary2.ts
run "FRESH canary2 base config, head decls" $T/deno.base.json $T/canary2.ts
run "FRESH canary2 head config, head decls" $T/deno.json $T/canary2.ts
run "canary2 base config again (after head run)" $T/deno.base.json $T/canary2.ts
echo "=== missing_dependency"; grep -rl "missing_dependency" $(deno info 2>/dev/null | sed -n 's/^DENO_DIR location: //p') 2>/dev/null | head -3
