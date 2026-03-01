import { app, BrowserWindow, ipcMain, Menu, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { exiftool } from 'exiftool-vendored';

import { sortImagesByCaptureTime } from './js/imageHelper.js';
import { sanitize } from './js/generalHelpers.js';
import { loadSettings, saveSettings } from './js/settingsHelper.js';
import { isValidLocation } from './js/ExifHandler.js';
import { OllamaClient } from './aitagging/OllamaClient.js';
import { reverseGeocodeToXmp } from './js/nominatim.js'
import { isNumber } from './js/generalHelpers.js';
import { isValidLatLng, dmsToDecimal } from './js/TrackAndGpsHandler.js';

const isDev = !app.isPackaged;
// write to a log file if the exe is used (production only)
if (!isDev) {
  const logFilePath = path.join(app.getPath('userData'), 'geotagger.log');
  let logStream;

  try {
    logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch (err) {
    try {
      process.stderr.write(
        `[LOG-INIT ERROR] ${new Date().toISOString()} Failed to create log file at "${logFilePath}": ${String(err)}\n`
      );
    } catch {}
    logStream = null;
  }
  
  if (logStream) {
    
    // Minimal: direkten Override testen
    const origLog = console.log;
    console.log = (...args) => {
      try {
        logStream.write('[LOG] ' + args.join(' ') + '\n');
      } catch (e) {
        try {
          process.stderr.write(
            `[LOG-WRITE ERROR] ${new Date().toISOString()} ${String(e)}\n`
          );
        } catch {}
        try { origLog(...args); } catch {}
      }
    };

    app.on('will-quit', () => {
      try { logStream.end(); } catch {}
    });
  }
}

let systemLanguage = 'en';
let win; // Variable für das Hauptfenster
let settings = {}; // Variable zum Speichern der Einstellungen
let extensions = ['jpg', 'webp', 'avif', 'heic', 'tiff', 'dng', 'nef', 'cr3']; // supported image extensions as default
let exiftoolPath = 'exiftool'; // system exiftool must be in PATH for this to work! (only for development!)
if (app.isPackaged) {
  exiftoolPath = path.join(
    process.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'exiftool-vendored.exe',
    'bin',
    process.platform === 'win32' ? 'exiftool.exe' : 'exiftool'
  );
}
let exiftoolAvailable = false;

// Basisverzeichnis der App
const appRoot = app.getAppPath();
const localesPath = path.join(appRoot, 'locales');
const settingsFilePath = path.join(app.getPath('userData'), 'user-settings.json');

// Settings direkt beim Start laden
try {
  if (fs.existsSync(settingsFilePath)) {
    settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    if (settings.extensions && Array.isArray(settings.extensions)) extensions = settings.extensions;
    console.log('Settings loaded from:', settingsFilePath);
  }
} catch (err) {
  console.log('Failed to load settings:', err);
}

// sharp availabability check
let sharpAvailable = false;
let sharp;
try {
  sharp = (await import('sharp')).default;
  sharpAvailable = true;
} catch (err) {
  // das logging funktioniert hier nicht
  console.log('[WARN] Sharp not available, skipping thumbnail rotation: ', err);
}

// AI Tagging with Ollama: check availability at startup
let ollamaAvailable = { status: false, model: '' };
let ollamaClient;

/** Hauptstart */
app.whenReady().then(async () => {

  try {
    exiftoolAvailable = await checkExiftoolAvailable(exiftoolPath);
    console.log(`Exiftool available: ${exiftoolAvailable} from path: ${exiftoolPath}`); 
  } catch (err) {
    console.log('Failed to check exiftool availability:', err);
    console.log(`Using exiftool path: ${exiftoolPath}`);
  }

  try {
    ollamaAvailable = await checkOllamaAvailable('ollama_config.json', 'prompt.txt');
    //console.log(`Ollama available: ${ollamaAvailable.status} with model: ${ollamaAvailable.model}`);
  } catch (err) {
    console.log('Failed to check Ollama availability:', err);
  }
  
  // i18next initialisieren. i18next prevents XSS: https://www.i18next.com/translation-function/interpolation?utm_source=chatgpt.com 
  // So, no further sanitizing is done here and not in render.js.
  systemLanguage = (app.getLocale() || 'en').split('-')[0];
  try {
    await i18next.use(Backend).init({
      lng: systemLanguage,
      fallbackLng: 'en',
      backend: { loadPath: path.join(localesPath, '{{lng}}', 'translation.json') },
    });
  } catch (err) {
    console.log('Error initializing i18next:', err);

    // Fallback auf Englisch
    try {
      await i18next.init({ lng: 'en', fallbackLng: 'en' });
    } catch (err2) {
      console.log('Fallback i18next init failed:', err2);
    }
  }

  if (win && !win.isDestroyed()) return;
  createWindow();

  if (win) {
    win.on('closed', () => {
      win = null;
    });
  }

  setupMenu(i18next.t.bind(i18next));

});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  win = null;
});


/**
 * Setup the main menu for the application.
 * @param {function} t - The translation function for i18next.
 * @returns void
 */
