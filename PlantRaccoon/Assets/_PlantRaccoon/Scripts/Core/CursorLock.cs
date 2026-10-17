using UnityEngine;
using UnityEngine.InputSystem;

namespace PlantRaccoon
{
    /// <summary>
    /// Hides and locks the mouse cursor while playing so the mouse controls the camera.
    /// Escape frees the cursor, clicking in the game locks it again.
    /// (Stage 6 replaces the Escape behaviour with a real pause menu.)
    /// Put this on the "GameManager" object.
    /// </summary>
    public class CursorLock : MonoBehaviour
    {
        [SerializeField] RaccoonInput input;
        [SerializeField] bool lockOnStart = true;

        void Start()
        {
            if (lockOnStart) SetLocked(true);
        }

        void Update()
        {
            if (input != null && input.PausePressed)
            {
                SetLocked(false);
            }
            else if (Cursor.lockState != CursorLockMode.Locked
                     && Mouse.current != null && Mouse.current.leftButton.wasPressedThisFrame)
            {
                SetLocked(true);
            }
        }

        public static void SetLocked(bool locked)
        {
            Cursor.lockState = locked ? CursorLockMode.Locked : CursorLockMode.None;
            Cursor.visible = !locked;
        }
    }
}
