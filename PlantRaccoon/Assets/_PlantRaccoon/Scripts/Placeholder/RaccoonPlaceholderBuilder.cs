using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// TEMPORARY Stage 1 visual: assembles a recognisable low-poly raccoon (body, head, black eye mask,
    /// ears, snout, four legs, striped tail) out of Unity primitives. It has NO colliders – the Raccoon's
    /// single CapsuleCollider handles physics. Stage 2 replaces all of this with a real rigged model.
    ///
    /// Usage: put on the Raccoon, assign the four materials, then right-click the component header
    /// (or the ⋮ menu) and choose "Build Placeholder Raccoon". It also builds itself on Play if missing.
    /// The raccoon faces +Z (the blue arrow in the Scene view).
    /// </summary>
    public class RaccoonPlaceholderBuilder : MonoBehaviour
    {
        public const string VisualRootName = "Visual";

        [Header("Materials (URP/Lit)")]
        [SerializeField] Material furMaterial;    // grey-brown
        [SerializeField] Material darkMaterial;   // near black: mask, paws, tail rings
        [SerializeField] Material lightMaterial;  // off-white: snout, brows, belly, ear tips
        [SerializeField] Material eyeMaterial;    // glossy black

        [SerializeField] bool buildOnAwakeIfMissing = true;

        void Awake()
        {
            if (buildOnAwakeIfMissing && transform.Find(VisualRootName) == null)
                Build();
        }

        [ContextMenu("Build Placeholder Raccoon")]
        public void Build()
        {
            Clear();

            Material fur = furMaterial != null ? furMaterial : MakeFallbackMaterial(new Color(0.48f, 0.45f, 0.42f), 0.2f);
            Material dark = darkMaterial != null ? darkMaterial : MakeFallbackMaterial(new Color(0.12f, 0.11f, 0.10f), 0.25f);
            Material light = lightMaterial != null ? lightMaterial : MakeFallbackMaterial(new Color(0.82f, 0.79f, 0.73f), 0.15f);
            Material eye = eyeMaterial != null ? eyeMaterial : MakeFallbackMaterial(Color.black, 0.9f);

            Transform visual = Empty(VisualRootName, transform, Vector3.zero);

            // ---- Body (bobs and squashes, carries head and tail) ----
            Transform bodyPivot = Empty("BodyPivot", visual, Vector3.zero);
            Part("Body", PrimitiveType.Sphere, bodyPivot, new Vector3(0f, 0.34f, 0f), new Vector3(0.44f, 0.38f, 0.78f), fur);
            Part("Belly", PrimitiveType.Sphere, bodyPivot, new Vector3(0f, 0.29f, 0.04f), new Vector3(0.36f, 0.28f, 0.62f), light);
            Part("Back", PrimitiveType.Sphere, bodyPivot, new Vector3(0f, 0.43f, -0.08f), new Vector3(0.34f, 0.22f, 0.5f), dark); // darker saddle

            // ---- Head ----
            Transform head = Empty("HeadPivot", bodyPivot, new Vector3(0f, 0.44f, 0.34f));
            Part("Head", PrimitiveType.Sphere, head, new Vector3(0f, 0.04f, 0.06f), new Vector3(0.32f, 0.28f, 0.30f), fur);
            Part("Brow", PrimitiveType.Sphere, head, new Vector3(0f, 0.11f, 0.12f), new Vector3(0.22f, 0.06f, 0.18f), light);
            Part("Mask", PrimitiveType.Sphere, head, new Vector3(0f, 0.06f, 0.12f), new Vector3(0.335f, 0.09f, 0.22f), dark);
            Part("Snout", PrimitiveType.Sphere, head, new Vector3(0f, 0f, 0.22f), new Vector3(0.15f, 0.12f, 0.2f), light);
            Part("Nose", PrimitiveType.Sphere, head, new Vector3(0f, 0.02f, 0.32f), new Vector3(0.06f, 0.05f, 0.05f), dark);
            Part("Eye_L", PrimitiveType.Sphere, head, new Vector3(-0.07f, 0.07f, 0.2f), Vector3.one * 0.045f, eye);
            Part("Eye_R", PrimitiveType.Sphere, head, new Vector3(0.07f, 0.07f, 0.2f), Vector3.one * 0.045f, eye);
            Part("Ear_L", PrimitiveType.Sphere, head, new Vector3(-0.1f, 0.18f, 0.02f), new Vector3(0.1f, 0.12f, 0.04f), fur, new Vector3(0f, 0f, 20f));
            Part("Ear_R", PrimitiveType.Sphere, head, new Vector3(0.1f, 0.18f, 0.02f), new Vector3(0.1f, 0.12f, 0.04f), fur, new Vector3(0f, 0f, -20f));
            Part("EarInner_L", PrimitiveType.Sphere, head, new Vector3(-0.1f, 0.185f, 0.035f), new Vector3(0.06f, 0.08f, 0.02f), light, new Vector3(0f, 0f, 20f));
            Part("EarInner_R", PrimitiveType.Sphere, head, new Vector3(0.1f, 0.185f, 0.035f), new Vector3(0.06f, 0.08f, 0.02f), light, new Vector3(0f, 0f, -20f));

            // ---- Striped tail: a chain of segments, each a child of the previous, so wiggles ripple down it ----
            float[] tailSizes = { 0.13f, 0.15f, 0.16f, 0.16f, 0.15f, 0.13f, 0.10f };
            Transform parent = Empty("TailRoot", bodyPivot, new Vector3(0f, 0.38f, -0.34f));
            parent.localRotation = Quaternion.Euler(18f, 0f, 0f); // tilt the tail slightly upward
            for (int i = 0; i < tailSizes.Length; i++)
            {
                Vector3 offset = i == 0 ? Vector3.zero : new Vector3(0f, 0f, -0.11f);
                Transform segment = Empty("TailSegment_" + i, parent, offset);
                bool ring = i % 2 == 1 || i == tailSizes.Length - 1; // dark rings + dark tip
                float s = tailSizes[i];
                Part("TailMesh_" + i, PrimitiveType.Sphere, segment, new Vector3(0f, 0f, -0.06f), new Vector3(s, s, s * 1.15f), ring ? dark : fur);
                parent = segment;
            }

            // ---- Legs (not under BodyPivot, so the paws stay planted while the body bobs) ----
            Leg("LegPivot_FL", visual, new Vector3(-0.13f, 0.26f, 0.22f), fur, dark);
            Leg("LegPivot_FR", visual, new Vector3(0.13f, 0.26f, 0.22f), fur, dark);
            Leg("LegPivot_BL", visual, new Vector3(-0.13f, 0.26f, -0.22f), fur, dark);
            Leg("LegPivot_BR", visual, new Vector3(0.13f, 0.26f, -0.22f), fur, dark);

            RaccoonPlaceholderAnimator animator = GetComponent<RaccoonPlaceholderAnimator>();
            if (animator != null) animator.RefreshParts();

            MarkSceneDirty();
        }

        [ContextMenu("Clear Placeholder Raccoon")]
        public void Clear()
        {
            Transform old = transform.Find(VisualRootName);
            if (old != null) DestroyImmediate(old.gameObject);
            MarkSceneDirty();
        }

        void Leg(string name, Transform parent, Vector3 hipPosition, Material legMaterial, Material pawMaterial)
        {
            Transform pivot = Empty(name, parent, hipPosition);
            // A Unity cylinder is 2 units tall, so a Y scale of 0.11 gives a 0.22 m leg.
            Part("Leg", PrimitiveType.Cylinder, pivot, new Vector3(0f, -0.12f, 0f), new Vector3(0.09f, 0.11f, 0.09f), legMaterial);
            Part("Paw", PrimitiveType.Sphere, pivot, new Vector3(0f, -0.235f, 0.03f), new Vector3(0.1f, 0.05f, 0.12f), pawMaterial);
        }

        static Transform Empty(string name, Transform parent, Vector3 localPosition)
        {
            Transform t = new GameObject(name).transform;
            t.SetParent(parent, false);
            t.localPosition = localPosition;
            return t;
        }

        static Transform Part(string name, PrimitiveType type, Transform parent, Vector3 localPosition,
            Vector3 localScale, Material material, Vector3 localEuler = default)
        {
            GameObject go = GameObject.CreatePrimitive(type);
            go.name = name;
            // Visual only: remove the primitive's collider immediately so it never fights the raccoon's own collider.
            DestroyImmediate(go.GetComponent<Collider>());

            Transform t = go.transform;
            t.SetParent(parent, false);
            t.localPosition = localPosition;
            t.localRotation = Quaternion.Euler(localEuler);
            t.localScale = localScale;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return t;
        }

        static Material MakeFallbackMaterial(Color color, float smoothness)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            Material m = new Material(shader) { color = color };
            if (m.HasProperty("_Smoothness")) m.SetFloat("_Smoothness", smoothness);
            return m;
        }

        void MarkSceneDirty()
        {
#if UNITY_EDITOR
            if (!Application.isPlaying)
                UnityEditor.SceneManagement.EditorSceneManager.MarkSceneDirty(gameObject.scene);
#endif
        }
    }
}