function setupMenu(t) {
  const menuTemplate = [  
      {    
        label: t('file'),  
        submenu: [    
          { label: t('reload'), role: 'reload' }, // this is required just for testing
          { label: t('reloadData'),
              click: async () => {
                if (!win || !settings.imagePath) {
                    console.warn('No image path set; reloadData skipped');
                    return;
                }

                reloadImageData(settings);
              }
          }, 
          { label: t('quit'), role: 'quit' }  
        ]    
      },  
      {  
        label: t('gpxTrack'),  
        submenu: [  
          {  
            label: t('openGpxFile'),  
            click: async () => {    
              const { canceled, filePaths } = await dialog.showOpenDialog({    
                title: t('selectGpxFileTitle'),  
                filters: [{ name: t('gpxFiles'), extensions: ['gpx'] }], // do not puzzle with variable 'extensions' here!
                properties: ['openFile']    
              });  
  
              if (!canceled && filePaths.length > 0) {
                const gpxPath = filePaths[0];
                console.log(t('gpxPath'), gpxPath);
                settings.gpxPath = gpxPath; 
                // set the path to the icons for the map, which is required for leaflet map to show the icons on the track correctly.
                settings.iconPath = appRoot;
                sendToRenderer('gpx-data', gpxPath);
                saveSettings(settingsFilePath, settings);
                // reload the data
                if (settings.imagePath && settings.imagePath.length > 3) {
                  reloadImageData(settings);
                }
              }    
            }    
          },  
          {  
            label: t('clearGpxFile'),  
            click: () => {  
              settings.gpxPath = '';
              settings.iconPath = appRoot; // set the path to the icons for the map
              sendToRenderer('clear-gpx');  
              saveSettings(settingsFilePath, settings);  
            }  
          }  
        ]  
      },  
      {  
        label: t('imageFolder'),  
        submenu: [  
          {  
            label: t('selectFolder'),  
            click: async () => {  
              const { canceled, filePaths } = await dialog.showOpenDialog({  
                title: t('selectImageFolderTitle'),  
                properties: ['openDirectory']  
              });  
  
              if (!canceled && filePaths.length > 0) {  
                const imagePath = filePaths[0];  
                console.log(t('imagePath'), imagePath);  
                settings.imagePath = imagePath;  
                settings.iconPath = appRoot;
                saveSettings(settingsFilePath, settings);
                // read images from the folder if this is possible in the renderer process
                sendToRenderer('image-loading-started', imagePath);
                
                // Vor dem Aufruf von readImagesFromFolder
                const startTime = Date.now();
                console.log('Start reading images from folder at:', new Date(startTime).toLocaleString());
                let allImages = await readImagesFromFolder(imagePath, extensions);
                // Endzeit und Dauer berechnen:
                const endTime = Date.now();
                console.log('Finished reading images at:', new Date(endTime).toLocaleString());
                console.log('Duration (ms):', endTime - startTime);
                // send the images to the renderer process
                sendToRenderer('set-image-path', imagePath, allImages);
              }  
            }  
          },  
          {  
            label: t('clearImageFolder'),  
            click: () => {  
              settings.imagePath = '';  
              settings.iconPath = appRoot;
              sendToRenderer('clear-image-path');  
              saveSettings(settingsFilePath, settings);  
            }  
          }  
        ]  
      },  
      isDev && {  
        label: t('development'),  
        submenu: [  
          {  
            label: t('openDevTools'),  
            role: 'toggleDevTools',  
            accelerator: 'F12'  
          }  
        ]  
      }  
    ].filter(Boolean);
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

/**
 * Creates and configures the main Electron browser window for the application.
 * Loads user settings, sets up window size and position, and initializes IPC handlers
 * for UI events (resize, move, sidebar widths, bar sizes, image filter updates, 
 *                exit with unsaved changes, save metadata, geotag image with exifTool).
 * Loads translations and passes them to the renderer process.
 * Loads images from the last used image folder (if available) extracts metadata and sends them to the renderer.
 * Loads last used GPX file (if available) and sends it to the renderer.
 *
 * **Global Variables Used/Modified:**
 * - `settings` (object): Stores user/application settings and is updated/saved during window events.
 * - `win` (BrowserWindow): Stores the reference to the main window.
 * - `extensions` (array): Supported image file extensions, used for image loading.
 * - `settingsFilePath` (string): Path to the JSON file where settings are saved/loaded.
 *
 * @function createWindow
 * @global {object} settings, settingsFilePath, appRoot, win
 * @returns {void}
 */
function createWindow() {  
  settings = loadSettings(appRoot, settingsFilePath);
  settings.iconPath = appRoot;
  
  win = new BrowserWindow({  
    width: settings.width || 800,  
    height: settings.height || 600,  
    webPreferences: {  
      preload: path.join(appRoot, './build/preload.bundle.js'), 
      nodeIntegration: false,  
      contextIsolation: true,
      webSecurity: true // aktiviert Standard-Sicherheitsrichtlinien: 
      //sandbox: true,
      //enableRemoteModule: false
    }  
  });  
  
  win.loadFile('index.html');
  if (isDev) {  
    //win.webContents.openDevTools();  
  }
  
  win.webContents.on('did-finish-load', () => {  
    // Send the saved settings to the renderer process
    let translation = i18next.getDataByLanguage(systemLanguage)?.translation || {};
    // append the translation object to the settings object
    settings.translation = translation;
    settings.lng = systemLanguage;
    sendToRenderer('load-settings', settings);  

    if (settings.imagePath && fs.existsSync(settings.imagePath)) {
      sendToRenderer('image-loading-started', settings.imagePath);
      
      // Vor dem Aufruf von readImagesFromFolder
      const startTime = Date.now();
      console.log('Start reading images from folder at:', new Date(startTime).toLocaleString());
      readImagesFromFolder(settings.imagePath, extensions).then(allImages => {
        sendToRenderer('set-image-path', settings.imagePath, allImages);
        const endTime = Date.now();
        console.log('Finished reading images at:', new Date(endTime).toLocaleString());
        console.log('Duration (ms):', endTime - startTime);
      });
    }
  });  
  
  win.on('resize', () => {  
    let [width, height] = win.getSize();  
    settings.width = width;  
    settings.height = height;  
    saveSettings(settingsFilePath, settings);  
  });  
  
  win.on('move', () => {  
    let [x, y] = win.getPosition();  
    settings.x = x;  
    settings.y = y;  
    saveSettings(settingsFilePath, settings);  
  });  
  
  ipcMain.on('update-bars-size', (event, { topBarHeight, bottomBarHeight }) => {  
    settings.topBarHeight = topBarHeight;  
    settings.bottomBarHeight = bottomBarHeight;  
    saveSettings(settingsFilePath, settings);  
  });  
  
  ipcMain.on('update-sidebar-width', (event, { leftSidebarWidth, rightSidebarWidth }) => {  
    settings.leftSidebarWidth = leftSidebarWidth;  
    settings.rightSidebarWidth = rightSidebarWidth;  
    saveSettings(settingsFilePath, settings);  
  });

  ipcMain.on('update-image-filter', (event, newSettings) => {
    settings.imageFilter = newSettings.imageFilter;
    settings.skipImagesWithGPS = newSettings.skipImagesWithGPS;
    settings.ignoreGPXDate = newSettings.ignoreGPXDate;
    settings.cameraModels = newSettings.cameraModels;
    settings.timeDevSetting = newSettings.timeDevSetting;
    saveSettings(settingsFilePath, settings);
  });

  ipcMain.on('update-map-settings', (event, newSettings) => {
    if (newSettings.map.mapselector) {
      settings.map.mapselector = newSettings.map.mapselector;
    }
    settings.map.mapcenter = newSettings.map.mapcenter;
    settings.map.zoom = newSettings.map.zoom;
    saveSettings(settingsFilePath, settings);
  });

  ipcMain.on('exit-with-unsaved-changes', (event, allImages) => {

      const options = {  
            type: 'question',  
            buttons: [i18next.t('save'), i18next.t('discard')], // ['Save', 'Discard'],  
            defaultId: 0,  
            title: i18next.t('unsavedChanges'), //'Unsaved Changes',  
            message: i18next.t('unsavedChangesMessage'), //'You have unsaved changes. Do you want to save them?',  
      };  
  
      dialog.showMessageBox(win, options).then((response) => {  
            if (response.response === 0) {  // 'Save' button
                writeMetaData(allImages).then(() => {
                    console.log('exit-with-unsaved-changes: Changes saved.');
                    app.exit();
                    app.quit();
                });
            } else {  
                // 'Discard' button, do nothing an quit. The changes will be lost!
                console.log('exit-with-unsaved-changes: Changes skipped.');
                app.exit();
                app.quit();
            }  
        }); 
  })

  ipcMain.handle('save-meta-to-image', async (event, allImages) => {
    
    if (!Array.isArray(allImages)) {
      return { success: false, error: 'Invalid data format' };
    }

    await writeMetaData(allImages, event.sender);
    return 'done';
  });

  ipcMain.handle('geotag-exiftool', async (event, data) => {
    const { gpxPath, imagePath, options } = data;
    // check if paths to files are valid
    if (!fs.existsSync(gpxPath)) {
      dialog.showErrorBox(i18next.t('GpxFileNotFound'), i18next.t('FileNotFoundMessage', { gpxPath }) );
      return { success: false, error: i18next.t('GpxFileNotFound') };
    }

    if (!fs.existsSync(imagePath)) {
      dialog.showErrorBox(i18next.t('ImageFileNotFound'), i18next.t('FileNotFoundMessage', { gpxPath }) );
      return { success: false, error: i18next.t('ImageFileNotFound') };
    }

    if (exiftoolAvailable) {
      return await geotagImageExiftool(gpxPath, imagePath, options);
    } else {
      dialog.showErrorBox(i18next.t('NoExiftool'), i18next.t('exiftoolNotFound') );
      console.log('Exiftool is not installed or not in PATH.');
      return { success: false, error: i18next.t('exiftoolNotAvailable') };
    }
  });

  ipcMain.on('main-reload-data', (event, settings, lastImage ) => {
    reloadImageData(settings, lastImage);
  });

  ipcMain.handle('ai-tagging-status', async (event) => {
    return { ollamaAvailable };
  });

  ipcMain.handle('ai-tagging-start', async (event, data) => {
    const { imagePath, captureDate, imageMeta, location } = data;
    
    if (!fs.existsSync(imagePath)) {
      dialog.showErrorBox(i18next.t('ImageFileNotFound'), i18next.t('FileNotFoundMessage', { gpxPath }) );
      return { success: false, error: i18next.t('ImageFileNotFound') };
    }

    let geoLocationInfo = '';
    if ( location === 'unknown') {
      geoLocationInfo = 'No Location: '; 
    } else {
      geoLocationInfo = location;
    }

    if (ollamaAvailable.status) {
      let aiResult = await ollamaClient.generate(imagePath, captureDate, imageMeta, geoLocationInfo);
      
      if (aiResult && aiResult.success && aiResult.data.title && aiResult.data.description && aiResult.data.keywords) {
        return { 
          'success': aiResult.success,
          'imagePath': imagePath, 
          'location': geoLocationInfo,
          'Title': aiResult.data.title,
          'Description': aiResult.data.description,
          'Keywords': aiResult.data.keywords // Tags must be a comma-separated string for exiftool to write them correctly to the metadata. The AI model should generate the tags in this format as well, so that no further processing is required here. Security: Be cautious when writing AI-generated content to image metadata, especially if it includes user-generated input. Consider implementing validation and sanitization of the AI output before writing it to the metadata to prevent potential security issues or injection attacks.
        };
      } else {  
        console.log("Unexpected AI result format: ", aiResult);  
        return { success: false, error: 'Unexpected AI result format' };
      }
    } else {
        dialog.showErrorBox(i18next.t('NoAITool'), i18next.t('AIToolNotFound') );
        console.log('AI-Tool (Ollama) is not available.');
        return { success: false, error: i18next.t('AIToolNotAvailable') };
    }
  });

  ipcMain.handle('geocoding-start', async (event, data) => {
    const { imagePath, imageMeta, location } = data;
    
    if (!fs.existsSync(imagePath)) {
      dialog.showErrorBox(i18next.t('ImageFileNotFound'), i18next.t('FileNotFoundMessage', { gpxPath }) );
      return { success: false, error: i18next.t('ImageFileNotFound') };
    }
    // delete the location info
    if (!isNumber(imageMeta.lat) || !isNumber(imageMeta.lng)) {
      return { 
        'success': true,
        'imagePath': imagePath, 
        'location': 'unknown',
        'City': '',
        'State': '',
        'Country':''
      };
    } else {
      let result = await reverseGeocodeToXmp(imageMeta.lat, imageMeta.lng);

      if (!result) {
        dialog.showErrorBox(i18next.t('GeocodingFailed'), i18next.t('GeocodingFailedMessage') );
        return { success: false, error: i18next.t('GeocodingFailed') };
      }
      
      result.State = result['Province-State'];
      let geolocation = `${result.City}, ${result.State}, ${result.Country}`;

      return { 
        'success': true,
        'imagePath': imagePath, 
        'location': geolocation,
        'City': result.City,
        'State': result.State,
        'Country': result.Country
      };
    }
  });
}

// ---- helper functions for the main process ----
// Mind: The following functions can only be called from the main process and so
// can't be move to a separate file(s). This is due to restrictions of electron, node.js runtime calls or whatever.
/**
 * Sends a message to the renderer process with the given channel and arguments.
 * If the renderer is not available (e.g., it has been closed or has not been created yet),
 * a warning will be logged to the console.
 * @param {string} channel - the channel to send the message to
 * @param {...any} args - the arguments to send to the renderer
 * @global {BrowserWindow} win
 * 
 */
function sendToRenderer(channel, ...args) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, ...args);
  } else {
    console.warn('Renderer not available:', channel);
  }
}

