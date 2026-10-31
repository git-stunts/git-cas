cd /app
deno --version | head -1
T=test/types
run() { echo "=== $1"; deno check --config "$2" "$3" 2>&1 | grep -vE '^\s*$' | head -${4:-25}; echo "exit=${PIPESTATUS[0]}"; }
cp /exp/deno.base.json $T/deno.base.json
cp /exp/pac.head.ts $T/pac.head.ts; cp /exp/pac.base.ts $T/pac.base.ts; cp /exp/canary.ts $T/canary.ts
run "D head config + head fixture (GREEN)" $T/deno.json $T/pac.head.ts
run "B base config + base fixture (main state)" $T/deno.base.json $T/pac.base.ts
run "A base config + head fixture" $T/deno.base.json $T/pac.head.ts
run "canary head config" $T/deno.json $T/canary.ts
run "canary base config" $T/deno.base.json $T/canary.ts
cp src/domain/schemas/ManifestSchema.d.ts /tmp/head.d.ts
cp /exp/ManifestSchema.base.d.ts src/domain/schemas/ManifestSchema.d.ts
run "C head config + head fixture + zod3 decls (RED)" $T/deno.json $T/pac.head.ts 60
run "C2 base config + head fixture + zod3 decls" $T/deno.base.json $T/pac.head.ts
cp /tmp/head.d.ts src/domain/schemas/ManifestSchema.d.ts
echo '{"nodeModulesDir":"manual","compilerOptions":{"skipLibCheck":false}}' > $T/deno.nolib.json
run "E skipLibCheck false head" $T/deno.nolib.json $T/pac.head.ts 40
