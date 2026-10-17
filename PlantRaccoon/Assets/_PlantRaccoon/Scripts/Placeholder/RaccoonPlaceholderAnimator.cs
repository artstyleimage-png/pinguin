using System.Collections.Generic;
using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// TEMPORARY Stage 1 "animation" for the primitive raccoon: stiff trotting legs, body bob and waddle,
    /// a wagging striped tail, nose-up/nose-down in the air and a squash on hard landings.
    /// Deliberately a bit awkward. Stage 2 replaces this with a real Animator on a rigged model.
    /// Put this on the Raccoon, next to RaccoonPlaceholderBuilder.
    /// </summary>
    public class RaccoonPlaceholderAnimator : MonoBehaviour
    {
        [SerializeField] RaccoonMovement movement;

        [Header("Walk Cycle")]
        [SerializeField] float strideCyclesPerMeter = 1.4f;
        [SerializeField] float legSwingAngle = 40f;
        [SerializeField] float bodyBobHeight = 0.035f;
        [SerializeField] float bodyWaddleAngle = 4f;

        [Header("Air")]
        [SerializeField] float airLegAngle = 35f;
        [SerializeField] float airPitchPerVelocity = 3f;
        [SerializeField] float maxAirPitch = 25f;

        [Header("Tail")]
        [SerializeField] float tailWiggleSpeed = 5f;
        [SerializeField] float tailWiggleAngle = 10f;
        [SerializeField] float tailRunLift = 20f;
        [SerializeField] float tailFallLift = 1.5f;

        [Header("Landing Squash")]
        [SerializeField] float maxSquash = 0.3f;
        [SerializeField] float squashRecoverSpeed = 2.5f;
        [SerializeField] float minImpactForSquash = 3f;

        Transform bodyPivot;
        Transform headPivot;
        readonly Transform[] legs = new Transform[4]; // FL, FR, BL, BR
        readonly List<Transform> tail = new List<Transform>();
        readonly List<Quaternion> tailBaseRotations = new List<Quaternion>();
        Vector3 bodyBasePosition;
        Vector3 bodyBaseScale;
        Quaternion bodyBaseRotation;
        Quaternion headBaseRotation;

        float phase;
        float airPitch;
        float squash;
        bool partsFound;

        void Awake()
        {
            if (movement == null) movement = GetComponent<RaccoonMovement>();
        }

        void Start()
        {
            RefreshParts();
        }

        void OnEnable()
        {
            if (movement != null) movement.Landed += OnLanded;
        }

        void OnDisable()
        {
            if (movement != null) movement.Landed -= OnLanded;
        }

        /// <summary>Finds the placeholder parts by name. Called again by the builder after a rebuild.</summary>
        public void RefreshParts()
        {
            Transform visual = transform.Find(RaccoonPlaceholderBuilder.VisualRootName);
            partsFound = false;
            if (visual == null) return;

            bodyPivot = FindDeep(visual, "BodyPivot");
            headPivot = FindDeep(visual, "HeadPivot");
            legs[0] = FindDeep(visual, "LegPivot_FL");
            legs[1] = FindDeep(visual, "LegPivot_FR");
            legs[2] = FindDeep(visual, "LegPivot_BL");
            legs[3] = FindDeep(visual, "LegPivot_BR");

            tail.Clear();
            tailBaseRotations.Clear();
            for (int i = 0; ; i++)
            {
                Transform segment = FindDeep(visual, "TailSegment_" + i);
                if (segment == null) break;
                tail.Add(segment);
                tailBaseRotations.Add(segment.localRotation);
            }

            if (bodyPivot == null || headPivot == null || legs[0] == null || legs[1] == null || legs[2] == null || legs[3] == null)
                return;

            bodyBasePosition = bodyPivot.localPosition;
            bodyBaseScale = bodyPivot.localScale;
            bodyBaseRotation = bodyPivot.localRotation;
            headBaseRotation = headPivot.localRotation;
            partsFound = true;
        }

        void Update()
        {
            if (!partsFound || movement == null) return;

            float dt = Time.deltaTime;
            float speed = movement.HorizontalSpeed;
            bool grounded = movement.IsGrounded;
            Vector3 velocity = movement.Velocity;
            float walk01 = Mathf.Clamp01(speed / Mathf.Max(0.01f, movement.WalkSpeed));
            float run01 = Mathf.Clamp01(speed / Mathf.Max(0.01f, movement.RunSpeed));

            phase = Mathf.Repeat(phase + speed * strideCyclesPerMeter * Mathf.PI * 2f * dt, Mathf.PI * 2f);
            float wave = Mathf.Sin(phase);

            // ---- Legs: diagonal pairs move together (trot). In the air: front legs reach forward, back legs back. ----
            if (grounded)
            {
                float swing = wave * legSwingAngle * walk01;
                SetLeg(0, swing, dt);   // FL
                SetLeg(1, -swing, dt);  // FR
                SetLeg(2, -swing, dt);  // BL (moves with FR)
                SetLeg(3, swing, dt);   // BR (moves with FL)
            }
            else
            {
                SetLeg(0, -airLegAngle, dt);
                SetLeg(1, -airLegAngle, dt);
                SetLeg(2, airLegAngle, dt);
                SetLeg(3, airLegAngle, dt);
            }

            // ---- Body: bob + waddle on the ground, nose up when rising / nose down when falling ----
            float bob = grounded ? Mathf.Abs(wave) * bodyBobHeight * walk01 : 0f;
            float waddle = grounded ? wave * bodyWaddleAngle * walk01 : 0f;
            float targetPitch = grounded ? 0f : Mathf.Clamp(-velocity.y * airPitchPerVelocity, -maxAirPitch, maxAirPitch);
            airPitch = Mathf.Lerp(airPitch, targetPitch, 1f - Mathf.Exp(-10f * dt));
            squash = Mathf.MoveTowards(squash, 0f, squashRecoverSpeed * dt);

            bodyPivot.localPosition = bodyBasePosition + Vector3.up * bob;
            bodyPivot.localRotation = bodyBaseRotation * Quaternion.Euler(airPitch, 0f, waddle);
            bodyPivot.localScale = new Vector3(
                bodyBaseScale.x * (1f + squash * 0.5f),
                bodyBaseScale.y * (1f - squash),
                bodyBaseScale.z * (1f + squash * 0.3f));

            headPivot.localRotation = headBaseRotation * Quaternion.Euler(Mathf.Sin(phase * 2f) * 4f * walk01, 0f, 0f);

            // ---- Tail: lazy wag, faster and higher when running, flops upward when falling ----
            float wagSpeed = tailWiggleSpeed * (1f + walk01);
            float wagAngle = tailWiggleAngle * (0.5f + walk01);
            float lift = (tailRunLift * run01 + Mathf.Max(0f, -velocity.y) * tailFallLift) / Mathf.Max(1, tail.Count);
            for (int i = 0; i < tail.Count; i++)
            {
                float yaw = Mathf.Sin(Time.time * wagSpeed - i * 0.7f) * wagAngle;
                float jitter = (Mathf.PerlinNoise(Time.time * 2f, i * 3.1f) - 0.5f) * 6f; // a little life
                tail[i].localRotation = tailBaseRotations[i] * Quaternion.Euler(lift + jitter, yaw, 0f);
            }
        }

        void SetLeg(int index, float angle, float dt)
        {
            legs[index].localRotation = Quaternion.Slerp(legs[index].localRotation,
                Quaternion.Euler(angle, 0f, 0f), 1f - Mathf.Exp(-15f * dt));
        }

        void OnLanded(float impactSpeed)
        {
            if (impactSpeed >= minImpactForSquash)
                squash = Mathf.Clamp(impactSpeed / 30f, 0.08f, maxSquash);
        }

        static Transform FindDeep(Transform root, string name)
        {
            if (root.name == name) return root;
            foreach (Transform child in root)
            {
                Transform found = FindDeep(child, name);
                if (found != null) return found;
            }
            return null;
        }
    }
}
