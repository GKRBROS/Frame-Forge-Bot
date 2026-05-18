#!/bin/sh
# Purge hardcoded credentials from ALL possible file locations

for f in src/routes/login.tsx src/routes/adm.tsx src/lib/rag.functions.ts; do
  if [ -f "$f" ]; then
    sed -i 's/adm@tfg\.com/admin@yourdomain.com/g' "$f"
    sed -i 's/adm@2026//g' "$f"
    sed -i '/^\s*const ADMIN_EMAIL\s*=\s*"admin@yourdomain.com";/d' "$f"
    sed -i '/^\s*const ADMIN_PASSWORD\s*=\s*"";/d' "$f"
    sed -i '/^\s*const ADMIN_EMAIL\s*=/d' "$f"
    sed -i '/^\s*const ADMIN_PASSWORD\s*=/d' "$f"
  fi
done
