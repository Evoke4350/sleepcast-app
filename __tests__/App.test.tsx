/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// App fetches a real podcast feed on mount. Unmocked, this test made a live
// network request to feed.sleepwithmepodcast.com — slow, offline-fragile on a
// fresh clone, and the response landed after the test had finished, which is
// what produced "Cannot log after tests are done" on every run.
const FEED = `<?xml version="1.0"?>
<rss><channel>
  <title>Test Show</title>
  <item>
    <title>An Episode</title>
    <guid>ep-1</guid>
    <enclosure url="https://example.test/ep1.mp3" type="audio/mpeg"/>
    <pubDate>Tue, 01 Jul 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

function mockFeed(xml: string) {
  const fetchMock = jest.fn(() =>
    Promise.resolve({ok: true, text: () => Promise.resolve(xml)}),
  );
  (globalThis as {fetch?: unknown}).fetch = fetchMock;
  return fetchMock;
}

afterEach(() => {
  delete (globalThis as {fetch?: unknown}).fetch;
  jest.clearAllMocks();
});

test('loads the feed and offers a timer', async () => {
  mockFeed(FEED);
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });

  // The pool counter is the one thing that proves the whole chain ran: fetch,
  // fast-xml-parser, and the shared Episode shape the player repo defines.
  expect(tree.root.findByProps({testID: 'pool'}).props.children).toEqual([
    1,
    ' episodes ready',
  ]);
  expect(tree.root.findByProps({testID: 'start-45'})).toBeTruthy();
});

test('says so when the feed cannot be read', async () => {
  // A blank response is the shape of a dead feed host. Surfacing it beats an
  // eternal "gathering episodes…" that never resolves.
  mockFeed('<rss><channel><title>Empty</title></channel></rss>');
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });

  expect(tree.root.findByProps({testID: 'error'}).props.children).toContain(
    'no episodes',
  );
});
