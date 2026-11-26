// Kopiert die Supabase-Bibliothek nach public/vendor (kein CDN nötig, passt zur Content-Security-Policy).
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'node_modules/@supabase/supabase-js/dist/umd/supabase.js');
const dest = path.join(root, 'public/vendor/supabase.js');
const version = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/@supabase/supabase-js/package.json'), 'utf8')).version;
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `/* @supabase/supabase-js ${version} – MIT License */\n${fs.readFileSync(src, 'utf8')}`);
console.log(`supabase-js ${version} -> public/vendor/supabase.js`);
