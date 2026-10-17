using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// Stage 1 only: builds a grey-box test area for checking movement and collisions
    /// (ramps of different steepness, stairs, jump blocks, a curb, a low tunnel for the camera,
    /// pushable crates, and a gap in the north wall to test falling off the world).
    /// The real city replaces this in Stage 5.
    ///
    /// Usage: put on an empty "TestArea" object at (0,0,0), assign materials, then use the component's
    /// ⋮ menu > "Build Test Area". Everything is created as children of TestArea.
    /// </summary>
    public class TestAreaBuilder : MonoBehaviour
    {
        [Header("Materials (URP/Lit)")]
        [SerializeField] Material groundMaterial;
        [SerializeField] Material wallMaterial;
        [SerializeField] Material rampMaterial;
        [SerializeField] Material crateMaterial;

        [Header("Crates")]
        [SerializeField] int crateCount = 12;
        [SerializeField] float crateSize = 0.6f;
        [SerializeField] float crateMass = 3f;

        const float AreaSize = 60f;

        [ContextMenu("Build Test Area")]
        public void Build()
        {
            Clear();

            Material ground = groundMaterial != null ? groundMaterial : Fallback(new Color(0.42f, 0.45f, 0.38f));
            Material wall = wallMaterial != null ? wallMaterial : Fallback(new Color(0.65f, 0.62f, 0.58f));
            Material ramp = rampMaterial != null ? rampMaterial : Fallback(new Color(0.55f, 0.5f, 0.42f));
            Material crate = crateMaterial != null ? crateMaterial : Fallback(new Color(0.6f, 0.42f, 0.25f));

            // Ground: a thick box is much harder to fall through than a flat Plane.
            Box("Ground", new Vector3(0f, -0.5f, 0f), new Vector3(AreaSize, 1f, AreaSize), ground);

            // Boundary walls. The north wall has a 4 m gap so you can test falling off the world (respawn).
            float h = AreaSize * 0.5f;
            Box("Wall_South", new Vector3(0f, 1.5f, -h), new Vector3(AreaSize, 3f, 1f), wall);
            Box("Wall_East", new Vector3(h, 1.5f, 0f), new Vector3(1f, 3f, AreaSize), wall);
            Box("Wall_West", new Vector3(-h, 1.5f, 0f), new Vector3(1f, 3f, AreaSize), wall);
            Box("Wall_North_A", new Vector3(-16f, 1.5f, h), new Vector3(28f, 3f, 1f), wall);
            Box("Wall_North_B", new Vector3(16f, 1.5f, h), new Vector3(28f, 3f, 1f), wall);

            // Ramps: 15° and 30° should be walkable, 50° should be too steep (you slide back down).
            Ramp("Ramp_15deg", new Vector3(-12f, 0f, 6f), 15f, ramp);
            Ramp("Ramp_30deg", new Vector3(-7f, 0f, 6f), 30f, ramp);
            Ramp("Ramp_50deg_TooSteep", new Vector3(-2f, 0f, 6f), 50f, ramp);

            Stairs(new Vector3(8f, 0f, 4f), wall);

            // Jump blocks: with the default jump height (1.3 m) you clear 0.5 and 1.0, not 1.5 and 2.0.
            float[] heights = { 0.5f, 1f, 1.5f, 2f };
            for (int i = 0; i < heights.Length; i++)
                Box("JumpBlock_" + heights[i].ToString("0.0") + "m",
                    new Vector3(-20f, heights[i] * 0.5f, -6f + i * 4f), new Vector3(2f, heights[i], 2f), wall);

            // A low curb, like the sidewalks in the future city.
            Box("Curb_0.1m", new Vector3(0f, 0.05f, -8f), new Vector3(20f, 0.1f, 1f), wall);

            // Low tunnel: walk through it and check the camera does not clip through the roof or walls.
            Box("Tunnel_WallL", new Vector3(-1.5f, 0.75f, -16f), new Vector3(0.5f, 1.5f, 6f), wall);
            Box("Tunnel_WallR", new Vector3(1.5f, 0.75f, -16f), new Vector3(0.5f, 1.5f, 6f), wall);
            Box("Tunnel_Roof", new Vector3(0f, 1.65f, -16f), new Vector3(3.5f, 0.3f, 6f), wall);

            // Pushable crates: a loose group and a small tower.
            for (int i = 0; i < crateCount; i++)
            {
                int row = i / 4, col = i % 4;
                Crate("Crate_" + i, new Vector3(4f + col * 1.2f, crateSize * 0.5f, 14f + row * 1.2f), crate);
            }
            for (int i = 0; i < 4; i++)
                Crate("CrateTower_" + i, new Vector3(12f, crateSize * 0.5f + i * crateSize, 14f), crate);

            MarkSceneDirty();
        }

        [ContextMenu("Clear Test Area")]
        public void Clear()
        {
            for (int i = transform.childCount - 1; i >= 0; i--)
                DestroyImmediate(transform.GetChild(i).gameObject);
            MarkSceneDirty();
        }

        // A slab whose low end starts at 'start' (buried slightly in the ground) and rises towards +Z.
        void Ramp(string name, Vector3 start, float angle, Material material)
        {
            const float length = 8f, width = 3f, thickness = 0.3f;
            float rad = angle * Mathf.Deg2Rad;
            Vector3 center = start + new Vector3(0f, Mathf.Sin(rad) * length * 0.5f - thickness * 0.5f, Mathf.Cos(rad) * length * 0.5f);
            Transform t = Box(name, center, new Vector3(width, thickness, length), material);
            t.localRotation = Quaternion.Euler(-angle, 0f, 0f); // negative X rotation tilts the +Z end upward
        }

        // Eight 0.2 m steps plus an invisible ramp collider on top of them.
        // Invisible ramps on stairs are the standard trick: smooth movement, no getting caught on step edges.
        void Stairs(Vector3 start, Material material)
        {
            const int steps = 8;
            const float stepHeight = 0.2f, stepDepth = 0.4f, width = 3f;

            for (int i = 0; i < steps; i++)
            {
                float height = stepHeight * (i + 1);
                Box("Step_" + i, start + new Vector3(0f, height * 0.5f, i * stepDepth), new Vector3(width, height, stepDepth), material);
            }

            float topHeight = stepHeight * steps;                       // 1.6 m
            Vector3 rampLow = start + new Vector3(0f, 0f, -stepDepth * 1.5f);
            Vector3 rampHigh = start + new Vector3(0f, topHeight, (steps - 1) * stepDepth - stepDepth * 0.5f);
            Vector3 along = rampHigh - rampLow;

            GameObject rampCollider = new GameObject("Stairs_InvisibleRamp");
            rampCollider.transform.SetParent(transform, false);
            rampCollider.transform.localPosition = (rampLow + rampHigh) * 0.5f;
            rampCollider.transform.localRotation = Quaternion.LookRotation(along.normalized, Vector3.up);
            rampCollider.AddComponent<BoxCollider>().size = new Vector3(width, 0.05f, along.magnitude);

            // A landing at the top so there is somewhere to stand.
            Box("Stairs_Landing", start + new Vector3(0f, topHeight * 0.5f, steps * stepDepth - stepDepth * 0.5f + 1.5f),
                new Vector3(width, topHeight, 3f), material);
        }

        void Crate(string name, Vector3 position, Material material)
        {
            Transform t = Box(name, position, Vector3.one * crateSize, material);
            Rigidbody rb = t.gameObject.AddComponent<Rigidbody>();
            rb.mass = crateMass;
            rb.interpolation = RigidbodyInterpolation.Interpolate;
        }

        Transform Box(string name, Vector3 localPosition, Vector3 size, Material material)
        {
            GameObject go = GameObject.CreatePrimitive(PrimitiveType.Cube); // comes with a BoxCollider
            go.name = name;
            go.transform.SetParent(transform, false);
            go.transform.localPosition = localPosition;
            go.transform.localScale = size;
            go.GetComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        static Material Fallback(Color color)
        {
            Shader shader = Shader.Find("Universal Render Pipeline/Lit");
            if (shader == null) shader = Shader.Find("Standard");
            return new Material(shader) { color = color };
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
