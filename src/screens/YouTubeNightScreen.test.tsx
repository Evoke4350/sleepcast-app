import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import YouTubeNightScreen from "./YouTubeNightScreen";
import { effectiveVolume, type Episode } from "../../vendor/player/src/lib/engine";
import { loadNights } from "../../vendor/player/src/lib/rest/ledger";
import { RestSession } from "../../vendor/player/src/lib/rest/session";
import { getPlays } from "../../vendor/player/src/lib/store";
import { HEARD_SEC } from "../../vendor/player/src/lib/plays";
import type { CreatePlayerArgs, YTPlayerLike } from "../../vendor/player/src/lib/youtube-media";

const epA: Episode = {
  id: "a",
  title: "Episode A",
  url: "https://www.youtube.com/watch?v=aaa",
  feedId: "feed1",
  date: "",
  youtubeId: "aaa",
};
const epB: Episode = {
  id: "b",
  title: "Episode B",
  url: "https://www.youtube.com/watch?v=bbb",
  feedId: "feed1",
  date: "",
  youtubeId: "bbb",
};

function makeStub(overrides: Partial<YTPlayerLike> = {}): YTPlayerLike {
  return {
    getPlayerState: jest.fn(() => 1),
    playVideo: jest.fn(),
    pauseVideo: jest.fn(),
    setVolume: jest.fn(),
    getCurrentTime: jest.fn(() => 0),
    getDuration: jest.fn(() => 0),
    loadVideoById: jest.fn(),
    destroy: jest.fn(),
    ...overrides,
  };
}

/** A fake createPlayer that hands back a single stub, calling onReady
 *  synchronously (as if the iframe were already up) so YouTubeMedia's
 *  pending-command queue never comes into play — it isn't what this suite is
 *  testing. */
function makeCreatePlayer(stub: YTPlayerLike) {
  return jest.fn((args: CreatePlayerArgs) => {
    args.onReady();
    return stub;
  });
}

function advanceTicks(n: number) {
  act(() => {
    jest.advanceTimersByTime(n * 1000);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("the fade drives the player's volume to round(effectiveVolume(remaining, 60, trim) * 100)", () => {
  const stub = makeStub(); // getPlayerState -> 1 (playing) from the first tick
  const createPlayer = makeCreatePlayer(stub);
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={0.7} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });

  // Tick 1: transport is "playing" immediately, so the clock starts here.
  // remaining lands exactly on minutes*60 (600s) on this first tick — well
  // outside the 60s fade window, so volume should be full (times trim).
  advanceTicks(1);
  expect(stub.setVolume).toHaveBeenLastCalledWith(Math.round(effectiveVolume(600, 60, 0.7) * 100));

  // Advance to remaining = 11s (601 - k = 11 => k = 590), inside the fade
  // window, where the fade curve actually does something.
  advanceTicks(589);
  expect(stub.setVolume).toHaveBeenLastCalledWith(Math.round(effectiveVolume(11, 60, 0.7) * 100));

  act(() => {
    tree.unmount();
  });
});

test("the timer reaching zero stops playback, appends a rest-ledger night, and calls onEnd", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);
  const onEnd = jest.fn();
  const before = loadNights().length;

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={1} trim={1} onEnd={onEnd} createPlayer={createPlayer} />,
    );
  });

  // remaining = (minutes*60 + 1) - k; for minutes=1 that's 0 at k=61.
  advanceTicks(61);

  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(stub.destroy).toHaveBeenCalled();
  const nights = loadNights();
  expect(nights.length).toBe(before + 1);
  const last = nights[nights.length - 1];
  expect(last.endedVia).toBe("faded");
  expect(last.timerMinutes).toBe(1);

  act(() => {
    tree.unmount();
  });
});

test("tapping yt-stop ends the night as abandoned rather than faded", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);
  const onEnd = jest.fn();
  const before = loadNights().length;

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={onEnd} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(5); // playback under way, well before the timer would fade out

  act(() => {
    tree.root.findByProps({ testID: "yt-stop" }).props.onPress();
  });

  expect(onEnd).toHaveBeenCalledTimes(1);
  const nights = loadNights();
  expect(nights.length).toBe(before + 1);
  expect(nights[nights.length - 1].endedVia).toBe("abandoned");

  act(() => {
    tree.unmount();
  });
});

