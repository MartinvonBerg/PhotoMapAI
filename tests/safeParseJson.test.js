import { safeParseJson } from '../js/generalHelpers.js';

describe('safeParseJson', () => {

  beforeEach(() => {
    // ensure no leftover pollution from other tests
    delete Object.prototype.polluted;
  });

  test('parses simple JSON', () => {
    const res = safeParseJson('{"a":1, "b": "ok"}');
    expect(res).toEqual({ a: 1, b: 'ok' });

    // real world JSON example
    const test = {
        "ollama": {
            "base_url": "http://localhost:11434",
            "model": "qwen3-vl:8b",
            "timeout": 120,
            "long_edge": 896
        },
        "generation": {
            "temperature": 0.1,
            "top_p": 0.8,
            "seed": 42,
            "top_k": 1,
            "repeat_penalty": 1.0,
            "stream": false,
            "format": {
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
                        "minItems": 10,
                        "maxItems": 15
                    }
                    },
                    "required": [
                        "title",
                        "description",
                        "keywords"
                    ],
                    "additionalProperties": false
                }
        },
        "output": {
            "print_raw_response": false
        }
        }
    const res2 = safeParseJson(JSON.stringify(test));
    expect(res2).toEqual(test);
  });

  test('removes dangerous keys at root and prevents prototype pollution', () => {
    const raw = JSON.stringify({ __proto__: { polluted: true }, safe: 'yes' });
    const res = safeParseJson(raw);

    // returned object must not contain the dangerous key (check own-property)
    expect(Object.prototype.polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(res, '__proto__')).toBe(false);
    expect(res.safe).toBe('yes');
  });

  test('removes dangerous keys nested in objects', () => {
    const raw = JSON.stringify({ nested: { __proto__: { polluted: true }, normal: 1 } });
    const res = safeParseJson(raw);

    expect(Object.prototype.hasOwnProperty.call(res.nested, '__proto__')).toBe(false);
    expect(res.nested.normal).toBe(1);
    expect(Object.prototype.polluted).toBeUndefined();
  });
  
  test('removes dangerous keys inside arrays', () => {
    const raw = JSON.stringify({ arr: [{ __proto__: { p: 1 } }, { constructor: { x: 1 } }, { prototype: 'bad' }] });
    const res = safeParseJson(raw);

    expect(Object.prototype.hasOwnProperty.call(res.arr[0], '__proto__')).toBe(false);
    expect(res.arr[1]).toEqual({});
    expect(res.arr[2]).toEqual({});
    expect(Object.prototype.p).toBeUndefined();
    expect(Object.prototype.x).toBeUndefined();
  });
  
  test('normalizes BOM, NUL and control characters before parse', () => {
    // include BOM and a literal NUL (\u0000) inside the JSON string
    const raw = '\uFEFF{"a":"b\u0000c"}';
    const res = safeParseJson(raw);

    // NUL should be removed by normalizeFileString before parsing
    expect(res.a).toBe('bc');
  });

  test('leaves similar-but-not-exact dangerous keys untouched', () => {
    const raw = JSON.stringify({ __PROTO__: { polluted: true }, normal: 'ok' });
    const res = safeParseJson(raw);

    // key is different in case and should remain
    expect(res).toHaveProperty('__PROTO__');
    expect(res.normal).toBe('ok');
    expect(Object.prototype.polluted).toBeUndefined();
  });

  test('throws on invalid JSON input', () => {
    expect(() => safeParseJson('{invalid-json: true,}')).toThrow();
  });

});
