# PLANT RACCOON: Stage 1 (Playable Prototype)

Stage 1 goal: a raccoon you can steer in a grey test area. It walks, runs, jumps, turns to face where it moves, bumps into crates, and is followed by a third-person camera that stays out of walls. Nothing else yet.

**What Stage 1 has:** Rigidbody movement, camera, cursor lock, a respawn safety net, a placeholder raccoon built from primitives with simple procedural "animation", and a test area.

**What Stage 1 does not have yet:** a real raccoon model (Stage 2), grabbing, biting and throwing (Stage 3), NPCs (Stage 4), the city (Stage 5), sound and menus (Stage 6).

The placeholder raccoon is not the final model. It is an assembly of spheres and cylinders: grey-brown body, black eye mask, light snout and brows, ears, four legs, and a ringed tail. It is good enough to judge proportions, scale and camera framing. In Stage 2 a real rigged model replaces it, and the movement scripts stay the same.

---

## 1. Unity project settings

| Setting | Value |
|---|---|
| Unity version | **Unity 6 LTS** (6000.0 or newer, e.g. 6000.3 LTS), installed through Unity Hub |
| Template | **Universal 3D** (also called "3D (URP)") |
| Project name | `PlantRaccoon` |

The scripts use Unity 6 names: `Rigidbody.linearVelocity`, `PhysicsMaterial`, `PhysicsMaterialCombine`. Unity 2022 used older names. See "Common errors" if you use 2022.

After the project opens:

1. **Input System package.** Open *Window > Package Manager > Unity Registry* and search "Input System". If it shows **Install**, click it. The Universal 3D template normally has it installed already.
2. **Active input handling.** Open *Edit > Project Settings > Player > Other Settings > Active Input Handling* and choose **Input System Package (New)**. If Unity asks to restart, click Yes. All PLANT RACCOON input goes through the new Input System only, so the two systems are never mixed.
3. **Physics.** In *Edit > Project Settings > Physics*, leave Gravity at (0, -9.81, 0) and the defaults as they are.
4. **Time.** In *Edit > Project Settings > Time*, leave Fixed Timestep at 0.02.
5. **Quality / shadows (optional).** Find the active URP asset (*Project Settings > Quality*, then the "Render Pipeline Asset" field) and set **Shadows > Max Distance** to about 60.
6. **Player layer.** Open *Edit > Project Settings > Tags and Layers > Layers*. In the first empty **User Layer** (usually User Layer 6), type `Player`.

## 2. Folder structure

Create these folders inside `Assets` (right-click in the Project window, then *Create > Folder*):

```
Assets/
└── _PlantRaccoon/            ← the underscore keeps it at the top of the list
    ├── Scripts/
    │   ├── Player/           RaccoonInput, RaccoonMovement, FallRespawn
    │   ├── Camera/           ThirdPersonCamera
    │   ├── Core/             CursorLock
    │   ├── Placeholder/      RaccoonPlaceholderBuilder, RaccoonPlaceholderAnimator
    │   └── Debug/            TestAreaBuilder
    ├── Materials/
    │   ├── Raccoon/
    │   └── Environment/
    ├── Scenes/
    ├── Prefabs/
    ├── Models/               (Stage 2)
    ├── Animations/           (Stage 2)
    ├── Textures/
    ├── PhysicsMaterials/     (Stage 3)
    └── Audio/                (Stage 6)
```

Copy all 8 `.cs` files from this repository's `PlantRaccoon/Assets/_PlantRaccoon/Scripts/` into the matching folders in your project. You can also copy the whole `_PlantRaccoon` folder into your project's `Assets` folder. Wait for Unity to compile, then check that the **Console** (*Window > General > Console*) shows no red errors.

## 3. The scripts

All scripts are in the `PlantRaccoon` namespace. Each one does a single job:

| Script | Goes on | Job |
|---|---|---|
| `RaccoonInput` | Raccoon | The only script that reads keyboard and mouse. To change keys, edit its bindings in the Inspector. |
| `RaccoonMovement` | Raccoon | Rigidbody walk, run, jump, turning, ground check, slopes. Fires the `Jumped` and `Landed` events. |
| `FallRespawn` | Raccoon | Puts the raccoon back at the spawn point when it falls below y = -15 or when you press R. |
| `RaccoonPlaceholderBuilder` | Raccoon | Builds the temporary primitive raccoon model under a `Visual` child. |
| `RaccoonPlaceholderAnimator` | Raccoon | Placeholder animation: legs, body bob, tail wag, air poses, landing squash. |
| `ThirdPersonCamera` | Main Camera | Mouse orbit, smooth follow, keeps the camera out of walls. |
| `CursorLock` | GameManager | Hides and locks the cursor. Escape frees it, a click locks it again. |
| `TestAreaBuilder` | TestArea | Builds the grey-box test level. |