/**
 * Reads all image files from a folder, extracts EXIF metadata, and returns an array of image data objects.
 * Supported extensions are filtered by the provided array.
 * The returned objects contain relevant EXIF fields and file information.
 * Images are sorted by their capture time (DateTimeOriginal).
 * Uses exiftool-vendored for fast, concurrent metadata extraction.
 *
 * TODO : read available metadata from xmp files (sidecar files for raw images) - exiftool can do this, too
 * 
 * @async
 * @function readImagesFromFolder
 * @param {string} folderPath - Absolute path to the folder containing images.
 * @param {string[]} extensions - Array of allowed file extensions (e.g. ['jpg', 'cr3']).
 * @global {object} exiftool : singleton from exiftool-vendored
 * @global {object} fs
 * @global {object} path
 * 
 * @returns {Promise<ImageMeta[]>} Resolves with an array of image metadata objects.
 * @throws Will log errors to the console if reading or parsing fails.
 */
async function readImagesFromFolder(folderPath, extensions) {
   /**
    * @typedef {Object} ImageMeta
    * @property {string|{rawValue: string}} DateTimeOriginal
    * @property {string} DateCreated
    * @property {string} DateTimeCreated
    * @property {string} OffsetTimeOriginal
    * @property {string} camera
    * @property {string} lens
    * @property {string} orientation
    * @property {number|string} height
    * @property {number|string} width
    * @property {number|string} lat
    * @property {number|string} lng
    * @property {string} GPSLatitude
    * @property {string} GPSLatitudeRef
    * @property {string} GPSLongitude
    * @property {string} GPSLongitudeRef
    * @property {string} GPSAltitude
    * @property {string} GPSImgDirection
    * @property {string} pos
    * @property {string} file
    * @property {string} extension
    * @property {string} imagePath
    * @property {string} thumbnail
    * @property {string} status
    * @property {string} Title
    * @property {string} CaptionAbstract
    * @property {string} Description
    * @property {string} ImageDescription
    * @property {string} XPTitle
    * @property {string} XPSubject
    * @property {string} XPComment
    * @property {number} index
    */

    try {  
        // Read all files in the directory
        let start = performance.now();
        const files = fs.readdirSync(folderPath);
        let end = performance.now();
        console.log(`Read ${files.length} files from ${folderPath} in ${end - start}ms`);
  
        // Filter files by the specified extensions  
        const imageFiles = files.filter(file => {  
            const ext = path.extname(file).toLowerCase().replace('.', '');  
            return extensions.includes(ext);  
        });
  
        // Define a function to extract required EXIF metadata. 
        const getExifData = async (filePath) => {
          const metadata = await exiftool.read(filePath, { ignoreMinorErrors: true });
          // metadata["State"], metadata.City, metadata.Country
            let thumbnailPath = '';
            const maxAgeDays = 14;
            
            //if (metadata.ThumbnailImage && metadata.ThumbnailImage.rawValue) {
            if ( sharpAvailable ) {
              const thumbnailPathTmp = path.join(app.getPath('temp'), `${path.basename(filePath)}_thumb.jpg`); // Security: Validate and normalize paths, then enforce a fixed base directory. Use path.resolve(base, input) and verify the result starts with base. Reject absolute paths, .. segments, and unsafe characters. Prefer allowlists for filenames.
              let useExistingThumbnail = false;

              // check if thumbnail exists and is not older than maxAgeDays. Delete if older and re-extract or keep existing
              if (fs.existsSync(thumbnailPathTmp)) {
                const now = Date.now();
                const maxAgeMillis = maxAgeDays * 24 * 60 * 60 * 1000;
                const stats = fs.statSync(thumbnailPathTmp);

                if (now - stats.mtimeMs > maxAgeMillis) {
                  fs.unlinkSync(thumbnailPathTmp);
                } else {
                  useExistingThumbnail = true;
                  thumbnailPath = thumbnailPathTmp;
                }
              }

              if (!useExistingThumbnail) {
                // add a config for long edge here: get it from the config of the ollamaClient if not use a default value of 1200 px.
                // TODO : problem is that other LLM may need other sizes and we need to handle this. So we chose a bit bigger than required for gemma3:12b.
                let longEdge = 1200;
                if ( ollamaClient  ) {
                  longEdge = ollamaClient.getPreferredLongEdge();
                }
                thumbnailPath = await resizeImage( metadata, filePath, thumbnailPathTmp, { longEdge: longEdge });
                if ( !thumbnailPath) thumbnailPath = filePath;
              }
              
            } else {
              thumbnailPath = filePath; // fallback to the file path if no thumbnail is available
            }

            // merge the geo location info to a single field for easier handling in the frontend and also for the AI tagging. Security: Be cautious when merging and displaying location information to prevent potential privacy issues. Consider allowing users to opt-out of sharing or displaying detailed location data.
            if ( isValidLocation(metadata) ) {
              metadata.Geolocation = `${metadata.City}, ${metadata.State}, ${metadata.Country}`;
            } else {
              metadata.Geolocation = 'unknown';
            }

            return {
                DateTimeOriginal: metadata.DateTimeOriginal || '',
                DateCreated: metadata.DateCreated || '',
                DateTimeCreated: metadata.DateTimeCreated || '',
                OffsetTimeOriginal: metadata.OffsetTimeOriginal || '',
                
                camera: metadata.Model || 'none',
                lens: metadata.LensModel || '',
                orientation: metadata.Orientation || '',
                //type: 'image',  // TODO : extend for videos, too. or remove it and control it by the extensions array? But mind that exifTool only works for images!
                height: metadata.ImageHeight || '',  
                width: metadata.ImageWidth || '',  
                
                lat: metadata.GPSLatitude || '',
                GPSLatitude: metadata.GPSLatitude || '',
                GPSLatitudeRef: metadata.GPSLatitudeRef || '',
                lng: metadata.GPSLongitude || '',
                GPSLongitude: metadata.GPSLongitude || '',
                GPSLongitudeRef: metadata.GPSLongitudeRef || '',
                pos: metadata.GPSPosition || '',
                GPSAltitude: metadata.GPSAltitude || '',
                GPSImgDirection: metadata.GPSImgDirection || '',
                
                file: path.basename(filePath, path.extname(filePath)),    
                extension: path.extname(filePath).toLowerCase(),  
                imagePath: filePath,
                thumbnail: thumbnailPath, // base64 encoded thumbnail or file path
                status: (metadata.GPSLatitude && metadata.GPSLongitude) ? 'loaded-with-GPS' : 'loaded-no-GPS', // simple status field
                
                // ---- TITLE ----
                Title : metadata.Title || '', // will be used in frontend for entry
                XPTitle: metadata.XPTitle || '', // TODO : What about Object Name?
                // not used: IPTC:ObjectName

                // ---- DESCRIPTION ---- with MWG:Description these entries shall be identical!
                ImageDescription: metadata.ImageDescription || '', // EXIF: ImageDescription
                CaptionAbstract: metadata.CaptionAbstract || '', // IPTC: Caption-Abstract
                Description : metadata.Description || '', // will be used in frontend for entry // XMP-dc: Description

                // ---- TAGS ----
                Keywords: metadata.Keywords || [], // andere Felder enthalten die Keywords nicht.

                // ---- GeoLocationInfo ----
                // get the geo location info from xmp
                City: metadata.City || '',
                Country: metadata.Country || '',
                ProvinceState: metadata.State || '',
                // merge the above fields to a location info string like "City, ProvinceState, Country" and use it in the frontend for display and also for the AI tagging. Security: Be cautious when merging and displaying location information to prevent potential privacy issues. Consider allowing users to opt-out of sharing or displaying detailed location data.
                Geolocation: metadata.Geolocation
            }
        };
  
        // Extract EXIF data for each image and sort by capture time
        start = performance.now();
        const imagesData = await Promise.all(  
            imageFiles.map(async file => {  
                const filePath = path.join(folderPath, file);  // Security: Validate and normalize paths, then enforce a fixed base directory. Use path.resolve(base, input) and verify the result starts with base. Reject absolute paths, .. segments, and unsafe characters. Prefer allowlists for filenames.
                return await getExifData(filePath);
            })  
        );  
        end = performance.now();
        console.log(`Extracted EXIF data for ${imagesData.length} images in ${end - start}ms`);

        // Sort images by capture time
        start = performance.now();
        sortImagesByCaptureTime(imagesData);
        end = performance.now();
        console.log(`Sorted ${imagesData.length} images by capture time in ${end - start}ms`);
        
        // Laufende Nummer ergänzen
        start = performance.now();
        imagesData.forEach((img, idx) => {
            img.index = idx; // Start bei 0, alternativ idx+1 für Start bei 1
        });
        end = performance.now();
        console.log(`Added index to ${imagesData.length} images in ${end - start}ms`);

        return imagesData;  
    } catch (error) {  
        console.log('Error reading images from folder:', error);  
    }
}

