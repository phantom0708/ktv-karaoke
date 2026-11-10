// Local admin CLI for KTV (the server must be running).
//   npm run coins -- <username> <amount>     give coins (negative to take away)
//   npm run admin -- <username> [off]        make an account admin (or remove with "off")
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [mode, username, arg] = process.argv.slice(2);
const key = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/admin.key'), 'utf8').trim();
if (!username || (mode === 'coins' && !arg)) { console.log('Dùng: npm run coins -- <tên đăng nhập> <số xu>   |   npm run admin -- <tên đăng nhập> [off]'); process.exit(1); }
const body = mode === 'admin' ? { action: 'admin', username, on: arg !== 'off' } : { action: 'coins', username, amount: Number(arg) };
const r = await fetch(`http://localhost:${process.env.PORT || 8080}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify(body) });
const j = await r.json();
if (!r.ok) { console.error(j.error === 'unknownUser' ? `Không tìm thấy tài khoản "${username}"` : `Lỗi: ${j.error}`); process.exit(1); }
console.log(mode === 'admin' ? `${j.username}: quyền quản trị = ${j.admin ? 'BẬT' : 'TẮT'}` : `${j.username}: ${body.amount >= 0 ? '+' : ''}${body.amount} xu → còn ${j.coins} xu`);
