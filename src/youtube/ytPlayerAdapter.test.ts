// The vendor YTPlayerLike is synchronous; react-native-youtube-iframe's ref is
// async (Promise-returning getters, state via a callback). makeYtAdapter
// bridges the two with a cache: pump() refreshes the cache from the async
// ctl, setState() records the latest player-state code, and the returned
// `player` reads only the cache — never awaits — so YouTubeMedia (which
// expects plain numbers back) can drive it unmodified.
import { makeYtAdapter } from "./ytPlayerAdapter";

test("sync getters return the latest pumped async values and state", async () => {
  let t = 5, d = 100;
  const calls: string[] = [];
  const ctl = {
    getCurrentTime: async () => t, getDuration: async () => d,
    play: () => calls.push("play"), pause: () => calls.push("pause"),
    setVolume: (p: number) => calls.push("vol:" + p), load: (id: string) => calls.push("load:" + id), destroy: () => calls.push("destroy"),
  };
  const a = makeYtAdapter(ctl);
  await a.pump();
  expect(a.player.getCurrentTime()).toBe(5);
  expect(a.player.getDuration()).toBe(100);
  a.setState(1); // YT PLAYING
  expect(a.player.getPlayerState()).toBe(1);
  a.player.setVolume(50); a.player.playVideo();
  expect(calls).toContain("vol:50"); expect(calls).toContain("play");
  t = 9; await a.pump();
  expect(a.player.getCurrentTime()).toBe(9);
});

test("getCurrentTime/getDuration/getPlayerState read 0/-1 before any pump or setState", () => {
  const ctl = {
    getCurrentTime: async () => 42, getDuration: async () => 99,
    play: () => {}, pause: () => {}, setVolume: () => {}, load: () => {}, destroy: () => {},
  };
  const a = makeYtAdapter(ctl);
  expect(a.player.getCurrentTime()).toBe(0);
  expect(a.player.getDuration()).toBe(0);
  expect(a.player.getPlayerState()).toBe(-1);
});

test("pauseVideo, loadVideoById, and destroy delegate to the ctl", () => {
  const calls: string[] = [];
  const ctl = {
    getCurrentTime: async () => 0, getDuration: async () => 0,
    play: () => calls.push("play"), pause: () => calls.push("pause"),
    setVolume: (p: number) => calls.push("vol:" + p),
    load: (id: string, start?: number) => calls.push(`load:${id}:${start}`),
    destroy: () => calls.push("destroy"),
  };
  const a = makeYtAdapter(ctl);
  a.player.pauseVideo();
  a.player.loadVideoById("abc123", 30);
  a.player.destroy();
  expect(calls).toEqual(["pause", "load:abc123:30", "destroy"]);
});