/**
 * Writes the metadata of all images in the allmagesData array to their respective files.
 * Only images with status 'loaded-with-GPS' or 'loaded-no-GPS' or 'geotagged' are written.
 * If writeMetadataOneImage is not initialized, an error is logged and the function returns.
 * Sends progress updates to the sender (if provided) after each image is processed.
 * 
 * @param {object} sender - the IPC sender to send progress updates to (optional)
 * @param {array} allmagesData - an array of objects containing information about all images
 * @returns {Promise<void>} - a promise that resolves when all metadata has been written
 */
async function writeMetaData(allmagesData, sender=null) {
  let totalImages = allmagesData.length;
  let currentIndex = 1;

  for (const img of allmagesData) {
    if (img.status !== 'loaded-with-GPS' && img.status !== 'loaded-no-GPS' && img.status !== 'geotagged') {
      console.log('Writing meta for Image:', img.file + img.extension);

      // progressObject has the structure: { currentIndex: number, totalImages: number, result: string, imagePath: string}
      try {
        // TODO: remove this doubled code
        const result = await writeMetadataOneImage(img.imagePath, img);
        if (sender) sender.send('save-meta-progress', {
          currentIndex,
          totalImages,
          imagePath: img.imagePath,
          result: result.success ? 'done' : 'error',
          message: result.data || result.message
        });
      } catch (error) {
        if (sender) sender.send('save-meta-progress', {
          currentIndex,
          totalImages,
          imagePath: img.imagePath,
          result: 'error',
          message: error.message
        });
      }
    } else {
      console.log('Skipping Image (no meta to write):', img.file + img.extension);
      if (sender) sender.send('save-meta-progress', {
        currentIndex,
        totalImages,
        imagePath: img.imagePath,
        result: 'skipped'
      })
    }

    currentIndex++;
  };
}

