using System.Diagnostics;
using Potentiostat.Web.Hubs;
using Potentiostat.Web.Services;

var builder = WebApplication.CreateBuilder(args);

// Bind to an OS-assigned free port so the packaged exe never fails to start because a
// hardcoded port is already in use; the actual URL is only known after the app has bound,
// so the browser launch happens from the ApplicationStarted lifetime event below.
builder.WebHost.UseUrls("http://127.0.0.1:0");

builder.Services.AddControllersWithViews();
builder.Services.AddSignalR();
builder.Services.AddSingleton<IPotentiostatSessionService, PotentiostatSessionService>();

var app = builder.Build();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Home/Error");
}

app.UseStaticFiles();
app.UseRouting();

app.MapControllerRoute(
    name: "default",
    pattern: "{controller=Home}/{action=Index}/{id?}");

app.MapHub<AcquisitionHub>("/hubs/acquisition");

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = app.Urls.First();
    try
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    catch (Exception ex)
    {
        app.Logger.LogWarning(ex, "Could not auto-launch the browser. Open {Url} manually.", url);
    }
});

app.Lifetime.ApplicationStopping.Register(() =>
{
    var session = app.Services.GetRequiredService<IPotentiostatSessionService>();
    session.DisposeAsync().AsTask().GetAwaiter().GetResult();
});

app.Run();
