/**
 * Layout-only templates — only positions / dimensions / shapes, NO
 * materials or furniture. Applying one clears the current floor's
 * enabled rooms and replaces them with the template's room set.
 *
 * Used by FloorPlanAll's "📋 户型" picker.
 *
 * Coords: cm, origin = floor's back-left corner (same convention as
 * roomLayout). `shape.points` are in room-local cm (origin = room
 * back-left).
 */
import type { RoomType } from "./types";
import type { RoomShape } from "./roomGeometry";

export interface LayoutTemplateRoom {
  room: RoomType;
  x: number;           // cm
  y: number;
  width: number;       // cm
  depth: number;
  shape?: RoomShape;
}

export interface FloorplanLayout {
  id: string;
  name: string;
  area: number;        // ㎡, display only
  rooms: LayoutTemplateRoom[];
}

// All templates fit inside ~1200×1200 cm (12×12 m) bbox, with some padding.
// Rooms are axis-aligned (preset "rect") unless noted.

export const FLOORPLAN_LAYOUTS: FloorplanLayout[] = [
  {
    id: "studio-45",
    name: "一居室 45㎡",
    area: 45,
    rooms: [
      { room: "living",    x: 0,    y: 0,    width: 480, depth: 460 },
      { room: "kitchen",   x: 0,    y: 460,  width: 300, depth: 240 },
      { room: "bathroom",  x: 300,  y: 460,  width: 180, depth: 240 },
    ],
  },
  {
    id: "2br-south-north-85",
    name: "两居南北通透 85㎡",
    area: 85,
    rooms: [
      { room: "living",   x: 0,    y: 220,  width: 440, depth: 440 },
      { room: "kitchen",  x: 440,  y: 220,  width: 260, depth: 220 },
      { room: "bathroom", x: 440,  y: 440,  width: 260, depth: 220 },
      { room: "master",   x: 0,    y: 0,    width: 380, depth: 220 },
      { room: "bedroom",  x: 380,  y: 0,    width: 320, depth: 220 },
      { room: "balcony",  x: 0,    y: 660,  width: 700, depth: 140 },
    ],
  },
  {
    id: "3br-2lr-110",
    name: "三居两厅 110㎡",
    area: 110,
    rooms: [
      { room: "living",   x: 200,  y: 260,  width: 500, depth: 420 },
      { room: "dining",   x: 0,    y: 260,  width: 200, depth: 300 },
      { room: "kitchen",  x: 0,    y: 0,    width: 280, depth: 260 },
      { room: "bathroom", x: 280,  y: 0,    width: 200, depth: 260 },
      { room: "master",   x: 480,  y: 0,    width: 380, depth: 260 },
      { room: "bedroom",  x: 700,  y: 260,  width: 280, depth: 240 },
      { room: "bedroom2", x: 700,  y: 500,  width: 280, depth: 180 },
      { room: "balcony",  x: 200,  y: 680,  width: 500, depth: 120 },
    ],
  },
  {
    id: "l-shaped-living-95",
    name: "L 型客厅两居 95㎡",
    area: 95,
    rooms: [
      {
        room: "living", x: 0, y: 200, width: 600, depth: 500,
        shape: {
          preset: "l-shape",
          // L 型：右下角缺 40%×40%
          points: [
            [0, 0], [600, 0], [600, 300], [360, 300], [360, 500], [0, 500],
          ],
        },
      },
      { room: "kitchen",  x: 360, y: 500, width: 240, depth: 200 },
      { room: "master",   x: 0,   y: 0,   width: 340, depth: 200 },
      { room: "bedroom",  x: 340, y: 0,   width: 260, depth: 200 },
      { room: "bathroom", x: 600, y: 0,   width: 200, depth: 300 },
    ],
  },
  {
    id: "big-flat-with-study-150",
    name: "大平层带书房 150㎡",
    area: 150,
    rooms: [
      { room: "living",   x: 260,  y: 300,  width: 600, depth: 480 },
      { room: "dining",   x: 0,    y: 300,  width: 260, depth: 340 },
      { room: "kitchen",  x: 0,    y: 0,    width: 340, depth: 300 },
      { room: "bathroom", x: 340,  y: 0,    width: 220, depth: 300 },
      { room: "bathroom2",x: 860,  y: 300,  width: 200, depth: 240 },
      { room: "master",   x: 560,  y: 0,    width: 500, depth: 300 },
      { room: "closet",   x: 860,  y: 540,  width: 200, depth: 240 },
      { room: "bedroom",  x: 0,    y: 640,  width: 260, depth: 240 },
      { room: "study",    x: 0,    y: 880,  width: 260, depth: 200 },
      { room: "balcony",  x: 260,  y: 780,  width: 800, depth: 140 },
    ],
  },
];
