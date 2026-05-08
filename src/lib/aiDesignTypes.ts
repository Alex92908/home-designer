import type { RoomType } from "./types";

/** A room entry returned by the AI design API */
export interface AiDesignRoom {
  type: RoomType;
  widthCm: number;
  depthCm: number;
  x: number;
  y: number;
}

/** Per-floor layout returned by the AI */
export interface AiDesignFloor {
  floorIndex: number;
  rooms: AiDesignRoom[];
}

/** Full AI design result — returned by POST /api/ai-design */
export interface AiDesignResult {
  floors: number;
  exterior: {
    wallColor?: string;
    roofType?: "flat" | "gable" | "hip" | "chinese";
    roofColor?: string;
    accentColor?: string;
  };
  floorLayouts: AiDesignFloor[];
  /** Short Chinese summary shown to the user after generation */
  summary?: string;
}
