# Motion capture — spike assets

## BVH clips — `cmu/`

Six clips from the **CMU Graphics Lab Motion Capture Database**
(http://mocap.cs.cmu.edu/), BVH conversion by Bruce Hahne (cgspeed),
mirrored at https://github.com/una-dinosauria/cmu-mocap (only the 6 files
needed were fetched — no spidering of the CMU site).

- `cmu_walk.bvh` — subject 02, motion 02_01, "walk" (2.86 s, 344 frames)
- `cmu_run.bvh` — subject 09, motion 09_01, "run" (1.23 s, 149 frames)
- `cmu_idle.bvh` — subject 140, motion 140_06, "Idle" (29.68 s, 3563 frames)
- `cmu_sit.bvh` — subject 13, motion 13_01, "sit on high stool, stand up" (19.27 s, 2314 frames)
- `cmu_wave.bvh` — subject 111, motion 111_37, "Wave" (2.70 s, 325 frames)
- `cmu_punch.bvh` — subject 02, motion 02_05, "punch/strike" (15.45 s, 1855 frames)

All six parse with three-stdlib `BVHLoader`: 38 bones, 62 tracks, 120 fps.
Descriptions are from the CMU motion index (`cmu-mocap-index-text.txt`).

**License (CMU):** "This data is free for use in research and commercial
projects worldwide." The database was created with funding from NSF
EIA-0196217. The data must not be resold as data itself. Credit line
required by CMU: *"The data used in this project was obtained from
mocap.cs.cmu.edu."*

## VRM humanoid — `VRM1_Constraint_Twist_Sample.vrm`

pixiv's official `@pixiv/three-vrm` sample model (VRM 1.0, 54 humanoid
bones), taken from the three-vrm repository
(`packages/three-vrm/examples/models/`), which is MIT-licensed. The file's
own embedded meta says: author pixiv Inc., licenseUrl
https://vrm.dev/licenses/1.0/ (VRM Public License 1.0), `licenseType` field
unset. It is the model all of three-vrm's own examples load. Do not treat
it as a production character — it is a constraint-test sample, not a
ZhuyaHome character design.
