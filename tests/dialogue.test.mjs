import test from "node:test";
import assert from "node:assert/strict";
import {
  createLocalServer,
  dialoguePrompt,
  cleanLine,
} from "../scripts/local-server.mjs";
import { DialogueManager, conversationContext } from "../dist/dialogue.js";
import { PlanetWorld } from "../dist/sim/planet-world.js";

async function serverFixture(fetcher) {
  const server = createLocalServer(fetcher);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}
test("localhost bridge fixes the installed model, limits prompt, and serves the planet", async () => {
  const requests = [];
  const fixture = await serverFixture(async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/api/tags"))
      return Response.json({ models: [{ name: "llama2-uncensored:latest" }] });
    return Response.json({ message: { content: '"Keep clear of my food."' } });
  });
  try {
    const status = await (
      await fetch(fixture.base + "/api/dialogue/status")
    ).json();
    assert.equal(status.available, true);
    const page = await fetch(fixture.base + "/planet.html");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Conversations/);
    const response = await fetch(fixture.base + "/api/dialogue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        speaker: "Aster #1",
        listener: "Cinder #2",
        situation: "They bumped near food.",
        prior: "",
      }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).line, "Keep clear of my food.");
    const payload = JSON.parse(requests.at(-1).options.body);
    assert.equal(payload.model, "llama2-uncensored:latest");
    assert.equal(payload.stream, false);
    assert.equal(payload.options.num_predict, 48);
    assert.equal(
      (
        await fetch(fixture.base + "/api/dialogue", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
      ).status,
      400,
    );
  } finally {
    await new Promise((resolve) => fixture.server.close(resolve));
  }
});
test("dialogue manager carries two turns, cooldown, and discards replies after reset", async () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  let resolveSlow,
    slow = false,
    calls = 0;
  const fetcher = async (url, options) => {
    if (url.endsWith("/status"))
      return Response.json({
        available: true,
        model: "llama2-uncensored:latest",
      });
    calls++;
    if (slow)
      return new Promise((resolve) => {
        resolveSlow = () => resolve(Response.json({ line: "stale" }));
      });
    const data = JSON.parse(options.body);
    return Response.json({
      line:
        calls === 1 ? "This patch is crowded." : `I heard you: ${data.prior}`,
    });
  };
  const manager = new DialogueManager(fetcher);
  manager.attach(w);
  assert(await manager.check());
  assert(await manager.converse(w, a, b, true));
  assert.equal(manager.lines.length, 2);
  assert.match(manager.lines[1].line, /This patch is crowded/);
  assert.equal(
    manager.lastPair.get([a.id, b.id].sort((x, y) => x - y).join(":")),
    w.tick,
  );
  slow = true;
  const pending = manager.converse(w, a, b, true);
  const next = new PlanetWorld(99);
  manager.attach(next);
  resolveSlow();
  assert.equal(await pending, false);
  assert.equal(manager.lines.length, 0);
});
test("prompt includes current drives and recent physical encounter", () => {
  const w = new PlanetWorld(),
    [a, b] = w.organisms;
  a.mind.intent = "challenging";
  a.mind.reason = "A rival entered my territory";
  w.events.push({ type: "bump", actorId: a.id, receiverId: b.id });
  const context = conversationContext(w, a, b, "Leave this place");
  assert.match(context.situation, /bump/);
  assert.match(context.situation, /challenging/);
  assert.equal(context.prior, "Leave this place");
  assert.equal(cleanLine("<b>Hi</b>"), "Hi");
  assert.throws(() =>
    dialoguePrompt({ speaker: "", listener: "x", situation: "y" }),
  );
});