Dependencies: `RaccoonMovement`, `ThirdPersonCamera`, `CursorLock` and `FallRespawn` read from `RaccoonInput`. `RaccoonPlaceholderAnimator` reads from `RaccoonMovement`. `RaccoonPlaceholderBuilder` tells `RaccoonPlaceholderAnimator` when it rebuilds. No other script references another one.

### Controls

| Key | Action | Stage |
|---|---|---|
| W A S D / arrow keys | Move (relative to the camera) | 1 |
| Mouse | Rotate camera | 1 |
| Space | Jump | 1 |
| Left Shift (hold) | Run | 1 |
| R | Respawn (if stuck) | 1 |
| Escape | Free the mouse cursor (pause menu comes in Stage 6) | 1 |
| E | Interact / grab / release | 3 (already bound) |
| Left mouse | Bite | 3 (already bound) |
| Right mouse | Throw held object | 3 (already bound) |

**Changing a key:** select the Raccoon, find **Raccoon Input** in the Inspector, expand an action (e.g. Jump), double-click the binding, and pick a new key with *Listen*.

## 4. Materials to create

Right-click in the folder, choose *Create > Material*, and keep the shader as **Universal Render Pipeline/Lit**. Set **Base Map** color and **Smoothness** as follows:

`Materials/Raccoon/`

| Name | Base color (hex) | Smoothness |
|---|---|---|
| `M_RaccoonFur` | `7A736B` | 0.2 |
| `M_RaccoonDark` | `1F1C1A` | 0.25 |
| `M_RaccoonLight` | `D2CBBE` | 0.15 |
| `M_RaccoonEye` | `050505` | 0.9 |

`Materials/Environment/`

| Name | Base color (hex) | Smoothness |
|---|---|---|
| `M_TestGround` | `6B735F` | 0.1 |
| `M_TestWall` | `A69E94` | 0.15 |
| `M_TestRamp` | `8C7F6B` | 0.1 |
| `M_TestCrate` | `9A6B40` | 0.2 |

The scripts fall back to auto-generated materials if you skip this step. Real assets are better because they are saved in the project and you can adjust them.

## 5. GameObjects to create, with their components and Inspector values

Create a new scene with *File > New Scene > Basic (URP)* (or "Standard"). Save it as `Assets/_PlantRaccoon/Scenes/Stage1_Prototype.unity`.

The finished hierarchy:

```
Stage1_Prototype
├── Directional Light
├── Global Volume          (if the template created one, keep it)
├── Main Camera
├── GameManager
├── TestArea
│   └── (generated: Ground, walls, ramps, stairs, blocks, crates...)
└── Raccoon
    ├── CameraTarget
    └── Visual             (generated by RaccoonPlaceholderBuilder)
```

### 5.1 Directional Light
- **Transform Rotation:** (50, -30, 0)
- **Light > Intensity:** 1.2, **Color:** a slightly warm white (`FFF4E5`)
- **Shadow Type:** Soft Shadows

### 5.2 TestArea
1. Use *GameObject > Create Empty* and rename it `TestArea`. Set Position to (0, 0, 0). If the Transform shows other values, use ⋮ > *Reset*.
2. **Add Component > Test Area Builder**, then drag the four `M_Test…` materials into its fields.
3. Click the ⋮ (three dots) at the top right of the Test Area Builder component and choose **Build Test Area**.
4. Children appear under TestArea. Save the scene (Ctrl+S).

The test area contains the following (the raccoon starts at the center, facing north, which is +Z):
- **North:** ramps at 15° and 30° (walkable) and 50° (too steep, you slide back). Crates and a crate tower are further north. A 4 m gap in the far north wall lets you test falling off the world.
- **North-east:** stairs with an invisible ramp collider and a landing at the top.
- **West:** jump blocks of 0.5, 1.0, 1.5 and 2.0 m. You should clear the first two and not the last two.
- **South:** a 0.1 m curb, and further south a low tunnel for testing camera collision.

### 5.3 Raccoon (the player)
1. Use *GameObject > Create Empty* and rename it `Raccoon`.
   - **Position:** (0, 0.1, 0). **Rotation:** (0, 0, 0). **Scale:** (1, 1, 1). The scale must stay (1,1,1).
   - **Tag:** `Player` (Unity has this tag built in).
   - **Layer:** `Player`. If Unity asks about children, choose "Yes, change children".
2. **Add Component > Rigidbody**
   - Mass: **8**
   - Linear Damping: **0**, Angular Damping: **0.05**
   - Use Gravity: **on**, Is Kinematic: **off**
   - Interpolate: **Interpolate**
   - Collision Detection: **Continuous**
   - Constraints: **Freeze Rotation X, Y, Z all ticked**

   `RaccoonMovement` enforces the last three settings in code, so they cannot be wrong at runtime.
