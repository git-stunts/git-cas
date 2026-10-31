cd /app; ls deno.lock 2>&1; cat node_modules/zod/package.json | grep '"version"'; readlink -f node_modules/zod; ls node_modules/.deno 2>/dev/null | grep -i zod; cat .dockerignore | head -20
