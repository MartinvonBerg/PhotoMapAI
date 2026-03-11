# GPS and AI Tagger — Local Photo Geotagging & AI Metadata

Geotag photos from **GPX tracks**, place images directly on a **map**, and write **AI-generated metadata** into your files — all **locally**, without cloud services.

This Electron desktop application allows photographers to quickly:

* match photos to a **GPX track**
* assign locations directly on a **Leaflet map**
* edit **EXIF metadata**
* generate **titles, descriptions and keywords with local AI** or manually

Everything is written **directly into the image files** using **ExifTool**. (No Database used)

Supported image formats:

* JPG
* WebP
* AVIF
* HEIC
* TIFF

---

# Quick Start

1. Download the latest **Windows release** (Sorry, none for MAC and Linux)
2. Unzip the archive
3. Run (the first chosen App Name is used for the *.exe)

```
GpxTaggerApp.exe
```

4. Select an **image folder**
5. Load a **GPX track** or place images manually on the map

There is **no installer** — extraction is sufficient.

Windows Defender may warn because the executable is **not code-signed**.

---

# Screenshot

![Screenshot](App-Screenshot.png)

---
# Contents
- [GPS and AI Tagger — Local Photo Geotagging \& AI Metadata](#gps-and-ai-tagger--local-photo-geotagging--ai-metadata)
- [Quick Start](#quick-start)
- [Screenshot](#screenshot)
- [Contents](#contents)
- [Application Layout](#application-layout)
- [Localization](#localization)
- [Typical Workflow](#typical-workflow)
  - [1. Load Images](#1-load-images)
  - [2. Filter Images](#2-filter-images)
  - [3. Load a GPX Track](#3-load-a-gpx-track)
- [Geotagging via GPX Track](#geotagging-via-gpx-track)
    - [Requirements](#requirements)
    - [Procedure](#procedure)
- [Geotagging Without a GPX Track](#geotagging-without-a-gpx-track)
- [Display Images on the Map](#display-images-on-the-map)
- [Selecting Images](#selecting-images)
  - [Via Thumbnails](#via-thumbnails)
  - [Via Map](#via-map)
- [Editing Metadata](#editing-metadata)
  - [GPS Coordinates](#gps-coordinates)
  - [Altitude and Direction](#altitude-and-direction)
  - [Title, Description and Keywords](#title-description-and-keywords)
  - [Multiple Selection Behavior](#multiple-selection-behavior)
  - [Saving Metadata](#saving-metadata)
- [Keyboard Shortcuts](#keyboard-shortcuts)
    - [Thumbnail Bar](#thumbnail-bar)
    - [Map](#map)
    - [Metadata Editor](#metadata-editor)
- [Known Limitations](#known-limitations)
- [Changelog](#changelog)
- [Disclaimer](#disclaimer)
  - [Development Note](#development-note)
  - [Developer Setup](#developer-setup)
    - [Development Requirements](#development-requirements)
- [Debug Logging](#debug-logging)

<!-- TOC -->
---

# Application Layout

After starting the application:

* **Left sidebar**
  GPX track information and geotagging controls

* **Center area**
  Leaflet map and optional track chart

* **Bottom area**
  Image thumbnails

* **Right sidebar**
  Metadata editor for the selected image

If no images or GPX file are loaded these areas remain empty (map may sometimes show old data, just reload app to get rid of it.)

The application remembers:

* window size and position
* pane layout
* last used paths

Settings are stored as **JSON in the user directory**, not in the project folder.

Window placement may be wrong when switching between different monitors — a known Electron limitation.

---

# Localization

The app detects the system language using `app.getLocale()`.

Available translations:

* English
* German

Translation files are located in:

```
locales/<language>/translation.json
```

Fallback language: **English**

---

# Typical Workflow

## 1. Load Images

Menu:

```
Image Folder → Select Folder
```

Supported extensions:

```
jpg, webp, avif, heic, tiff
```

Extensions can be configured in:

```
user-settings.json
```

Example:

```json
"extensions": [
  "jpg",
  "webp",
  "avif",
  "heic",
  "tiff"
]
```

When loading a folder:

* all images are scanned
* thumbnails are generated
* this may take time for large folders

There is currently **no progress indicator**.

Thumbnail size is defined in:

```
ollama_config.json
```

Reset the folder via:

```
Image Folder → Reset Folder
```

---

## 2. Filter Images

The **left sidebar** allows filtering by:

* file extension
* GPS data present / missing
* images located within the GPX track

If the filtered result contains **0 images**, GPS modification is disabled.

---

## 3. Load a GPX Track

Menu:

```
GPX Track → Open GPX File
```

The track appears on the map and track information is displayed.

The filter also updates the number of images whose timestamps match the track.

Remove the track via:

```
GPX Track → Clear GPX File
```

---

# Geotagging via GPX Track

### Requirements

* Images loaded
* GPX file loaded
* At least **one image selected**

### Procedure

1. In the **tracklog section** (left sidebar)

   * adjust the **time offset** between camera time and GPX track
   * or click on the map near the track where the photo was taken

Tip:

Photograph the GPS device showing the time at the start of the track to document time differences.

Use **RESET** if there is no offset.

2. Click the **Tracklog button** to start geotagging.

Existing GPS data will be **overwritten**.

3. **ExifTool** writes the coordinates and altitude directly into the image files.

ExifTool also creates **backup files** in the same folder.

4. After completion the images reload and appear as **markers on the map**.

Thumbnail status changes:

* red → no GPS
* green → GPS assigned

---

# Geotagging Without a GPX Track

1. Load images (they appear red if GPS is missing)

2. Select one or more images in the thumbnail bar

3. Choose a location on the map (or search for one)

4. Press:

```
CTRL + left click
```

to assign GPS coordinates and altitude.

5. Save the metadata using the **Save button in the right sidebar**.

Only the **currently selected images** are saved.

---

# Display Images on the Map

If images contain GPS data:

* markers appear on the map
* hovering shows:

  * image index
  * title
  * thumbnail preview

Clicking a marker:

* activates the marker
* selects the corresponding thumbnail
* updates metadata in the sidebar

---

# Selecting Images

## Via Thumbnails

Single click

* activate image
* metadata appears in right sidebar
* map zooms to image (depending on settings)

Multiple selection

```
Shift + click
```

Metadata behavior:

* identical values → shown normally
* different values → shown as `multiple` or `-8888`

Changes apply to **all selected images**.

Important:
Values are only accepted when **ENTER is pressed in each field**.

---

## Via Map

Clicking a marker:

* triggers `mapmarkerclick`
* selects the corresponding thumbnail
* loads metadata in the sidebar

---

# Editing Metadata

Metadata is edited in the **right sidebar**.

Important:

Changes are applied **only after pressing ENTER in each input field**.

---

## GPS Coordinates

Input examples:

```
48.8588443, 2.2943506
```

Other coordinate formats and Google geocodes are supported via `coordinate-parser`.

---

## Altitude and Direction

Numeric inputs with range validation.

---

## Title, Description and Keywords

Metadata can be:

* entered manually
* generated using AI (button only active if ollama + LLM is available)

Select images and press:

```
Gen AI
```

The generated metadata is written directly into the images.

---

## Multiple Selection Behavior

If values differ:

* text fields show `multiple`
* numeric fields show `-8888`

Changes apply to **all selected images**.

---

## Saving Metadata

After editing metadata you must **save immediately**.

If an image is deselected before saving, the changes are lost.

On exit with unsaved changes a dialog appears:

```
Save / Discard
```

---

# Keyboard Shortcuts

### Thumbnail Bar

* Left / Right click → select image
* Shift + click → range selection
* Shift + arrow keys → move selection
* CTRL + A → select all images

### Map

* CTRL + click → assign location

### Metadata Editor

* Click field → edit
* ENTER → confirm value and move to next field

---

# Known Limitations

Performance limitations:

* Large folders (hundreds or thousands of images)
* slow disks (HDD / USB). Copy your images to SSD and work with this images.

can result in **long loading times for thumbnails**.

---

# Changelog

V2.2.0 :

* Update JEST tests for OllamaClient.js
* Update Geolocation in main.js for partly undefined values.
* Add input of Pluscode as Coords, Add Ctrl A for Thumbnail Bar, Update npm packages
* adding structured format with JSON schema as output for ollama generate. Test with gemma3:12b, qwen3-vl:8b and llama3.2-vision:11b
* Update default settings
* npm update, Update JSON all sanitation, change Ollama generate Metadata Save, change ollama log level

V2.1.0 :

* Ollama : reload `ollama-config.json`, `prompt.txt` on every generate. Sanitize these files. Use scaled image with 'LongEdge' as Parameter (Default: 896px). Improve JSON-response parsing. Minor Bugfixes.
* Update translation files (DE, EN) and check Sanitation (done by i18next for XSS)
* Added Menu point to open all used settings Files from Menu
* Move to last active image after saving and reloading of Data / images.
* Changed GPSImageDirection Input to 0° ... 359.99° as specified by EXIF
* Update UI Input for Keywords in Right Sidebar and added the feature to add identical Tags to images with different Keywords like in LR 6.14.

V2.0.0 : This release introduces AI-assisted metadata generation, reverse geocoding, copy/paste metadata helpers, and several quality-of-life improvements.

* Added AI Metadata-Generation with API to Ollama using Model Gemma3:12b with best results. Adding ollama_config.json and prompt Template which may be changed by the user to his/her wishes. Some Translations still missing for that part. Just install Ollama and download the model gemma3:12b or any other you like.
* Added Reverse Geocoding with Nominatim.
* Updated storage and Copy of settings / config / prompt on first Run.
* Some code rework, bug fixes and refactoring in Helpers.
* Update of all npm packages
* Added some JEST-Tests, but still not complete.

V1.4.0 : Bug-Fix in Left Sidebar and its Handling, Clean-up Build Config and process, Add Config to debug main.mjs.

V1.3.0 : Update and standardize Right Sidebar Input, Bug Fixes in main.js. Fix logging in Distribution, checking sharp non-availability (still not solved)

V1.2.0 : Refactor complete code to ESM and add / change projects defs to reduce Distribution size (shrunk from 922 MB to 422 MB unpacked)

V1.1.0 : Update exiftool-vendored to 35.9.0, Fix Tag writing for Title and Description to be compliant with MWG. Add security notes from Review in Code.

V1.0.0 : First public Release.

-------------

# Disclaimer

This tool is **not a professional application**. It was primarily built as an **Electron learning project**.

There are many other tools that provide similar functionality:

* PhotoLocator – [https://github.com/meesoft/PhotoLocator](https://github.com/meesoft/PhotoLocator) (OSS, Windows) *(currently my favourite)*
* darktable – [https://www.darktable.org/](https://www.darktable.org/) (OSS)
* GeoTagNinja – [https://github.com/nemethviktor/GeoTagNinja](https://github.com/nemethviktor/GeoTagNinja) (OSS, Windows)
* ExifToolGui – [https://github.com/FrankBijnen/ExifToolGui](https://github.com/FrankBijnen/ExifToolGui) (OSS, excellent tool and makes this one almost unnecessary)
* Lightroom – still excellent, but the pricing model made it unusable for me
* Other tools for Linux/macOS/Windows exist but did not appeal to me personally

For AI tagging I evaluated:

* PhotoPrism
* IMatch

Both store metadata in a **database**, which I currently prefer to avoid.

---

## Development Note

This project was developed with heavy assistance from AI tools including:

* Sourcery
* ChatGPT
* MS Copilot
* Windsurf
* GitLens
* and occasionally good old Google search.



---

## Developer Setup

1. Clone the repository or download the source

2. Install dependencies

```
npm install
```

3. Start development mode

```
npm run devrun
```

(Check `package.json` in case the script changes.)

4. Build the application

```
npm run package          → Windows build (./dist)
npm run package:linux    → Linux build (./dist-linux)
npm run package:max      → macOS build (./dist-mac)
```

The unpacked build is roughly **451 MB**.
Release archives are around **170 MB**.

### Development Requirements

* Node.js (recommended LTS, e.g. 20.x)
* IDE such as VS Code
* **ExifTool installed and available in PATH**

```
exiftool
```

must work in the terminal.

ExifTool is bundled in the packaged EXE but required during development.

# Debug Logging

Debug output is always written to:

```
geotagger.log
```

Paths:

Windows

```
C:\Users\<USERNAME>\AppData\Roaming\<AppName>\geotagger.log
```

Linux

```
/home/<USERNAME>/.config/<AppName>/geotagger.log
```

macOS

```
/Users/<USERNAME>/Library/Application Support/<AppName>/geotagger.log
```

Logging cannot currently be disabled.
