cd /app
Z=node_modules/zod
echo "== checks.js 95-121"; sed -n 95,121p $Z/v4/core/checks.js | cat -n | sed 's/^ *\([0-9]*\)/L\1+94/'
echo "== util.js aborted"; grep -n "export function aborted" -A8 $Z/v4/core/util.js
echo "== z3 union dirty"; grep -n "dirty = undefined\|if (dirty)" node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js | head
echo "== z3 int check"; grep -n 'check.kind === "int"' -A10 node_modules/.pnpm/zod@3.25.76/node_modules/zod/v3/types.js | head -14
echo "== registries"; sed -n 48,52p $Z/v4/core/registries.js
echo "== core 133-141"; sed -n 133,141p $Z/v4/core/core.js
