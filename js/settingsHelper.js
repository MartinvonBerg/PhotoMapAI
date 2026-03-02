// settingsHelper.js

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

/**
 * Loads user settings from a JSON file.
 * If the file does not exist or cannot be parsed, returns an empty object.
 * 
 * @param {string} settingsFilePath 
 * @param {string} appRoot
 * 
 * @returns {object} The loaded settings object.
 */
export function loadSettings(appRoot, settingsFilePath) {
  // check if file exists in settingsFilePath. 
  // If not copy the default settings file from the project folder to the user folder
  const defaultSettingsPath = path.join(appRoot, 'settings', 'user-settings.json');

  if (!fs.existsSync(settingsFilePath) && fs.existsSync(defaultSettingsPath)) {
    fs.copyFileSync( defaultSettingsPath, settingsFilePath);
  } else if ( !fs.existsSync(defaultSettingsPath)) {
    console.log('Could not find default settings file from', defaultSettingsPath);
  }

  try {  
    return JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));  
  } catch (error) {
    return {};
  }  
}

/**
 * saves user settings to a JSON file.
 * 
 * @param {string} settingsFilePath 
 * @param {object} settings 
 * 
 */
export function saveSettings(settingsFilePath, settings) {
  //console.log('Saving settings to', settingsFilePath);
  fs.writeFileSync(settingsFilePath, JSON.stringify(settings, null, 2));
}

export function openSettingsInSystemEditor(settingsPath) {

  // check if notepad++ is installed
  if (fs.existsSync("C:\\Program Files\\Notepad++\\notepad++.exe")) {
    spawn('C:\\Program Files\\Notepad++\\notepad++.exe', [settingsPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  
  if (process.platform === 'win32') {
    // Win11 Notepad (notepad.exe) – unabhängig von .json-Default-App
    spawn('notepad.exe', [settingsPath], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  // macOS/Linux: hier könntest du "open"/"xdg-open" nehmen oder bei shell.openPath bleiben
  // (öffnet dann jeweils die Default-App)
  dialog.showMessageBox({ message: `Auf ${process.platform} aktuell nicht fest verdrahtet.` });
}