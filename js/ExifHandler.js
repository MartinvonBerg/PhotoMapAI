/** @module ExifHandler
 * 
 * @file ExifHandler.js
 * @requires Date (which is available without import)
 */

import { isNumber } from './generalHelpers.js';

function exifDateToJSLocaleDate(dt) {

  // Achtung: Monat ist in JS 0-basiert! Doubled with the following function.
  const dateObj = new Date(
    dt.year,
    dt.month - 1,
    dt.day,
    dt.hour,
    dt.minute,
    dt.second
  );

  // Ausgabe als Datum und Zeit
  return dateObj.toLocaleDateString();
}

function exifDateTimeToJSTime(dt) {
  const dateObj = new Date(
    dt.year,
    dt.month - 1,
    dt.day,
    dt.hour,
    dt.minute,
    dt.second
  );

  return dateObj.toLocaleTimeString() + ' ' + dt.zoneName;
}

function exifDateToISODate(dt) {
  if (!dt || typeof dt !== 'object' || dt.year == null || dt.month == null || dt.day == null) {
    return '';
  }

  const year = String(dt.year).padStart(4, '0');
  const month = String(dt.month).padStart(2, '0');
  const day = String(dt.day).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Calculates the mean and standard deviation of a set of timestamps.
 * Also returns the date if the max deviation is less than 24h.
 * @param {Array} imagesSubset - Array of image objects with a DateTimeOriginal property.
 * @returns {Object} - Object with mean, maxDev, and date properties.
 * @property {string} mean - Mean of the timestamps in ISO format.
 * @property {string} maxDev - Maximum deviation in seconds.
 * @property {string|null} date - Date of the mean if max deviation is less than 24h, otherwise null.
 */
function calcTimeMeanAndStdDev(imagesSubset) {
    const toUnixTimestamp = (dateObjOrStr) => {
        if (typeof dateObjOrStr === 'string') {
            // Format: "YYYY:MM:DD HH:MM:SS"
            const [datePart, timePart] = dateObjOrStr.split(' ');
            if (!datePart || !timePart) return null;
            const [year, month, day] = datePart.split(':').map(Number);
            const [hour, minute, second] = timePart.split(':').map(Number);
            return new Date(Date.UTC(year, month - 1, day, hour, minute, second)).getTime() / 1000;
        } else if (typeof dateObjOrStr === 'object' && dateObjOrStr != null && isNumber(dateObjOrStr.year) && isNumber(dateObjOrStr.month) && isNumber(dateObjOrStr.day) ) {
            const {
                year, month, day,
                hour = 0, minute = 0, second = 0,
                tzoffsetMinutes = 0
            } = dateObjOrStr;

            // Berechne UTC-Zeit unter Berücksichtigung der Zeitzonenverschiebung
            const localTime = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
            const offsetSeconds = tzoffsetMinutes * 60;
            return (localTime.getTime() / 1000) - offsetSeconds;
        }
        return null;
    };

    const timestamps = imagesSubset
        .map(img => toUnixTimestamp(img.DateTimeOriginal))
        .filter(ts => ts !== null);

    if (timestamps.length === 0) {
        return { mean: null, maxDev: null, date: null };
    }

    const mean = timestamps.reduce((sum, val) => sum + val, 0) / timestamps.length;
    //const variance = timestamps.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / timestamps.length;
    //const stdDev = Math.sqrt(variance);
    const deviations = timestamps.map(ts => Math.abs(ts - mean));
    const maxDeviation = Math.max(...deviations);

    // If maxDeviation < 86400 seconds (24h) return the date, too. So if maxDeviation is greater than 24h, date will be null.
    let date = null;
    if (maxDeviation < 86400) {
        const meanDate = new Date(mean * 1000);
        //date = meanDate.toISOString().split('T')[0]; // YYYY-MM-DD
        date = meanDate.toLocaleDateString(); // Lokales Datumsformat
    }


    return {
        mean: new Date(mean * 1000).toISOString(),
        maxDev: maxDeviation.toFixed(3) + ' seconds',
        date: date
    };
}

function getTimeDifference(time1, time2) {

  const date1 = parseTime(time1);
  const date2 = parseTime(time2);

  if (date1 === null || date2 === null) {
    return null;
  }

  // Differenz in Millisekunden
  const diffMs = date1 - date2;
  const isNegative = diffMs < 0;
  let absDiffMs = Math.abs(diffMs);

  // Umwandlung in hh:mm:ss
  const hours = Math.floor(absDiffMs / (1000 * 60 * 60));
  absDiffMs -= hours * 1000 * 60 * 60;

  const minutes = Math.floor(absDiffMs / (1000 * 60));
  absDiffMs -= minutes * 1000 * 60;

  const seconds = Math.floor(absDiffMs / 1000);

  // Formatierung mit führenden Nullen
  const pad = (num) => String(num).padStart(2, '0');

  return `${isNegative ? '-' : ''}${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function parseTimeDiffToSeconds(timeDiffStr) {
  if (typeof timeDiffStr !== 'string') return null;

  const match = /^(-)?(\d{2}):([0-5]\d):([0-5]\d)$/.exec(timeDiffStr);
  if (!match) return null;

  const [, signSymbol, hhStr, mmStr, ssStr] = match;

  const sign = signSymbol ? -1 : 1;
  const hh = Number(hhStr);
  const mm = Number(mmStr);
  const ss = Number(ssStr);

  return sign * (hh * 3600 + mm * 60 + ss);
}

/**
 * Wandelt einen allgemeinen Zeitwert in ein JavaScript-Date-Objekt um.
 * Unterstützt Date-Instanzen und Zeitangaben als String, gibt bei ungültigen Eingaben null zurück.
 *
 * @param {string|Date} input - Die zu parsende Zeitangabe, entweder als Date-Objekt oder als parsebarer String.
 * @returns {Date|null} Ein gültiges Date-Objekt, wenn die Eingabe geparst werden konnte, sonst null.
 */
function parseTime(input) {
  if (typeof input === 'string') {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  } else if (input instanceof Date) {
    return input;
  } else {
    return null;
    //throw new Warning('Ungültiger Zeittyp. Erwartet wird ein String oder ein Date-Objekt.');
  }
}

/**
 * Safely parses EXIF-style DateTime strings (e.g. "YYYY:MM:DD HH:MM:SS")
 * into a JavaScript Date object.
 *
 * Returns null if the value cannot be parsed into a valid date.
 *
 * @param {string} rawValue
 * @returns {Date|null}
 */
function parseExifDateTime(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') {
    return null;
  }

  // Typical EXIF format: "YYYY:MM:DD HH:MM:SS"
  // Some variants may omit the time part.
  const dateTimeParts = rawValue.trim().split(' ');
  const datePart = dateTimeParts[0];
  const timePart = dateTimeParts[1] || '00:00:00';

  const dateSegments = datePart.split(':');
  if (dateSegments.length < 3) {
    return null;
  }

  const [yearStr, monthStr, dayStr] = dateSegments;
  const [hourStr = '0', minuteStr = '0', secondStr = '0'] = timePart.split(':');

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const second = parseInt(secondStr, 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second)
  ) {
    return null;
  }

  // JavaScript Date months are 0-based.
  const date = new Date(year, month - 1, day, hour, minute, second);

  // Guard against invalid dates (e.g. month 13, day 32, etc.).
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isValidLocation(metadata) {
  return (
    typeof metadata.City === 'string' &&
    typeof metadata.State === 'string' &&
    typeof metadata.Country === 'string' &&
    metadata.City.length > 0 &&
    metadata.State.length > 0 &&
    metadata.Country.length > 0
  );
}

export { parseExifDateTime, exifDateToJSLocaleDate, exifDateTimeToJSTime, calcTimeMeanAndStdDev, getTimeDifference, parseTimeDiffToSeconds, isValidLocation};