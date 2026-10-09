// Real filmed loops (Mixkit, see public/loops/CREDITS.md). Plain module: safe to import from server and client code.
export const SCENE_IDS = ["rain-roof", "fireside", "seaside", "rainforest", "snowy-forest", "morning-mist"] as const;
export type LoopSceneId = (typeof SCENE_IDS)[number];

export const LOOP_SRC: Record<LoopSceneId, string> = {
  "rain-roof": "/loops/rain-roof.mp4",
  "fireside": "/loops/fireside.mp4",
  "seaside": "/loops/seaside.mp4",
  "rainforest": "/loops/rainforest.mp4",
  "snowy-forest": "/loops/snowy-forest.mp4",
  "morning-mist": "/loops/morning-mist.mp4",
};

// First frame of each loop: shown while the video loads, under reduced motion, and if the video fails.
export const POSTER: Record<LoopSceneId, string> = {
  "rain-roof": "/loops/rain-roof.jpg",
  "fireside": "/loops/fireside.jpg",
  "seaside": "/loops/seaside.jpg",
  "rainforest": "/loops/rainforest.jpg",
  "snowy-forest": "/loops/snowy-forest.jpg",
  "morning-mist": "/loops/morning-mist.jpg",
};

export const SCENE_LABEL: Record<LoopSceneId, string> = {
  "rain-roof": "Rainy day",
  "fireside": "Fireside",
  "seaside": "Seaside",
  "rainforest": "Rainforest",
  "snowy-forest": "Snowy forest",
  "morning-mist": "Morning mist",
};

export function isSceneId(s: unknown): s is LoopSceneId {
  return typeof s === "string" && (SCENE_IDS as readonly string[]).includes(s);
}
