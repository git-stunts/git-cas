cd /app/node_modules/zod
echo "== version"; grep '"version"' package.json
echo "== index"; cat -n index.js 2>/dev/null | head; ls
echo "== v4/index"; cat -n v4/index.js 2>/dev/null | head
echo "== classic external default?"; grep -n "default" v4/classic/index.js 2>/dev/null
echo "== union handle"; grep -n "function handleUnionResults" -A25 v4/core/schemas.js
echo "== disc"; grep -n "No matching discriminator\|discriminator" v4/core/schemas.js | head -20
echo "== int"; grep -n "safeint\|MAX_SAFE_INTEGER" v4/core/checks.js v4/core/util.js v4/classic/schemas.js | head -20
echo "== d.ts generics"; grep -nE "export interface (ZodEnum|ZodDiscriminatedUnion|ZodObject|ZodUnion|ZodDefault|ZodArray|ZodLiteral|ZodOptional|ZodUndefined)\b|export interface ZodObject<" v4/classic/schemas.d.ts
echo "== disc fn"; grep -nE "export declare function (discriminatedUnion|union|enum|object)\b" -A2 v4/classic/schemas.d.ts
echo "== ZodError"; grep -n "ZodError\b" v4/classic/errors.js | head; grep -n "message\|initializer" v4/core/errors.js | head -30
echo "== zod3 dist"; Z3=/app/node_modules/.pnpm/zod@3.25.76/node_modules/zod; grep -n '"version"' $Z3/package.json
echo "== zod3 int"; grep -n 'kind === "int"' -A10 $Z3/v3/types.js | head -14
echo "== zod3 union"; grep -n "class ZodUnion" -A60 $Z3/v3/types.js | grep -n "dirty\|invalid_union\|unionErrors" 
echo "== who depends on zod"; ls /app/node_modules/.pnpm | grep -i zod; ls /app/node_modules/.pnpm | grep -i "plumbing\|vault"
for p in /app/node_modules/.pnpm/@git-stunts+*/node_modules/@git-stunts/*; do echo "$p"; grep -n '"zod"\|"version"' $p/package.json; done
