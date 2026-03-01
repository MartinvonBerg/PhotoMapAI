import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { sanitizeString, sanitizeTxtFile, safeParseJson } from '../js/generalHelpers.js';

class OllamaClient {

    /**
     * Initializes the OllamaClient with the given app root, config file path, and prompt template file path.
     * 
     * @param {string} appRoot - The path to the application's root directory.
     * @param {string} configfile - The path to the config file (relative to the app root).
     * @param {string} promptfile - The path to the prompt template file (relative to the app root).
     * 
     * The OllamaClient will check if the config file and prompt template exist in the app root and copy them to the user's app directory if they do not exist.
     * The OllamaClient will then load the config and prompt from the user's app directory.
     * If the config or prompt is invalid, the OllamaClient will set `ollamaAvailable` to false and `model` to null.
     */
    constructor(appRoot, configfile, promptfile) {
        this.configfile = configfile;
        this.promptTemplate = promptfile;

        // build absolute path to config file and prompt template in the users app directory, 
        // which is writable and can be used to store user-specific settings and custom prompts. 
        // This allows users to modify the config and prompt without changing the packaged app files, which may be read-only. 
        this.configPath = path.join(app.getPath('userData'), configfile);
        this.promptPath = path.join(app.getPath('userData'), promptfile);

        let load1 = this.checkAndCopySettingsFiles(appRoot, this.configPath, configfile);
        let load2 = this.checkAndCopySettingsFiles(appRoot, this.promptPath, promptfile);
        if (!load1 || !load2) {
            console.log("Failed to load config or prompt template. Check if the default files exist in the app's settings folder.");
            this.ollamaAvailable = false;
            this.model = null;
            return;
        }

        this.config = this.loadJsonConfig( this.configPath);
        this.prompt = this.loadPrompt( this.promptPath);

        if (!this.config || !this.config.ollama || !this.prompt) {
            console.log("Invalid config.json or prompt file.");
            this.ollamaAvailable = false;
            this.model = null;
            return;
        }
        this.ollamaAvailable = true;
        this.baseUrl = this.config.ollama.base_url;
        this.model = this.config.ollama.model;
        this.timeout = this.config.ollama.timeout ?? 120;
        this.generation = this.config.generation;
    }

    /**
     * Check and copy settings files if they do not exist in the user-writable location.
     * @param {string} appRoot the root of the packaged and running app
     * @param {string} settingsFilePath the full path to the user settings which are editable
     * @param {string} fileName the basename of the settings file
     */
    checkAndCopySettingsFiles(appRoot, settingsFilePath, fileName) {
        // check if file exists in settingsFilePath. 
        // If not copy the default settings file from the project folder to the user folder
        const defaultSettingsPath = path.join(appRoot, 'settings', fileName);
        
        if ( fs.existsSync(settingsFilePath) ) {
            return true;
        }

        if (!fs.existsSync(settingsFilePath) && fs.existsSync(defaultSettingsPath)) {
            fs.copyFileSync( defaultSettingsPath, settingsFilePath);
            return true;
        } else {
            console.log('Could not find default ai-settings file from', defaultSettingsPath);
            return false;
        }
    }