/**
 * Writes the metadata of one image to its respective file with exiftool-vendored.
 * Only images with status 'loaded-with-GPS' or 'loaded-no-GPS' are written.
 * If writeMetadataOneImage is not initialized, an error is logged and the function returns.
 * @param {string} filePath - the path to the image file
 * @param {object} metadata - an object containing information about the image
 * @global {object} exifTool
 * @global {string} exiftoolPath
 * @global {boolean} exiftoolAvailable
 * @returns {Promise<void>} - a promise that resolves when the metadata has been written
 */
async function writeMetadataOneImage(filePath, metadata) {
  const writeData = {};

  // --- GPS Altitude ---
  const altitude = metadata.GPSAltitude;
  if (altitude !== undefined && altitude !== null) {
    writeData["EXIF:GPSAltitude"] = altitude;
  }

  // --- GPS ImageDirection ---
  const imageDirection = metadata.GPSImgDirection;
  if (imageDirection !== undefined && imageDirection !== null) {
    writeData["EXIF:GPSImgDirection"] = imageDirection;
  }

  // --- GPS position ---
  const pos = metadata.pos; // this is in different formats yet!
  if (pos !== undefined && pos !== null && pos !== "") {
    writeData["EXIF:GPSPosition"] = pos;
    writeData["EXIF:GPSLatitude"] = metadata.GPSLatitude;
    writeData["EXIF:GPSLatitudeRef"] = metadata.GPSLatitudeRef;
    writeData["EXIF:GPSLongitude"] = metadata.GPSLongitude;
    writeData["EXIF:GPSLongitudeRef"] = metadata.GPSLongitudeRef;
  } else if (exiftoolAvailable && pos !== null) {
    let command = `"${exiftoolPath}" -gps*= -overwrite_original_in_place "${filePath}"`;
    console.log("ExifTool Command:", command);

    
    // Comment missing why using the exiftool directly here. Warten auf exec, aber nur im Fehlerfall abbrechen mit return resolve....
    const execResult = await new Promise((resolve) => {
      // TODO : doubled to 'execDouble'
      exec(command, (error, stdout, stderr) => { // Security: Command injection from function argument passed to child_process invocation
        if (error) {
          console.log(`ExifTool-Error: ${stderr || error.message}`);
          return resolve({ success: false, error: `ExifTool-Error: ${stderr || error.message}` });
        }
        resolve({ success: true, output: stdout });
      });
    });

  } else if (!exiftoolAvailable) {
    console.log("exiftool is not available!");
    dialog.showErrorBox(i18next.t('NoExiftool'), i18next.t('exiftoolNotFound'));
    return { success: false, error: 'Exiftool is not installed or not in PATH.' };
  }

  // --- TITLE ---
  const title = sanitize(metadata.Title);
  if (title !== undefined && title !== null) {
    writeData["XMP-dc:Title"] = title;
    writeData["XPTitle"] = title; // This is not MWG standard! But Windows Special!
    writeData["IPTC:ObjectName"] = title;
    writeData["IPTCDigest"] = ""; // update IPTC digest
  }

  // --- DESCRIPTION ---
  const desc = sanitize(metadata.Description);
  if (desc !== undefined && desc !== null) {
    writeData["MWG:Description"] = desc;
    writeData["IPTC:Caption-Abstract"] = desc; // must be written after "MWG:Description"! 
    writeData["IPTCDigest"] = ""; // update IPTC digest
  }

  // --- KEYWORDS = TAGS ---
  if (Array.isArray(metadata.Keywords)) {
    metadata.Keywords = metadata.Keywords.join(',');
  }
  let tags = sanitize(metadata.Keywords);
  if (tags !== undefined && tags !== null) {
    tags = tags.split(',');
    tags = [...new Set(
      tags.map(v => v.trim()).filter(v => v.length > 0)
    )]
    writeData["MWG:Keywords"] = tags; // writes to "XMP-dc:Subject" and IPTC:Keywords but not IPTC:hierarchical Subject (written by LR). "XMP-dc:Subject" and IPTC:Keywords contain a flat List only.
    writeData["XMP-lr:HierarchicalSubject"] = []; // remove the old "XMP-lr:HierarchicalSubject" which was written by LR unless the App implements an hierarchical list as well.
  } 

  // --- GeoLocationInfo ---
  let city = null, country = null, provinceState = null, countryCode = null;
  if ( writeData["EXIF:GPSPosition"] && isValidLatLng(metadata.GPSLatitude, metadata.GPSLongitude) ) {
    // get the geo location info from xmp. We are passing to different formats here!
    let lat, lng = 0;
    if ( Array.isArray(metadata.GPSLatitude) && Array.isArray(metadata.GPSLongitude) ) {
      const roundTo = (value, decimals) => Math.round(value * 10 ** decimals) / 10 ** decimals;
      let lat1 = metadata.GPSLatitude.join(' ');
      let lng1 = metadata.GPSLongitude.join(' ');
      lat = roundTo(dmsToDecimal(lat1, metadata.GPSLatitudeRef), 6); // float
      lng = roundTo(dmsToDecimal(lng1, metadata.GPSLongitudeRef), 6); // float
    } else {
      lat = metadata.GPSLatitude;
      lng = metadata.GPSLongitude;
    }
    
    let result = await reverseGeocodeToXmp(lat, lng);
    if (result) {
      metadata.City = result.City;
      metadata.Country = result.Country;
      metadata.State = result['Province-State'];
      city = sanitize(metadata.City);
      country = sanitize(metadata.Country);
      provinceState = sanitize(metadata.State);
      countryCode = sanitize(result.CountryCode);
    }
  } else {
    city = null;
    country = null;
    provinceState = null;
    countryCode = null;
  }
  // do not check for 'null' here because this is used for deleting Tags completely.
  if (city !== undefined) {
    writeData["XMP:City"] = city;
    writeData["XMP-photoshop:City"] = city;
    writeData["XMP-iptcExt:LocationShownCity"] = city; // IPTC Extension for Location shown - City
    writeData["IPTC:City"] = city; // IIM/legacy IPTC standard
  }

  if (country !== undefined ) {
    writeData["XMP:Country"] = country;
    writeData["XMP-photoshop:Country"] = country;
    writeData["XMP-iptcExt:LocationShownCountryName"] = country; // IPTC Extension for Location shown - Country Name
    writeData["IPTC:Country-PrimaryLocationName"] = country; // IIM/legacy IPTC standard
  }

  if (provinceState !== undefined ) {
    writeData["XMP:State"] = provinceState;
    writeData["XMP-photoshop:State"] = provinceState;
    writeData["XMP-iptcExt:LocationShownProvinceState"] = provinceState; // IPTC Extension for Location shown - Province/State
    writeData["IPTC:Province-State"] = provinceState; // IIM/legacy IPTC standard
  } 

  if (countryCode !== undefined ) {
    writeData["XMP:CountryCode"] = countryCode;
    writeData["XMP-photoshop:CountryCode"] = countryCode;
    writeData["XMP-iptcExt:LocationShownCountryCode"] = countryCode; // IPTC Extension for Location shown - Country Code
    writeData["IPTC:Country-PrimaryLocationCode"] = countryCode; // IIM/legacy IPTC standard
  }

  if (Object.keys(writeData).length > 0) {
    await exiftool.write(filePath, writeData);
    let metaDataString = JSON.stringify(writeData, null, 2);
    console.log("Metadata successfully written: ", metaDataString);
    return { success: true, data: writeData };
  } else {
    console.log("No Metadata to write (all fields empty).");
    return { success: true, message: "No metadata written." };
  }
}

