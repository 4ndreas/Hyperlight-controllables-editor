# Controllables Editor

Standalone browser editor for `lightcontrol/config/controllables.py`.

It loads the active fixtures from the parent `lightcontrol` repository, lets you move and rotate them in a 3D scene, and exports a new `controllables.py` with only `position` and `orientation` rewritten.

## Run

From the `lightcontrol` repository root:

```powershell
.\controllables-editor\start_editor.ps1
```

Default URL: `http://127.0.0.1:8765`

Optional bind host override:

```powershell
.\controllables-editor\start_editor.ps1 -BindHost 0.0.0.0
```

Rebuild the frontend bundle only when needed:

```powershell
.\controllables-editor\start_editor.ps1 -Rebuild
```

## Manual Run

Build the frontend once:

```powershell
cd .\controllables-editor\frontend
npm install
npm run build
```

Start the server with the project's existing Conda environment:

```powershell
cd ..
.\.conda\env-lc\python.exe .\controllables-editor\server.py --project-root .
```

## Notes

- The editor reads `config/controllables.py`.
- Export keeps the original file text and comments intact where possible and only replaces active `position` and `orientation` expressions inside `groups`.
- Exported orientations are written as numeric `Quaternion([x, y, z, w])` values.


## To Do

- auto artnet-in numbering 
- add items as grid
- auto DMX numbering

- add enviroment to the scene
- add custom 3d models to the fixture
- fix or add drag and dropp objects
- show wireing of the leds ?
- live mode to light up a fixture (setup help)
- live mode for simulation ?
