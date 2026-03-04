/** @module generalHelpers
 * 
 * @file generalHelpers.js
 * @requires toDMS
 */

import { toDMS } from './TrackAndGpsHandler.js';
import sanitizeHtml from 'sanitize-html';

/** Returns an object with the keys being the property names of the images and the values being the first value if all values are identical, or the multipleValue if not.
 * 
 * @param {object[]} images - the array of images
 * @param {number[]} indexes - the array of indexes of the images in the images array
 * @param {string[]} keys - the array of property names of the images to check for identical values
 * @param {string} multipleValue - the value to return if the values for a key are not identical
 * @returns {object} result - an object with the keys being the property names of the images and the values being the first value if all values are identical, or the multipleValue if not
 */
function getIdenticalValuesForKeysInImages(images, indexes, keys, multipleValue) {  
    const result = {};  
  
    keys.forEach(key => {  
        // Konvertiere alle Werte zu Strings  
        let values = indexes.map(index => String(images[index][key]));  
        let allIdentical = values.every(value => value === values[0]);  
  
        result[key] = allIdentical ? values[0] : multipleValue;  
    });  
    // this function is only called if indexes.length is greater than 1, so the following is correct here.
    result.file = multipleValue;
    result.extension = '';
    
    // set a fake wrong value for number inputs to indicate that the values are not identical
    if (keys.includes('GPSAltitude') && result.GPSAltitude === multipleValue) result.GPSAltitude = -8888;
    if (keys.includes('GPSImgDirection') && result.GPSImgDirection === multipleValue) result.GPSImgDirection = -8888;       
  
    return result;  
} 

function normalizeTags(input) {
  return [...new Set(
    input
      .split(",")          // 1. split
      .map(tag => tag.trim())  // 2. trim whitespace
      .filter(tag => tag.length > 0) // 3. remove empty entries
  )].join(", "); // 4 & 5 deduplicate + join
}

/** update the allImages array to convertedValue for GPS-Data and set the status to 'gps-manually-changed'
 * 
 * @param {object[]} allImages array of all images
 * @param {string} indices an string of image indices like "1, 2, 3, 4" or "1" 
 * @param {string} convertedValue '' or object with { lat, lon, refLat, refLon } as GPS coordinates
 * @param {string} newStatusAfterSave optional status to set after saving the data
 */
function updateAllImagesGPS(allImages, indices, convertedValue = '', newStatusAfterSave = '') {  
    // Splitte den String und konvertiere in ein Array von Zahlen  
    const indexArray = indices.split(',').map(index => parseInt(index.trim(), 10));

    // TODO: Why not lat lng here? And why not altittude?
    indexArray.forEach(index => {  
        if (index < 0 || index >= allImages.length) {  
          console.error(`Index ${index} ist außerhalb des Bereichs.`);  
          return;  
        }
        // TODO: newStatusAfterSave wird nur hier benutzt und der alte status auch nicht.
        if ( convertedValue && convertedValue.pos === allImages[index].pos && newStatusAfterSave === 'loaded-with-GPS' ) {
          // Wenn die Werte gleich sind und der neue Status 'loaded-with-GPS' ist, gehe zum naechsten Bild
          return; // return here skips to the next iteration of the loop
        }
        else if ( convertedValue === '' ) {  
          allImages[index].pos = '';  
          allImages[index].GPSLatitude = '';  
          allImages[index].GPSLatitudeRef = '';  
          allImages[index].GPSLongitude = '';  
          allImages[index].GPSLongitudeRef = '';  
          allImages[index].status = 'gps-manually-changed';
        } else if ( convertedValue ) {
          allImages[index].pos = toDMS(convertedValue.lat) + ' ' + convertedValue.refLat + ', ' + toDMS(convertedValue.lon) + ' ' + convertedValue.refLon;  
          allImages[index].GPSLatitude = toDMS(convertedValue.lat);  
          allImages[index].GPSLatitudeRef = convertedValue.refLat;  
          allImages[index].GPSLongitude = toDMS(convertedValue.lon);  
          allImages[index].GPSLongitudeRef = convertedValue.refLon;  
          allImages[index].status = 'gps-manually-changed';  
        } else {
          allImages[index].pos = null;  
          allImages[index].GPSLatitude = null;  
          allImages[index].GPSLatitudeRef = null;  
          allImages[index].GPSLongitude = null;  
          allImages[index].GPSLongitudeRef = null;  
          allImages[index].status = 'leave-gps-unchanged';  
        }
    });
    return allImages;
}

/** 
 * Converts an input string into an HTML-escaped text representation, making it safe 
 * to display as HTML without interpreting any contained tags/markup.
 * 
 * @param {string} value 
 * @returns string returns a string where HTML special characters (especially <, >, &, " and ') are converted to HTML entities but not removed.
 * 
 */
function sanitizeInput(value) {
  // Entfernt <script>, HTML-Tags etc.
  const div = document.createElement("div");
  div.textContent = value; 
  return div.innerHTML; // Rückgabe ist sicherer Text
}

