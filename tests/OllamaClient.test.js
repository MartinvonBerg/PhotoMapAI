import { OllamaClient } from '../aitagging/OllamaClient.js';
import { expect, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import { sanitizeTxtFile, safeParseJson, sanitize, sanitizeString } from '../js/generalHelpers.js';

// Get the current directory (ES6 module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OllamaClient', () => {
    let tempDir;
    const appRoot = path.join(__dirname, '..');
    const configFile = 'ollama_config.json';
    const promptFile = 'prompt.txt';

    beforeAll(() => {
        // Create a temporary directory for test userData
        tempDir = path.join(os.tmpdir(), 'ollama-client-test');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
    });

    afterAll(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    afterEach(() => {
        // Clean up files created in tempDir after each test
        const files = fs.readdirSync(tempDir);
        files.forEach(file => {
            const filePath = path.join(tempDir, file);
            if (fs.lstatSync(filePath).isFile()) {
                fs.unlinkSync(filePath);
            }
        });
    });
    
    describe('constructor', () => {
        test('should initialize OllamaClient with valid config and prompt files', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const status = await client.getOllamaClientStatus();

            expect(client).toBeInstanceOf(OllamaClient);
            expect(client.ollamaAvailable).toBe(true);
            expect(client.model).not.toBeNull();
            expect(client.baseUrl).toBeDefined();
            expect(client.config).toBeDefined();
            expect(client.prompt).toBeDefined();
            expect(client.format).toBeDefined();

            // -- status
            expect(status.available).toBe(true);
            expect(['gemma3:12b', 'qwen3-vl:8b']).toContain(client.model);
        });

        test('should set ollamaAvailable to false if config files are missing', () => {
            const client = new OllamaClient(appRoot, 'non-existent/config.json', 'non-existent/prompt.txt');

            expect(client.ollamaAvailable).toBe(false);
            expect(client.model).toBeNull();
        });

        test('should return null if JSON or prompt.txt is invalid', () => {
            const invalidConfigFile = path.join(tempDir, 'invalid.json');
            fs.writeFileSync(invalidConfigFile, '{invalid json}');

            const client = new OllamaClient(appRoot, 'invalid.json', promptFile);
            expect(client.ollamaAvailable).toBe(false);
            expect(client.model).toBeNull();

            fs.unlinkSync(invalidConfigFile);

            // generate a txt-file which will not pass the check with 'sanitizeTxtFile()'
            const invalidPromptFile = path.join(tempDir, 'invalid.txt');
            fs.writeFileSync(invalidPromptFile, '<script>alert("XSS");</script>');

            const client2 = new OllamaClient(appRoot, configFile, 'invalid.txt');
            expect(client2.ollamaAvailable).toBe(false);
            expect(client2.model).toBeNull();
        });

        test('should copy settings files from default location if they do not exist in userData', () => {
            // Clean up tempDir to ensure files don't exist
            const configPath = path.join(tempDir, 'test_config.json');
            const promptPath = path.join(tempDir, 'test_prompt.txt');

            expect(fs.existsSync(configPath)).toBe(false);
            expect(fs.existsSync(promptPath)).toBe(false);

            const client = new OllamaClient(appRoot, configFile, promptFile);

            // After initialization, files should be copied to userData
            expect(fs.existsSync(path.join(tempDir, path.basename(configFile)))).toBe(true);
            expect(fs.existsSync(path.join(tempDir, path.basename(promptFile)))).toBe(true);
        });

        test('should load config with correct baseUrl and model', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);

            expect(client.baseUrl).toBe('http://localhost:11434');
            expect(['gemma3:12b', 'qwen3-vl:8b']).toContain(client.model);
            expect(client.timeout).toBe(120);
        });

        test('should load generation settings from config', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);

            expect(client.generation).toBeDefined();
            expect(client.generation.temperature).toBe(0.1);
            expect(client.generation.top_p).toBe(0.8);
            expect(client.generation.seed).toBe(42);
            expect(client.generation.top_k).toBe(1);
        });
    });
    
    describe('copySettingsFiles', () => {
        test('should return true if file already exists in settingsFilePath', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const existingFile = path.join(tempDir, 'existing_file.json');

            // Create a test file
            fs.writeFileSync(existingFile, '{}');

            const result = client.copySettingsFiles(appRoot, existingFile, 'dummy.json');

            expect(result).toBe(true);
            fs.unlinkSync(existingFile);
        });

        test('should copy file from appRoot to settingsFilePath if it does not exist', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const newConfigPath = path.join(tempDir, 'new_config.json');

            expect(fs.existsSync(newConfigPath)).toBe(false);

            const result = client.copySettingsFiles(appRoot, newConfigPath, 'ollama_config.json');

            expect(result).toBe(true);
            expect(fs.existsSync(newConfigPath)).toBe(true);
        });

        test('should return false if neither source nor destination file exists', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const nonExistentSourceFile = 'non/existent/file.json';
            const nonExistentDestFile = path.join(tempDir, 'non_existent.json');

            const result = client.copySettingsFiles(appRoot, nonExistentDestFile, nonExistentSourceFile);

            expect(result).toBe(false);
        });
    });
    
    describe('loadJsonConfig', () => {
        test('should load and parse a valid JSON config file', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const configPath = path.join(__dirname, '..', 'settings', configFile);
            const config = client.loadJsonConfig(configPath);

            expect(config).toBeDefined();
            expect(config.ollama).toBeDefined();
            expect(config.generation).toBeDefined();
        });

        test('should return null if file does not exist', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const nonExistentFile = path.join(tempDir, 'non_existent_config.json');

            const config = client.loadJsonConfig(nonExistentFile);

            expect(config).toBeNull();
        });

        test('should return null if JSON is invalid', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const invalidJsonFile = path.join(tempDir, 'invalid.json');
            fs.writeFileSync(invalidJsonFile, '{invalid json}');

            const config = client.loadJsonConfig(invalidJsonFile);

            expect(config).toBeNull();
        });
    });
    
    describe('loadPrompt', () => {
        test('should load prompt template from file', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const promptPath = path.join(__dirname, '..', 'settings', promptFile);
            const prompt = client.loadPrompt(promptPath);

            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe('string');
            expect(prompt.length).toBeGreaterThan(0);
        });

        test('should return null if prompt file does not exist', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const nonExistentFile = path.join(tempDir, 'non_existent_prompt.txt');

            const prompt = client.loadPrompt(nonExistentFile);

            expect(prompt).toBeNull();
        });

        test('should sanitize loaded prompt content', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const testPromptFile = path.join(tempDir, 'test_prompt.txt');
            const promptContent = 'Test prompt with DATEREPLACE and LOCATIONREPLACE';
            fs.writeFileSync(testPromptFile, promptContent);

            const prompt = client.loadPrompt(testPromptFile);

            expect(prompt).toBeDefined();
            expect(typeof prompt).toBe('string');
        });
    });
    
    describe('getPreferredLongEdge', () => {
        test('should return long_edge from config if available', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const longEdge = client.getPreferredLongEdge();

            expect(longEdge).toBe(896);
        });

        test('should return default value 1200 if long_edge not in config', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            // Temporarily remove long_edge from config
            const originalLongEdge = client.config.ollama.long_edge;
            delete client.config.ollama.long_edge;

            const longEdge = client.getPreferredLongEdge();

            expect(longEdge).toBe(1200);

            // Restore
            client.config.ollama.long_edge = originalLongEdge;
        });
    });
    
    describe('checkOllamaStatus', () => {
        test('should return false if ollamaAvailable is false', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.ollamaAvailable = false;

            const status = await client.checkOllamaStatus();

            expect(status).toBe(false);
        });

        test('should return false if model is not defined', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.model = null;

            const status = await client.checkOllamaStatus();

            expect(status).toBe(false);
        });
        
        test('should handle fetch timeout gracefully', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.timeout = 0.001; // Very short timeout to trigger timeout

            global.fetch = jest.fn(() => Promise.reject(new Error('timeout'))); // Simulate timeout/error

            const status = await client.checkOllamaStatus();

            expect(status).toBe(false);
        });
        
        test('should handle fetch errors gracefully', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);

            global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

            const status = await client.checkOllamaStatus();

            expect(status).toBe(false);
        });

        test('should return false if HTTP response is not ok', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            
            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({})
                })
            );
            
            // this starts ollama on the system, so depends on installed ollama server.
            const status = await client.checkOllamaStatus();

            expect(status).toBe(false);
        });
        
    });

    describe('validateAndSanitizeMetadataJSON', () => {
        const format = {
            "type": "object",
            "properties": {
                "title": {
                    "type": "string"
                },
                "description": {
                    "type": "string"
                },
                "keywords": {
                    "type": "array",
                    "items": {
                        "type": "string"
                    },
                    minItems: 1,
                    maxItems: 15
                }
                },
                "required": [
                    "title",
                    "description",
                    "keywords"
                ],
                additionalProperties: false
        };

        test('should return null if input is not a string', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);

            const result = client.validateAndSanitizeMetadataJSON({ title: 'test' }, format);

            expect(result).toBeNull();
        });
        
        test('should validate and sanitize valid JSON metadata', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '{"title": "Test Title", "description": "Test Description", "keywords": ["tag1", "tag2"]}';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).not.toBeNull();
            expect(result.title).toBe('Test Title');
            expect(result.description).toBe('Test Description');
            expect(result.keywords).toEqual(["tag1", "tag2"]);
        });
        
        test('should extract JSON from markdown code fences', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '```json\n{"title": "Test", "description": "Desc", "keywords": ["key1"]}\n```';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).not.toBeNull();
            expect(result.title).toBe('Test');
            expect(result.description).toBe('Desc');
            expect(result.keywords).toEqual(["key1"]);
        });
        
        test('should return null if JSON has missing required fields', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '{"title": "Test", "description": "Desc"}'; // missing keywords

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });

        test('should return null if JSON has extra fields', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '{"title": "Test", "description": "Desc", "keywords": "key1", "extra": "field"}';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });

        test('should return null if any field is not a string', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '{"title": 123, "description": "Desc", "keywords": "key1"}';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });

        test('should return null if input is an array', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '[{"title": "Test"}]';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });

        test('should return null if input is null', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = 'null';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });

        test('should return null if JSON cannot be extracted from response', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = 'This is text without JSON';

            const result = client.validateAndSanitizeMetadataJSON(input, format);

            expect(result).toBeNull();
        });
    });

    describe('Sanitizers and normalization security checks', () => {
        test('sanitizeTxtFile removes scripts, NUL and control chars and normalizes newlines', () => {
            const raw = "\uFEFFHello\u0000<scRipt>alert('x')<\/scRipt>\r\nLine2\x01\tTab";
            const cleaned = sanitizeTxtFile(raw);

            expect(cleaned).not.toContain('<script>');
            expect(cleaned).not.toContain('\u0000');
            expect(cleaned).not.toMatch(/\x01/);
            expect(cleaned).toContain('\n');
            expect(cleaned).not.toContain('\r');
        });

        test('sanitizeString removes HTML tags, control chars and collapses whitespace', () => {
            const raw = "  <b>Hello</b>\n\n<script>alert(1)</script>   \t\t";
            const s = sanitizeString(raw);

            expect(s).not.toMatch(/<[^>]*>/);
            expect(s).not.toContain('script');
            expect(s).not.toMatch(/\s{2,}/);
        });

        test('safeParseJson prevents prototype pollution and sanitizes strings in JSON', () => {
            const input = JSON.stringify({
                title: '<script>alert(1)</script>Title',
                keywords: ['good', '<b>bad</b>'],
                __proto__: { polluted: 'yes' },
                constructor: { bad: 'x' }
            });

            const parsed = safeParseJson(input);

            // ensure prototype is null (no prototype pollution)
            expect(Object.getPrototypeOf(parsed)).toBeNull();
            // dangerous keys removed
            expect(parsed.__proto__).toBeUndefined();
            expect(parsed.constructor).toBeUndefined();
            // strings sanitized
            expect(parsed.title).not.toContain('<');
            expect(parsed.title).toContain('Title');
            expect(Array.isArray(parsed.keywords)).toBe(true);
            expect(parsed.keywords[1]).not.toContain('<');
        });

        test('sanitize returns undefined for non-string inputs', () => {
            expect(sanitize(123)).toBeUndefined();
            expect(sanitize(null)).toBeUndefined();
        });
    });
    
    /*
    describe('getOllamaClientStatus', () => {
        test('should return object with available and model properties', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.checkOllamaStatus = jest.fn(() => Promise.resolve(false));

            const status = await client.getOllamaClientStatus();

            expect(status).toHaveProperty('available');
            expect(status).toHaveProperty('model');
        });

        test('should return available false if model is not defined', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.model = null;

            const status = await client.getOllamaClientStatus();

            expect(status.available).toBe(false);
            expect(status.model).toBeNull();
        });

        test('should return available true and model if ollama is already running', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.checkOllamaStatus = jest.fn(() => Promise.resolve(true));

            const status = await client.getOllamaClientStatus();

            expect(status.available).toBe(true);
            expect(status.model).toBe('gemma3:12b');
        });

        test('should try to spawn ollama process if not running', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            client.checkOllamaStatus = jest.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(false);

            const status = await client.getOllamaClientStatus();

            expect(client.checkOllamaStatus).toHaveBeenCalledTimes(2);
        });
    });

    describe('preparePrompt', () => {
        test('should replace DATEREPLACE with captureDate', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Image was taken on DATEREPLACE';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, '2024-01-15', imageMeta, geoLocationInfo);

            expect(result).toContain('2024-01-15');
            expect(result).not.toContain('DATEREPLACE');
        });

        test('should remove line with DATEREPLACE if no captureDate provided', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Date: DATEREPLACE\nOther info';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).not.toContain('DATEREPLACE');
        });

        test('should replace LOCATIONREPLACE with geoLocationInfo', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Location: LOCATIONREPLACE';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'Berlin, Germany';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).toContain('Berlin, Germany');
            expect(result).not.toContain('LOCATIONREPLACE');
        });

        test('should remove line with LOCATIONREPLACE if geoLocationInfo is "No Location"', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Location: LOCATIONREPLACE\nOther info';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).not.toContain('LOCATIONREPLACE');
        });

        test('should remove HINT section when no metadata is provided', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Before\n#HINTSTART\nHint content\n#HINTEND\nAfter';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).not.toContain('#HINTSTART');
            expect(result).not.toContain('#HINTEND');
            expect(result).not.toContain('Hint content');
        });

        test('should replace existing metadata placeholders when metadata is provided', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Title: TITLEEXISTING\nDescription: DESCREXISTING\nKeywords: KEYWORDSEXISTING';
            const imageMeta = { Title: 'My Title', Description: 'My Description', Keywords: ['tag1', 'tag2'] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).toContain('My Title');
            expect(result).toContain('My Description');
            expect(result).toContain('tag1, tag2');
        });

        test('should remove lines with placeholders when metadata is empty', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Title: TITLEEXISTING\nDescription: DESCREXISTING\nKeywords: KEYWORDSEXISTING';
            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).not.toContain('TITLEEXISTING');
            expect(result).not.toContain('DESCREXISTING');
            expect(result).not.toContain('KEYWORDSEXISTING');
        });

        test('should handle metadata with only some fields populated', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const template = 'Title: TITLEEXISTING\nDescription: DESCREXISTING\nKeywords: KEYWORDSEXISTING';
            const imageMeta = { Title: 'Only Title', Description: '', Keywords: [] };
            const geoLocationInfo = 'No Location';

            const result = client.preparePrompt(template, null, imageMeta, geoLocationInfo);

            expect(result).toContain('Only Title');
            expect(result).not.toContain('DESCREXISTING');
            expect(result).not.toContain('KEYWORDSEXISTING');
        });
    });

    describe('extractJsonFromResponse', () => {
        test('should extract JSON from plain string', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '{"title": "Test", "description": "Desc", "keywords": "key1"}';

            const result = client.extractJsonFromResponse(input);

            expect(result).toContain('{');
            expect(result).toContain('}');
        });

        test('should remove markdown code fences', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '```json\n{"title": "Test", "description": "Desc", "keywords": "key1"}\n```';

            const result = client.extractJsonFromResponse(input);

            expect(result).not.toContain('```');
        });

        test('should extract JSON from text with surrounding content', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = 'Some text before\n{"title": "Test", "description": "Desc", "keywords": "key1"}\nSome text after';

            const result = client.extractJsonFromResponse(input);

            expect(result).toContain('{"title"');
            expect(result).not.toContain('Some text');
        });

        test('should handle backticks with language identifier', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '```json\n{"title": "Test", "description": "Desc", "keywords": "key1"}\n```';

            const result = client.extractJsonFromResponse(input);

            const parsed = JSON.parse(result);
            expect(parsed.title).toBe('Test');
        });

        test('should throw error if no JSON found in string', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = 'This is plain text without any JSON objects';

            expect(() => {
                client.extractJsonFromResponse(input);
            }).toThrow();
        });

        test('should trim whitespace from response', () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const input = '   \n\n{"title": "Test", "description": "Desc", "keywords": "key1"}   \n\n';

            const result = client.extractJsonFromResponse(input);

            expect(result).not.toMatch(/^\s+/);
            expect(result).not.toMatch(/\s+$/);
        });
    });

    describe('generate', () => {
        test('should return error object if image file does not exist', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'non-existent-image.jpg');
            const imageMeta = { Title: '', Description: '', Keywords: [] };

            const result = await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('should reload config and prompt before generating', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            // Create a test image
            const imagePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(imagePath, Buffer.from('fake image data'));

            client.loadJsonConfig = jest.fn(() => client.config);
            client.loadPrompt = jest.fn(() => client.prompt);

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ response: '{"title": "Test", "description": "Desc", "keywords": "key"}' })
                })
            );

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(client.loadJsonConfig).toHaveBeenCalled();
            expect(client.loadPrompt).toHaveBeenCalled();
        });

        test('should encode image to base64 before sending', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'test-image.jpg');
            const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG header
            fs.writeFileSync(imagePath, imageData);

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ response: '{"title": "Test", "description": "Desc", "keywords": "key"}' })
                })
            );

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(global.fetch).toHaveBeenCalled();
            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.images).toBeDefined();
            expect(body.images[0]).toBe(imageData.toString('base64'));
        });

        test('should handle fetch errors gracefully', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(imagePath, 'fake image');

            global.fetch = jest.fn(() => Promise.reject(new Error('Network error')));

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const result = await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        test('should return success true when valid JSON response is received', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(imagePath, 'fake image');

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Test Title", "description": "Test Description", "keywords": "key1, key2"}'
                    })
                })
            );

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const result = await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(result.success).toBe(true);
            expect(result.data).toBeDefined();
        });

        test('should call ollamaTransformText if initial response is not valid JSON', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(imagePath, 'fake image');

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: 'This is not valid JSON'
                    })
                })
            );

            client.ollamaTransformText = jest.fn(() =>
                Promise.resolve({ title: 'Transformed', description: 'Response', keywords: 'key1' })
            );

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            const result = await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            expect(client.ollamaTransformText).toHaveBeenCalled();
        });

        test('should include generation parameters in request payload', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const imagePath = path.join(tempDir, 'test-image.jpg');
            fs.writeFileSync(imagePath, 'fake image');

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Test", "description": "Desc", "keywords": "key"}'
                    })
                })
            );

            const imageMeta = { Title: '', Description: '', Keywords: [] };
            await client.generate(imagePath, '2024-01-15', imageMeta, 'Berlin, Germany');

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.options.temperature).toBe(0.1);
            expect(body.options.top_p).toBe(0.8);
            expect(body.options.seed).toBe(42);
            expect(body.options.top_k).toBe(1);
        });
    });

    describe('ollamaTransformText', () => {
        test('should send request to Ollama API', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'test', options: {} };
            const firstPrompt = 'Original response';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Test", "description": "Desc", "keywords": "key"}'
                    })
                })
            );

            await client.ollamaTransformText(url, payload, firstPrompt);

            expect(global.fetch).toHaveBeenCalledWith(url, expect.any(Object));
        });

        test('should remove images key from payload', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'test', images: ['base64image'], options: {} };
            const firstPrompt = 'Original response';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Test", "description": "Desc", "keywords": "key"}'
                    })
                })
            );

            await client.ollamaTransformText(url, payload, firstPrompt);

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.images).toBeUndefined();
        });

        test('should return parsed JSON from response', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'test', options: {} };
            const firstPrompt = 'Original response';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Transformed Title", "description": "Desc", "keywords": "key1, key2"}'
                    })
                })
            );

            const result = await client.ollamaTransformText(url, payload, firstPrompt);

            expect(result.title).toBe('Transformed Title');
            expect(result.description).toBe('Desc');
            expect(result.keywords).toBe('key1, key2');
        });

        test('should return original response if fetch fails', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'test', options: {} };
            const firstPrompt = 'Original response';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: false,
                    status: 500,
                    json: () => Promise.resolve({})
                })
            );

            const result = await client.ollamaTransformText(url, payload, firstPrompt);

            expect(result).toBe(firstPrompt);
        });

        test('should return original response if response has no response property', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'test', options: {} };
            const firstPrompt = 'Original response';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ error: 'Some error' })
                })
            );

            const result = await client.ollamaTransformText(url, payload, firstPrompt);

            expect(result).toBe(firstPrompt);
        });

        test('should include transformation prompt in request', async () => {
            const client = new OllamaClient(appRoot, configFile, promptFile);
            const url = 'http://localhost:11434/api/generate';
            const payload = { model: 'test-model', prompt: 'original prompt', options: {} };
            const firstPrompt = 'Original response text';

            global.fetch = jest.fn(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        response: '{"title": "Test", "description": "Desc", "keywords": "key"}'
                    })
                })
            );

            await client.ollamaTransformText(url, payload, firstPrompt);

            const callArgs = global.fetch.mock.calls[0];
            const body = JSON.parse(callArgs[1].body);
            expect(body.prompt).toContain('Convert the following TEXT');
            expect(body.prompt).toContain(firstPrompt);
        });
    });
    */
});
