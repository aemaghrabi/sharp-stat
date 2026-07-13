; Inno Setup script for Potentiostat Console (Potentiostat.Web).
; Built by scripts/publish-release.ps1, which supplies:
;   /DMyAppVersion=x.y.z   - release version, also used in the output filename
;   /DPublishDir=<path>    - the dotnet publish output folder to package
;
; Compile manually (for local testing) with, e.g.:
;   ISCC.exe /DMyAppVersion=1.0.0 /DPublishDir=..\publish\win-x64 installer\PotentiostatWeb.iss

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\publish\win-x64"
#endif

#define MyAppName "Potentiostat Console"
#define MyAppExeName "Potentiostat.Web.exe"
#define MyAppPublisher "IoTech LLC"

[Setup]
; Fixed GUID - keep stable across releases so upgrades replace in place instead of
; installing side-by-side.
AppId={{A26C9B18-89FE-4754-AFE7-16B5B060C386}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\release
OutputBaseFilename=PotentiostatConsole-Setup-{#MyAppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
; Shows an acknowledgements page, then requires accepting the non-commercial
; license before Setup will continue.
InfoBeforeFile=ACKNOWLEDGEMENTS.txt
LicenseFile=LICENSE.txt

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Files]
; Whole publish output (exe + wwwroot/ + appsettings*.json) - PublishSingleFile only
; bundles managed/native assemblies, not loose content files, so everything under
; PublishDir needs to travel together.
Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