    /**
     * Loads a JSON configuration file from the given path.
     * Returns the parsed JSON object or null if an error occurs.
     * @param {string} filePath - The path to the JSON configuration file to load.
     * @returns {object|null} The parsed JSON object or null if an error occurs.
     */
    loadJsonConfig(filePath) {
        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            return safeParseJson(data);
        } catch (e) {
            console.log(`Error loading config file ${filePath}: ${e}`);
            return null;
        }
    }

    /**
     * Loads a prompt template from a text file.
     * Returns the contents of the file as a string, or null if an error occurs.
     * @param {string} filePath - The path to the text file containing the prompt template.
     * @returns {string|null} The loaded prompt template or null if an error occurs.
     */
    loadPrompt(filePath) {
        try {
            return sanitizeTxtFile( fs.readFileSync(filePath, 'utf-8') );
        } catch (e) {
            console.log(`Error loading prompt file: ${e}`);
            return null;
        }
    }

    getPreferredLongEdge() {
        return this.config.ollama.long_edge ?? 1200;
    }

    /**
     * Checks if the Ollama model is available by performing a robust HTTP GET.
     * Does not check whether Ollama was started already.
     * If the Ollama HTTP API responds, consider it available.
     * Further validation can inspect the response for expected fields.
     * @returns {Promise<boolean>} True if the Ollama model is available, false otherwise.
     */
    async checkOllamaStatus() {
        // check if setting were loaded correctly. This does not check wether Ollama was started already.
        if ( !this.ollamaAvailable || !this.model ) {
            console.log("Ollama config files not properly loaded. Check config file and prompt file in user app folder.");
            return false;
        }

        // perform a robust HTTP GET with timeout and host normalization
        // Normalize `localhost` -> `127.0.0.1` to avoid IPv6 resolution issues
        const base = (this.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');
        const normalizedBase = base.replace('localhost', '127.0.0.1');
        let url = `${normalizedBase}/api/tags`;

        const timeoutMs = (this.timeout ?? 120) * 1000;
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal
            });
            clearTimeout(id);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            // If the Ollama HTTP API responds, consider it available.
            // Further validation can inspect `data` for expected fields.
            if (data) {
                // optional: extract model info from response if available
                // here this.model is the expected model from config and it shall be checked wether it is actually available according to the response.
                let modelFound = false;
                for (const modelInfo of data.models || []) {
                    if (modelInfo.name.includes(this.model) ) {
                        console.log(`Ollama model "${this.model}" is available.`);
                        this.model = modelInfo.name; // update to actual model name from response, which may include version or other details
                        modelFound = true;
                        // load the model and set keep_alive to -1 to keep it in memory.
                        // but this slows down the app start!
                        url = `${normalizedBase}/api/generate`;
                        await fetch(url, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                model: this.model,
                                prompt: '',
                                keep_alive: -1
                            })
                        });
                        
                        break;
                    }
                }
                if (!modelFound) {
                    console.log(`Ollama model "${this.model}" is not available.`);
                    this.model = null; // model not found
                    return false;
                }
                return true;
            }
            return false;
        } catch (e) {
            clearTimeout(id);
            if (e.name === 'AbortError') {
                console.log(`Ollama request to ${url} timed out after ${timeoutMs}ms`);
            } else {
                console.log(`Fehler bei der Anfrage an Ollama (${url}):`, e && e.message ? e.message : e);
            }
            return false;
        }
    }

    /**
     * Checks whether Ollama is available and running with the specified model.
     * If not running, tries to start it once with exec, but only if ollama is configured to be used and the model is specified.
     * Returns an object with two properties: available (boolean) and model (string or null).
     * If available is true, model is the name of the model that is currently running.
     * If available is false, model is null.
     * 
     * @returns {available, model} - Object with availability and model name that was loaded.
    */
    async getOllamaClientStatus() {
        let status = await this.checkOllamaStatus();

        // if not running try to start it once with exec, but only if ollama is configured to be used and the model is specified. This allows to automatically start ollama when the user tries to use it without starting it manually first.
        if (!status && this.model) {
            const { spawn } = await import('child_process');
            this.ollamaProcess = spawn('ollama', ['serve'], {
                detached: true,
                stdio: 'ignore'
            });

            this.ollamaProcess.unref();
            
            // try again to check the status after trying to start it, wait a few seconds to give it time to start up
            await new Promise(resolve => setTimeout(resolve, 2000));
            status = await this.checkOllamaStatus();
            return { available: this.ollamaAvailable, model: this.model };

        } else if (status && this.model) {
            console.log("Ollama is already running.");
            this.ollamaAvailable = status;
            return { available: this.ollamaAvailable, model: this.model };
        } else {
            console.log("Ollama model not defined in config files. Check config file and prompt file in user app folder.");
            this.ollamaAvailable = false;
            return { available: this.ollamaAvailable, model: null };
        }
    }

    preparePrompt(promptTemplate, captureDate, imageMeta, geoLocationInfo) {
        
        // update the prompt template with the actual values for date and location
        let prompt = promptTemplate;

        if (captureDate) {
            prompt = prompt.replace('DATEREPLACE', captureDate);
        } else {
            // delete the complete line with the date placeholder if no capture date is available.
            prompt = prompt.replace(/.*DATEREPLACE.*(\r?\n)?/g, '');
        }

        if (!geoLocationInfo.includes('No Location')) {
            prompt = prompt.replace('LOCATIONREPLACE', geoLocationInfo);
        } else { // delete the complete line with the location placeholder if no location info is available.
            prompt = prompt.replace(/.*LOCATIONREPLACE.*(\r?\n)?/g, '');
        }

        if (imageMeta.Title.length === 0 && imageMeta.Description.length === 0 && imageMeta.Keywords.length === 0) {
            // remove the alle lines between #HINTSTART and #HINTEND.
            prompt = prompt.replace(/#HINTSTART[\s\S]*?#HINTEND/g, '');
        } else {

            if (imageMeta.Title.length > 0) {
                prompt = prompt.replace('TITLEEXISTING', imageMeta.Title);
            } else {
                // remove the complete line with the title placeholder if no title is available.
                prompt = prompt.replace(/.*TITLEEXISTING.*(\r?\n)?/g, '');
            }

            if (imageMeta.Description.length > 0) {
                prompt = prompt.replace('DESCREXISTING', imageMeta.Description);
            } else {
                // remove the complete line with the description placeholder if no description is available.
                prompt = prompt.replace(/.*DESCREXISTING.*(\r?\n)?/g, '');
            }

            if (imageMeta.Keywords.length > 0) {
                // join the keywords with comma and space.
                prompt = prompt.replace('KEYWORDSEXISTING', imageMeta.Keywords.join(', '));
            } else {
                // remove the complete line with the keywords placeholder if no keywords are available.
                prompt = prompt.replace(/.*KEYWORDSEXISTING.*(\r?\n)?/g, '');
            }
            // remove the hint lines between #HINTSTART and #HINTEND.
            prompt = prompt.replace(/.*#HINTSTART.*(\r?\n)?/g, '');
            prompt = prompt.replace(/.*#HINTEND.*(\r?\n)?/g, '');
        }

        return prompt;
    }

    /**
     * Validates and sanitizes a JSON string response object for XMP metadata storage purposes.
     * Expected format:
     * {
     *   "Title": "...",
     *   "Description": "...",
     *   "Keywords": "..."
     * }
     *
     * @param {string} input
     * @returns {{Title: string, Description: string, Keywords: string} | null}
     */
    validateAndSanitizeMetadataJSON(input) {
        if (typeof input !== "string") {
            return null;
        }
        input = this.extractJsonFromResponse(input);

        // 1. Strict JSON Parse
        let parsed;
        try {
            parsed = JSON.parse(input);
        } catch {
            return null;
        }

        // 2. Basic structural validation
        if (
            typeof parsed !== "object" ||
            parsed === null ||
            Array.isArray(parsed)
        ) {
            return null;
        }

        // 3. Prototype Pollution Protection
        // Ensure plain object
        if (Object.getPrototypeOf(parsed) !== Object.prototype) {
            return null;
        }

        const allowedKeys = ["title", "description", "keywords"];

        const keys = Object.keys(parsed);

        // 4. No additional or missing properties
        if (keys.length !== allowedKeys.length) {
            return null;
        }

        for (const key of keys) {
            if (!allowedKeys.includes(key)) {
            return null;
            }
        }

        // 5. Type checking + sanitization
        const sanitized = Object.create(null);

        for (const key of allowedKeys) {
            const value = parsed[key];

            if (typeof value !== "string") {
            return null;
            }

            sanitized[key] = sanitizeString(value, key);
        }

        return sanitized;
    }

    /**
     * Extrahiert JSON aus einer LLM-Antwort, entfernt Markdown-Code-Fences
     * und parsed das Ergebnis sicher.
     */
    extractJsonFromResponse(responseText) {
        // 1. Entferne ```json ... ``` oder ``` ... ```
        let cleaned = responseText.replace(/```json\s*/g, "");
        cleaned = cleaned.replace(/```/g, "");
        cleaned = cleaned.trim();
        
        // 2. Falls noch Text vor/nach dem JSON steht → nur {...} extrahieren
        const match = cleaned.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error("Kein gültiges JSON-Objekt gefunden.");
        }
        
        const jsonStr = match[0];
        
        return jsonStr;
    }

    /**
     * Generates tags for an image using the Ollama AI model.
     * The generate function takes an image path, a capture date, coordinates, and a geo location info string as parameters.
     * It updates the prompt template with the actual values for date and location, and then sends a POST request to the Ollama API with the updated prompt and the image.
     * If the request is successful, it returns an object with the sanitized response data and a success flag set to true.
     * If the request fails, it returns an object with an error message and a success flag set to false.
     * @param {string} imagepath - The path to the image file that should be tagged.
     * @param {string} captureDate - The date the image was captured.
     * @param {string} coords - The coordinates of the location where the image was captured.
     * @param {string} geoLocationInfo - A string containing information about the location where the image was captured.
     * @returns {success, data, error} - An object with a success flag, the sanitized response data, and an error message if the request fails.
     */
    async generate(imagePath, captureDate, imageMeta, geoLocationInfo) {
        // reload the config and prompt before every generate
        this.config = this.loadJsonConfig( this.configPath);
        this.prompt = this.loadPrompt( this.promptPath);

        const prompt = this.preparePrompt(this.prompt, captureDate, imageMeta, geoLocationInfo);  
        const url = `${this.baseUrl}/api/generate`;

        let encodedImage;
        try {
            const imageBuffer = fs.readFileSync(imagePath);
            encodedImage = imageBuffer.toString('base64');
        } catch (e) {
            console.log(`Fehler beim Laden des Bildes: ${e}`);
            process.exit(1);
        }

        const payload = {
            model: this.model,
            prompt: prompt,
            keep_alive: -1,
            images: [encodedImage],
            format: 'json',
            stream: this.config.generation.stream ?? false,
            options: {
                temperature: this.config.generation.temperature ?? 0.1,
                top_p: this.config.generation.top_p ?? 0.8,
                seed: this.config.generation.seed ?? 42,
                top_k: this.config.generation.top_k ?? 1
            }
        };

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                timeout: this.timeout
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            if (data.response) {
                // sanitize the response data to a valid JSON.
                console.log("Antwort von Ollama: ", data.response);
                let sanitizedData = this.validateAndSanitizeMetadataJSON(data.response);
                
                if ( !sanitizedData ) {
                    sanitizedData = await this.ollamaTransformText(url, payload, data.response)
                    console.log("Transformierte Antwort von Ollama: ", sanitizedData);
                }
                return { data: sanitizedData, success: true };

            } else {
                console.log("Unerwartetes Antwortformat von Ollama:");
                console.log(data);
                return { success: false, error: "Unexpected response format from Ollama: " + response.statusText };
            }
        } catch (e) {
            console.log(`Fehler bei der Anfrage an Ollama: ${e}`);
            return { success: false, error: e && e.message ? e.message : e };
        }
    }

    async ollamaTransformText(url, payload, firstprompt) {
        let prompt = `Convert the following TEXT into valid JSON, where 'keywords' must be a comma-separated list of individual keywords. 'title' and 'description' may only contain plain text. Output only the JSON, no explanations. Return TEXT directly if the format is already correct. Do not translate.
        Output a JSON object in the following format (exactly this format as an example):
        {
        "title": "...",
        "description": "...",
        "keywords": "keyword1, keyword2, ...."
        }
        ---- TEXT ----
        `;

        prompt += firstprompt;
        payload.prompt = prompt;
        // remove unsed keys from object payload
        if (payload.images) delete payload.images;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            timeout: this.timeout
        });

        if (!response.ok) return firstprompt;
        const data = await response.json();
        if ( !data.response ) return firstprompt;
        let result = JSON.parse(data.response);
        return result;
    }
}

export { OllamaClient };
