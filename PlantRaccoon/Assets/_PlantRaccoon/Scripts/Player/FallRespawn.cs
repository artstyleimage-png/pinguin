using UnityEngine;

namespace PlantRaccoon
{
    /// <summary>
    /// Safety net: if the raccoon ever falls below the world (or the player presses R because it is stuck),
    /// put it back at the spawn point. Prevents soft-locks.
    /// Put this on the Raccoon.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    public class FallRespawn : MonoBehaviour
    {
        [Tooltip("Below this height the raccoon is respawned.")]
        [SerializeField] float killHeight = -15f;
        [Tooltip("Optional. If empty, the raccoon's starting position is used.")]
        [SerializeField] Transform spawnPoint;
        [Tooltip("Optional. Lets the player respawn manually with the Respawn key (R).")]
        [SerializeField] RaccoonInput input;

        Rigidbody body;
        Vector3 startPosition;
        Quaternion startRotation;

        void Awake()
        {
            body = GetComponent<Rigidbody>();
            startPosition = transform.position;
            startRotation = transform.rotation;
        }

        void Update()
        {
            if (input != null && input.RespawnPressed) Respawn();
        }

        void FixedUpdate()
        {
            if (body.position.y < killHeight) Respawn();
        }

        public void Respawn()
        {
            Vector3 position = spawnPoint != null ? spawnPoint.position : startPosition;
            Quaternion rotation = spawnPoint != null ? spawnPoint.rotation : startRotation;

            body.linearVelocity = Vector3.zero;
            body.angularVelocity = Vector3.zero;
            body.position = position;
            body.rotation = rotation;
            transform.SetPositionAndRotation(position, rotation); // avoids an interpolation "smear" across the map
        }
    }
}