test("a video stuck buffering past the dead-video window advances to the next episode via pickNextEpisode", () => {
  // getPlayerState fixed at 3 (BUFFERING): never reaches "playing", so this
  // never looks like an autoplay refusal (shouldGiveUp's unstarted/cued
  // exemption doesn't apply) — it's a stuck load, and should be skipped.
  const stub = makeStub({ getPlayerState: jest.fn(() => 3) });
  const createPlayer = makeCreatePlayer(stub);
  const onEnd = jest.fn();

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA, epB]} minutes={10} trim={1} onEnd={onEnd} createPlayer={createPlayer} />,
    );
  });

  expect(tree.root.findByProps({ testID: "yt-nowplaying" }).props.children).toBe(epA.title);

  // Just under the 25s watchdog window: still epA, not skipped yet.
  advanceTicks(24);
  expect(stub.loadVideoById).not.toHaveBeenCalled();

  // Past it: epA is marked dead and pickNextEpisode hands back epB, the only
  // other episode in the lineup.
  advanceTicks(2);
  expect(stub.loadVideoById).toHaveBeenCalledWith(epB.youtubeId, 0);
  expect(tree.root.findByProps({ testID: "yt-nowplaying" }).props.children).toBe(epB.title);
  expect(onEnd).not.toHaveBeenCalled(); // the night continues — one episode left

  // epB is stuck too, and it's the last one: nothing left to play, so the
  // night ends rather than sitting on a dead frame with the countdown
  // running.
  const before = loadNights().length;
  advanceTicks(26);
  expect(onEnd).toHaveBeenCalledTimes(1);
  // Neither episode ever actually reached "playing" this whole night, so
  // RestSession was never anchored (it's constructed at the first observed
  // "playing" tick — see tick()'s started-gate) and there's nothing to
  // append to the rest ledger for a night that played nothing.
  expect(loadNights().length).toBe(before);

  act(() => {
    tree.unmount();
  });
});

test("yt-begin is shown until playback starts, then hidden once the player reports playing", () => {
  // Starts UNSTARTED (autoplay blocked) — the tap-to-begin fallback should
  // be visible and the countdown/volume should not have moved off the
  // pre-start state yet.
  const stub = makeStub({ getPlayerState: jest.fn(() => -1) });
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(3);
  expect(tree.root.findByProps({ testID: "yt-begin" })).toBeTruthy();

  // Tap it — the fallback's whole job is to be the user gesture that
  // unblocks play().
  act(() => {
    tree.root.findByProps({ testID: "yt-begin" }).props.onPress();
  });
  expect(stub.playVideo).toHaveBeenCalled();

  // Simulate the tap having worked: the stub now reports playing.
  (stub.getPlayerState as jest.Mock).mockReturnValue(1);
  advanceTicks(1);

  expect(tree.root.findAllByProps({ testID: "yt-begin" }).length).toBe(0);

  act(() => {
    tree.unmount();
  });
});

test("an episode heard past HEARD_SEC is recorded in the plays ledger", () => {
  const stub = makeStub(); // playing from tick 1
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={30} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });

  // epPlayingSinceRef is anchored on the first "playing" tick (k=1). Run
  // well past HEARD_SEC (120s) of wall-clock time, then end the night by
  // hand — flushHeard (called from endNight) is what actually writes the
  // play record.
  advanceTicks(130);
  act(() => {
    tree.root.findByProps({ testID: "yt-stop" }).props.onPress();
  });

  const play = getPlays().find((p) => p.id === epA.id);
  expect(play).toBeTruthy();
  expect(play!.heardSec).toBeGreaterThanOrEqual(HEARD_SEC);
  expect(play!.feedId).toBe(epA.feedId);
  expect(play!.title).toBe(epA.title);

  act(() => {
    tree.unmount();
  });
});

test("an episode heard for LESS than HEARD_SEC is not recorded", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={30} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });

  advanceTicks(10); // well under HEARD_SEC (120s)
  act(() => {
    tree.root.findByProps({ testID: "yt-stop" }).props.onPress();
  });

  expect(getPlays().find((p) => p.id === epA.id)).toBeUndefined();

  act(() => {
    tree.unmount();
  });
});

