/** @module preload contextBridge
 * 
 * @file src/preload.js
 * @requires electron:contextBridge
 * @requires electron:ipcRenderer
 * @description
 *  This module establishes IPC communication between the renderer process (renderer.js) and the main process (main.js).
 *  It uses Electron's contextBridge to expose a limited API to the renderer process, allowing it to send and receive messages securely.
 *  The exposed API includes methods for sending messages to the main process, receiving messages from it, and invoking methods that return promises.
 *  This setup is crucial for maintaining security in Electron applications by preventing direct access to Node.js APIs from the renderer process.
 * 
 * @author Martin von Berg
 * @version 2.2.0
 * @license MIT
 */

//const { contextBridge, ipcRenderer } = require('electron');
import { contextBridge, ipcRenderer } from 'electron';
  
// Expose a limited API to the renderer  
contextBridge.exposeInMainWorld('myAPI', {  
  send: (channel, ...args) => {  
    // List of channels allowed  
    const validChannels_send = ['update-bars-size', 'update-sidebar-width', 'update-image-filter', 'exit-with-unsaved-changes', 'update-map-settings', 'main-reload-data'];
    if (validChannels_send.includes(channel)) {  
      ipcRenderer.send(channel, ...args);  // hier wird eine Nachricht an main.js geschickt
    }  
  },  
  receive: (channel, func) => {  
    const validChannels_receive = ['load-settings', 'gpx-data', 'clear-gpx', 'set-image-path', 'clear-image-path', 'image-loading-started', 'reload-data', 'save-meta-progress'];  
    if (validChannels_receive.includes(channel)) {
      // List of channels allowed and strip event as it includes `sender`
      ipcRenderer.on(channel, (event, ...args) => func(...args));  // hier wird eine Nachricht von main.js gesendet, in renderer.js empfangen und die entsprechende Callback-Funktion func in renderer.js aufgerufen
    }  
  },
  invoke: (channel, data) => {  
    // List of channels allowed  
    const validChannels_invoke = ['save-meta-to-image', 'geotag-exiftool', 'ai-tagging-status', 'ai-tagging-start', 'geocoding-start'];
    if (validChannels_invoke.includes(channel)) {  
      return ipcRenderer.invoke(channel, data);  // hier wird eine Nachricht 'data' von renderer.js an main.js geschickt und ein return-wert an renderer.js zurückgegeben.
    }  
  }, 
});  