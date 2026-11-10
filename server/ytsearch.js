// YouTube search without an API key: read the public results page (ytInitialData) and, for "load more",
// the same continuation endpoint the YouTube web page itself uses. Best effort — YouTube may change it.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
let client = { version: '2.20240101.00.00', key: null }; // refreshed from every results page

const text = (t) => t?.simpleText ?? t?.runs?.map((r) => r.text).join('') ?? '';

// walk any JSON tree and collect videoRenderer items + the continuation token
export function parseResults(root) {
  const items = []; let next = null;
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const x of o) walk(x); return; }
    if (o.videoRenderer?.videoId) {
      const v = o.videoRenderer;
      items.push({
        videoId: v.videoId, title: text(v.title), channel: text(v.ownerText || v.longBylineText || v.shortBylineText),
        thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, duration: text(v.lengthText) || null,
      });
      return;
    }
    if (o.continuationCommand?.token) next = o.continuationCommand.token;
    for (const k in o) walk(o[k]);
  };
  walk(root);
  return { items, next };
}

function extractJson(html, marker) {
  const i = html.indexOf(marker); if (i < 0) return null;
  let start = html.indexOf('{', i); let depth = 0, inStr = false, esc = false;
  for (let j = start; j < html.length; j++) {
    const c = html[j];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return JSON.parse(html.slice(start, j + 1)); }
  }
  return null;
}

export async function searchYouTube(q, pageToken) {
  if (pageToken) {
    const url = `https://www.youtube.com/youtubei/v1/search?prettyPrint=false${client.key ? `&key=${client.key}` : ''}`;
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: client.version, hl: 'vi', gl: 'VN' } }, continuation: pageToken }) });
    if (!r.ok) throw new Error(`YouTube ${r.status}`);
    return parseResults(await r.json());
  }
  const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D&hl=vi&gl=VN`, // sp = videos only
    { headers: { 'user-agent': UA, 'accept-language': 'vi,en;q=0.8', cookie: 'CONSENT=YES+1' } });
  if (!r.ok) throw new Error(`YouTube ${r.status}`);
  const html = await r.text();
  client = { version: html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? client.version, key: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? client.key };
  const data = extractJson(html, 'var ytInitialData');
  if (!data) throw new Error('Không đọc được kết quả YouTube');
  return parseResults(data);
}
