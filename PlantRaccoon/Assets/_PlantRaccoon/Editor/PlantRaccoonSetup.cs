using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using UnityEngine.SceneManagement;

namespace PlantRaccoon.EditorTools
{
    /// <summary>
    /// One-click project setup: URP asset, Player layer, Input System, materials and the complete
    /// Stage 1 scene, wired exactly as described in STAGE1_SETUP.md.
    /// Menu: PLANT RACCOON > Set Up Project and Build Stage 1 Scene.
    /// The automatic WebGL build (PlantRaccoonBuild) runs this first, so the online version always
    /// matches the scripts in the repository.
    /// </summary>
    public static class PlantRaccoonSetup
    {
        const string Root = "Assets/_PlantRaccoon";
        public const string ScenePath = Root + "/Scenes/Stage1_Prototype.unity";

        [MenuItem("PLANT RACCOON/Set Up Project and Build Stage 1 Scene")]
        public static void SetUpEverything()
        {
            ConfigureProject();
            BuildStage1Scene();
            Debug.Log("PLANT RACCOON: project configured and Stage 1 scene saved to " + ScenePath);
        }

        public static void ConfigureProject()
        {
            EnsureFolders();
            EnsurePlayerLayer();
            EnsureUrp();
            UseNewInputSystem();
            PlayerSettings.productName = "PLANT RACCOON";
            PlayerSettings.companyName = "PlantRaccoon";
            AssetDatabase.SaveAssets();
        }

        // ------------------------------------------------------------------ project

        static void EnsureFolders()
        {
            string[] folders =
            {
                "Scenes", "Prefabs", "Materials/Raccoon", "Materials/Environment", "Settings",
                "Models", "Animations", "Textures", "PhysicsMaterials", "Audio"
            };
            foreach (string folder in folders)
                Directory.CreateDirectory(Path.Combine(Root, folder));
            AssetDatabase.Refresh();
        }

        static int EnsurePlayerLayer()
        {
            Object tagManagerAsset = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/TagManager.asset")[0];
            SerializedObject tagManager = new SerializedObject(tagManagerAsset);
            SerializedProperty layers = tagManager.FindProperty("layers");

            for (int i = 0; i < layers.arraySize; i++)
                if (layers.GetArrayElementAtIndex(i).stringValue == "Player")
                    return i;

            for (int i = 6; i < layers.arraySize; i++) // 0-5 are Unity's built-in layers
            {
                SerializedProperty layer = layers.GetArrayElementAtIndex(i);
                if (string.IsNullOrEmpty(layer.stringValue))
                {
                    layer.stringValue = "Player";
                    tagManager.ApplyModifiedPropertiesWithoutUndo();
                    return i;
                }
            }

            Debug.LogError("PLANT RACCOON: no free layer for 'Player'.");
            return 0;
        }

        static void EnsureUrp()
        {
            string assetPath = Root + "/Settings/PlantRaccoon_URP.asset";
            string rendererPath = Root + "/Settings/PlantRaccoon_URP_Renderer.asset";

            UniversalRenderPipelineAsset urp = AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>(assetPath);
            if (urp == null)
            {
                UniversalRendererData renderer = ScriptableObject.CreateInstance<UniversalRendererData>();
                AssetDatabase.CreateAsset(renderer, rendererPath);
                urp = UniversalRenderPipelineAsset.Create(renderer);
                AssetDatabase.CreateAsset(urp, assetPath);
            }

            urp.shadowDistance = 60f;
            EditorUtility.SetDirty(urp);

            GraphicsSettings.defaultRenderPipeline = urp;
            int current = QualitySettings.GetQualityLevel();
            for (int i = 0; i < QualitySettings.names.Length; i++)
            {
                QualitySettings.SetQualityLevel(i, false);
                QualitySettings.renderPipeline = urp;
            }
            QualitySettings.SetQualityLevel(current, false);
        }