/**
 * Sanitizes a string value by removing any HTML tags and attributes from it.
 * 
 * If the value is not a string, it returns undefined.
 * 
 * @param {string} value - the string value to sanitize
 * @returns {string|undefined} - the sanitized string or undefined if the value is not a string
 */
function sanitize(value) {  

  if (typeof value !== "string") return undefined;  
  let v = value.trim();

  v = sanitizeHtml(v, {
      allowedTags: [],  // does not allow any tags!  
      allowedAttributes: {}
    });

  return v;
}

/**
 * Sanitizes string for safe XMP metadata usage and removes control characters, HTML tags, collapses whitespace.
 * @param {string} value - the string value to sanitize
 * @return {string} the sanitized string
 */
function sanitizeString(str) {
  
  return str
    .normalize("NFC")

    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, "")

    // Remove all HTML/XML tags
    .replace(/<[^>]*>/g, "")

    // Collapse whitespace
    .replace(/\s+/g, " ")

    .trim();
}

/**
 * Struktur-erhaltender TXT-Sanitizer:
 * - behält \n und normale Leerzeichen bei
 * - entfernt BOM, NUL und problematische Control-Chars
 * - optional: CRLF/CR -> LF normalisieren
 * - optional: Tabs behalten oder entfernen
 */
function sanitizeTxtFile(raw, opts = {}) {
  const {
    normalizeNewlines = true, // \r\n und \r -> \n
    keepTabs = true,          // \t behalten
    trimEnd = false,          // nur Dateiende trimmen (innen bleibt alles)
    maxLength = 2_000_000     // Schutz gegen riesige Inputs (2MB default)
  } = opts;

  if (raw == null) return "";
  let s = String(raw);

  // Optional: Größenlimit (DoS-Schutz bei untrusted input)
  if (s.length > maxLength) {
    s = s.slice(0, maxLength);
  }

  // UTF-8 BOM entfernen
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // Newlines normalisieren (Struktur bleibt, nur Format vereinheitlicht)
  if (normalizeNewlines) {
    s = s.replace(/\r\n?/g, "\n");
  }

  // NUL bytes entfernen
  s = s.replace(/\u0000/g, "");

  // C0-Controls entfernen, aber \n (und optional \t) behalten
  // Entfernt: 0x01-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F
  // Lässt: \n (0x0A), \r (falls normalizeNewlines=false), und optional \t (0x09)
  const controlPattern = keepTabs
    ? /[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
    : /[\u0001-\u0009\u000B\u000C\u000E-\u001F\u007F]/g;
  s = s.replace(controlPattern, "");

  // Optional: Unicode "Line/Paragraph Separator" in \n überführen
  // (kommt selten vor, kann aber Layout brechen)
  s = s.replace(/\u2028|\u2029/g, "\n");

  // Optional: nur am Ende trimmen (innen bleibt alles inkl. Leerzeilen)
  if (trimEnd) {
    s = s.replace(/[ \t]+\n/g, "\n"); // trailing spaces vor newline entfernen
    s = s.replace(/[ \t]+$/g, "");    // trailing spaces am Dateiende entfernen
    s = s.replace(/\n+$/g, "\n");     // viele End-Newlines auf genau eine reduzieren
  }

  return sanitize(s);
}

function normalizeFileString(input) {
  if (input == null) return "";
  let s = String(input);

  // UTF-8 BOM entfernen
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // NUL bytes raus (klassischer Exploit/Parser-Killer)
  s = s.replace(/\u0000/g, "");

  // Die meisten C0-Control-Chars entfernen, aber \t \n \r lassen (Struktur!)
  s = s.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

  // Optional: Newlines normalisieren
  s = s.replace(/\r\n?/g, "\n");

  return s;
}

function safeParseJson(raw) {

  const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);
  const s = normalizeFileString(raw);

  const data = JSON.parse(s);

  // Rekursiv gefährliche Keys entfernen
  const scrub = (value) => {
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") {
      for (const k of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(k)) {
          delete value[k];
        } else {
          value[k] = scrub(value[k]);
        }
      }
    }
    return value;
  };

  return scrub(data);
}

/**
 * Checks if an object is empty.
 *
 * @param {Object} obj - The object to check.
 * @return {boolean} Returns true if the object is empty, false otherwise.
 */
function isObjEmpty (obj) {
  return Object.values(obj).length === 0 && obj.constructor === Object;
}

// Source - https://stackoverflow.com/a/20169362
// Posted by peter.petrov, modified by community. See post 'Timeline' for change history
// Retrieved 2026-02-15, License - CC BY-SA 4.0
const isNumber = function isNumber(value) 
{
   return typeof value === 'number' && isFinite(value);
}

export { sanitize, updateAllImagesGPS, getIdenticalValuesForKeysInImages, sanitizeInput, isObjEmpty, isNumber, sanitizeString, sanitizeTxtFile, safeParseJson, normalizeTags };