3. **Add Component > Capsule Collider**
   - Center: **(0, 0.25, 0.05)**
   - Radius: **0.25**
   - Height: **1.0**
   - Direction: **Z-Axis**. A horizontal capsule fits a four-legged animal and makes it harder to get stuck in gaps.
   - Leave Material empty. The script assigns a zero-friction physics material at runtime so the raccoon never sticks to walls.
4. **Add Component > Raccoon Input.** The default bindings fill in automatically.
5. **Add Component > Raccoon Movement**
   - Camera Transform: drag **Main Camera** here.
   - Ground Layers: click the dropdown, choose **Everything**, then click **Player** to untick it.
   - Leave the other values at their defaults for now: Walk 3.5, Run 7, Ground Accel 30, Ground Decel 25, Air Accel 8, Turn 600, Jump Height 1.3, Coyote 0.15, Buffer 0.15, Fall Gravity ×1.8, Max Fall 30, Ground Check 0.12, Max Slope 45, Stick Force 10.
6. **Add Component > Fall Respawn**
   - Kill Height: **-15**
   - Spawn Point: leave empty (uses the start position)
   - Input: drag **Raccoon** here.
7. **Add Component > Raccoon Placeholder Builder**
   - Drag the four `M_Raccoon…` materials into Fur / Dark / Light / Eye.
   - Leave Build On Awake If Missing ticked.
8. **Add Component > Raccoon Placeholder Animator**
   - Movement: drag **Raccoon** here.
9. On the **Raccoon Placeholder Builder** component, click ⋮ and choose **Build Placeholder Raccoon**. A `Visual` child appears and you can see the raccoon in the Scene view. Check that the blue Z arrow of the Move tool points out of its face.
10. Right-click Raccoon, choose *Create Empty*, and rename the new child `CameraTarget`. Set its **Position to (0, 0.6, 0)**. This is the point the camera orbits around, slightly above the raccoon's head.

### 5.4 Main Camera
1. Select **Main Camera**. It must keep the tag `MainCamera`. Do **not** make it a child of the raccoon.
2. Camera component: set **Clipping Planes Near** to **0.05** and **Field of View** to **60**.
3. **Add Component > Third Person Camera**
   - Target: drag **Raccoon > CameraTarget** here.
   - Input: drag **Raccoon** here.
   - Collision Layers: choose **Everything**, then untick **Player**.
   - Defaults: Distance 3.5, Sensitivity 0.1, Pitch -20 to 65, Start Pitch 15, Follow Smooth 0.06, Collision Radius 0.2, Min Distance 0.5.

### 5.5 GameManager
1. Use *GameObject > Create Empty* and rename it `GameManager`.
2. **Add Component > Cursor Lock**, then drag **Raccoon** into Input.

### 5.6 Save and register the scene
- Press **Ctrl+S**.
- In *File > Build Profiles* (in Unity 2022 it was *Build Settings*), click **Add Open Scenes**.
- Optional: drag the Raccoon from the Hierarchy into `Assets/_PlantRaccoon/Prefabs/` to make a `Raccoon` prefab.

## 6. How the scripts are connected (summary)

| Field | On component | Drag in |
|---|---|---|
| Camera Transform | Raccoon > Raccoon Movement | Main Camera |
| Input | Raccoon > Fall Respawn | Raccoon |
| Movement | Raccoon > Raccoon Placeholder Animator | Raccoon |
| Fur/Dark/Light/Eye Material | Raccoon > Raccoon Placeholder Builder | M_Raccoon… materials |
| Target | Main Camera > Third Person Camera | Raccoon/CameraTarget |
| Input | Main Camera > Third Person Camera | Raccoon |
| Input | GameManager > Cursor Lock | Raccoon |
| Materials | TestArea > Test Area Builder | M_Test… materials |

Layer masks: **Ground Layers** (Raccoon Movement) and **Collision Layers** (Third Person Camera) must both be *Everything except Player*.

## 7. Testing checklist

Press **Play** and click once in the Game view so the cursor locks.

