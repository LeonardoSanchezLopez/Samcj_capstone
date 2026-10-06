// Verificacion ESTATICA de contrato; no sustituye pruebas E2E con BD real.
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
const sources=["backend/src/routes/public.routes.js"].map(p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')).join('\n');
for(const path of ["/availability", "/book", "/quote"]){test(`existe ruta o contrato ${path}`,()=>assert.ok(sources.includes(path),`No se encontro ${path}`));}
