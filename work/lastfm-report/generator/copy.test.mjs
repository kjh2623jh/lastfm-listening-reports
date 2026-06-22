import assert from "node:assert/strict";
import test from "node:test";

import { generateAiCopy } from "./copy.mjs";

test("parses nested Responses API output text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      output: [{
        content: [{
          type: "output_text",
          text: JSON.stringify({
            summary: "ok",
            story: "ok",
            insights: [],
            recommendation: { title: "ok", about: "ok", why: "ok" }
          })
        }]
      }]
    })
  });

  try {
    const result = await generateAiCopy({
      kind: "weekly",
      range: { label: "test" },
      total: 1,
      uniqueTracks: 1,
      uniqueArtists: 1,
      concentration: 100,
      peak: {},
      periodFocus: {},
      deepDive: {},
      topTracks: [],
      topArtists: [],
      topAlbums: [],
      comparison: {}
    }, {
      apiKey: "test",
      model: "test",
      apiUrl: "https://example.invalid"
    });

    assert.equal(result.summary, "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