| # | Test | Expected |
|---|---|---|
| 1 | Do nothing | Raccoon stands still, no sliding, no jitter. Tail wags lazily. |
| 2 | Hold W, move the mouse | Raccoon walks where the camera looks and turns smoothly. Legs trot, body bobs. |
| 3 | Hold Shift + W | Runs at about twice the speed. Tail lifts, wag gets faster. |
| 4 | Release all keys while running | Stops within about 0.3 s without ice-skating. |
| 5 | Space | Jumps about 1.3 m. Nose points up, then down, and the body squashes on landing. |
| 6 | Press Space just before landing | The jump still happens (jump buffer). |
| 7 | Walk off a block and press Space right after leaving it | The jump still happens (coyote time). |
| 8 | Walk into a wall diagonally | Slides along it and never sticks to it. |
| 9 | Jump into a wall | Falls down normally and does not hang on the wall. |
| 10 | 15° and 30° ramps | Walks up. Standing still on the slope does not slide down. |
| 11 | 50° ramp | Cannot walk up it and slides back down. |
| 12 | Stairs | Walks up and down smoothly. |
| 13 | Curb (0.1 m) | Walks over it. If it catches, see "Common errors". |
| 14 | Jump blocks | 0.5 and 1.0 m can be cleared, 1.5 and 2.0 m cannot. |
| 15 | Run into crates and the crate tower | Crates get shoved and the tower topples. The raccoon does not get launched or stuck. |
| 16 | Walk through the tunnel and spin the camera | The camera moves in close instead of showing the inside of the roof or walls. |
| 17 | Back up against a wall and spin the camera | The camera never ends up behind the wall. |
| 18 | Walk through the north wall gap off the edge | Falls, then respawns at the start once below -15. The camera snaps along. |
| 19 | Press R anywhere | Respawns. |
| 20 | Press Escape, then click the Game view | Cursor frees, then locks again. |
| 21 | Select Raccoon in Play mode with the Scene view visible | The ground check gizmo below the raccoon is green on the ground and red in the air. |

## 8. Common errors and fixes

| Problem | Cause / fix |
|---|---|
| `The type or namespace name 'InputSystem' does not exist` | The Input System package is not installed. Install it from Package Manager (step 1.1). |
| Keys do nothing and the Console warns about input handling | Active Input Handling is set to "Input Manager (Old)". Change it to **Input System Package (New)** and restart Unity. |
| `'Rigidbody' does not contain a definition for 'linearVelocity'` / `PhysicsMaterial` not found | You are on Unity 2022 or older. Either upgrade to Unity 6, or replace `linearVelocity` with `velocity`, `PhysicsMaterial` with `PhysicMaterial`, and `PhysicsMaterialCombine` with `PhysicMaterialCombine`. |
| `Can't add script component … class cannot be found` | Either there is a compile error elsewhere (fix the red Console errors first), or a file was renamed. Each file name must exactly match its class name, e.g. `RaccoonMovement.cs`. |
| Everything is pink | The material is not using a URP shader, or the project is not URP. Set the shader to *Universal Render Pipeline/Lit*, and check that *Project Settings > Graphics* has a URP asset. |
| Raccoon never jumps and the ground gizmo stays red | Ground Layers is set to *Nothing*. Set it to Everything minus Player. Also check that the ground has a collider (the test area cubes do). |
| Camera keeps zooming in to the raccoon | Collision Layers includes the Player layer, or the Raccoon is not on the Player layer. |
| W moves the raccoon in a strange direction | Camera Transform is not assigned, or Main Camera lost its `MainCamera` tag. |
| Raccoon or camera jitters | Rigidbody Interpolate is off (the script sets it on, so check that the script is on the object), the camera is a child of the raccoon (it must not be), or the raccoon's scale is not (1,1,1). |
| Raccoon slides slowly while standing still | It is on a slope steeper than Max Slope Angle, or the Ground Check gizmo is red. Check Ground Layers. |
| Raccoon falls through the floor | The floor has no collider. Use a Cube (thick) rather than a Plane for big floors. Also check that Collision Detection is Continuous. |
| Raccoon catches on curbs or small steps | Keep curbs at 0.1 m or less, or put an invisible ramp collider on taller steps as the stairs do. Step-up handling is improved in Stage 3. |
| Mouse does not turn the camera | The cursor is not locked. Click inside the Game view. The camera only reads the mouse while the cursor is locked. |
| Raccoon is invisible in Play mode | The `Visual` child is missing and the builder did not run. Use ⋮ > *Build Placeholder Raccoon* and check the builder component is enabled. |
| Generated test area or raccoon disappears after reopening the scene | The scene was not saved after building. Build again and press Ctrl+S. |
| Escape in the Editor always frees the cursor | That is normal Unity Editor behaviour. Click the Game view again. |
| Crates fly away when you spawn | A crate overlaps the raccoon or another object. Move the Raccoon to an empty spot. |

## Tweaking feel

Change these values while in Play mode, then copy the good ones back after you stop. Unity resets Play-mode changes when you exit.
- **Floatier jumps:** lower Fall Gravity Multiplier (e.g. 1.3).
- **Snappier stops:** raise Ground Deceleration.
- **More awkward, committed jumps:** lower Air Acceleration (e.g. 4).
- **Camera too sensitive:** lower Mouse Sensitivity (0.05–0.08).

When every row of the testing checklist passes, Stage 1 is done. Ask for **Stage 2** (real raccoon model, materials, rigging and animations) to continue.
