import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResults } from '../server/ytsearch.js';

test('parseResults finds videos anywhere in the tree and the continuation token', () => {
  const data = { contents: { a: [
    { videoRenderer: { videoId: 'abcdefghijk', title: { runs: [{ text: 'Song ' }, { text: 'Karaoke' }] }, ownerText: { runs: [{ text: 'Chan' }] }, lengthText: { simpleText: '4:13' } } },
    { shelf: { items: [{ videoRenderer: { videoId: 'zyxwvutsrqp', title: { simpleText: 'Other' }, longBylineText: { runs: [{ text: 'B' }] } } }] } },
    { continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'TOKEN123' } } } },
  ] } };
  const r = parseResults(data);
  assert.deepEqual(r.items.map((i) => i.videoId), ['abcdefghijk', 'zyxwvutsrqp']);
  assert.equal(r.items[0].title, 'Song Karaoke'); assert.equal(r.items[0].channel, 'Chan'); assert.equal(r.items[0].duration, '4:13');
  assert.equal(r.items[1].duration, null);
  assert.equal(r.next, 'TOKEN123');
});