        // Same as Project Settings > Player > Active Input Handling = "Input System Package (New)".
        static void UseNewInputSystem()
        {
            Object[] playerSettings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/ProjectSettings.asset");
            if (playerSettings.Length == 0) return;

            SerializedObject so = new SerializedObject(playerSettings[0]);
            SerializedProperty handler = so.FindProperty("activeInputHandler");
            if (handler == null)
            {
                Debug.LogWarning("PLANT RACCOON: could not find activeInputHandler; set Active Input Handling manually.");
                return;
            }
            handler.intValue = 1; // 0 = old Input Manager, 1 = Input System, 2 = both
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        // ------------------------------------------------------------------ scene

        public static void BuildStage1Scene()
        {
            int playerLayer = LayerMask.NameToLayer("Player");
            if (playerLayer < 0) playerLayer = EnsurePlayerLayer();
            int everythingButPlayer = ~(1 << playerLayer);

            Scene scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // Lighting: warm sun, flat-ish three-colour ambient and light fog: cheap early-2010s daylight.
            GameObject sun = new GameObject("Directional Light");
            Light light = sun.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            light.color = Hex("FFF4E5");
            light.shadows = LightShadows.Soft;
            sun.transform.rotation = Quaternion.Euler(50f, -30f, 0f);
            RenderSettings.sun = light;

            Material sky = Mat("Environment", "M_Sky", Color.white, 0f, "Skybox/Procedural");
            RenderSettings.skybox = sky;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = Hex("A9BFD6");
            RenderSettings.ambientEquatorColor = Hex("8E8B82");
            RenderSettings.ambientGroundColor = Hex("4A473F");
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = Hex("BCC8D2");
            RenderSettings.fogStartDistance = 35f;
            RenderSettings.fogEndDistance = 140f;

            // Camera
            GameObject cameraObject = new GameObject("Main Camera") { tag = "MainCamera" };
            Camera cam = cameraObject.AddComponent<Camera>();
            cam.nearClipPlane = 0.05f;
            cam.farClipPlane = 300f;
            cam.fieldOfView = 60f;
            cam.clearFlags = CameraClearFlags.Skybox;
            cameraObject.AddComponent<AudioListener>();
            cameraObject.transform.SetPositionAndRotation(new Vector3(0f, 1.5f, -3.5f), Quaternion.Euler(15f, 0f, 0f));

            // Test area
            GameObject area = new GameObject("TestArea");
            TestAreaBuilder areaBuilder = area.AddComponent<TestAreaBuilder>();
            SetRef(areaBuilder, "groundMaterial", Mat("Environment", "M_TestGround", Hex("6B735F"), 0.1f));
            SetRef(areaBuilder, "wallMaterial", Mat("Environment", "M_TestWall", Hex("A69E94"), 0.15f));
            SetRef(areaBuilder, "rampMaterial", Mat("Environment", "M_TestRamp", Hex("8C7F6B"), 0.1f));
            SetRef(areaBuilder, "crateMaterial", Mat("Environment", "M_TestCrate", Hex("9A6B40"), 0.2f));
            areaBuilder.Build();

            // Raccoon
            GameObject raccoon = new GameObject("Raccoon") { tag = "Player", layer = playerLayer };
            raccoon.transform.position = new Vector3(0f, 0.1f, 0f);

            Rigidbody body = raccoon.AddComponent<Rigidbody>();
            body.mass = 8f;
            body.linearDamping = 0f;
            body.angularDamping = 0.05f;
            body.interpolation = RigidbodyInterpolation.Interpolate;
            body.collisionDetectionMode = CollisionDetectionMode.Continuous;
            body.constraints = RigidbodyConstraints.FreezeRotation;

            CapsuleCollider capsule = raccoon.AddComponent<CapsuleCollider>();
            capsule.center = new Vector3(0f, 0.25f, 0.05f);
            capsule.radius = 0.25f;
            capsule.height = 1f;
            capsule.direction = 2; // Z axis

            RaccoonInput input = raccoon.AddComponent<RaccoonInput>();

            RaccoonMovement movement = raccoon.AddComponent<RaccoonMovement>();
            SetRef(movement, "cameraTransform", cameraObject.transform);
            SetMask(movement, "groundLayers", everythingButPlayer);

            FallRespawn respawn = raccoon.AddComponent<FallRespawn>();
            SetRef(respawn, "input", input);

            RaccoonPlaceholderBuilder visualBuilder = raccoon.AddComponent<RaccoonPlaceholderBuilder>();
            SetRef(visualBuilder, "furMaterial", Mat("Raccoon", "M_RaccoonFur", Hex("7A736B"), 0.2f));
            SetRef(visualBuilder, "darkMaterial", Mat("Raccoon", "M_RaccoonDark", Hex("1F1C1A"), 0.25f));
            SetRef(visualBuilder, "lightMaterial", Mat("Raccoon", "M_RaccoonLight", Hex("D2CBBE"), 0.15f));
            SetRef(visualBuilder, "eyeMaterial", Mat("Raccoon", "M_RaccoonEye", Hex("050505"), 0.9f));

            RaccoonPlaceholderAnimator animator = raccoon.AddComponent<RaccoonPlaceholderAnimator>();
            SetRef(animator, "movement", movement);

            visualBuilder.Build();

            Transform cameraTarget = new GameObject("CameraTarget").transform;
            cameraTarget.SetParent(raccoon.transform, false);
            cameraTarget.localPosition = new Vector3(0f, 0.6f, 0f);

            ThirdPersonCamera follow = cameraObject.AddComponent<ThirdPersonCamera>();
            SetRef(follow, "target", cameraTarget);
            SetRef(follow, "input", input);
            SetMask(follow, "collisionLayers", everythingButPlayer);

            // Game manager
            GameObject manager = new GameObject("GameManager");
            CursorLock cursorLock = manager.AddComponent<CursorLock>();
            SetRef(cursorLock, "input", input);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
        }

        // ------------------------------------------------------------------ helpers

        static Material Mat(string folder, string name, Color color, float smoothness,
            string shaderName = "Universal Render Pipeline/Lit")
        {
            string path = $"{Root}/Materials/{folder}/{name}.mat";
            Material material = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (material == null)
            {
                material = new Material(Shader.Find(shaderName));
                AssetDatabase.CreateAsset(material, path);
            }

            if (material.HasProperty("_BaseColor")) material.SetColor("_BaseColor", color);
            if (material.HasProperty("_Smoothness")) material.SetFloat("_Smoothness", smoothness);
            EditorUtility.SetDirty(material);
            return material;
        }

        static void SetRef(Object component, string field, Object value)
        {
            SerializedObject so = new SerializedObject(component);
            SerializedProperty property = so.FindProperty(field);
            if (property == null)
            {
                Debug.LogError($"PLANT RACCOON setup: field '{field}' not found on {component.GetType().Name}.");
                return;
            }
            property.objectReferenceValue = value;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static void SetMask(Object component, string field, int mask)
        {
            SerializedObject so = new SerializedObject(component);
            SerializedProperty property = so.FindProperty(field);
            if (property == null)
            {
                Debug.LogError($"PLANT RACCOON setup: field '{field}' not found on {component.GetType().Name}.");
                return;
            }
            property.intValue = mask;
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString("#" + hex, out Color color);
            return color;
        }
    }
}