/**
 * Geotag an image using the GPS data from a GPX file with command line tool exiftool.
 * This function uses (external) exiftool to write the GPS data from the GPX file to the image file.
 * because exiftool-vendored does not support this functionality directly.
 * If the GPX file or the image file is not found, the function will resolve with an error message.
 * If the command fails, the function will resolve with an error message.
 * 
 * @param {string} gpxPath - The path to the GPX file.
 * @param {string} imagePath - The path to the image file.
 * @param {object} options - An object with the following properties:
 *   - verbose {string} - The verbosity of the command. Default is 'v2'.
 *   - charsetFilename {string} - The character set for the filename. Default is 'latin'.
 *   - geolocate {boolean} - Whether to geolocate the image. Default is true.
 *   - timeOffset {number} - The time offset in seconds to apply to the GPX data. Default is 0.
 * @global {string} exiftoolPath
 * @returns {Promise<object>} - A promise that resolves with an object containing a success flag and an error message if applicable.
 * The output will be an object with the following properties:
 *   - success {boolean} - Whether the command was successful.
 *   - error {string} - An error message if the command was not successful.
 *   - output {string} - The output of the command if it was successful.
 */
async function geotagImageExiftool(gpxPath, imagePath, options) { 
  
  // Standardwerte setzen
  const {
    verbose = 'v2',
    charsetFilename = 'latin',
    geolocate = false,
    timeOffset = 0,
  } = options ?? {};
  
  return new Promise( (resolve) => {
    
    // Pfade prüfen
    if (!fs.existsSync(gpxPath)) {
      return resolve({ success: false, error: `GPX-File not found: ${gpxPath}` });
    }

    if (!fs.existsSync(imagePath) || !fs.statSync(imagePath).isFile()) {
      return resolve({ success: false, error: `Image File not found: ${imagePath}` });
    }

    // Kommando zusammenbauen
    let command = `"${exiftoolPath}" -${verbose} -geosync=${timeOffset} -charset filename=${charsetFilename} -geotag "${gpxPath}"`;
    if (geolocate) {
      command += ' -geolocate=geotag';
    }
    command += ` "${imagePath}"`;
    console.log("ExifTool Command:", command);
    // TODO : doubled to 'execDouble'
    exec(command, async (error, stdout, stderr) => { // Security: Command injection from function argument passed to child_process invocation
      if (error) {
        console.log(`ExifTool-Error: ${stderr || error.message}`);
        return resolve({ success: false, error: `ExifTool-Error: ${stderr || error.message}` });
      }

      // add the geolocation here if it shall not be done by exiftool
      let geolocateSetting = true; // TODO define settings.geolocate;
      if ( !geolocate && geolocateSetting  ) {
        // get the new coords from the image file
        const metadata = await exiftool.read(imagePath, { ignoreMinorErrors: true });
        // get the geolocation
        let newmeta = {};
        newmeta.pos = metadata.GPSPosition;
        newmeta.GPSLatitude = metadata.GPSLatitude;
        newmeta.GPSLongitude = metadata.GPSLongitude;
        newmeta.GPSLatitudeRef = metadata.GPSLatitudeRef;
        newmeta.GPSLongitudeRef = metadata.GPSLongitudeRef;
        // write the geolocation to the image file
        writeMetadataOneImage(imagePath, newmeta);
      }

      resolve({ success: true, output: stdout });
    });

  });
}

