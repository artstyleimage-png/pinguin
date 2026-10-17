using UnityEngine;
using UnityEngine.InputSystem;

namespace PlantRaccoon
{
    /// <summary>
    /// The ONLY script that reads the keyboard and mouse.
    /// Every other script asks this one ("is jump pressed?") instead of reading devices itself,
    /// so changing a key later means editing one place: the bindings in this component's Inspector.
    ///
    /// Uses the Input System package (Project Settings > Player > Active Input Handling = "Input System Package (New)").
    /// </summary>
    [DefaultExecutionOrder(-100)] // read input before the other scripts run their Update
    public class RaccoonInput : MonoBehaviour
    {
        [Header("Movement")]
        [SerializeField] InputAction move = new InputAction("Move", InputActionType.Value, expectedControlType: "Vector2");
        [SerializeField] InputAction look = new InputAction("Look", InputActionType.Value, "<Mouse>/delta", expectedControlType: "Vector2");
        [SerializeField] InputAction jump = new InputAction("Jump", InputActionType.Button, "<Keyboard>/space");
        [SerializeField] InputAction run = new InputAction("Run", InputActionType.Button, "<Keyboard>/leftShift");

        [Header("Interaction (used from Stage 3 on)")]
        [SerializeField] InputAction interact = new InputAction("Interact", InputActionType.Button, "<Keyboard>/e");
        [SerializeField] InputAction bite = new InputAction("Bite", InputActionType.Button, "<Mouse>/leftButton");
        [SerializeField] InputAction throwObject = new InputAction("Throw", InputActionType.Button, "<Mouse>/rightButton");

        [Header("System")]
        [SerializeField] InputAction pause = new InputAction("Pause", InputActionType.Button, "<Keyboard>/escape");
        [SerializeField] InputAction respawn = new InputAction("Respawn", InputActionType.Button, "<Keyboard>/r");

        // ---- Values other scripts read ----
        public Vector2 Move => move.ReadValue<Vector2>();      // x = A/D, y = W/S, length 0..1
        public Vector2 Look => look.ReadValue<Vector2>();      // mouse movement in pixels this frame
        public bool RunHeld => run.IsPressed();
        public bool JumpPressed => jump.WasPressedThisFrame();
        public bool InteractPressed => interact.WasPressedThisFrame();
        public bool BitePressed => bite.WasPressedThisFrame();
        public bool ThrowPressed => throwObject.WasPressedThisFrame();
        public bool PausePressed => pause.WasPressedThisFrame();
        public bool RespawnPressed => respawn.WasPressedThisFrame();

        InputAction[] AllActions => new[] { move, look, jump, run, interact, bite, throwObject, pause, respawn };

        // Called by Unity when the component is first added in the Editor (or when you click "Reset").
        void Reset()
        {
            EnsureDefaultBindings();
        }

        void Awake()
        {
            EnsureDefaultBindings();
        }

        void OnEnable()
        {
            foreach (InputAction action in AllActions) action.Enable();
        }

        void OnDisable()
        {
            foreach (InputAction action in AllActions) action.Disable();
        }

        /// <summary>
        /// Adds the default keys to any action that has no bindings yet.
        /// Bindings you change in the Inspector are kept.
        /// </summary>
        void EnsureDefaultBindings()
        {
            if (move.bindings.Count == 0)
            {
                move.AddCompositeBinding("2DVector")
                    .With("Up", "<Keyboard>/w")
                    .With("Down", "<Keyboard>/s")
                    .With("Left", "<Keyboard>/a")
                    .With("Right", "<Keyboard>/d");
                move.AddCompositeBinding("2DVector")
                    .With("Up", "<Keyboard>/upArrow")
                    .With("Down", "<Keyboard>/downArrow")
                    .With("Left", "<Keyboard>/leftArrow")
                    .With("Right", "<Keyboard>/rightArrow");
            }

            AddBindingIfEmpty(look, "<Mouse>/delta");
            AddBindingIfEmpty(jump, "<Keyboard>/space");
            AddBindingIfEmpty(run, "<Keyboard>/leftShift");
            AddBindingIfEmpty(interact, "<Keyboard>/e");
            AddBindingIfEmpty(bite, "<Mouse>/leftButton");
            AddBindingIfEmpty(throwObject, "<Mouse>/rightButton");
            AddBindingIfEmpty(pause, "<Keyboard>/escape");
            AddBindingIfEmpty(respawn, "<Keyboard>/r");
        }

        static void AddBindingIfEmpty(InputAction action, string path)
        {
            if (action.bindings.Count == 0) action.AddBinding(path);
        }
    }
}
