using System;
using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// Rigidbody-based third-person movement for the raccoon: walk, run, jump, turn.
    ///
    /// Why a Rigidbody (and not a CharacterController)? Later stages need the raccoon to be shoved,
    /// to push shopping carts and to tumble. A Rigidbody takes part in physics for free.
    ///
    /// How it avoids the classic Rigidbody problems:
    ///  - Rotation is frozen, so the raccoon never tips over by accident (tumbling comes in a later stage, on purpose).
    ///  - The collider gets a zero-friction material, so it never sticks to walls.
    ///  - While standing on walkable ground, gravity is switched off and replaced by a small force into the ground,
    ///    so the raccoon does not slide down slopes when you let go of the keys.
    ///  - Speed changes are applied as velocity changes with a limited acceleration, so it feels responsive, not floaty.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    [RequireComponent(typeof(CapsuleCollider))]
    [RequireComponent(typeof(RaccoonInput))]
    public class RaccoonMovement : MonoBehaviour
    {
        [Header("References")]
        [Tooltip("Camera that defines 'forward'. Leave empty to use the camera tagged MainCamera.")]
        [SerializeField] Transform cameraTransform;

        [Header("Speed")]
        [SerializeField] float walkSpeed = 3.5f;
        [SerializeField] float runSpeed = 7f;
        [Tooltip("How fast the raccoon reaches its target speed on the ground (m/s per second).")]
        [SerializeField] float groundAcceleration = 30f;
        [Tooltip("How fast the raccoon stops on the ground when no key is held (m/s per second).")]
        [SerializeField] float groundDeceleration = 25f;
        [Tooltip("Steering while in the air. Low = committed, awkward jumps.")]
        [SerializeField] float airAcceleration = 8f;
        [Tooltip("Turning speed in degrees per second.")]
        [SerializeField] float turnSpeed = 600f;

        [Header("Jumping")]
        [Tooltip("Jump height in meters.")]
        [SerializeField] float jumpHeight = 1.3f;
        [Tooltip("You can still jump this many seconds after walking off a ledge.")]
        [SerializeField] float coyoteTime = 0.15f;
        [Tooltip("A jump pressed this many seconds before landing still happens.")]
        [SerializeField] float jumpBufferTime = 0.15f;
        [Tooltip("Gravity multiplier while falling. Above 1 = less floaty jumps.")]
        [SerializeField] float fallGravityMultiplier = 1.8f;
        [SerializeField] float maxFallSpeed = 30f;

        [Header("Ground Check")]
        [Tooltip("Layers counted as ground. Must NOT include the Player layer.")]
        [SerializeField] LayerMask groundLayers = ~0;
        [Tooltip("How far below the collider we still count as standing on something.")]
        [SerializeField] float groundCheckDistance = 0.12f;
        [Tooltip("Steeper slopes than this are not walkable: the raccoon slides off them.")]
        [SerializeField] float maxSlopeAngle = 45f;
        [Tooltip("Replaces gravity while grounded so the raccoon hugs slopes and stairs.")]
        [SerializeField] float groundStickForce = 10f;

        // ---- Read by other scripts (animation, sound, later stages) ----
        public bool IsGrounded { get; private set; }
        public bool IsRunning { get; private set; }
        public float HorizontalSpeed { get; private set; }
        public float WalkSpeed => walkSpeed;
        public float RunSpeed => runSpeed;
        public Vector3 Velocity => body.linearVelocity;

        /// <summary>Fired when a jump starts.</summary>
        public event Action Jumped;
        /// <summary>Fired when landing. The value is the downward speed at impact (m/s).</summary>
        public event Action<float> Landed;

        Rigidbody body;
        CapsuleCollider capsule;
        RaccoonInput input;

        Vector3 moveDirection;
        Vector3 groundNormal = Vector3.up;
        float lastGroundedTime = -10f;
        float lastJumpPressedTime = -10f;
        float ignoreGroundUntil;
        float lowestAirVelocityY;

        void Awake()
        {
            body = GetComponent<Rigidbody>();
            capsule = GetComponent<CapsuleCollider>();
            input = GetComponent<RaccoonInput>();

            // These settings are required for the controller to work, so we enforce them here.
            body.constraints = RigidbodyConstraints.FreezeRotation;
            body.interpolation = RigidbodyInterpolation.Interpolate;
            body.collisionDetectionMode = CollisionDetectionMode.Continuous;

            capsule.sharedMaterial = new PhysicsMaterial("RaccoonNoFriction")
            {
                dynamicFriction = 0f,
                staticFriction = 0f,
                bounciness = 0f,
                frictionCombine = PhysicsMaterialCombine.Minimum,
                bounceCombine = PhysicsMaterialCombine.Minimum
            };

            if (cameraTransform == null && Camera.main != null)
                cameraTransform = Camera.main.transform;
        }

        void Update()
        {
            // Button presses are read in Update (every frame) so no press is ever missed,
            // then used in FixedUpdate (every physics step).
            if (input.JumpPressed) lastJumpPressedTime = Time.time;

            IsRunning = input.RunHeld;
            moveDirection = GetCameraRelativeDirection(input.Move);

            Vector3 v = body.linearVelocity;
            HorizontalSpeed = new Vector3(v.x, 0f, v.z).magnitude;
        }

        void FixedUpdate()
        {
            bool wasGrounded = IsGrounded;
            CheckGround();

            if (IsGrounded)
            {
                lastGroundedTime = Time.time;
                if (!wasGrounded) Landed?.Invoke(-lowestAirVelocityY);
            }

            TryJump();
            ApplyMovement();
            ApplyGravity();
            RotateTowardsMovement();

            lowestAirVelocityY = IsGrounded ? 0f : Mathf.Min(lowestAirVelocityY, body.linearVelocity.y);
        }

        Vector3 GetCameraRelativeDirection(Vector2 stick)
        {
            Vector3 forward = cameraTransform != null ? cameraTransform.forward : Vector3.forward;
            Vector3 right = cameraTransform != null ? cameraTransform.right : Vector3.right;
            forward.y = 0f;
            right.y = 0f;
            forward.Normalize();
            right.Normalize();
            return Vector3.ClampMagnitude(forward * stick.y + right * stick.x, 1f);
        }

        void CheckGround()
        {
            if (Time.time < ignoreGroundUntil)
            {
                IsGrounded = false;
                groundNormal = Vector3.up;
                return;
            }

            // Start a slightly smaller sphere inside the collider's lowest point and sweep it down.
            // Works for a horizontal (Z) capsule and a vertical (Y) capsule. Assumes the raccoon's scale is (1,1,1).
            float radius = capsule.radius;
            float halfHeightDown = capsule.direction == 1 ? capsule.height * 0.5f : radius;
            Vector3 origin = transform.TransformPoint(capsule.center) + Vector3.down * (halfHeightDown - radius);
            float castRadius = radius * 0.9f;
            float castDistance = radius - castRadius + groundCheckDistance;

            if (Physics.SphereCast(origin, castRadius, Vector3.down, out RaycastHit hit, castDistance,
                    groundLayers, QueryTriggerInteraction.Ignore))
            {
                bool walkable = Vector3.Angle(hit.normal, Vector3.up) <= maxSlopeAngle;
                IsGrounded = walkable;
                groundNormal = walkable ? hit.normal : Vector3.up;
            }
            else
            {
                IsGrounded = false;
                groundNormal = Vector3.up;
            }
        }

        void TryJump()
        {
            bool jumpBuffered = Time.time - lastJumpPressedTime <= jumpBufferTime;
            bool recentlyGrounded = Time.time - lastGroundedTime <= coyoteTime;
            if (!jumpBuffered || !recentlyGrounded) return;

            // v = sqrt(2 * g * h) gives exactly jumpHeight meters with normal gravity.
            float jumpSpeed = Mathf.Sqrt(2f * Physics.gravity.magnitude * jumpHeight);
            Vector3 v = body.linearVelocity;
            v.y = jumpSpeed;
            body.linearVelocity = v;

            IsGrounded = false;
            groundNormal = Vector3.up;
            lastJumpPressedTime = -10f;
            lastGroundedTime = -10f;
            ignoreGroundUntil = Time.time + 0.15f; // don't "re-land" on the very next physics step
            Jumped?.Invoke();
        }

        void ApplyMovement()
        {
            float dt = Time.fixedDeltaTime;
            float targetSpeed = IsRunning ? runSpeed : walkSpeed;
            Vector3 desired = moveDirection * targetSpeed;
            Vector3 velocity = body.linearVelocity;

            if (IsGrounded)
            {
                // Walk along the ground surface (matters on ramps).
                Vector3 alongGround = Vector3.ProjectOnPlane(desired, groundNormal);
                if (alongGround.sqrMagnitude > 0.0001f)
                    desired = alongGround.normalized * desired.magnitude;

                Vector3 current = Vector3.ProjectOnPlane(velocity, groundNormal);
                float rate = desired.sqrMagnitude > 0.01f ? groundAcceleration : groundDeceleration;
                Vector3 next = Vector3.MoveTowards(current, desired, rate * dt);
                body.AddForce(next - current, ForceMode.VelocityChange);
            }
            else if (moveDirection.sqrMagnitude > 0.01f)
            {
                // In the air we only steer when a key is held, so flying momentum is kept (good for comedy later).
                Vector3 current = new Vector3(velocity.x, 0f, velocity.z);
                Vector3 next = Vector3.MoveTowards(current, desired, airAcceleration * dt);
                body.AddForce(next - current, ForceMode.VelocityChange);
            }
        }

        void ApplyGravity()
        {
            if (IsGrounded)
            {
                body.useGravity = false;
                body.AddForce(-groundNormal * groundStickForce, ForceMode.Acceleration);
                return;
            }

            body.useGravity = true;
            Vector3 v = body.linearVelocity;

            if (v.y < 0f)
                body.AddForce(Physics.gravity * (fallGravityMultiplier - 1f), ForceMode.Acceleration);

            if (v.y < -maxFallSpeed)
            {
                v.y = -maxFallSpeed;
                body.linearVelocity = v;
            }
        }

        void RotateTowardsMovement()
        {
            if (moveDirection.sqrMagnitude < 0.01f) return;

            Quaternion target = Quaternion.LookRotation(moveDirection, Vector3.up);
            body.MoveRotation(Quaternion.RotateTowards(body.rotation, target, turnSpeed * Time.fixedDeltaTime));
        }

        void OnValidate()
        {
            walkSpeed = Mathf.Max(0f, walkSpeed);
            runSpeed = Mathf.Max(walkSpeed, runSpeed);
            jumpHeight = Mathf.Max(0f, jumpHeight);
            fallGravityMultiplier = Mathf.Max(1f, fallGravityMultiplier);
            maxSlopeAngle = Mathf.Clamp(maxSlopeAngle, 0f, 89f);
        }

        // Draws the ground check sphere in the Scene view when the raccoon is selected.
        void OnDrawGizmosSelected()
        {
            CapsuleCollider c = capsule != null ? capsule : GetComponent<CapsuleCollider>();
            if (c == null) return;

            float halfHeightDown = c.direction == 1 ? c.height * 0.5f : c.radius;
            Vector3 origin = transform.TransformPoint(c.center) + Vector3.down * (halfHeightDown - c.radius);
            float castRadius = c.radius * 0.9f;
            float castDistance = c.radius - castRadius + groundCheckDistance;

            Gizmos.color = Application.isPlaying && IsGrounded ? Color.green : Color.red;
            Gizmos.DrawWireSphere(origin + Vector3.down * castDistance, castRadius);
        }
    }
}