test("a natural end-of-video advances via nextPlayable, excluding the episode that just finished", () => {
  // getPlayerState stays "playing" throughout — this is testing the ENDED
  // callback path (onChangeState reporting ENDED, wired to
  // CreatePlayerArgs.onEnded), not the watchdog, and the watchdog must not
  // fire and confuse the assertion.
  const stub = makeStub();
  let capturedArgs: CreatePlayerArgs | null = null;
  const createPlayer = jest.fn((args: CreatePlayerArgs) => {
    capturedArgs = args;
    args.onReady();
    return stub;
  });

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA, epB]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(2); // playback under way, epA current — well under HEARD_SEC

  // epA "finishes" (the library's onChangeState(ENDED) path) without ever
  // having errored or been watchdog-marked dead. Before the nextPlayable fix
  // this could hand epA straight back — it's unheard-per-the-ledger and
  // wasn't excluded by anything except a dead-set check it was never added
  // to. nextPlayable excludes the outgoing episode itself, so with a second
  // live candidate available it must move on to epB, not repeat epA.
  act(() => {
    capturedArgs!.onEnded();
  });

  expect(stub.loadVideoById).toHaveBeenCalledWith(epB.youtubeId, 0);
  expect(tree.root.findByProps({ testID: "yt-nowplaying" }).props.children).toBe(epB.title);

  act(() => {
    tree.unmount();
  });
});

test("RestSession.tick is driven every tick once playback is under way", () => {
  const tickSpy = jest.spyOn(RestSession.prototype, "tick");
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  try {
    act(() => {
      tree = TestRenderer.create(
        <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
      );
    });

    // Tick 1 both anchors the RestSession (transport is "playing" from the
    // start) and immediately feeds it its first signal; two more ticks
    // confirm it keeps being driven, not just called once at construction.
    advanceTicks(3);
    expect(tickSpy).toHaveBeenCalledTimes(3);
    const lastSignal = tickSpy.mock.calls[tickSpy.mock.calls.length - 1][0];
    expect(typeof lastSignal.now).toBe("number");
    // remaining is still ~597s here, nowhere near the 60s fade window.
    expect(lastSignal.fadingOrDone).toBe(false);

    act(() => {
      tree.unmount();
    });
  } finally {
    tickSpy.mockRestore();
  }
});

test("yt-nowplaying has accessibilityRole header", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });

  const title = tree.root.findByProps({ testID: "yt-nowplaying" });
  expect(title.props.accessibilityRole).toBe("header");

  // the decorative moon is hidden from the screen reader (parity with PlayerScreen)
  const moon = tree.root.findAll((n) => n.props.children === "☾").find(Boolean);
  expect(moon?.props.accessibilityElementsHidden).toBe(true);
  expect(moon?.props.importantForAccessibility).toBe("no-hide-descendants");

  act(() => {
    tree.unmount();
  });
});

test("yt-stop has button role and stop label", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });

  const stopBtn = tree.root.findByProps({ testID: "yt-stop" });
  expect(stopBtn.props.accessibilityRole).toBe("button");
  expect(stopBtn.props.accessibilityLabel).toBe("stop");

  act(() => {
    tree.unmount();
  });
});

test("yt-begin has button role and start playback label when visible", () => {
  // Use UNSTARTED state so yt-begin is visible
  const stub = makeStub({ getPlayerState: jest.fn(() => -1) });
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(3);

  const beginBtn = tree.root.findByProps({ testID: "yt-begin" });
  expect(beginBtn.props.accessibilityRole).toBe("button");
  expect(beginBtn.props.accessibilityLabel).toBe("start playback");

  act(() => {
    tree.unmount();
  });
});

test("yt-countdown has humanized accessibilityLabel", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(1);

  const countdown = tree.root.findByProps({ testID: "yt-countdown" });
  expect(countdown.props.accessibilityLabel).toBeTruthy();
  expect(countdown.props.accessibilityLabel).toMatch(/^\d+ minutes \d+ seconds remaining$/);

  act(() => {
    tree.unmount();
  });
});

test("yt-volume has accessibilityLabel with percentage", () => {
  const stub = makeStub();
  const createPlayer = makeCreatePlayer(stub);

  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <YouTubeNightScreen lineup={[epA]} minutes={10} trim={1} onEnd={jest.fn()} createPlayer={createPlayer} />,
    );
  });
  advanceTicks(1);

  const volume = tree.root.findByProps({ testID: "yt-volume" });
  expect(volume.props.accessibilityLabel).toBeTruthy();
  expect(volume.props.accessibilityLabel).toMatch(/^volume \d+ percent$/);

  act(() => {
    tree.unmount();
  });
});