/**
 * Reload all image data from the given folder.
 * This function sends an IPC message to the renderer to start loading data.
 * Then it reads all images from the given folder and sends the data to the renderer.
 * If an error occurs, it sends an IPC message with the error message to the renderer.
 * @param {object} settings - The settings object containing the image path.
 * @returns {Promise<boolean>} - A promise that resolves with true if the data was reloaded successfully, false otherwise.
 * @global {function} sendToRenderer
 * @global {function} readImagesFromFolder
 * @global {array} extensions
 * 
 */
async function reloadImageData(settings, lastImage) {
  // IPC an Renderer senden, um Daten neu zu laden. Loading starten.
  sendToRenderer('image-loading-started', settings.imagePath);

  try {
      const allImages = await readImagesFromFolder(settings.imagePath, extensions);
      sendToRenderer('reload-data', settings.imagePath, allImages, lastImage);
      return true;
    } catch (e) {
      console.log('Error reloading data:', e);
      sendToRenderer('image-loading-failed', settings.imagePath, String(e?.message || e));
      return false;
    }
}

/**
 * Rotate a thumbnail according to the EXIF orientation value.
 * The function takes a sharp image object and applies the necessary
 * transformations to rotate the image according to the EXIF orientation
 * value. If the sharp library is not available, the original
 * thumbnail path is returned. The function returns a promise with
 * the path to the rotated thumbnail as a fulfillment value.
 *
 * @param {object} metadata - The metadata of the image, containing the Orientation value.
 * @param {string} filePath - The path to the original image file.
 * @param {string} thumbPathTmp - The path to the temporary thumbnail file.
 * @global {boolean} sharpAvailable
 * @returns {Promise<string>} - A promise with the path to the rotated thumbnail as a fulfillment value.
 */
