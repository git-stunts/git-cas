cd /app; T=test/types
run() { echo "=== $1"; deno check --config "$2" "$3" 2>&1 | grep -E 'ERROR|at |Found|Check' | sed 's/\x1b\[[0-9;]*m//g' | head -${4:-30}; echo "exit=${PIPESTATUS[0]}"; }
cp /exp/deno.base.json $T/deno.base.json; cp /exp/canary2.ts $T/canary2.ts; cp /exp/only.ts $T/only.ts
echo '{"nodeModulesDir":"manual","compilerOptions":{"skipLibCheck":false}}' > $T/deno.nolib.json
echo '{"compilerOptions":{"skipLibCheck":false}}' > $T/deno.base.nolib.json
run "canary2 head config, head decls" $T/deno.json $T/canary2.ts
run "canary2 base config, head decls" $T/deno.base.json $T/canary2.ts
run "only.ts skipLibCheck=false head config head decls" $T/deno.nolib.json $T/only.ts
run "only.ts skipLibCheck=false BASE config head decls" $T/deno.base.nolib.json $T/only.ts
echo "=== deno info base"; deno info --config $T/deno.base.json $T/only.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | head -20
echo "=== deno info head"; deno info --config $T/deno.json $T/only.ts 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | head -20
cp /exp/ManifestSchema.base.d.ts src/domain/schemas/ManifestSchema.d.ts
run "canary2 base config, zod3 decls (main reality)" $T/deno.base.json $T/canary2.ts
run "only.ts skipLibCheck=false head config zod3 decls" $T/deno.nolib.json $T/only.ts
