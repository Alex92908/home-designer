"use client";

/**
 * SSGIPostProcessing
 *
 * Mounts INSIDE a React Three Fiber <Canvas>.
 *
 * - WebGPU path: sets up a RenderPipeline with SSGINode + DenoiseNode.
 * - WebGL path: returns null (parent Canvas already provides EffectComposer/SSAO).
 *
 * All dynamic imports are guarded so a missing module or a non-WebGPU renderer
 * simply leaves the scene untouched.
 */

import { useRef, useEffect } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import type * as THREE from "three";

// ─── SSGI parameters (pascal editor defaults) ──────────────────────────────

const SSGI_PARAMS = {
  sliceCount:        1,
  stepCount:         4,
  radius:            1,
  expFactor:         1.5,
  thickness:         0.5,
  backfaceLighting:  0.5,
  aoIntensity:       1.5,
  giIntensity:       0,
} as const;

// ─── Helper: detect WebGPU renderer ─────────────────────────────────────────

function isWebGPURenderer(gl: THREE.WebGLRenderer): boolean {
  return "isWebGPURenderer" in gl && (gl as unknown as { isWebGPURenderer: boolean }).isWebGPURenderer === true;
}

// ─── Main component ──────────────────────────────────────────────────────────

/**
 * Drop this component inside a React Three Fiber `<Canvas>`.
 *
 * On WebGPU renderers it builds an SSGI RenderPipeline and calls
 * `pipeline.render()` every frame.  On WebGL it is a no-op.
 */
export function SSGIPostProcessing() {
  const { gl, scene, camera } = useThree();

  // RenderPipeline stored in a ref so useFrame can call render() on it.
  // Typed as `any` because the WebGPU types are not part of the public
  // three TS declarations and we don't want to widen the module-level imports.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pipelineRef = useRef<any>(null);
  const activeRef   = useRef(false);

  useEffect(() => {
    if (!isWebGPURenderer(gl)) {
      // Not a WebGPU renderer — nothing to do.
      return;
    }

    let cancelled = false;

    async function buildPipeline() {
      try {
        // Dynamic imports — avoids bundling heavy WebGPU code on WebGL builds.
        const [
          { RenderPipeline },
          tslModule,
          { ssgi },
          { denoise },
        ] = await Promise.all([
          import("three/webgpu" as string) as Promise<{ RenderPipeline: new (renderer: unknown, output?: unknown) => { outputNode: unknown; needsUpdate: boolean; render: () => void } }>,
          import("three/tsl" as string) as Promise<{
            pass: (scene: unknown, camera: unknown, options?: unknown) => unknown;
            mrt: (obj: Record<string, unknown>) => unknown;
            output: unknown;
            diffuseColor: unknown;
            normalView: unknown;
            directionToColor: (v: unknown) => unknown;
            vec4: (...args: unknown[]) => unknown;
            add: (a: unknown, b: unknown) => unknown;
          }>,
          import("three/examples/jsm/tsl/display/SSGINode.js" as string) as Promise<{
            ssgi: (beauty: unknown, depth: unknown, normal: unknown, camera: unknown) => unknown;
          }>,
          import("three/examples/jsm/tsl/display/DenoiseNode.js" as string) as Promise<{
            denoise: (node: unknown, depth: unknown, normal: unknown, camera: unknown) => unknown;
          }>,
        ]);

        if (cancelled) return;

        const {
          pass,
          mrt,
          output,
          diffuseColor,
          normalView,
          directionToColor,
          vec4,
          add,
        } = tslModule;

        // ── Build the scene pass with MRT outputs ────────────────────────
        // The scene pass renders beauty, depth, and world-space normals into
        // separate render targets so SSGI can sample them.

        const scenePass = pass(scene, camera) as {
          getTextureNode: (name: string) => unknown;
          setMRT: (mrt: unknown) => void;
        };

        // Set up multiple render targets: beauty (rgba), normals (packed as colour).
        scenePass.setMRT(
          mrt({
            output,
            // Pack view-space normals into the [0,1] colour range.
            normal: directionToColor(normalView),
          }) as unknown
        );

        const beautyNode = scenePass.getTextureNode("output");
        const depthNode  = scenePass.getTextureNode("depth");
        const normalNode = scenePass.getTextureNode("normal");

        // ── SSGI node ────────────────────────────────────────────────────

        const ssgiNode = ssgi(beautyNode, depthNode, normalNode, camera) as {
          sliceCount:       number;
          stepCount:        number;
          radius:           number;
          expFactor:        number;
          thickness:        number;
          backfaceLighting: number;
          aoIntensity:      number;
          giIntensity:      number;
          getTextureNode:   (name: string) => unknown;
        };

        ssgiNode.sliceCount       = SSGI_PARAMS.sliceCount;
        ssgiNode.stepCount        = SSGI_PARAMS.stepCount;
        ssgiNode.radius           = SSGI_PARAMS.radius;
        ssgiNode.expFactor        = SSGI_PARAMS.expFactor;
        ssgiNode.thickness        = SSGI_PARAMS.thickness;
        ssgiNode.backfaceLighting = SSGI_PARAMS.backfaceLighting;
        ssgiNode.aoIntensity      = SSGI_PARAMS.aoIntensity;
        ssgiNode.giIntensity      = SSGI_PARAMS.giIntensity;

        // ── Denoise ──────────────────────────────────────────────────────

        const ssgiDenoised = denoise(ssgiNode, depthNode, normalNode, camera);

        // ── Combine: blend SSGI over the beauty pass ─────────────────────
        // ssgiDenoised.rgb carries the GI colour; .a carries ambient occlusion.
        // Multiply the beauty AO channel in and add GI on top.
        const finalOutput = add(
          vec4(
            (diffuseColor as { rgb: unknown }).rgb,
            1
          ),
          ssgiDenoised
        );

        // ── RenderPipeline ───────────────────────────────────────────────

        const pipeline = new RenderPipeline(gl);
        pipeline.outputNode  = finalOutput;
        pipeline.needsUpdate = true;

        pipelineRef.current = pipeline;
        activeRef.current   = true;
      } catch (err) {
        // Any import/setup failure → gracefully degrade to no SSGI.
        console.warn("[SSGIPostProcessing] SSGI setup failed, falling back to no SSGI:", err);
        pipelineRef.current = null;
        activeRef.current   = false;
      }
    }

    buildPipeline();

    return () => {
      cancelled = true;
      pipelineRef.current = null;
      activeRef.current   = false;
    };
  // scene and camera can change when the Canvas re-mounts; rebuild if so.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera]);

  // Drive the pipeline every frame.
  useFrame(() => {
    if (activeRef.current && pipelineRef.current) {
      try {
        pipelineRef.current.render();
      } catch {
        // If render throws (e.g. renderer was disposed), stop trying.
        activeRef.current = false;
      }
    }
  });

  // This component adds no DOM/JSX output — it only has side-effects.
  return null;
}

export default SSGIPostProcessing;