async function rotateThumbnail(metadata, filePath, thumbPathTmp) {
  const orientation = metadata.Orientation || 1; // default = normal
  if ( !sharpAvailable) return thumbPathTmp;
  if (orientation === 1) return thumbPathTmp;
  
  // Mit sharp korrigieren
  let image = sharp(thumbPathTmp);
  const rotatedThumbPath = path.join(app.getPath('temp'), `${path.basename(filePath)}_thumb_rotated.jpg`);  // Security: Validate and normalize paths, then enforce a fixed base directory. Use path.resolve(base, input) and verify the result starts with base. Reject absolute paths, .. segments, and unsafe characters. Prefer allowlists for filenames.

  switch (orientation) {
    case 3:
      image = image.rotate(180);
      break;
    case 6:
      image = image.rotate(90);
      break;
    case 8:
      image = image.rotate(270);
      break;
    case 2:
      image = image.flop(); // horizontal spiegeln
      break;
    case 4:
      image = image.flip(); // vertikal spiegeln
      break;
    case 5:
      image = image.rotate(90).flop();
      break;
    case 7:
      image = image.rotate(270).flop();
      break;
    default:
      // 1 = normal, keine Änderung
      break;
  }

  await image.toFile(rotatedThumbPath); // erzeugt neues Thumbnail mit korrigierter Version
  // rename the file to the original name
  fs.renameSync(rotatedThumbPath, thumbPathTmp); // überschreibt Thumbnail mit korrigierter Version

  return thumbPathTmp;
}

/**
 * @typedef {Object} ResizeConfig
 * @property {number} [longEdge=896]      - Max size of the longer edge in pixels.
 * @property {number} [jpegQuality=85]    - JPEG quality (1..100).
 * @property {string} [suffix="_resized"] - Suffix for basename generation.
 * @property {string} [flattenBg="#ffffff"] - Background for alpha flattening.
 * @property {number} [limitInputPixels]  - Optional guard against huge images (e.g., 40_000_000).
 */

/**
 * Resize an image buffer (jpg/webp/avif/png) to LLM-friendly dimensions and return JPEG bytes.
 * Output is always JPEG, long edge limited, alpha flattened, metadata stripped.
 *
 * - Long edge limited to config.longEdge
 * - fit: 'inside', withoutEnlargement: true
 * - Always outputs JPEG
 * - Flattens alpha (important for PNG/WEBP/AVIF with transparency)
 * - Removes metadata (keeps content deterministic)
 *
 * @param {string:path} inputFile
 * @param {string:path} outputFile
 * @param {ResizeConfig} [config]
 * @returns {Promise:Boolean}
 */
async function resizeImage(metadata, inputFile, outputFile, config = {}) {
  const {
    longEdge = 896,
    jpegQuality = 85,
    flattenBg = "#ffffff",
    limitInputPixels,
  } = config;

  const orientation = metadata.Orientation || 1; // default = normal

  if ( !sharpAvailable) return false;

  // convert inputFile to inputBuffer
  const inputBuffer = await sharp(inputFile).toBuffer();

  if (!Buffer.isBuffer(inputBuffer)) {
    //throw new TypeError("inputBuffer must be a Buffer");
    return false;
  }
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    //throw new TypeError("config.longEdge must be a positive number");
    return false;
  }
  if (!Number.isFinite(jpegQuality) || jpegQuality < 1 || jpegQuality > 100) {
    //throw new TypeError("config.jpegQuality must be in range 1..100");
    return false;
  }

  // NOTE: We don't rely on file extensions; sharp will sniff the buffer.
  // limitInputPixels protects from extreme images (optional).
  const sharpInstance = sharp(inputBuffer, limitInputPixels ? { limitInputPixels } : undefined);

  // We do a metadata probe to know whether alpha exists (for flatten decision).
  // This avoids unneeded flatten operations but still safe if flatten is always applied.
  const meta = await sharpInstance.metadata();

  let pipeline = sharp(inputBuffer, limitInputPixels ? { limitInputPixels } : undefined)
    .rotate() // respect EXIF orientation when present
    .resize({
      width: longEdge,
      height: longEdge,
      fit: "inside",
      withoutEnlargement: true,
    });

  // Flatten if the source has alpha (PNG/WEBP/AVIF often do). Output is JPEG anyway.
  if (meta.hasAlpha) {
    pipeline = pipeline.flatten({ background: flattenBg });
  }

  let image = await pipeline
    .jpeg({
      quality: jpegQuality,
      mozjpeg: true,
      chromaSubsampling: "4:2:0",
    });
    
  switch (orientation) {
    case 3:
      image = image.rotate(180);
      break;
    case 6:
      image = image.rotate(90);
      break;
    case 8:
      image = image.rotate(270);
      break;
    case 2:
      image = image.flop(); // horizontal spiegeln
      break;
    case 4:
      image = image.flip(); // vertikal spiegeln
      break;
    case 5:
      image = image.rotate(90).flop();
      break;
    case 7:
      image = image.rotate(270).flop();
      break;
    default:
      // 1 = normal, keine Änderung
      break;
  } 

  await image.toFile(outputFile);
  return outputFile;
}

/** 
 * check if the system exiftool is available in PATH. (not using exiftool-vendored here).
 * @param {string} exiftoolPath
 * @returns {boolean}
 */
async function checkExiftoolAvailable(exiftoolPath) {
  return new Promise((resolve) => {
    exec(`${exiftoolPath} -ver`, { shell: true }, (err) => { // Security: Command injection from function argument passed to child_process invocation
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function checkOllamaAvailable(configfile, promptfile) {
    
  ollamaClient = new OllamaClient(appRoot, configfile, promptfile);
  const status = await ollamaClient.getOllamaClientStatus();
  
  return {'status': status.available, 'model': status.model};
}
