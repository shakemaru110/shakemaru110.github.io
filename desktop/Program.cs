namespace Metronome;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        string? report = args.Length == 2 && args[0] == "--self-test" ? Path.GetFullPath(args[1]) : null;
        using var window = new MetronomeWindow(report);
        Application.Run(window);
        return window.ExitCode;
    }
}
