# Notes for Claude

## PLANT RACCOON (Unity project in `PlantRaccoon/`)
- The user wants to play the game in the browser after every request. Every push touching `PlantRaccoon/`
  triggers `.github/workflows/plant-raccoon-webgl.yml`, which builds WebGL with GameCI and publishes to
  https://artstyleimage-png.github.io/pinguin/plant-raccoon/
- After pushing a change: check the latest run of that workflow (GitHub MCP actions tools), read the logs if it
  failed, fix and push again, and end the reply with the play link and the build status.
- The CI build regenerates the scene from code (`Assets/_PlantRaccoon/Editor/PlantRaccoonSetup.cs`). Any new
  GameObject/component/material a stage adds must be created there too, or it will be missing online.
- Never rely on `Shader.Find` at runtime in builds: create materials as assets in the setup script.
- Reply to the user in Russian.
