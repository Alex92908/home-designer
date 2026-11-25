// BVH (CMU mocap) → VRM humanoid retargeting — spike for the film-mocap demo.
//
// The film actor today is a procedural mannequin with no skeleton, so BVH
// cannot drive it directly. This module drives a VRM 1.0 humanoid instead:
// each frame it copies the BVH skeleton's local joint rotations onto the
// matching VRM humanoid bones, corrected by a per-bone rest-pose offset
// (q_vrm(t) = q_vrm_rest * q_bvh_rest^-1 * q_bvh(t)), and copies the Hips
// root translation (relative to frame 0, cm → m) onto the VRM hips bone so
// walk/run play in place instead of walking off the stage.
//
// BVH note: three-stdlib's BVHLoader emits tracks named
// `.bones[Hips].quaternion`, which PropertyBinding only resolves when the
// mixer root object has a `.skeleton` property — hence the plain-object
// `{ skeleton }` mixer root below (a Bone has no `.skeleton`).

import * as THREE from "three";
import type { VRM, VRMHumanoid, VRMHumanBoneName } from "@pixiv/three-vrm";

/** CMU BVH joint name → VRM 1.0 humanoid bone name. */
export const BVH_TO_VRM_BONE: Record<string, VRMHumanBoneName> = {
  Hips: "hips",
  LowerBack: "spine",
  Spine: "chest",
  Spine1: "upperChest",
  Neck: "neck",
  Head: "head",
  LeftShoulder: "leftShoulder",
  LeftArm: "leftUpperArm",
  LeftForeArm: "leftLowerArm",
  LeftHand: "leftHand",
  RightShoulder: "rightShoulder",
  RightArm: "rightUpperArm",
  RightForeArm: "rightLowerArm",
  RightHand: "rightHand",
  // LHipJoint / RHipJoint are zero-offset pass-through joints in the CMU
  // hierarchy; VRM has no equivalent, the leg swing lives in the upper leg.
  LeftUpLeg: "leftUpperLeg",
  LeftLeg: "leftLowerLeg",
  LeftFoot: "leftFoot",
  LeftToeBase: "leftToes",
  RightUpLeg: "rightUpperLeg",
  RightLeg: "rightLowerLeg",
  RightFoot: "rightFoot",
  RightToeBase: "rightToes",
  // Skipped on purpose: Neck1 (extra neck segment; VRM has neck+head only),
  // fingers (LeftFingerBase/LThumb/... — VRM has them but the CMU finger
  // data is noisy and the demo does not need it).
};

export interface RetargetStats {
  mappedBones: number;
  /** BVH root (Hips) height at frame 0, in BVH units. */
  hipsRestHeight: number;
  /** BVH skeleton height at frame 0, in BVH units. */
  bvhHeightUnits: number;
  /** Scale applied to BVH root translation (BVH units → metres). */
  positionScale: number;
}

export class BvhToVrmRetargeter {
  readonly stats: RetargetStats;
  private readonly vrm: VRM;
  private readonly humanoid: VRMHumanoid;
  private readonly bvhBones: THREE.Bone[];
  private readonly links: Array<{
    bvh: THREE.Bone;
    vrm: THREE.Object3D;
    offset: THREE.Quaternion;
  }> = [];
  private readonly vrmHips: THREE.Object3D;
  private readonly vrmHipsRest = new THREE.Vector3();
  private readonly bvhHipsRest = new THREE.Vector3();

  /**
   * @param vrm loaded VRM (rest pose, before any animation is applied)
   * @param bvhSkeleton BVH skeleton, already stepped to frame 0
   *   (action.play() + mixer.setTime(0) + mixer.update(0) — the action
   *   MUST be playing, otherwise update() applies nothing and the "rest"
   *   pose below is just identity quaternions) so its bone quaternions
   *   are the T-pose rest values.
   * @param positionScale BVH units → metres for root translation. The
   *   CMU BVH files are NOT in cm: the skeleton is ~26 units tall, so the
   *   caller measures both skeletons and passes vrmHeight/bvhHeight.
   */
  constructor(vrm: VRM, bvhSkeleton: THREE.Skeleton, positionScale: number, bvhHeightUnits: number) {
    this.vrm = vrm;
    this.humanoid = vrm.humanoid;
    this.bvhBones = bvhSkeleton.bones;

    const bvhHips = bvhSkeleton.getBoneByName("Hips");
    const vrmHips = this.humanoid.getNormalizedBoneNode("hips");
    if (!bvhHips || !vrmHips) {
      throw new Error("BvhToVrmRetargeter: missing Hips bone on BVH or VRM side");
    }
    this.vrmHips = vrmHips;
    this.vrmHipsRest.copy(vrmHips.position);
    this.bvhHipsRest.copy(bvhHips.position);
    this.stats = {
      mappedBones: 0,
      hipsRestHeight: bvhHips.position.y,
      bvhHeightUnits,
      positionScale,
    };

    const inv = new THREE.Quaternion();
    for (const bvhBone of this.bvhBones) {
      const vrmName = BVH_TO_VRM_BONE[bvhBone.name];
      if (!vrmName) continue;
      const vrmNode = this.humanoid.getNormalizedBoneNode(vrmName);
      if (!vrmNode) continue;
      // offset = q_vrm_rest * q_bvh_rest^-1
      inv.copy(bvhBone.quaternion).invert();
      const offset = vrmNode.quaternion.clone().multiply(inv);
      this.links.push({ bvh: bvhBone, vrm: vrmNode, offset });
    }
    this.stats.mappedBones = this.links.length;
  }

  /** Copy the current BVH skeleton pose onto the VRM humanoid. Call every frame after mixer.update(). */
  apply(): void {
    const q = new THREE.Quaternion();
    const delta = new THREE.Vector3();
    for (const { bvh, vrm, offset } of this.links) {
      q.copy(offset).multiply(bvh.quaternion);
      vrm.quaternion.copy(q);
    }
    // Root motion, relative to frame 0, in place (walk/run stay on stage).
    const bvhHips = this.bvhBones[0];
    delta.subVectors(bvhHips.position, this.bvhHipsRest);
    this.vrmHips.position.copy(this.vrmHipsRest).addScaledVector(delta, this.stats.positionScale);
  }
}
