using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// Orbit camera that follows a target (the raccoon's CameraTarget child).
    /// Mouse rotates around the raccoon; a sphere cast pulls the camera in front of walls.
    /// Put this on the Main Camera.
    /// </summary>
    public class ThirdPersonCamera : MonoBehaviour
    {
        [Header("References")]
        [Tooltip("The empty 'CameraTarget' child of the raccoon.")]
        [SerializeField] Transform target;
        [Tooltip("The raccoon's RaccoonInput component (for mouse look).")]
        [SerializeField] RaccoonInput input;

        [Header("Orbit")]
        [SerializeField] float distance = 3.5f;
        [Tooltip("Degrees of rotation per pixel of mouse movement.")]
        [SerializeField] float mouseSensitivity = 0.1f;
        [SerializeField] bool invertY = false;
        [SerializeField] float minPitch = -20f;
        [SerializeField] float maxPitch = 65f;
        [SerializeField] float startPitch = 15f;

        [Header("Smoothing")]
        [Tooltip("How long the camera takes to catch up with the raccoon. 0 = rigid.")]
        [SerializeField] float followSmoothTime = 0.06f;
        [Tooltip("If the raccoon is suddenly this far away (teleport/respawn), snap instead of smoothing.")]
        [SerializeField] float snapDistance = 10f;

        [Header("Collision")]
        [Tooltip("Layers the camera cannot pass through. Must NOT include the Player layer.")]
        [SerializeField] LayerMask collisionLayers = ~0;
        [SerializeField] float collisionRadius = 0.2f;
        [SerializeField] float minDistance = 0.5f;
        [Tooltip("How fast the camera moves back out after a wall is no longer in the way.")]
        [SerializeField] float distanceReturnSpeed = 6f;

        float yaw;
        float pitch;
        float currentDistance;
        Vector3 pivot;
        Vector3 pivotVelocity;

        void Start()
        {
            if (target == null)
            {
                Debug.LogError("ThirdPersonCamera: no Target assigned. Drag the raccoon's CameraTarget into the Target field.", this);
                enabled = false;
                return;
            }

            yaw = target.eulerAngles.y;
            pitch = startPitch;
            pivot = target.position;
            currentDistance = distance;
        }

        // LateUpdate runs after all movement for this frame, so the camera never lags one frame behind.
        void LateUpdate()
        {
            float dt = Time.deltaTime;

            if (input != null && Cursor.lockState == CursorLockMode.Locked)
            {
                Vector2 look = input.Look;
                yaw += look.x * mouseSensitivity;
                pitch += (invertY ? 1f : -1f) * look.y * mouseSensitivity;
                pitch = Mathf.Clamp(pitch, minPitch, maxPitch);
            }

            if (Vector3.Distance(pivot, target.position) > snapDistance)
            {
                pivot = target.position;
                pivotVelocity = Vector3.zero;
            }
            else
            {
                pivot = Vector3.SmoothDamp(pivot, target.position, ref pivotVelocity, followSmoothTime);
            }

            Quaternion rotation = Quaternion.Euler(pitch, yaw, 0f);
            Vector3 back = rotation * Vector3.back;

            float wantedDistance = distance;
            if (Physics.SphereCast(pivot, collisionRadius, back, out RaycastHit hit, distance,
                    collisionLayers, QueryTriggerInteraction.Ignore))
            {
                wantedDistance = Mathf.Max(minDistance, hit.distance);
            }

            // Jump in instantly (never show the inside of a wall), ease back out slowly.
            currentDistance = wantedDistance < currentDistance
                ? wantedDistance
                : Mathf.MoveTowards(currentDistance, wantedDistance, distanceReturnSpeed * dt);

            transform.SetPositionAndRotation(pivot + back * currentDistance, rotation);
        }
    }
}
