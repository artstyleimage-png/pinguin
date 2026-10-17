using System;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace PlantRaccoon.EditorTools
{
    /// <summary>
    /// Builds the browser (WebGL) version of PLANT RACCOON.
    /// Used by the GitHub Actions workflow (.github/workflows/plant-raccoon-webgl.yml) on every push,
    /// and available locally under PLANT RACCOON > Build WebGL.
    /// </summary>
    public static class PlantRaccoonBuild
    {
        [MenuItem("PLANT RACCOON/Build WebGL")]
        public static void BuildWebGL()
        {
            PlantRaccoonSetup.SetUpEverything();

            // GitHub Pages does not send the headers compressed Unity builds need, so ship uncompressed files.
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;

            // GameCI passes the output folder as -customBuildPath.
            string output = GetArgument("-customBuildPath") ?? "Builds/WebGL/PlantRaccoon";

            BuildReport report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { PlantRaccoonSetup.ScenePath },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None
            });

            bool success = report.summary.result == BuildResult.Succeeded;
            Debug.Log($"PLANT RACCOON WebGL build: {report.summary.result}, {report.summary.totalErrors} errors, output: {output}");

            if (Application.isBatchMode)
                EditorApplication.Exit(success ? 0 : 1);
        }

        static string GetArgument(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
                if (args[i] == name) return args[i + 1];
            return null;
        }
    }
}
